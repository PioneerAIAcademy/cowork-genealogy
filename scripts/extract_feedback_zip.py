"""Extract a feedback zip into a directory.

Usage: python3 -I scripts/extract_feedback_zip.py <zip> <dest>

Used by setup-feedback-case.sh and by hand (docs/alpha-feedback-guide.md Step 8)
in place of `unzip`, which on macOS fails on the non-ASCII names a report title
carries (#3706). On POSIX `zipfile` keeps a `\\` in a member name as a literal
character, so a Windows desktop bundle's `results\\log_006.json` would land as
one root-level file: every member name has `\\` rewritten to `/` first.
`extract` still drops absolute paths and `..` components, so a rewritten
`..\\x` cannot escape <dest>. A leading `~` in either argument is expanded,
because cmd and PowerShell do not expand it.

Stdlib only. Run it with `-I`: the bundle is untrusted input.
"""
import os
import sys
import zipfile


def main(argv):
    if len(argv) != 3:
        print("usage: extract_feedback_zip.py <zip> <dest>", file=sys.stderr)
        return 2
    zip_path, dest = (os.path.expanduser(a) for a in argv[1:3])
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                # open() checks the local header against orig_filename, which
                # this leaves alone.
                zf.extract(info, dest)
    # Broad on purpose: an encrypted member (RuntimeError), an unsupported
    # method (NotImplementedError) or a corrupt stream (zlib.error) fails the
    # whole extraction rather than skipping the member, and each should read
    # as one line, not a traceback.
    except Exception as exc:
        print(f"error: {zip_path}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
