#!/usr/bin/env python3
"""Downloads the Latin subsets of the app's open-licence Google Fonts into fonts/ (run once).

Barlow, Barlow Condensed, JetBrains Mono and Unbounded are all under the SIL Open Font License,
so they can be embedded in the app and redistributed with it.
"""
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "fonts"
URL = (
    "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700"
    "&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600"
    "&family=Unbounded:wght@600&display=swap"
)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


css = get(URL).decode()
blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]+})", css)
OUT.mkdir(exist_ok=True)
faces = []
for subset, block in blocks:
    if subset != "latin":
        continue
    family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    weight = re.search(r"font-weight:\s*(\d+)", block).group(1)
    src = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
    urange = re.search(r"unicode-range:\s*([^;]+);", block).group(1)
    name = f"{family.replace(' ', '')}-{weight}.woff2"
    (OUT / name).write_bytes(get(src))
    faces.append(f"{family}|{weight}|{name}|{urange}")
    print("saved", name)
(OUT / "faces.txt").write_text("\n".join(faces) + "\n")
