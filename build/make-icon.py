"""Génère build/icon.png et build/icon.ico (Pillow requis)."""
from PIL import Image, ImageDraw, ImageFilter

import numpy as np

SIZE = 1024
RADIUS = 232


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(size, top_left, bottom_right):
    xs = np.linspace(0.0, 1.0, size, dtype=np.float32)[None, :]
    ys = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]
    t = np.clip((xs + ys) / 2.0, 0.0, 1.0)
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    for i in range(3):
        arr[:, :, i] = (top_left[i] + (bottom_right[i] - top_left[i]) * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def main():
    # Fond dégradé violet -> cyan
    bg = gradient(SIZE, (124, 58, 237), (34, 211, 238)).convert("RGBA")

    # Masque coins arrondis
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=RADIUS, fill=255)

    # Léger éclairage en haut
    shine = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse((-SIZE * 0.25, -SIZE * 0.55, SIZE * 1.25, SIZE * 0.45), fill=(255, 255, 255, 46))
    bg = Image.alpha_composite(bg, shine)

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)

    # Éclair
    bolt = [
        (612, 118),
        (300, 566),
        (478, 566),
        (420, 906),
        (734, 430),
        (552, 430),
        (612, 118),
    ]
    draw = ImageDraw.Draw(icon)
    draw.polygon(bolt, fill=(255, 226, 122, 255), outline=(90, 46, 160, 255))
    # contour un peu plus net
    draw.line(bolt + [bolt[0]], fill=(255, 240, 170, 255), width=10)

    icon = icon.filter(ImageFilter.SMOOTH)

    icon.save("build/icon.png")
    icon.resize((256, 256), Image.LANCZOS).save(
        "build/icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("build/icon.png et build/icon.ico générés")


if __name__ == "__main__":
    main()
