#!/usr/bin/env python3
"""U13 probe: do the drivers' Postgres connections through the bastion's SSM forward keep
``verify-full`` TLS?

The forward listens on 127.0.0.1, but RDS's certificate names its endpoint. psycopg gets
``host=<endpoint> hostaddr=127.0.0.1``: libpq verifies the certificate against ``host``
and connects to ``hostaddr``. node-postgres has no hostaddr, so the operator maps the
endpoint to 127.0.0.1 in /etc/hosts (here: ``docker run --add-host``).

This stands up a scratch CA, a server certificate for ``rds.invalid.test`` and a
``postgres:16-alpine`` with ``ssl=on`` on 127.0.0.1:<port>, then:

    psycopg  host=rds.invalid.test hostaddr=127.0.0.1   verify-full   must connect
    psycopg  host=127.0.0.1                             verify-full   must FAIL (name mismatch)
    node     rds.invalid.test via --add-host            verify-full   must connect
    node     rds.invalid.test without --add-host                      must FAIL (ENOTFOUND)

Certificates go in with ``docker cp`` (colima cannot bind-mount the scratchpad). Needs
docker, openssl and the local images ``postgres:16-alpine`` and ``node:24-slim``. $0, no
AWS. Exit 0 when all four come out as stated, 1 otherwise, 2 when it cannot run.

    cd apps/server && uv run python dev/probe_tls_hostaddr.py [--port 15433] [--keep]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

NAME = "rds.invalid.test"
CONTAINER = "u13-tls-hostaddr"
PG_IMAGE = "postgres:16-alpine"
NODE_IMAGE = "node:24-slim"
PASSWORD = "probe-only"

# node-postgres's own handshake: an SSLRequest, the server's 'S', then TLS on that socket
# verified against the CA for the name -- what pg does under sslmode verify-full.
NODE_CHECK = (
    "const net=require('net'),tls=require('tls'),fs=require('fs');const [h,p]=process.argv.slice(1);"
    "const c=net.connect(+p,h,()=>{const b=Buffer.alloc(8);b.writeInt32BE(8,0);b.writeInt32BE(80877103,4);c.write(b);});"
    "c.once('data',d=>{if(d.toString()!=='S'){console.log('NO_SSL');process.exit(1);}"
    "const s=tls.connect({socket:c,servername:h,ca:fs.readFileSync('/ca.crt')},()=>{console.log('TLS_OK '+s.authorized);"
    "s.destroy();process.exit(0);});s.on('error',e=>{console.log('TLS_ERR '+e.code);process.exit(1);});});"
    "c.on('error',e=>{console.log('NET_ERR '+e.code);process.exit(1);});"
)


def psycopg_dsn(host: str, port: int, *, hostaddr: str | None, ca: Path) -> str:
    parts = [f"host={host}"] + ([f"hostaddr={hostaddr}"] if hostaddr else []) + [
        f"port={port}", "dbname=postgres", "user=postgres", f"password={PASSWORD}",
        "sslmode=verify-full", f"sslrootcert={ca}", "connect_timeout=5"]
    return " ".join(parts)


def sh(*argv: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(list(argv), capture_output=True, text=True, encoding="utf-8", check=check)


def make_certs(d: Path) -> None:
    sh("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=u13-scratch-ca",
       "-keyout", str(d / "ca.key"), "-out", str(d / "ca.crt"))
    sh("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", f"/CN={NAME}",
       "-keyout", str(d / "server.key"), "-out", str(d / "server.csr"))
    (d / "san.ext").write_text(f"subjectAltName=DNS:{NAME}\n", encoding="utf-8")
    sh("openssl", "x509", "-req", "-in", str(d / "server.csr"), "-CA", str(d / "ca.crt"), "-CAkey", str(d / "ca.key"),
       "-CAcreateserial", "-days", "1", "-extfile", str(d / "san.ext"), "-out", str(d / "server.crt"))


def start_postgres(d: Path, port: int) -> None:
    sh("docker", "rm", "-f", CONTAINER, check=False)
    sh("docker", "create", "--name", CONTAINER, "-e", f"POSTGRES_PASSWORD={PASSWORD}", "-p", f"{port}:5432",
       "--entrypoint", "sh", PG_IMAGE, "-c",
       "mkdir -p /certs && cp /tmp/c/server.crt /tmp/c/server.key /certs/ && chown postgres /certs/* && "
       "chmod 600 /certs/server.key && exec docker-entrypoint.sh postgres -c ssl=on "
       "-c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key")
    tmp = d / "c"
    tmp.mkdir()
    for f in ("server.crt", "server.key"):
        shutil.copy(d / f, tmp / f)
    sh("docker", "cp", str(tmp), f"{CONTAINER}:/tmp/c")
    sh("docker", "start", CONTAINER)


def psycopg_connects(dsn: str) -> tuple[bool, str]:
    import psycopg

    try:
        with psycopg.connect(dsn) as conn:
            return True, str(conn.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()").fetchone())
    except psycopg.Error as exc:
        return False, str(exc).splitlines()[0][:160]


def node_connects(ca: Path, port: int, *, add_host: bool) -> tuple[bool, str]:
    sh("docker", "rm", "-f", f"{CONTAINER}-node", check=False)
    argv = ["docker", "create", "--name", f"{CONTAINER}-node"] + (
        ["--add-host", f"{NAME}:host-gateway"] if add_host else []) + [NODE_IMAGE, "node", "-e", NODE_CHECK, NAME, str(port)]
    sh(*argv)
    sh("docker", "cp", str(ca), f"{CONTAINER}-node:/ca.crt")
    res = sh("docker", "start", "-a", f"{CONTAINER}-node", check=False)
    sh("docker", "rm", "-f", f"{CONTAINER}-node", check=False)
    out = (res.stdout + res.stderr).strip()
    return "TLS_OK true" in out, out[-160:]


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=15433)
    p.add_argument("--keep", action="store_true", help="leave the postgres container running")
    args = p.parse_args(argv)
    if not shutil.which("docker") or not shutil.which("openssl"):
        print("probe_tls_hostaddr: needs docker and openssl", file=sys.stderr)
        return 2
    results: list[tuple[str, bool, str]] = []
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        try:
            make_certs(d)
            start_postgres(d, args.port)
            ok = False
            for _ in range(30):
                ok, _detail = psycopg_connects(psycopg_dsn(NAME, args.port, hostaddr="127.0.0.1", ca=d / "ca.crt"))
                if ok:
                    break
                time.sleep(1)
            for label, want, (got, detail) in (
                ("psycopg host=<name> hostaddr=127.0.0.1 verify-full connects", True,
                 psycopg_connects(psycopg_dsn(NAME, args.port, hostaddr="127.0.0.1", ca=d / "ca.crt"))),
                ("psycopg host=127.0.0.1 verify-full is refused (name mismatch)", False,
                 psycopg_connects(psycopg_dsn("127.0.0.1", args.port, hostaddr=None, ca=d / "ca.crt"))),
                ("node --add-host <name>:host-gateway verify-full connects", True,
                 node_connects(d / "ca.crt", args.port, add_host=True)),
                ("node without --add-host fails to resolve", False,
                 node_connects(d / "ca.crt", args.port, add_host=False)),
            ):
                results.append((label, got == want, detail))
        except subprocess.CalledProcessError as exc:
            print(f"probe_tls_hostaddr: {' '.join(exc.cmd[:3])}…: {(exc.stderr or '').strip()[:300]}", file=sys.stderr)
            return 2
        finally:
            if not args.keep:
                sh("docker", "rm", "-f", CONTAINER, check=False)
    for label, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}  ({detail})")
    return 0 if results and all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
