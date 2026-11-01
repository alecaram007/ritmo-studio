#!/usr/bin/env python3
"""Builds the Ritmo Studio website into site/_out: one landing page per language (Italian at the root,
the others under /<code>/), the online app, sitemap, robots and manifest.

    python3 site/build.py --base https://example.org

--base is the public address of the site, without a trailing slash: canonical and hreflang links, the
sitemap, structured data and social previews need it. Texts live in site/i18n/<code>.json (check them with
site/i18n/check.py). Download links point at the GitHub release of the version in desktop/package.json;
file sizes and the release date come from that release when `gh` can read it.
"""
import argparse, datetime, html, json, os, re, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'src')
I18N = os.path.join(HERE, 'i18n')

# code (file and folder name), hreflang, native name, short label, text direction, Open Graph locale
LANGS = [
    ('it', 'it', 'Italiano', 'IT', 'ltr', 'it_IT'),
    ('en', 'en', 'English', 'EN', 'ltr', 'en_US'),
    ('es', 'es', 'Español', 'ES', 'ltr', 'es_ES'),
    ('pt', 'pt', 'Português', 'PT', 'ltr', 'pt_BR'),
    ('fr', 'fr', 'Français', 'FR', 'ltr', 'fr_FR'),
    ('de', 'de', 'Deutsch', 'DE', 'ltr', 'de_DE'),
    ('nl', 'nl', 'Nederlands', 'NL', 'ltr', 'nl_NL'),
    ('sv', 'sv', 'Svenska', 'SV', 'ltr', 'sv_SE'),
    ('pl', 'pl', 'Polski', 'PL', 'ltr', 'pl_PL'),
    ('cs', 'cs', 'Čeština', 'CS', 'ltr', 'cs_CZ'),
    ('ro', 'ro', 'Română', 'RO', 'ltr', 'ro_RO'),
    ('hu', 'hu', 'Magyar', 'HU', 'ltr', 'hu_HU'),
    ('tr', 'tr', 'Türkçe', 'TR', 'ltr', 'tr_TR'),
    ('el', 'el', 'Ελληνικά', 'EL', 'ltr', 'el_GR'),
    ('ru', 'ru', 'Русский', 'RU', 'ltr', 'ru_RU'),
    ('uk', 'uk', 'Українська', 'UK', 'ltr', 'uk_UA'),
    ('ar', 'ar', 'العربية', 'AR', 'rtl', 'ar_AR'),
    ('he', 'he', 'עברית', 'HE', 'rtl', 'he_IL'),
    ('hi', 'hi', 'हिन्दी', 'HI', 'ltr', 'hi_IN'),
    ('id', 'id', 'Bahasa Indonesia', 'ID', 'ltr', 'id_ID'),
    ('vi', 'vi', 'Tiếng Việt', 'VI', 'ltr', 'vi_VN'),
    ('th', 'th', 'ไทย', 'TH', 'ltr', 'th_TH'),
    ('ja', 'ja', '日本語', 'JA', 'ltr', 'ja_JP'),
    ('ko', 'ko', '한국어', 'KO', 'ltr', 'ko_KR'),
    ('zh-cn', 'zh-CN', '简体中文', '简', 'ltr', 'zh_CN'),
    ('zh-tw', 'zh-TW', '繁體中文', '繁', 'ltr', 'zh_TW'),
]
DEFAULT = 'en'  # x-default: the page for visitors whose language has no page of its own
LATIN = {'it', 'en', 'es', 'pt', 'fr', 'de', 'nl', 'sv', 'pl', 'cs', 'ro', 'hu', 'tr', 'id', 'vi'}

# The drum pattern of the demo song «Mezzanotte», 16 steps.
PATTERN = [('kick', [0, 4, 8, 12]), ('clap', [4, 12]), ('hat', [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]), ('ohat', [2, 6, 10, 14])]
SHOTS = [('main', 'accent'), ('piano', 'teal'), ('playlist', 'blue'), ('mixer', 'pink')]


def read(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def attr(s):
    return html.escape(s, quote=True)


def release_info(repo, tag):
    try:
        out = subprocess.run(['gh', 'release', 'view', tag, '-R', repo, '--json', 'assets,publishedAt'],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        data = json.loads(out)
        return {a['name']: a['size'] for a in data['assets']}, data['publishedAt'][:10]
    except Exception as e:  # no gh, no network or no release yet: build without sizes
        print('warning: release not readable, building without file sizes:', e)
        return {}, datetime.date.today().isoformat()


def seq_markup(t):
    rows = []
    for voice, on in PATTERN:
        name = t['voices'][voice]
        steps = ''.join(f'<button type="button" class="st" aria-pressed="{"true" if i in on else "false"}" aria-label="{attr(name)}, {attr(t["seq_step"])} {i + 1}"></button>' for i in range(16))
        rows.append(f'<div class="seq-row" data-voice="{voice}"><span class="seq-ch">{name}</span><div class="seq-steps">{steps}</div></div>')
    return (f'<div class="seq" id="seq" data-bpm="124" role="group" aria-label="{attr(t["seq_aria"])}">'
            f'<div class="seq-head"><button type="button" class="seq-play" id="seq-play" aria-pressed="false" data-play="{attr(t["seq_play"])}" data-stop="{attr(t["seq_stop"])}">'
            '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg>'
            f'<span>{t["seq_play"]}</span></button><span class="seq-bpm"><b>124</b> BPM</span><p class="seq-note">{t["seq_note"]}</p></div>'
            + ''.join(rows) + '</div>')


def blocks(t):
    feats = []
    for (img, color), f in zip(SHOTS, t['features']):
        ticks = ''.join(f'<li>{x}</li>' for x in f['list'])
        feats.append(
            f'<article class="feat"><div class="feat-text"><span class="tag" style="color:var(--{color})">{f["tag"]}</span>'
            f'<h3>{f["h3"]}</h3><p>{f["p"]}</p><ul class="ticks">{ticks}</ul></div>'
            f'<div class="shot"><img src="{{{{R}}}}img/{img}-800.webp" srcset="{{{{R}}}}img/{img}-800.webp 800w, {{{{R}}}}img/{img}-1600.webp 1600w" '
            f'sizes="(max-width:860px) calc(100vw - 32px), 620px" width="1600" height="1000" loading="lazy" decoding="async" alt="{attr(f["alt"])}"></div></article>')
    return {
        'FEATURES': '\n'.join(feats),
        'CARDS': ''.join(f'<div class="card"><h3>{c["h3"]}</h3><p>{c["p"]}</p></div>' for c in t['cards']),
        'STEPS': ''.join(f'<li><strong>{s["h"]}</strong>{s["p"]}</li>' for s in t['steps']),
        'NEWS': ''.join(f'<li>{n}</li>' for n in t['news']),
        'PROMISE': ''.join(f'<li>{p}</li>' for p in t['promise']),
        'FAQ': ''.join(f'<details class="q"><summary>{q["q"]}</summary><div class="ans"><p>{q["a"]}</p></div></details>' for q in t['faq']),
        'SEQ': seq_markup(t),
    }


def plain(s):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def jsonld(t, lang, url, base, ver, date, repo_url, fill_text):
    graph = [
        {'@type': 'WebSite', '@id': base + '/#website', 'url': base + '/', 'name': 'Ritmo Studio',
         'inLanguage': [l[1] for l in LANGS]},
        {'@type': 'SoftwareApplication', '@id': base + '/#app', 'name': 'Ritmo Studio', 'url': url,
         'description': t['ld_description'], 'applicationCategory': 'MultimediaApplication',
         'applicationSubCategory': 'Digital Audio Workstation',
         'operatingSystem': 'Windows 10, Windows 11, macOS 13+, Linux, Web browser',
         'softwareVersion': ver, 'dateModified': date, 'isAccessibleForFree': True,
         'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'},
         'downloadUrl': url + '#download', 'installUrl': base + '/app/',
         'image': f'{base}/img/og/{lang[0]}.jpg',
         'screenshot': [f'{base}/img/{n}-1600.webp' for n, _ in SHOTS],
         'featureList': t['ld_features'], 'inLanguage': 'it', 'codeRepository': repo_url,
         'license': 'https://opensource.org/licenses/MIT'},
        {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': lang[1],
         'mainEntity': [{'@type': 'Question', 'name': plain(q['q']), 'acceptedAnswer': {'@type': 'Answer', 'text': plain(fill_text(q['a']))}} for q in t['faq']]},
    ]
    return json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def fill(text, values):
    for k, v in values.items():
        text = text.replace('{{' + k + '}}', v)
    return text


def mb(size):
    return f'{size / 1e6:.0f} MB' if size else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.environ.get('SITE_BASE', 'http://localhost:8766'))
    ap.add_argument('--repo', default=os.environ.get('SITE_REPO', 'alecaram007/ritmo-studio'))
    ap.add_argument('--out', default=os.path.join(HERE, '_out'))
    a = ap.parse_args()
    base = a.base.rstrip('/')
    ver = json.loads(read(ROOT, 'desktop', 'package.json'))['version']
    tag = 'v' + ver
    sizes, date = release_info(a.repo, tag)
    repo_url = f'https://github.com/{a.repo}'
    files = {
        'WIN': f'RitmoStudio-{ver}-win-x64-setup.exe', 'WIN_ZIP': f'RitmoStudio-{ver}-win-x64.zip',
        'MAC_ARM': f'RitmoStudio-{ver}-mac-arm64.dmg', 'MAC_ARM_ZIP': f'RitmoStudio-{ver}-mac-arm64.zip',
        'MAC_X64': f'RitmoStudio-{ver}-mac-x64.dmg', 'MAC_X64_ZIP': f'RitmoStudio-{ver}-mac-x64.zip',
        'APPIMAGE': f'RitmoStudio-{ver}-linux-x86_64.AppImage', 'DEB': f'ritmo-studio_{ver}_amd64.deb',
    }
    missing = [n for n in files.values() if sizes and n not in sizes]
    if missing:  # still uploading, or a file was renamed: the links to these files will not work yet
        print(f'warning: the release {tag} lacks {missing}')
    common = {'BASE': base, 'VER': ver, 'REPO_URL': repo_url, 'RELEASE_URL': repo_url + '/releases'}
    for k, n in files.items():
        common['DL_' + k] = f'{repo_url}/releases/download/{tag}/{n}'
        common['SZ_' + k] = mb(sizes.get(n, 0))

    texts = {l[0]: json.loads(read(I18N, l[0] + '.json')) for l in LANGS if os.path.exists(os.path.join(I18N, l[0] + '.json'))}
    langs = [l for l in LANGS if l[0] in texts]
    skipped = [l[0] for l in LANGS if l[0] not in texts]
    if skipped:
        print('warning: no translation yet for', skipped)
    path = {l[0]: '' if l[0] == 'it' else l[0] + '/' for l in langs}
    url = {c: f'{base}/{p}' for c, p in path.items()}
    alternates = [(l[1], url[l[0]]) for l in langs] + [('x-default', url[DEFAULT if DEFAULT in url else 'it'])]
    hreflang_tags = '\n'.join(f'<link rel="alternate" hreflang="{h}" href="{u}">' for h, u in alternates)
    d = datetime.date.fromisoformat(date)
    css = re.sub(r'\n\s*', '\n', read(SRC, 'style.css').replace('{{FONTS}}', read(SRC, 'fonts.css')))
    js = read(SRC, 'site.js')
    template = read(SRC, 'page.html')

    out = a.out
    shutil.rmtree(out, ignore_errors=True)
    for lang in langs:
        code, hreflang, name, short, direction, og_locale = lang
        t = texts[code]
        rel = '' if code == 'it' else '../'
        date_text = t['date_format'].format(d=d.day, m=d.month, y=d.year, month=t['months'][d.month - 1])
        values = dict(common, URL=url[code], R=rel, HOME='./', HREFLANG=hreflang_tags,
                      DATE_HTML=f'<time datetime="{date}">{date_text}</time>')
        if code in LATIN:
            values['PRELOAD'] = (f'<link rel="preload" href="{rel}fonts/Unbounded-600-latin.woff2" as="font" type="font/woff2" crossorigin>\n'
                                 f'<link rel="preload" href="{rel}fonts/Barlow-400-latin.woff2" as="font" type="font/woff2" crossorigin>')
        elif code in ('ru', 'uk'):
            values['PRELOAD'] = f'<link rel="preload" href="{rel}fonts/Unbounded-600-cyrillic.woff2" as="font" type="font/woff2" crossorigin>'
        else:
            values['PRELOAD'] = ''
        cur = ' aria-current="page"'
        values['LANG_ITEMS'] = ''.join(
            f'<li><a href="{rel}{path[l[0]]}" hreflang="{l[1]}" lang="{l[1]}"{cur if l[0] == code else ""}>{l[2]}</a></li>' for l in langs)
        values['LANG_LINKS'] = ''.join(
            f'<a href="{rel}{path[l[0]]}" hreflang="{l[1]}" lang="{l[1]}"{cur if l[0] == code else ""}>{l[2]}</a>' for l in langs)
        values['LANGS_JSON'] = json.dumps({'current': hreflang.lower(), 'pages': {
            l[1].lower(): [f'{rel}{path[l[0]]}', texts[l[0]]['suggest'], texts[l[0]]['suggest_go']] for l in langs}},
            ensure_ascii=False).replace('</', '<\\/')

        page = template
        for k, v in blocks(t).items():
            page = page.replace('{{' + k + '}}', v)
        page = re.sub(r'\{\{t:(\w+)\}\}', lambda m: t[m.group(1)], page)
        page = re.sub(r'\{\{a:(\w+)\}\}', lambda m: attr(fill(t[m.group(1)], values)), page)
        meta = {'code': code, 'hreflang': hreflang, 'dir': direction, 'short': short, 'og_locale': og_locale}
        page = re.sub(r'\{\{L:(\w+)\}\}', lambda m: meta[m.group(1)], page)
        page = page.replace('{{CSS}}', css).replace('{{JS}}', js)
        page = fill(fill(page, values), values)  # texts can hold placeholders such as {{VER}} or {{R}}
        page = page.replace('{{JSONLD}}', jsonld(t, lang, url[code], base, ver, date, repo_url, lambda s: fill(s, values)))
        left = sorted(set(re.findall(r'\{\{[^}]+\}\}', page)))
        if left:
            raise SystemExit(f'{code}: placeholders without a value: {left}')
        write(os.path.join(out, path[code], 'index.html'), page)
        title = re.search(r'<title>(.*?)</title>', page).group(1)
        desc = re.search(r'<meta name="description" content="(.*?)">', page).group(1)
        print(f'{code:6} title {len(html.unescape(title)):3}  description {len(html.unescape(desc)):3}  {len(page) // 1024} KB')

    # The online app (its interface is Italian), with its own title, description and links for search engines.
    app = read(ROOT, 'RitmoStudio.html')
    app = app.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
    app = app.replace('<title>Ritmo Studio</title>', '<title>Ritmo Studio online – DAW gratis nel browser</title>', 1)
    app = re.sub(r'<meta name="description" content="[^"]*">',
                 '<meta name="description" content="Apri Ritmo Studio nel browser e fai musica subito, gratis e senza installare nulla: step sequencer, Piano Roll, Playlist e Mixer.">', app, count=1)
    head = (f'<link rel="canonical" href="{base}/app/">\n<link rel="icon" href="../favicon.ico" sizes="any">\n'
            '<link rel="icon" href="../img/logo.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="../img/apple-touch-icon.png">\n'
            '<link rel="manifest" href="../site.webmanifest">\n<meta name="theme-color" content="#121618">\n'
            '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Ritmo Studio">\n'
            f'<meta property="og:url" content="{base}/app/">\n<meta property="og:title" content="Ritmo Studio online – DAW gratis nel browser">\n'
            '<meta property="og:description" content="Fai musica nel browser, gratis e senza installare nulla.">\n'
            f'<meta property="og:image" content="{base}/img/og/it.jpg">\n<meta name="twitter:card" content="summary_large_image">\n')
    app = app.replace('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n',
                      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head, 1)
    assert head in app, 'could not add the head tags to the online app'
    # Search engines read the title after the app starts: keep the site title while the demo song is open.
    old = "document.title = proj.name + ' — Ritmo Studio';"
    assert old in app, 'the app no longer sets document.title the expected way'
    app = app.replace(old, "document.title = proj.name === 'Mezzanotte (demo)' ? 'Ritmo Studio online – DAW gratis nel browser' : proj.name + ' — Ritmo Studio';")
    write(os.path.join(out, 'app', 'index.html'), app)

    shutil.copytree(os.path.join(SRC, 'img'), os.path.join(out, 'img'))
    shutil.copytree(os.path.join(SRC, 'fonts'), os.path.join(out, 'fonts'))
    shutil.copy(os.path.join(SRC, 'favicon.ico'), out)
    for f in os.listdir(SRC):  # the IndexNow key, which tells search engines the site is ours
        if re.fullmatch(r'[0-9a-f]{32}\.txt', f):
            shutil.copy(os.path.join(SRC, f), out)
    write(os.path.join(out, '404.html'), fill(read(SRC, '404.html'), {'BASE': base}))
    write(os.path.join(out, '.nojekyll'), '')
    write(os.path.join(out, 'robots.txt'), f'User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n')
    write(os.path.join(out, 'site.webmanifest'), json.dumps({
        'name': 'Ritmo Studio', 'short_name': 'Ritmo Studio', 'lang': 'it', 'start_url': './app/', 'scope': './',
        'display': 'standalone', 'background_color': '#121618', 'theme_color': '#121618',
        'icons': [{'src': 'img/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
                  {'src': 'img/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]}, indent=2))
    alt = ''.join(f'<xhtml:link rel="alternate" hreflang="{h}" href="{u}"/>' for h, u in alternates)
    entries = [(url[l[0]], alt, '1.0' if l[0] == 'it' else '0.8') for l in langs] + [(f'{base}/app/', '', '0.7')]
    write(os.path.join(out, 'sitemap.xml'),
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + ''.join(f'  <url><loc>{u}</loc><lastmod>{date}</lastmod><priority>{p}</priority>{x}</url>\n' for u, x, p in entries)
          + '</urlset>\n')
    print(f'site built in {out}: {len(langs)} languages')


if __name__ == '__main__':
    main()
