"""#4001: the vendored pdf.js (``proto/web/static/pdfjs/``) reads a text layer.

Runs the exact files the upload page loads, under Node, over two one-page fixtures in
``tests/fixtures/pdfjs/`` (written by its ``make_pdfs.py``): one with a text layer, one
image-only like a scan. The page sends the text it finds beside the original, and a
multi-page PDF with none gets the upload route's 422, so "no text" must read as empty.

Needs ``node`` (Node 22 in the server-pytest job). Without it the test skips locally
and fails under CI, so a runner that lost Node cannot pass it silently.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PDFJS = HERE.parent / "proto" / "web" / "static" / "pdfjs"
FIXTURES = HERE / "fixtures" / "pdfjs"


def _extract(pdf: str) -> dict:
    node = shutil.which("node")
    if node is None:
        if os.environ.get("CI"):
            pytest.fail("node is not on PATH; the server-pytest job sets up Node 22 for this test")
        pytest.skip("node is not on PATH")
    run = subprocess.run(
        [node, str(FIXTURES / "extract.mjs"), str(PDFJS), str(FIXTURES / pdf)],
        capture_output=True, text=True, encoding="utf-8", timeout=120, check=False,
    )
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout.strip().splitlines()[-1])


def test_the_vendored_files_are_the_ones_the_page_loads():
    assert {p.name for p in PDFJS.iterdir()} >= {"pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE", "README.md"}
    assert "6.4.299" in (PDFJS / "README.md").read_text(encoding="utf-8")


def test_pdfjs_reads_the_text_layer():
    assert _extract("text.pdf") == {"pages": 1, "text": ["Ugo Stella, Milano 1910"]}


def test_pdfjs_finds_no_text_in_a_scan():
    assert _extract("scan.pdf") == {"pages": 1, "text": [""]}


def _run_page_text_layer(pdf: str, tmp_path: Path) -> str:
    """The upload page's own ``textLayer`` function (``pages._UPLOAD_SCRIPT``), cut from
    the script and run under Node on a fixture, with the vendored pdf.js. It is the code
    the browser runs, so a call pdf.js no longer has (``doc.destroy()`` in pdf.js 6) fails
    here rather than silently uploading a PDF without its text."""
    # pages.py needs only the standard library; import it the way the tier does (proto/ on
    # sys.path), not through test_proto_web, which loads psycopg.
    if str(PDFJS.parents[2]) not in sys.path:
        sys.path.insert(0, str(PDFJS.parents[2]))
    from web import pages

    node = shutil.which("node")
    if node is None:
        if os.environ.get("CI"):
            pytest.fail("node is not on PATH; the server-pytest job sets up Node 22 for this test")
        pytest.skip("node is not on PATH")
    js = pages._UPLOAD_SCRIPT
    fn = js[js.index("async function textLayer"):js.index("function send(")]
    runner = tmp_path / "run.mjs"
    runner.write_text(
        'import { readFile } from "node:fs/promises";\n'
        f"const pdfjsLib = await import({json.dumps((PDFJS / 'pdf.min.mjs').as_uri())});\n"
        f"pdfjsLib.GlobalWorkerOptions.workerSrc = {json.dumps((PDFJS / 'pdf.worker.min.mjs').as_uri())};\n"
        "const say = () => {};\n"
        + fn
        + f"const bytes = await readFile({json.dumps(str(FIXTURES / pdf))});\n"
        f'const file = new File([bytes], {json.dumps(pdf)}, {{ type: "application/pdf" }});\n'
        "console.log(JSON.stringify(await textLayer(file)));\n"
        "process.exit(0);\n",
        encoding="utf-8",
    )
    run = subprocess.run([node, str(runner)], capture_output=True, text=True, encoding="utf-8",
                         timeout=120, check=False)
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout.strip().splitlines()[-1])


def test_the_upload_pages_own_code_sends_the_text_layer(tmp_path):
    assert _run_page_text_layer("text.pdf", tmp_path) == "--- Page 1 ---\nUgo Stella, Milano 1910"


def test_the_upload_pages_own_code_sends_no_text_for_a_scan(tmp_path):
    assert _run_page_text_layer("scan.pdf", tmp_path) == ""
