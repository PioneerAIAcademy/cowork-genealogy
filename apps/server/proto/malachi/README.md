# The malachi stack

The remote MCP server on `malachi`: the web tier with the chat off, the tool server, Postgres,
MinIO and an nginx edge. There is no worker, queue or shim.

| File | What it is |
|---|---|
| `compose.yml` | The seven services. Only `edge` publishes, on `127.0.0.1:8006`. |
| `nginx.conf` | The edge's routing and logs. |
| `env.template` | The settings, with blank secrets. |
| `malachi.sh` | What the `make malachi-*` targets run. |
| `dml_role.py` | Creates the role web and tools connect as. Runs in the `migrate` one-shot. |
| `project_export.py` | `make malachi-export`. Runs in the web image. |
| `rehearsal.sh` | `make malachi-rehearsal`: all of this on a Mac, under its own name. |

`tests/test_malachi_stack.py` and `tests/test_malachi_role_pg.py` pin the rules.

## What matters on this host

- **Port 8006 is public the moment anything binds it.** Funnel serves it at the host root. Bring
  the stack up with `EDGE=off` first, and start the edge last.
- **Never run `make proto-up`, `tailscale serve reset` or `tailscale funnel --https=443 off`
  here, and do not reboot.** `/wiki` and `/pop-stats` are production ingress for every installed
  `.mcpb`.
- **Keep `~/.config/genealogy-beta/env`.** A new `FS_TOKEN_ENC_KEY` answers 401 to every user. A
  new `POSTGRES_PASSWORD` is refused by the initialised database. `make malachi-up` refuses
  blank secrets, and refuses to write a new file over a `DATA_DIR` that holds a stack.
- **Everything is under `DATA_DIR`,** `/home/data/genealogy-beta`: `postgres/`, `minio/`,
  `backups/`, `exports/`. Backups sit on the same disk as the data and nothing runs them on a
  timer.

## First bring-up

The repository is public, so `git clone https://github.com/PioneerAIAcademy/cowork-genealogy.git`
works with no key. Whoever deploys does the first clone, in a folder of their own on the root
disk. The host needs bash, curl, git, make and docker, and nothing else.

```
ALLOWED_EMAILS=you@example.com make malachi-up EDGE=off
make malachi-check EDGE=off PUBLIC=1 REACH=1
make malachi-up
make malachi-check PUBLIC=1
```

| Step | What it proves |
|---|---|
| `malachi-up EDGE=off` | The first run writes the env file. Everything but the edge starts, and port 8006 stays free. |
| `malachi-check EDGE=off PUBLIC=1 REACH=1` | The tiers are healthy, `/wiki` and `/pop-stats` answer 200 and the root slot answers 502, and the tools container reaches both sidecars. |
| `malachi-up` | The edge starts once web and tools are healthy. |
| `malachi-check PUBLIC=1` | `/wiki` and `/pop-stats` still answer 200, the slot answers 200, and every route check passes through Funnel. |

If `REACH=1` fails, the sidecars bind host loopback only, so a container reaches them through the
public hostname or not at all. Set `WIKI_API_URL` and `POP_STATS_URL` in the env file. The next
thing to try is `extra_hosts` mapping the hostname to the host's tailnet address; it is untested.

Another process may hold port 8006 for a while, such as a probe. `EDGE=off` on `malachi-up` stops
the edge and leaves everything else running. `malachi-check` fails while the edge is stopped
unless it is given `EDGE=off`.

Set `WEB_PUBLIC_URL` to `PUBLIC_URL` in the env file only on a ref that has dropped the viewer's
`/#/p/<id>` links, because with the SPA off they lead nowhere. Blank, `project_context` offers no
links at all. Then run `make malachi-up`.

## Day to day

| Target | What it does |
|---|---|
| `make malachi-check` | Health, routes, the deployed sha and disk. `BASE_URL=` points it elsewhere. |
| `make malachi-logs SERVICE=web` | The last 200 lines. `TAIL=`, and `FOLLOW=1` to follow. |
| `make malachi-deploy REF=<sha>` | Fetch, check out detached, `malachi-up`, `malachi-check`. Needs a clean tree. |
| `make malachi-backup` | `pg_dump` and a mirror of MinIO to `DATA_DIR/backups/<UTC>/`. Keeps the newest `KEEP` (14). |
| `make malachi-restore-check` | Restores the newest backup into a scratch database, then checks the ledger and every blob against the mirror. |
| `make malachi-export EMAIL=` or `PROJECT=` | A project's files in `DATA_DIR/exports/<id>/`, what the web tier's download would give, with its `MISSING.txt`. |
| `make malachi-down` | Stops the stack and keeps the data. |

**Roll back** with `make malachi-deploy REF=<previous sha>`. A migration is not undone, and an
older build is fine on a newer schema.

**A deploy** recreates web and tools, so the edge answers 502 for a few seconds. The edge itself
restarts only when `nginx.conf` changes.

**After a reboot** Docker restarts the containers in no fixed order. The edge answers 502 until
web and tools are up.

**Memory.** `malachi-up` refuses under 4 GB free, because a build shares this host with
`wiki-query-api` and `pop-stats-api`. `MIN_FREE_MEM_GB=` overrides it. `malachi-check` and
`malachi-backup` want 20 GB free on `DATA_DIR` (`MIN_FREE_GB=`), and `malachi-check` wants 10 GB on
Docker's root (`MIN_DOCKER_FREE_GB=`).

## Restoring after a loss

The env file must be the one the backup was taken under.

```
make malachi-wipe CONFIRM=yes
make malachi-restore CONFIRM=yes BACKUP=<folder under DATA_DIR/backups>
make malachi-up
make malachi-check
```

`malachi-wipe` deletes `postgres/` and `minio/` and keeps `backups/`, `exports/` and the env file.
`malachi-restore` refuses a database that holds tables, and takes the newest backup with no
`BACKUP=`. `malachi-up` re-creates the role's grants, which a restore leaves out.

## Rehearsing

`make malachi-rehearsal` runs on a developer's Mac from a clean tree. It clones the branch, runs
every target against a real stack on port 18006, and removes everything. No CI job brings the stack
up, so this is the only end-to-end proof. It reaches nothing outside the Mac, so `PUBLIC=1` and a
successful `REACH=1` are proved only on `malachi`.
