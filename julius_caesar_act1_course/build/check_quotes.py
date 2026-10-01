#!/usr/bin/env python3
"""Check every double-quoted string (>=3 words) in a markdown file against the verified Act 1 texts.
Usage: python3 check_quotes.py file.md [--min-words N]
Exit code 0 if all quotations match, 1 otherwise. Prints unmatched quotations with line numbers."""
import re, sys, unicodedata, os
HERE = os.path.dirname(os.path.abspath(__file__))
def norm(t):
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    t = t.replace('—', ' ').replace('–', ' ').replace('-', ' ')
    t = re.sub(r"[^a-z0-9' ]+", ' ', t)
    t = re.sub(r"(?<![a-z])'|'(?![a-z])", ' ', t)   # drop quote-mark apostrophes, keep in-word ones
    t = re.sub(r"\s+", ' ', t).strip()
    return t
corpus = ''
for f in ('ACT1_FOLGER.txt', 'ACT1_MIT.txt', 'act1_gutenberg.txt'):
    raw = open(os.path.join(HERE, f), encoding='utf-8').read()
    raw = re.sub(r'^(?!\s*\d)[A-Z][A-Za-z ]+\.\s*$', '', raw, flags=re.M)  # speaker labels (unnumbered lines only)
    raw = re.sub(r'^\s*\d+\s{2}', '', raw, flags=re.M)      # strip line numbers
    raw = re.sub(r'^\s*\[.*?\]\s*$', '', raw, flags=re.M)     # strip stage directions
    raw = re.sub(r'^#+.*$', '', raw, flags=re.M)
    corpus += ' ' + norm(raw)
# also allow spellings: Folger 'laughter' vs 'laugher' both present already. Add common British variants of Folger-only words:
variants = {'honor':'honour','honorable':'honourable','honors':'honours','color':'colour','favor':'favour','laboring':'labouring','offense':'offence','humor':'humour','luster':'lustre','neighbors':'neighbours','theater':'theatre','dishonorable':'dishonourable','marketplace':'market place'}
extra = corpus
for a,b in variants.items():
    extra = re.sub(r'\b%s\b'%a, b, extra)
corpus = corpus + ' ' + extra
def main():
    path = sys.argv[1]
    minw = 3
    if '--min-words' in sys.argv: minw = int(sys.argv[sys.argv.index('--min-words')+1])
    text = open(path, encoding='utf-8').read()
    bad = []
    total = 0
    items = []
    for m in re.finditer(r'[“"]([^“”"\n]+?)[”"]', text):
        items.append((text.count('\n', 0, m.start()) + 1, m.group(1)))
    for ln, l in enumerate(text.split('\n'), 1):
        if l.lstrip().startswith('>'):
            q = re.sub(r'^\s*>+\s*', '', l)
            q = re.sub(r'^\*\*[^*]+\*\*:?\s*', '', q)   # drop **Speaker:** label
            q = re.sub(r'^[A-Z][A-Za-z ]{1,20}:\s*', '', q)  # drop Speaker: label
            q = q.replace('*','').replace('_','')
            if q.strip(): items.append((ln, q))
    for line, q in items:
        segs = [s for s in re.split(r'\.\.\.|…|\[\s*\.\.\.\s*\]|\[…\]', q)]
        for seg in segs:
            n = norm(seg)
            # drop leading/trailing partial words markers
            words = n.split()
            if len(words) < minw: continue
            total += 1
            if n not in corpus:
                bad.append((line, seg.strip()))
    for line, seg in bad:
        print(f'{path}:{line}: NOT IN TEXT -> "{seg}"')
    print(f'# checked {total} quotation segments (>= {minw} words); unmatched: {len(bad)}')
    sys.exit(1 if bad else 0)
if __name__ == '__main__': main()
