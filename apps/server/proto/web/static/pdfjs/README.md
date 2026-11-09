# Vendored pdf.js

The chat-off upload page (`/upload/<project id>`, issue #4001) runs pdf.js in the
patron's browser to read a PDF's text layer before it uploads. The tier serves these
files itself at `/static/pdfjs/`; it never loads pdf.js from a CDN.

- **Package:** `pdfjs-dist` **6.4.299**, released 2026-10-03.
  - tarball: `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz`
  - npm integrity: `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`
- **Files**, copied unmodified from the package's `legacy/build/`, plus its `LICENSE` (Apache-2.0):

  | File | sha256 |
  |---|---|
  | `pdf.min.mjs` | `bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259` |
  | `pdf.worker.min.mjs` | `145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6` |

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
3. Copy `legacy/build/pdf.min.mjs`, `legacy/build/pdf.worker.min.mjs` and `LICENSE` here.
4. Update the version, integrity and hashes above, then run `tests/test_pdfjs_vendored.py`.

This README is not shipped: the Beanstalk web bundle copies only the three files
above (`scripts/eb_bundles/build.py`), because its verifier refuses a `README.md`
in tier code.
