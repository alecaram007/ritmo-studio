#!/usr/bin/env python3
"""Builds Ritmo Studio into single self-contained HTML files.

  RitmoStudio.html     full document, open it with a double click (works offline);
                       the desktop apps in desktop/ package this same file
  dist/artifact.html   page content only, for publishing as a claude.ai Artifact

Fonts come from fonts/ (run fetch_fonts.py once) and are embedded as data URIs.
"""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
FONTS = ROOT / "fonts"

page = (SRC / "index.html").read_text(encoding="utf-8")


def inline(match: re.Match) -> str:
    js = (SRC / match.group(1)).read_text(encoding="utf-8")
    if "</script" in js.lower():
        raise SystemExit(f"{match.group(1)} contains a closing script tag")
    return "<script>\n" + js + "\n</script>"


def font_faces() -> str:
    faces = FONTS / "faces.txt"
    if not faces.exists():
        raise SystemExit("fonts/faces.txt missing: run fetch_fonts.py first")
    # Variable fonts arrive as the same file for every weight: embed each distinct file once with a weight range.
    groups = {}
    for line in faces.read_text().split("\n"):
        if not line.strip():
            continue
        family, weight, name, urange = line.split("|")
        data = (FONTS / name).read_bytes()
        g = groups.setdefault((family, data), {"weights": [], "urange": urange})
        g["weights"].append(int(weight))
    rules = []
    for (family, data), g in groups.items():
        w = g["weights"]
        weight = str(w[0]) if len(w) == 1 else f"{min(w)} {max(w)}"
        b64 = base64.b64encode(data).decode()
        rules.append(
            f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{weight};font-display:swap;"
            f"src:url(data:font/woff2;base64,{b64}) format('woff2');unicode-range:{g['urange']};}}"
        )
    return "<style>\n" + "\n".join(rules) + "\n</style>"


def i18n_data() -> None:
    """Writes src/js/i18n-data.js: the source texts once, then each language as a list in the same order."""
    folder = SRC / "i18n"
    src = [e["s"] for e in json.loads((folder / "strings.json").read_text(encoding="utf-8"))]
    data = {"src": src}
    for f in sorted(folder.glob("*.json")):
        if f.name == "strings.json":
            continue
        t = json.loads(f.read_text(encoding="utf-8"))
        data[f.stem] = [t.get(s, "") for s in src]
    js = "window.RITMO_I18N = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (SRC / "js" / "i18n-data.js").write_text(js.replace("</", "<\\/"), encoding="utf-8")
    print(f"translations: {len(src)} texts, languages {', '.join(k for k in data if k != 'src') or 'none yet'}")


i18n_data()
content = re.sub(r'<script src="([^"]+)"></script>', inline, page)
content = content.replace("<!--FONTS-->", font_faces())

(ROOT / "dist").mkdir(exist_ok=True)
(ROOT / "dist" / "artifact.html").write_text(content, encoding="utf-8")

full = (
    '<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    "</head>\n<body>\n" + content + "\n</body>\n</html>\n"
)
(ROOT / "RitmoStudio.html").write_text(full, encoding="utf-8")
print(f"RitmoStudio.html: {len(full) / 1024:.0f} KB")
