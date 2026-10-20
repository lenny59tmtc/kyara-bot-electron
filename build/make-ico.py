"""Génère build/icon.ico (multi-tailles) à partir de build/icon.png.
Format standard moderne : entrées BMP/DIB pour 16–128, entrée PNG pour 256.
Pillow requis.
"""
from pathlib import Path
import io
import struct

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "icon.png"
DIB_SIZES = [16, 24, 32, 48, 64, 128]
PNG_SIZE = 256

img = Image.open(SRC).convert("RGBA")


def dib_entry(size: int) -> bytes:
    """ICONIMAGE au format BMP/DIB 32 bits + masque AND."""
    im = img.resize((size, size), Image.LANCZOS)
    pixels = im.tobytes("raw", "BGRA")  # lignes du haut vers le bas
    row = size * 4
    xor = b"".join(pixels[i * row:(i + 1) * row] for i in range(size - 1, -1, -1))
    mask_row = ((size + 31) // 32) * 4
    mask = b"\x00" * (mask_row * size)
    header = struct.pack(
        "<IiiHHIIiiII",
        40,          # biSize
        size,        # biWidth
        size * 2,    # biHeight (XOR + AND)
        1,           # biPlanes
        32,          # biBitCount
        0,           # biCompression = BI_RGB
        len(xor),    # biSizeImage
        0, 0, 0, 0,  # résolution / couleurs
    )
    return header + xor + mask


def png_entry(size: int) -> bytes:
    im = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


entries = [(size, dib_entry(size)) for size in DIB_SIZES]
entries.append((PNG_SIZE, png_entry(PNG_SIZE)))

header = struct.pack("<HHH", 0, 1, len(entries))
offset = 6 + 16 * len(entries)
directory = b""
payload = b""
for size, blob in entries:
    directory += struct.pack(
        "<BBBBHHII",
        0 if size >= 256 else size,
        0 if size >= 256 else size,
        0, 0, 1, 32, len(blob), offset,
    )
    payload += blob
    offset += len(blob)

(HERE / "icon.ico").write_bytes(header + directory + payload)
print(f"build/icon.ico écrit ({', '.join(f'{s}x{s}' for s in DIB_SIZES + [PNG_SIZE])}) depuis build/icon.png")
