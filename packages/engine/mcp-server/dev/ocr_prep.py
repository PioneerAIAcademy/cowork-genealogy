#!/usr/bin/env python3
"""OCR image prep for the Qwen-vs-Claude spike (dev-only, NOT shipped).

Ports book-to-tree's ``enhance_for_ocr`` (grayscale + autocontrast + unsharp
mask, JPEG q95, longest side capped) so the spike can generate the "enhanced"
Qwen variants with the exact reference pipeline. Reads a raw JPEG, writes an
enhanced JPEG, and prints a one-line JSON summary (dims + byte sizes for both
the raw and the prepped image) to stdout so the TS orchestrator can record
them. Run via ``uv run --with Pillow python3`` (system python has no PIL).

Usage:
    python3 ocr_prep.py <raw_in.jpg> <prep_out.jpg> [max_dim]

Upscaling stays off (Qwen downsamples to its token budget regardless); we only
cap the longest side (default 2000 px) to bound the payload.
"""
from __future__ import annotations

import json
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


def enhance_for_ocr(
    image_bytes: bytes,
    *,
    grayscale: bool = True,
    autocontrast_cutoff: int = 2,
    sharpen: bool = True,
    jpeg_quality: int = 95,
    max_dimension: int | None = 2000,
) -> tuple[bytes, int, int]:
    img = Image.open(BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    img = img.convert("L") if grayscale else img.convert("RGB")
    img = ImageOps.autocontrast(img, cutoff=autocontrast_cutoff)
    if sharpen:
        img = img.filter(ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=3))
    if max_dimension is not None and max(img.width, img.height) > max_dimension:
        if img.width >= img.height:
            new_size = (max_dimension, round(img.height * max_dimension / img.width))
        else:
            new_size = (round(img.width * max_dimension / img.height), max_dimension)
        img = img.resize(new_size, Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
    return buf.getvalue(), img.width, img.height


def main() -> int:
    raw_in, prep_out = Path(sys.argv[1]), Path(sys.argv[2])
    max_dim = int(sys.argv[3]) if len(sys.argv) > 3 else 2000
    raw = raw_in.read_bytes()  # binary — no encoding needed
    with Image.open(BytesIO(raw)) as im:
        rw, rh = im.size
    prepped, pw, ph = enhance_for_ocr(raw, max_dimension=max_dim)
    prep_out.write_bytes(prepped)  # binary — no encoding needed
    print(
        json.dumps(
            {
                "raw": {"w": rw, "h": rh, "bytes": len(raw)},
                "prep": {"w": pw, "h": ph, "bytes": len(prepped)},
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
