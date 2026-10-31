#!/usr/bin/env python3
"""Builds the Ritmo Studio website (Italian + English landing pages, online app, sitemap) into site/_out.

    python3 site/build.py --base https://example.org

--base is the public address of the site, without a trailing slash: canonical links, the sitemap,
structured data and social previews need it. Download links point at the GitHub release of the version
in desktop/package.json; file sizes and the release date come from that release when `gh` can read it.
"""
import argparse, datetime, html, json, os, re, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'src')
FONTS = ['Unbounded-600', 'Barlow-400', 'Barlow-600', 'BarlowCondensed-600', 'JetBrainsMono-500']

# The drum pattern of the demo song «Mezzanotte», 16 steps.
PATTERN = [('kick', [0, 4, 8, 12]), ('clap', [4, 12]), ('hat', [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]), ('ohat', [2, 6, 10, 14])]
TEXT = {
    'it': {
        'voices': {'kick': 'Cassa', 'clap': 'Clap', 'hat': 'Hi-hat', 'ohat': 'Hi-hat aperto'},
        'step': 'passo', 'play': 'Play', 'stop': 'Stop', 'aria': 'Step sequencer di prova',
        'note': 'Il pattern di batteria della demo «Mezzanotte». Premi Play e clicca i passi per cambiarlo.',
        'months': ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
        'desc': 'DAW gratuita per creare beat e canzoni: step sequencer, Piano Roll, Playlist, Mixer, strumenti ed effetti inclusi e plugin VST3, AU e LV2.',
        'features': ['Step sequencer (Channel Rack)', 'Piano Roll con note Slide e Portamento', 'Playlist con clip audio, automazioni e marcatori', 'Mixer a 125 tracce con 10 slot effetto', '10 strumenti e 15 effetti inclusi', 'Plugin VST3, AU e LV2', 'Registrazione MIDI e audio', 'Esportazione WAV, FLAC, OGG e MIDI'],
    },
    'en': {
        'voices': {'kick': 'Kick', 'clap': 'Clap', 'hat': 'Hi-hat', 'ohat': 'Open hat'},
        'step': 'step', 'play': 'Play', 'stop': 'Stop', 'aria': 'Try-out step sequencer',
        'note': 'The drum pattern of the «Mezzanotte» demo. Press Play and click the steps to change it.',
        'months': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        'desc': 'Free DAW for making beats and songs: step sequencer, piano roll, playlist, mixer, built-in instruments and effects, and VST3, AU and LV2 plugins.',
        'features': ['Step sequencer (channel rack)', 'Piano roll with slide and portamento notes', 'Playlist with audio clips, automation and markers', '125-track mixer with 10 effect slots', '10 instruments and 15 effects included', 'VST3, AU and LV2 plugins', 'MIDI and audio recording', 'WAV, FLAC, OGG and MIDI export'],
    },
}


def read(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def release_info(repo, tag):
    try:
        out = subprocess.run(['gh', 'release', 'view', tag, '-R', repo, '--json', 'assets,publishedAt'],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        data = json.loads(out)
        return {a['name']: a['size'] for a in data['assets']}, data['publishedAt'][:10]
    except Exception as e:  # no gh, no network or no release yet: build without sizes
        print('warning: release not readable, building without file sizes:', e)
        return {}, datetime.date.today().isoformat()


def seq_markup(lang):
    t = TEXT[lang]
    rows = []
    for voice, on in PATTERN:
        name = t['voices'][voice]
        steps = ''.join(f'<button type="button" class="st" aria-pressed="{"true" if i in on else "false"}" aria-label="{name}, {t["step"]} {i + 1}"></button>' for i in range(16))
        rows.append(f'<div class="seq-row" data-voice="{voice}"><span class="seq-ch">{name}</span><div class="seq-steps">{steps}</div></div>')
    return (f'<div class="seq" id="seq" data-bpm="124" role="group" aria-label="{t["aria"]}">'
            f'<div class="seq-head"><button type="button" class="seq-play" id="seq-play" aria-pressed="false" data-play="{t["play"]}" data-stop="{t["stop"]}">'
            '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg>'
            f'<span>{t["play"]}</span></button><span class="seq-bpm"><b>124</b> BPM</span><p class="seq-note">{t["note"]}</p></div>'
            + ''.join(rows) + '</div>')


def faq_entries(page):
    out = []
    for q, a in re.findall(r'<details class="q"><summary>(.*?)</summary><div class="ans">(.*?)</div></details>', page, re.S):
        text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', a))).strip()
        out.append({'@type': 'Question', 'name': html.unescape(q), 'acceptedAnswer': {'@type': 'Answer', 'text': text}})
    return out


def jsonld(lang, page, base, ver, date, repo_url):
    t = TEXT[lang]
    url = base + ('/' if lang == 'it' else '/en/')
    graph = [
        {'@type': 'WebSite', '@id': base + '/#website', 'url': base + '/', 'name': 'Ritmo Studio', 'inLanguage': ['it', 'en']},
        {'@type': 'SoftwareApplication', '@id': base + '/#app', 'name': 'Ritmo Studio', 'url': url,
         'description': t['desc'], 'applicationCategory': 'MultimediaApplication',
         'applicationSubCategory': 'Digital Audio Workstation',
         'operatingSystem': 'Windows 10, Windows 11, macOS 13+, Linux, Web browser',
         'softwareVersion': ver, 'dateModified': date, 'isAccessibleForFree': True,
         'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'},
         'downloadUrl': url + '#download', 'installUrl': base + '/app/',
         'image': f'{base}/img/og-{lang}.png',
         'screenshot': [f'{base}/img/{n}-1600.webp' for n in ('main', 'piano', 'playlist', 'mixer')],
         'featureList': t['features'], 'inLanguage': 'it', 'codeRepository': repo_url,
         'license': 'https://opensource.org/licenses/MIT'},
        {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': lang, 'mainEntity': faq_entries(page)},
    ]
    return json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def fill(text, values):
    for k, v in values.items():
        text = text.replace('{{' + k + '}}', v)
    left = sorted(set(re.findall(r'\{\{[A-Z_]+\}\}', text)))
    if left:
        raise SystemExit(f'placeholders without a value: {left}')
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
    d = datetime.date.fromisoformat(date)
    common = {'BASE': base, 'VER': ver, 'DATE': date, 'REPO_URL': repo_url, 'RELEASE_URL': repo_url + '/releases',
              'DATE_TEXT': f'{d.day} {TEXT["it"]["months"][d.month - 1]} {d.year}',
              'DATE_TEXT_EN': f'{TEXT["en"]["months"][d.month - 1]} {d.day}, {d.year}'}
    for k, n in files.items():
        common['DL_' + k] = f'{repo_url}/releases/download/{tag}/{n}'
        common['SZ_' + k] = mb(sizes.get(n, 0))

    out = a.out
    shutil.rmtree(out, ignore_errors=True)
    css, js = read(SRC, 'style.css'), read(SRC, 'site.js')
    for lang, dest, rel in (('it', 'index.html', ''), ('en', 'en/index.html', '../')):
        page = read(SRC, lang + '.html')
        page = page.replace('{{CSS}}', re.sub(r'\n\s*', '\n', css.replace('{{R}}', rel))).replace('{{JS}}', js).replace('{{SEQ}}', seq_markup(lang))
        page = fill(page.replace('{{R}}', rel), {**common, 'JSONLD': '@@JSONLD@@'})
        page = page.replace('@@JSONLD@@', jsonld(lang, page, base, ver, date, repo_url))
        write(os.path.join(out, dest), page)
        title = re.search(r'<title>(.*?)</title>', page).group(1)
        desc = re.search(r'<meta name="description" content="(.*?)">', page).group(1)
        print(f'{dest}: title {len(title)} chars, description {len(desc)} chars, {len(page) // 1024} KB')

    # The online app, with its own title, description and links for search engines and social previews.
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
            f'<meta property="og:image" content="{base}/img/og-it.png">\n<meta name="twitter:card" content="summary_large_image">\n')
    app = app.replace('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n',
                      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head, 1)
    assert head in app, 'could not add the head tags to the online app'
    # Search engines read the title after the app starts: keep the site title while the demo song is open.
    old = "document.title = proj.name + ' — Ritmo Studio';"
    assert old in app, 'the app no longer sets document.title the expected way'
    app = app.replace(old, "document.title = proj.name === 'Mezzanotte (demo)' ? 'Ritmo Studio online – DAW gratis nel browser' : proj.name + ' — Ritmo Studio';")
    write(os.path.join(out, 'app', 'index.html'), app)

    shutil.copytree(os.path.join(SRC, 'img'), os.path.join(out, 'img'))
    shutil.copy(os.path.join(SRC, 'favicon.ico'), out)
    for f in os.listdir(SRC):  # the IndexNow key, which tells search engines the site is ours
        if re.fullmatch(r'[0-9a-f]{32}\.txt', f):
            shutil.copy(os.path.join(SRC, f), out)
    os.makedirs(os.path.join(out, 'fonts'))
    for f in FONTS:
        shutil.copy(os.path.join(ROOT, 'fonts', f + '.woff2'), os.path.join(out, 'fonts'))
    write(os.path.join(out, '404.html'), fill(read(SRC, '404.html'), {'BASE': base}))
    write(os.path.join(out, '.nojekyll'), '')
    write(os.path.join(out, 'robots.txt'), f'User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n')
    write(os.path.join(out, 'site.webmanifest'), json.dumps({
        'name': 'Ritmo Studio', 'short_name': 'Ritmo Studio', 'lang': 'it', 'start_url': './app/', 'scope': './',
        'display': 'standalone', 'background_color': '#121618', 'theme_color': '#121618',
        'icons': [{'src': 'img/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
                  {'src': 'img/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]}, indent=2))
    alt = (f'<xhtml:link rel="alternate" hreflang="it" href="{base}/"/>'
           f'<xhtml:link rel="alternate" hreflang="en" href="{base}/en/"/>'
           f'<xhtml:link rel="alternate" hreflang="x-default" href="{base}/"/>')
    urls = [(f'{base}/', alt, '1.0'), (f'{base}/en/', alt, '0.8'), (f'{base}/app/', '', '0.7')]
    write(os.path.join(out, 'sitemap.xml'),
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + ''.join(f'  <url><loc>{u}</loc><lastmod>{date}</lastmod><priority>{p}</priority>{x}</url>\n' for u, x, p in urls)
          + '</urlset>\n')
    print('site built in', out)


if __name__ == '__main__':
    main()
