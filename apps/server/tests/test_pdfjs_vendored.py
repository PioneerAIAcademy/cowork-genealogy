"""#4001: the upload page's text-layer code, run under Node with the vendored pdf.js.

The block between ``// --- text layer: start`` and ``// --- text layer: end`` in
``pages._UPLOAD_SCRIPT`` is cut out and run as it is, with ``location`` set as if the page
were at ``/upload/<id>``. It loads ``proto/web/static/pdfjs/`` through the same versioned
URLs the browser uses, so a pdf.js call the vendored version no longer has (pdf.js 6
dropped ``doc.destroy()``) fails here instead of a PDF quietly going up without its text.

Fixtures in ``tests/fixtures/pdfjs/``, written by its ``make_pdfs.py``: a one-line text
PDF, a two-line one (a register's rows), and an image-only one (a scan).

Needs ``node`` (Node 22 in the server-pytest job). Without it the tests skip locally and
fail under CI, so a runner that lost Node cannot pass them silently.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "proto" / "web"
PDFJS = WEB / "static" / "pdfjs"
FIXTURES = HERE / "fixtures" / "pdfjs"

# pages.py and project_blobs.py need only the standard library; import them the way the
# tier does (proto/ on sys.path), not through test_proto_web, which loads psycopg.
if str(WEB.parent) not in sys.path:
    sys.path.insert(0, str(WEB.parent))
from web import pages  # noqa: E402
from web.project_blobs import UPLOAD_MAX_BYTES  # noqa: E402

SCRIPT = pages._UPLOAD_SCRIPT
BLOCK = SCRIPT[SCRIPT.index("// --- text layer: start"):SCRIPT.index("// --- text layer: end")]


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        if os.environ.get("CI"):
            pytest.fail("node is not on PATH; the server-pytest job sets up Node 22 for these tests")
        pytest.skip("node is not on PATH")
    return node


def _text_layer(pdf: str, tmp_path: Path) -> str:
    """What the upload page would send as ``text`` for this fixture."""
    page_url = (WEB / "upload" / "proj_0123456789abcdef").as_uri()
    runner = tmp_path / "run.mjs"
    runner.write_text(
        'import { readFile } from "node:fs/promises";\n'
        f"globalThis.location = {{ href: {json.dumps(page_url)} }};\n"
        "const say = () => {};\n"
        + BLOCK
        + f"const bytes = await readFile({json.dumps(str(FIXTURES / pdf))});\n"
        f'const file = new File([bytes], {json.dumps(pdf)}, {{ type: "application/pdf" }});\n'
        "console.log(JSON.stringify(await textLayer(file)));\n"
        "process.exit(0);\n",
        encoding="utf-8",
    )
    run = subprocess.run([_node(), str(runner)], capture_output=True, text=True, encoding="utf-8",
                         timeout=120, check=False)
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout.strip().splitlines()[-1])


def test_the_page_sends_a_pdfs_text_layer(tmp_path):
    assert _text_layer("text.pdf", tmp_path) == "--- Page 1 ---\nUgo Stella, Milano 1910"


def test_the_page_keeps_each_line_on_its_own_line(tmp_path):
    """A register's rows stay rows, so a name keeps the age and place on its line."""
    assert _text_layer("rows.pdf", tmp_path) == "--- Page 1 ---\nJohn Smith 34 Farmer\nMary Smith 30 Keeping house"


def test_the_page_sends_no_text_for_a_scan(tmp_path):
    assert _text_layer("scan.pdf", tmp_path) == ""


def test_the_vendored_files_are_the_ones_the_page_loads():
    assert {p.name for p in PDFJS.iterdir()} >= {"pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE", "README.md"}
    version = re.search(r'const PDFJS_VERSION = "([^"]+)";', SCRIPT).group(1)
    assert f"**{version}**" in (PDFJS / "README.md").read_text(encoding="utf-8"), \
        "the page's PDFJS_VERSION must name the vendored release"


def test_the_pages_size_limit_is_the_routes():
    assert re.search(r"const MAX_BYTES = (\d+);", SCRIPT).group(1) == str(UPLOAD_MAX_BYTES)
