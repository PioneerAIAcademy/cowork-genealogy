"""Two minimal one-page PDFs, written by hand: one with a text layer, one image-only."""
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
print("wrote", sorted(p.name for p in out.iterdir()))
