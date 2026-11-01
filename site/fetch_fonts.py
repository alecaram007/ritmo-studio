#!/usr/bin/env python3
"""Downloads the website's fonts with every alphabet they cover into site/src/fonts/ and writes
site/src/fonts.css (run once, or again to refresh). Browsers only fetch the parts a page needs,
thanks to unicode-range. All four families are under the SIL Open Font License."""
import pathlib, re, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'src' / 'fonts'
URL = ('https://fonts.googleapis.com/css2?family=Unbounded:wght@600&family=Barlow:wght@400;600'
       '&family=Barlow+Condensed:wght@600&family=JetBrains+Mono:wght@500&display=swap')
SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese', 'greek']
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
        return r.read()


css = get(URL).decode()
OUT.mkdir(parents=True, exist_ok=True)
faces = []
for subset, block in re.findall(r'/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]+})', css):
    if subset not in SUBSETS:
        continue
    family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    weight = re.search(r'font-weight:\s*(\d+)', block).group(1)
    src = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
    urange = re.search(r'unicode-range:\s*([^;]+);', block).group(1)
    name = f"{family.replace(' ', '')}-{weight}-{subset}.woff2"
    (OUT / name).write_bytes(get(src))
    faces.append(f"@font-face{{font-family:'{family}';font-weight:{weight};font-display:swap;"
                 f"src:url({{{{R}}}}fonts/{name}) format('woff2');unicode-range:{urange}}}")
    print('saved', name)
(HERE / 'src' / 'fonts.css').write_text('\n'.join(faces) + '\n')
