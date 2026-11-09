"""One user's OpenRouter key onto their row: `make malachi-openrouter EMAIL=`.

Run inside the web image (``malachi.sh openrouter`` binds this file). ``users.openrouter_key_enc``
is the column the connector door reads, so a seeded user can transcribe and nobody else can:
linking is off on this stack. The key arrives on stdin, never argv, and is stored as ciphertext.
It stays out of ``web/`` so it does not ship in the web bundle.

    python openrouter_seed.py --email a@example.com
"""

from __future__ import annotations

import argparse
import os
import sys

import psycopg

from web import auth

SET_KEY_SQL = "UPDATE users SET openrouter_key_enc = %s WHERE lower(email) = lower(%s)"


def seed(dsn: str, email: str, key: str) -> bool:
    """Encrypt ``key`` onto ``email``'s row. False when no such user exists."""
    with psycopg.connect(dsn) as conn:
        return conn.execute(SET_KEY_SQL, (auth.encrypt(key), email)).rowcount > 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    args = parser.parse_args(argv)
    key = sys.stdin.read().strip()
    if not key:
        print("no key on stdin", file=sys.stderr)
        return 2
    if not seed(os.environ["PG_DSN"], args.email, key):
        print(f"no user {args.email}: they must sign in once first", file=sys.stderr)
        return 1
    print(f"seeded {args.email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
