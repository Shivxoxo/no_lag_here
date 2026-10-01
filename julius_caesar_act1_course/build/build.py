#!/usr/bin/env python3
"""Assemble chapter Markdown files into a designed HTML study book, then render to PDF via Chromium.
Usage: python3 build.py <sections_dir> <out_html> [--pdf out.pdf]"""
import re, sys, os, glob, html, json, subprocess
import markdown
from markdown.extensions.toc import slugify

BOX_TITLES = {
 'insight': "PROFESSOR'S INSIGHT", 'quote': 'QUOTATION', 'keyword': 'KEYWORDS', 'history': 'HISTORICAL CONTEXT',
 'icse': 'ICSE EXAM BOX', 'crossref': 'CROSS-REFERENCE', 'revision': 'REVISION', 'textnote': 'TEXT NOTE',
 'weak': 'WEAK ANSWER', 'strong': 'EXCELLENT ANSWER', 'level': 'LEVEL', 'model': 'MODEL ANSWER', 'question': 'QUESTIONS', 'extract': 'EXTRACT'}

def convert_boxes(md):
    out = []
    stack = []
    for line in md.split('\n'):
        m = re.match(r'^:::\s*([a-z]+)\s*(.*)$', line)
        if m and m.group(1) in BOX_TITLES:
            typ, title = m.group(1), m.group(2).strip()
            label = BOX_TITLES[typ]
            if typ == 'level' and title: label = ''
            head = f'<div class="box-head"><span class="box-label">{html.escape(label)}</span>' + (f'<span class="box-title">{html.escape(title)}</span>' if title else '') + '</div>'
            out.append(f'\n<div class="box box-{typ}" markdown="1">\n{head}\n')
            stack.append(typ)
        elif line.strip() == ':::' and stack:
            stack.pop(); out.append('\n</div>\n')
        else:
            out.append(line)
    while stack: stack.pop(); out.append('\n</div>\n')
    return '\n'.join(out)

def convert_chains(md):
    def rep(m):
        lines = [l for l in m.group(1).split('\n') if l.strip()]
        items = []
        for l in lines:
            s = l.strip()
            if s in ('↓','→','v','|','->'): continue
            items.append(f'<div class="chain-step">{html.escape(s)}</div>')
        return '\n<div class="chain">' + '<div class="chain-arrow">↓</div>'.join(items) + '</div>\n'
    return re.sub(r'```chain\n(.*?)```', rep, md, flags=re.S)

def demote_none(md): return md

def build(sections_dir, out_html, meta):
    files = sorted(glob.glob(os.path.join(sections_dir, '*.md')))
    md_ext = ['tables', 'fenced_code', 'md_in_html', 'attr_list', 'def_list', 'sane_lists', 'smarty']
    chapters = []
    for i, f in enumerate(files):
        raw = open(f, encoding='utf-8').read()
        raw = convert_chains(convert_boxes(raw))
        m = re.search(r'^#\s+(.+)$', raw, flags=re.M)
        title = m.group(1).strip() if m else os.path.basename(f)
        raw = re.sub(r'^#\s+.+$', '', raw, count=1, flags=re.M)
        body = markdown.markdown(raw, extensions=md_ext, extension_configs={'smarty': {'smart_dashes': False, 'smart_ellipses': False, 'smart_quotes': False}})
        # collect h2 for TOC and add ids
        secs = []
        used = set()
        def add_id(mm):
            inner = mm.group(1)
            t = re.sub('<[^>]+>', '', inner).strip()
            sid = f'ch{i+1}-' + slugify(t, '-')
            k = 2
            base = sid
            while sid in used:
                sid = f'{base}-{k}'; k += 1
            used.add(sid)
            secs.append((sid, t))
            return f'<h2 id="{sid}">{inner}</h2>'
        body = re.sub(r'<h2>(.*?)</h2>', add_id, body, flags=re.S)
        chid = f'ch{i+1}'
        num = i  # chapter 0 = front matter
        chapters.append(dict(id=chid, title=title, body=body, secs=secs, num=num, file=os.path.basename(f)))
    css = open(os.path.join(os.path.dirname(__file__), 'book.css'), encoding='utf-8').read()
    # Title page + TOC
    toc = ['<nav class="toc"><h1>Contents</h1>']
    for ch in chapters:
        label = 'Front matter' if ch['num']==0 else f"Chapter {ch['num']}"
        toc.append(f'<div class="toc-ch"><a href="#{ch["id"]}"><span class="toc-num">{label}</span><span class="toc-title">{html.escape(ch["title"])}</span><span class="toc-page"></span></a></div>')
        for sid, t in ch['secs']:
            toc.append(f'<div class="toc-sec"><a href="#{sid}"><span class="toc-title">{html.escape(t)}</span><span class="toc-page"></span></a></div>')
    toc.append('</nav>')
    parts = [f'<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>{html.escape(meta["title"])}</title><style>{css}</style></head><body>']
    parts.append(f'''<section class="titlepage">
  <div class="tp-rule"></div>
  <div class="tp-kicker">A PERSONAL MASTER COURSE FOR ICSE</div>
  <h1 class="tp-title">JULIUS CAESAR</h1>
  <div class="tp-sub">Act 1 — Master Course &amp; Study Book</div>
  <div class="tp-desc">{html.escape(meta["subtitle"])}</div>
  <div class="tp-rule"></div>
  <div class="tp-meta">{meta["meta_html"]}</div>
</section>''')
    parts.append(''.join(toc))
    for ch in chapters:
        label = 'FRONT MATTER' if ch['num']==0 else f"CHAPTER {ch['num']}"
        parts.append(f'<section class="chapter" id="{ch["id"]}"><div class="ch-divider"><div class="ch-label">{label}</div><h1 class="ch-title">{html.escape(ch["title"])}</h1></div>{ch["body"]}</section>')
    parts.append('</body></html>')
    open(out_html, 'w', encoding='utf-8').write(''.join(parts))
    print('chapters:', len(chapters), 'html bytes:', os.path.getsize(out_html))
    return chapters

def fill_toc_pages(out_html, pdf_path):
    import pymupdf
    doc = pymupdf.open(pdf_path)
    dest = {}
    for pno in range(len(doc)):
        for l in doc[pno].get_links():
            nd = l.get('nameddest')
            if nd and 'page' in l and nd not in dest:
                dest[nd] = l['page'] + 1
        if len(dest) and pno > 0 and not any(x.get('nameddest') for x in doc[pno].get_links()):
            break  # past the TOC pages
    h = open(out_html, encoding='utf-8').read()
    def rep(m):
        return m.group(1) + str(dest.get(m.group(2), '')) + m.group(3)
    h2 = re.sub(r'(<a href="#([^"]+)">.*?<span class="toc-page">)()(</span>)', lambda m: m.group(1) + str(dest.get(m.group(2), '')) + m.group(4), h, flags=re.S)
    open(out_html, 'w', encoding='utf-8').write(h2)
    print('toc entries numbered:', len(dest), 'pages:', len(doc))
    return len(doc)

def add_bookmarks(out_html, pdf_path):
    import pymupdf
    doc = pymupdf.open(pdf_path)
    dest = {}
    for pno in range(len(doc)):
        for l in doc[pno].get_links():
            nd = l.get('nameddest')
            if nd and 'page' in l and nd not in dest: dest[nd] = l['page'] + 1
    h = open(out_html, encoding='utf-8').read()
    toc = []
    for m in re.finditer(r'<div class="toc-(ch|sec)"><a href="#([^"]+)">(.*?)</a></div>', h, flags=re.S):
        kind, sid, inner = m.groups()
        inner = re.sub(r'<span class="toc-num">.*?</span>', '', inner, flags=re.S)
        title = re.sub('<[^>]+>', ' ', inner); title = re.sub(r'\s+', ' ', html.unescape(title)).strip()
        title = re.sub(r'\s+\d+$', '', title)  # drop page number text
        if sid in dest: toc.append([1 if kind=='ch' else 2, title[:120], dest[sid]])
    if toc:
        doc.set_toc(toc)
        tmp = pdf_path + '.tmp'
        doc.save(tmp, garbage=3, deflate=True); doc.close()
        os.replace(tmp, pdf_path)
    print('bookmarks added:', len(toc))

def render(out_html, pdf_path):
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'render.js'), out_html, pdf_path], check=True)

if __name__ == '__main__':
    sections_dir, out_html = sys.argv[1], sys.argv[2]
    meta = json.load(open(os.path.join(os.path.dirname(__file__), 'meta.json')))
    build(sections_dir, out_html, meta)
    if '--pdf' in sys.argv:
        pdf_path = sys.argv[sys.argv.index('--pdf') + 1]
        render(out_html, pdf_path)              # pass 1
        fill_toc_pages(out_html, pdf_path)      # inject page numbers into TOC
        render(out_html, pdf_path)              # pass 2
        n = fill_toc_pages(out_html, pdf_path)  # sanity re-read (numbers should be unchanged)
        add_bookmarks(out_html, pdf_path)
        print('final pages:', n)
