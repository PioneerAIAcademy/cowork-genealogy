"""Minimal one-page PDFs, written by hand: a text layer, two lines of text (a register's
rows), a word split across two fonts beside a gap with no space character (split), a
CID-keyed CJK font with no ToUnicode table and no embedded font file (cid), and an image
only (a scan). Run: python make_pdfs.py <this directory>."""
import sys, zlib
from pathlib import Path

def pdf(objects: list[bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)

def stream(data: bytes, extra: str = "") -> bytes:
    return f"<< /Length {len(data)} {extra}>>\nstream\n".encode() + data + b"\nendstream"

def text_pdf() -> bytes:
    content = b"BT /F1 18 Tf 72 720 Td (Ugo Stella, Milano 1910) Tj ET"
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        stream(content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])

def rows_pdf() -> bytes:
    content = (b"BT /F1 14 Tf 72 720 Td (John Smith 34 Farmer) Tj ET\n"
               b"BT /F1 14 Tf 72 700 Td (Mary Smith 30 Keeping house) Tj ET")
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        stream(content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])

def split_pdf() -> bytes:
    # A bold "J" then "ohn" in the regular font: two pdf.js items in one word. Then a
    # kerning gap of 2 em before "Smith", with no space character in the content.
    content = b"BT /F2 14 Tf 72 720 Td (J) Tj /F1 14 Tf [(ohn) -2000 (Smith)] TJ ET"
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        stream(content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ])

def cid_pdf() -> bytes:
    # 田中 東京 ("Tanaka", a name, and "Tokyo", a place) as a UCS-2BE hex string: the
    # /Encoding /UniJIS-UCS2-H predefined CMap treats the content stream's codes as
    # Unicode code points directly, mapping them to CIDs for the Adobe-Japan1 ordering.
    # No /ToUnicode and no embedded font file (no /FontFile3 on the descriptor): pdf.js
    # can only recover these glyphs' codes -- let alone their text -- by resolving the
    # named CMap through cMapUrl.
    content = b"BT /F1 24 Tf 72 720 Td <75304E2D002067714EAC> Tj ET"
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        stream(content),
        b"<< /Type /Font /Subtype /Type0 /BaseFont /MS-Mincho /Encoding /UniJIS-UCS2-H "
        b"/DescendantFonts [6 0 R] >>",
        b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MS-Mincho "
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> "
        b"/FontDescriptor 7 0 R /DW 1000 >>",
        b"<< /Type /FontDescriptor /FontName /MS-Mincho /Flags 4 "
        b"/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 "
        b"/CapHeight 880 /StemV 80 >>",
    ])

def scan_pdf() -> bytes:
    w = h = 8  # a tiny grey image: no text operators anywhere
    raw = zlib.compress(bytes([128]) * (w * h))
    content = b"q 612 0 0 792 0 0 cm /Im1 Do Q"
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /XObject << /Im1 5 0 R >> >> >>",
        stream(content),
        stream(raw, f"/Type /XObject /Subtype /Image /Width {w} /Height {h} "
                    "/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode "),
    ])

out = Path(sys.argv[1])
(out / "text.pdf").write_bytes(text_pdf())
(out / "scan.pdf").write_bytes(scan_pdf())
(out / "rows.pdf").write_bytes(rows_pdf())
(out / "split.pdf").write_bytes(split_pdf())
(out / "cid.pdf").write_bytes(cid_pdf())
print("wrote", sorted(p.name for p in out.iterdir()))
