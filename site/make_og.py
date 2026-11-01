#!/usr/bin/env python3
"""Draws the social preview image (1200×630) of every language into site/src/img/og/<code>.jpg,
with headless Google Chrome. Run it after changing og_headline, og_os or og_chip in site/i18n/.

    python3 site/make_og.py [code ...]
"""
import html, json, os, pathlib, subprocess, sys, tempfile
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'src'
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
VERSION = json.loads((HERE.parent / 'desktop' / 'package.json').read_text())['version'].rsplit('.', 1)[0]
HREFLANG = {'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW'}
RTL = {'ar', 'he'}

PAGE = """<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{fonts}
:root{{--disp:'Unbounded',system-ui,sans-serif;--label:'Barlow Condensed',system-ui,sans-serif}}
:lang(ja){{--disp:'Hiragino Sans',sans-serif;--label:'Hiragino Sans',sans-serif}}
:lang(ko){{--disp:'Apple SD Gothic Neo',sans-serif;--label:'Apple SD Gothic Neo',sans-serif}}
:lang(zh-CN){{--disp:'PingFang SC',sans-serif;--label:'PingFang SC',sans-serif}}
:lang(zh-TW){{--disp:'PingFang TC',sans-serif;--label:'PingFang TC',sans-serif}}
:lang(ar){{--disp:'Geeza Pro',sans-serif;--label:'Geeza Pro',sans-serif}}
:lang(he){{--disp:'Arial Hebrew',sans-serif;--label:'Arial Hebrew',sans-serif}}
:lang(hi){{--disp:'Kohinoor Devanagari',sans-serif;--label:'Kohinoor Devanagari',sans-serif}}
:lang(th){{--disp:'Thonburi',sans-serif;--label:'Thonburi',sans-serif}}
:lang(el){{--disp:'Helvetica Neue',sans-serif;--label:'Helvetica Neue',sans-serif}}
:lang(ru),:lang(uk){{--label:'Helvetica Neue',sans-serif}}
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#121618;color:#eef1f2}}
.glow{{position:absolute;left:-200px;top:-260px;width:900px;height:900px;background:radial-gradient(closest-side,rgba(246,164,60,.16),transparent)}}
.txt{{position:absolute;left:64px;top:64px;width:560px}}
.rtl .txt{{left:auto;right:64px}}
.rtl .glow{{left:auto;right:-200px}}
.brand{{display:flex;align-items:center;gap:14px;font:600 30px/1 'Unbounded',sans-serif;direction:ltr;justify-content:flex-start}}
.rtl .brand{{justify-content:flex-end}}
.rtl .steps{{left:auto;right:64px}}
.brand img{{width:52px;height:52px}}
h1{{font:600 {size}px/1.15 var(--disp);letter-spacing:-.01em;margin:38px 0 0}}
:lang(ja) h1,:lang(ko) h1,:lang(zh) h1,:lang(ar) h1,:lang(he) h1,:lang(hi) h1,:lang(th) h1,:lang(el) h1{{font-weight:700;letter-spacing:0;line-height:1.3}}
.os{{font:600 27px/1.2 var(--label);letter-spacing:.06em;text-transform:uppercase;color:#c3ccd1;margin-top:30px}}
.chip{{display:inline-block;margin-top:22px;font:600 24px/1 var(--label);letter-spacing:.06em;text-transform:uppercase;color:#1c1206;background:#f6a43c;border-radius:999px;padding:11px 18px}}
.ver{{font:500 22px/1 'JetBrains Mono',monospace;color:#8e9ca4;margin-inline-start:14px}}
.shot{{position:absolute;left:660px;top:70px;width:900px;border-radius:14px;overflow:hidden;border:1px solid #323c42;box-shadow:0 40px 80px -30px #000}}
.shot img{{display:block;width:100%}}
.rtl .shot{{left:-360px}}
.steps{{position:absolute;left:64px;bottom:56px;display:flex;gap:6px;direction:ltr}}
.steps i{{width:26px;height:34px;border-radius:4px;background:#38434a}}
.steps i:nth-child(8n+5),.steps i:nth-child(8n+6),.steps i:nth-child(8n+7),.steps i:nth-child(8n+8){{background:#4a3236}}
.steps i.on{{background:#f6a43c}}
</style></head><body class="{dir}"><div class="glow"></div>
<div class="txt" dir="{dir}"><div class="brand"><img src="{logo}">Ritmo Studio</div><h1>{headline}</h1><div class="os">{os}</div><span class="chip">{chip}</span><span class="ver">v{ver}</span></div>
<div class="shot"><img src="{shot}"></div>
<div class="steps">{steps}</div>
</body></html>"""


def draw(code, t, tmp):
    fonts = (SRC / 'fonts.css').read_text().replace('{{R}}fonts/', (SRC / 'fonts').as_uri() + '/')
    head = t['og_headline']
    size = 50 if len(head) <= 44 else 44 if len(head) <= 60 else 38
    steps = ''.join(f'<i class="{"on" if i % 4 == 0 else ""}"></i>' for i in range(16))
    page = PAGE.format(lang=HREFLANG.get(code, code), dir='rtl' if code in RTL else 'ltr', fonts=fonts, size=size,
                       logo=(SRC / 'img' / 'logo.svg').as_uri(), shot=(SRC / 'img' / 'piano-1600.webp').as_uri(),
                       headline=html.escape(head), os=html.escape(t['og_os']), chip=html.escape(t['og_chip']), ver=VERSION, steps=steps)
    src = pathlib.Path(tmp) / f'{code}.html'
    png = pathlib.Path(tmp) / f'{code}.png'
    src.write_text(page, encoding='utf-8')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--window-size=1200,630', '--virtual-time-budget=3000', f'--user-data-dir={tmp}/profile',
                    f'--screenshot={png}', src.as_uri()], check=True, capture_output=True, timeout=60)
    out = SRC / 'img' / 'og' / f'{code}.jpg'
    out.parent.mkdir(exist_ok=True)
    Image.open(png).convert('RGB').crop((0, 0, 1200, 630)).save(out, quality=86, optimize=True, progressive=True)
    print('drew', out.relative_to(HERE.parent), f'{out.stat().st_size // 1024} KB')


codes = sys.argv[1:] or sorted(p.stem for p in (HERE / 'i18n').glob('*.json'))
with tempfile.TemporaryDirectory() as tmp:
    for c in codes:
        draw(c, json.loads((HERE / 'i18n' / f'{c}.json').read_text(encoding='utf-8')), tmp)
