#!/usr/bin/env python3
"""Generates the Ritmo Studio app icon.

  build/icon.png   1024x1024, macOS-style rounded square with transparent margin
  build/icon.icns  macOS (iconset made with sips, packed with iconutil; macOS only)
  build/icon.ico   Windows, 16-256 px, from a tighter full-bleed variant

Needs Pillow:  python3 scripts/make-icon.py
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "build"
SS = 4  # supersampling factor
SIZE = 1024

TOP = (0x26, 0x31, 0x3A)
BOTTOM = (0x1B, 0x22, 0x28)
BRASS = (0xF0, 0xA2, 0x40)
BRASS_HI = (0xF7, 0xBC, 0x66)
BRASS_LO = (0xE3, 0x8D, 0x2A)
DIM = (0x33, 0x3F, 0x49)
DIM_HI = (0x3B, 0x48, 0x53)

# 4x4 step grid, lit cells form an equalizer-like rhythm (column heights 2, 4, 1, 3).
HEIGHTS = [2, 4, 1, 3]
LIT = [[row >= 4 - HEIGHTS[col] for col in range(4)] for row in range(4)]


def vgradient(w, h, top, bottom):
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return grad.resize((w, h))


def rounded_mask(size, box, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def render(body_margin, radius_ratio, shadow):
    S = SIZE * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = body_margin * SS
    box = (m, m, S - m - 1, S - m - 1)
    body = S - 2 * m
    radius = round(body * radius_ratio)

    if shadow:
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        off = 14 * SS
        ImageDraw.Draw(sh).rounded_rectangle(
            (box[0], box[1] + off, box[2], box[3] + off), radius=radius, fill=(0, 0, 0, 120)
        )
        sh = sh.filter(ImageFilter.GaussianBlur(20 * SS))
        img.alpha_composite(sh)

    # Body: vertical slate gradient.
    mask = rounded_mask((S, S), box, radius)
    grad = vgradient(S, body, TOP, BOTTOM)
    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg.paste(grad, (0, m))
    img.paste(bg, (0, 0), mask)

    # Subtle inner rim.
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=(255, 255, 255, 22), width=3 * SS)
    img.alpha_composite(rim)

    # Step grid.
    grid = body * 0.66
    gap = grid * 0.075
    cell = (grid - 3 * gap) / 4
    cr = cell * 0.22
    x0 = m + (body - grid) / 2
    y0 = m + (body - grid) / 2 + body * 0.01

    def cell_box(r, c):
        x = x0 + c * (cell + gap)
        y = y0 + r * (cell + gap)
        return (round(x), round(y), round(x + cell), round(y + cell))

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(4):
        for c in range(4):
            if LIT[r][c]:
                gd.rounded_rectangle(cell_box(r, c), radius=cr, fill=BRASS + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(cell * 0.22))
    img.alpha_composite(glow)

    cells = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for r in range(4):
        for c in range(4):
            b = cell_box(r, c)
            w, h = b[2] - b[0], b[3] - b[1]
            if LIT[r][c]:
                tile = vgradient(w, h, BRASS_HI, BRASS_LO).convert("RGBA")
            else:
                tile = vgradient(w, h, DIM_HI, DIM).convert("RGBA")
            tmask = rounded_mask((w, h), (0, 0, w - 1, h - 1), cr)
            cells.paste(tile, (b[0], b[1]), tmask)
            # top highlight line on each cell
            hl = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(hl).rounded_rectangle(
                (0, 0, w - 1, h - 1), radius=cr, outline=(255, 255, 255, 60 if LIT[r][c] else 18), width=2 * SS
            )
            hl_mask = Image.new("L", (w, h), 0)
            ImageDraw.Draw(hl_mask).rectangle((0, 0, w, h // 2), fill=255)
            cells.paste(hl, (b[0], b[1]), Image.composite(hl.getchannel("A"), Image.new("L", (w, h), 0), hl_mask))
    img.alpha_composite(cells)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    mac_style = render(body_margin=100, radius_ratio=0.225, shadow=True)
    png = OUT / "icon.png"
    mac_style.save(png)
    print(f"wrote {png.relative_to(ROOT)}")

    full_bleed = render(body_margin=24, radius_ratio=0.2, shadow=False)
    ico = OUT / "icon.ico"
    full_bleed.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {ico.relative_to(ROOT)}")

    if sys.platform == "darwin" and shutil.which("iconutil") and shutil.which("sips"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = pathlib.Path(tmp) / "icon.iconset"
            iconset.mkdir()
            for base in (16, 32, 128, 256, 512):
                for scale in (1, 2):
                    px = base * scale
                    name = f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"
                    subprocess.run(
                        ["sips", "-z", str(px), str(px), str(png), "--out", str(iconset / name)],
                        check=True, stdout=subprocess.DEVNULL,
                    )
            icns = OUT / "icon.icns"
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
            print(f"wrote {icns.relative_to(ROOT)}")
    else:
        print("skipped icon.icns (needs macOS sips + iconutil)")


if __name__ == "__main__":
    main()
