"""Génère les visuels NSIS (écran de setup) depuis build/icon.png.
Pillow requis. Produit :
  - build/installerSidebar.bmp   (164×314, page d'accueil/fin de l'installateur)
  - build/installerHeader.bmp    (150×57, en-tête des pages)
La palette et la couleur de texte reprennent celles de l'icône (rose / prune).
"""
from pathlib import Path
import json
import math

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ICON = Image.open(HERE / "icon.png").convert("RGBA")
VERSION = json.loads((HERE.parent / "package.json").read_text(encoding="utf-8"))["version"]

BG_TOP = (22, 10, 17)
BG_BOTTOM = (46, 20, 34)
TEXT = (255, 234, 246)
DIM = (201, 168, 188)
ACCENT = (244, 90, 159)


def font(size: int, bold: bool = True):
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\seguisb.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def gradient(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def radial_glow(size: tuple[int, int], cx: int, cy: int, radius: int, alpha: int) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        r = radius * i // steps
        a = int(alpha * (1 - i / steps) ** 0.7)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*ACCENT, a))
    return layer


def fit_font(text: str, size: int, max_width: int, bold: bool = True):
    while size > 6:
        f = font(size, bold)
        if f.getbbox(text)[2] <= max_width:
            return f
        size -= 1
    return font(size, bold)


def draw_centered(draw, xy, text, f, fill):
    x, y = xy
    box = f.getbbox(text)
    width = box[2] - box[0]
    draw.text((x - width / 2, y), text, font=f, fill=fill)


# --- Sidebar 164 × 314 -------------------------------------------------------
sidebar = gradient(164, 314).convert("RGBA")
sidebar = Image.alpha_composite(sidebar, radial_glow((164, 314), 82, 110, 110, 70))
d = ImageDraw.Draw(sidebar)

logo = ICON.resize((96, 96), Image.LANCZOS)
sidebar.alpha_composite(logo, (34, 34))

# Liseré rose
d.rounded_rectangle([18, 148, 146, 150], radius=1, fill=ACCENT)

title_font = fit_font("KYARA BOT", 21, 136)
draw_centered(d, (82, 160), "KYARA BOT", title_font, TEXT)

subtitle_font = font(9, bold=False)
draw_centered(d, (82, 192), "AUTOMATISATION KYARA", subtitle_font, DIM)

version_font = font(9, bold=False)
draw_centered(d, (82, 286), f"v{VERSION}", version_font, DIM)

sidebar.convert("RGB").save(HERE / "installerSidebar.bmp")

# --- Header 150 × 57 ---------------------------------------------------------
header = gradient(150, 57).convert("RGBA")
header = Image.alpha_composite(header, radial_glow((150, 57), 32, 28, 70, 60))
d = ImageDraw.Draw(header)

logo_small = ICON.resize((36, 36), Image.LANCZOS)
header.alpha_composite(logo_small, (8, 10))

header_title = fit_font("KYARA BOT", 13, 92)
d.text((52, 12), "KYARA BOT", font=header_title, fill=TEXT)
d.text((52, 31), f"v{VERSION}", font=font(8, bold=False), fill=DIM)

header.convert("RGB").save(HERE / "installerHeader.bmp")

# --- Aperçus PNG (non versionnés) -------------------------------------------
preview_dir = HERE.parent / ".tmp" / "figma"
try:
    preview_dir.mkdir(parents=True, exist_ok=True)
    sidebar.convert("RGB").save(preview_dir / "installerSidebar-preview.png")
    header.convert("RGB").save(preview_dir / "installerHeader-preview.png")
except Exception:
    pass

print(f"build/installerSidebar.bmp et build/installerHeader.bmp générés (v{VERSION})")
