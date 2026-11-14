# Vendored pdf.js

The chat-off upload page (`/upload/<project id>`, issue #4001) runs pdf.js in the
patron's browser to read a PDF's text layer before it uploads. The tier serves these
files itself at `/pdfjs/`; it never loads pdf.js from a CDN. Not at `/static/`: on
Beanstalk the platform's nginx answers that path from the bundle's own `static/` folder.

- **Package:** `pdfjs-dist` **6.4.299**, released 2026-10-03.
  - tarball: `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz`
  - npm integrity: `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`
- **Files**, copied unmodified from the package's `legacy/build/`, plus its `LICENSE` (Apache-2.0):

  | File | sha256 |
  |---|---|
  | `pdf.min.mjs` | `bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259` |
  | `pdf.worker.min.mjs` | `145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6` |

  Plus `cmaps/`, copied unmodified from the package's `cmaps/` (168 `.bcmap` files,
  predefined CMaps a CID font with no `/ToUnicode` table needs for text extraction,
  plus its `LICENSE`):

  cmaps/ digest: `afd390807f2a7122ddeac6e6885f86ef71405659280cc6c17569bd580583a547`

  (sha256 of the sorted `"<name> <sha256 of file>\n"` lines over every file in
  `cmaps/` — `tests/test_pdfjs_vendored.py` recomputes it, and also asserts the
  directory holds exactly 168 `.bcmap` files plus `LICENSE`). One aggregate digest
  rather than a per-file table, which would be 168 unreviewable rows; a mismatch
  still fails loudly, it just doesn't say which file moved.

## Why the legacy build

The standard build (`build/`) needs JavaScript added in 2025:
- `Promise.try`, which Node 22 does not have, so it fails in the `server-pytest` job's Node;
- `Uint8Array.prototype.toHex`, which a browser only a year or two old does not have.

The legacy build is the same pdf.js release compiled without them. It runs in Node 22,
so `tests/test_pdfjs_vendored.py` runs these exact files, the ones the browser loads.
It also runs in older browsers, so no patron is locked out for not having the newest one.

## Updating

1. Pick a release at least two weeks old.
2. `npm pack pdfjs-dist@<version>`, and check the tarball against `npm view pdfjs-dist@<version> dist.integrity`.
3. Copy `legacy/build/pdf.min.mjs`, `legacy/build/pdf.worker.min.mjs` and `LICENSE` here, and
   replace `cmaps/` wholesale with the package's own `cmaps/` (every `.bcmap` file plus its
   `LICENSE`, unmodified).
4. Update the version, integrity and hashes above, and the `cmaps/` file count and digest, and
   `PDFJS_VERSION` in `web/pages.py`. Then run `tests/test_pdfjs_vendored.py` and
   `tests/test_proto_rehearsal.py`.

The hashes are load-bearing. Minified pdf.js has 12-digit runs in its data tables, and
`test_proto_rehearsal.py`'s scan for pasted AWS account ids skips these two files only
while their sha256 matches the table above. Edit a file, or skip the hash update, and the
scan reads it again.

This README is not shipped: the Beanstalk web bundle copies only the three files
and the `cmaps/` directory above (`scripts/eb_bundles/build.py`), because its
verifier refuses a `README.md` in tier code.
