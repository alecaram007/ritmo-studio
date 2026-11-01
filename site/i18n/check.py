#!/usr/bin/env python3
"""Checks site translations against en.json: same keys and list lengths, placeholders and HTML tags kept,
search-friendly title and description lengths.   python3 site/i18n/check.py [code ...]  (no code = all)"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WIDE = {'ja', 'ko', 'zh-cn', 'zh-tw'}  # scripts where one character carries more, so limits are shorter


def load(code):
    with open(os.path.join(HERE, code + '.json'), encoding='utf-8') as f:
        return json.load(f)


def marks(s):
    return sorted(re.findall(r'\{\{[A-Z_]+\}\}|<a href="[^"]*">|</a>', s))


def walk(ref, val, path, errs):
    if isinstance(ref, dict):
        if not isinstance(val, dict):
            return errs.append(f'{path}: should be an object')
        for k in ref:
            if k not in val:
                errs.append(f'{path}{k}: missing')
            else:
                walk(ref[k], val[k], f'{path}{k}.', errs)
        for k in val:
            if k not in ref:
                errs.append(f'{path}{k}: unknown key')
    elif isinstance(ref, list):
        if not isinstance(val, list):
            return errs.append(f'{path}: should be a list')
        if len(ref) != len(val) and path not in ('faq.',):
            errs.append(f'{path}: {len(val)} items, expected {len(ref)}')
        for i, (r, v) in enumerate(zip(ref, val)):
            walk(r, v, f'{path}{i}.', errs)
    else:
        if not isinstance(val, str) or not val.strip():
            errs.append(f'{path}: empty')
        elif path not in ('date_format.',) and marks(ref) != marks(val):
            errs.append(f'{path}: placeholders/links differ: {marks(val)} vs {marks(ref)}')


def check(code, ref):
    t, errs = load(code), []
    if code == 'it':  # Italian has no question about the interface language, so its FAQ is one shorter
        ref = {k: v for k, v in ref.items() if k != 'faq'}
        t = {k: v for k, v in t.items() if k != 'faq'}
        errs += [] if len(load(code)['faq']) == len(load('en')['faq']) - 1 else ['faq: expected one question less than en']
    walk(ref, t, '', errs)
    t = load(code)
    if code != 'it' and len(t.get('faq', [])) != len(load('en')['faq']):
        errs.append(f'faq: {len(t.get("faq", []))} questions, expected {len(ref["faq"])}')
    tl, dl = len(t.get('title', '')), len(t.get('description', ''))
    tmax, dmin, dmax = (34, 50, 95) if code in WIDE else (62, 110, 160)
    if tl > tmax:
        errs.append(f'title: {tl} characters, keep it under {tmax}')
    if not dmin <= dl <= dmax:
        errs.append(f'description: {dl} characters, aim for {dmin}–{dmax}')
    if 'Ritmo Studio' not in t.get('title', ''):
        errs.append('title: must contain "Ritmo Studio"')
    if not re.search(r'\{d\}', t.get('date_format', '')) or not re.search(r'\{y\}', t.get('date_format', '')):
        errs.append('date_format: needs {d} and {y} (and {month} or {m})')
    return errs


ref = load('en')
codes = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(HERE) if f.endswith('.json') and f != 'en.json')
bad = 0
for c in codes:
    e = check(c, ref)
    bad += bool(e)
    print(f'{c}: ' + ('ok' if not e else '\n  ' + '\n  '.join(e)))
sys.exit(1 if bad else 0)
