"""Extract per-page text from the lecture PDFs in the vault's Atlas/Resources/Lectures tree into slides_text.json.

PDFs already in slides_text.json keep their text, so a rerun only reads what is new and the slide links built on the
old text stay put. A PDF joins the index only when named (or with --all); the rest stay unindexed, so Carrel keeps
listing them under "New in the vault", ready to have a study set built from them.

    python extract_slides.py                                   keep the index as it is (drops PDFs that are gone)
    python extract_slides.py "Atlas/Resources/Lectures/HODL/x.pdf" ...   add these decks
    python extract_slides.py --all                             re-read every lecture PDF

Uses PyMuPDF if it is installed (better text order), otherwise pypdf.
"""
import sys, os, io, json, re

from config import VAULT, LECTURE_DIRS

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, 'slides_text.json')
sys.path.insert(0, os.path.expandvars(r'%LOCALAPPDATA%\Temp\shlib'))  # where the first build put PyMuPDF
try:
    import fitz  # PyMuPDF
    if not hasattr(fitz, 'open'):  # a leftover 'fitz' folder without PyMuPDF behind it
        raise ImportError('not PyMuPDF')
except ImportError:
    fitz = None
    import pypdf


def tidy(t):
    t = re.sub(r'[ \t]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t).strip()[:4000]


def read_pages(path):
    """(page texts, width/height of page 1)"""
    if fitz:
        doc = fitz.open(path)
        pages = [tidy(pg.get_text('text')) for pg in doc]
        w, h = (doc[0].rect.width, doc[0].rect.height) if len(doc) else (0, 0)
        return pages, (w / h if h else 1.333)
    with open(path, 'rb') as f:
        reader = pypdf.PdfReader(io.BytesIO(f.read()))
    pages = []
    for pg in reader.pages:
        try:
            pages.append(tidy(pg.extract_text() or ''))
        except Exception:
            pages.append('')
    box = reader.pages[0].mediabox if reader.pages else None
    return pages, (float(box.width) / float(box.height) if box and float(box.height) else 1.333)


def extract(only=(), everything=False, log=print):
    """Update slides_text.json; returns the number of PDFs indexed."""
    try:
        with open(INDEX, encoding='utf8') as fh:
            known = json.load(fh)
    except (OSError, ValueError):
        known = {}
    only = {p.replace('\\', '/') for p in only}
    out = {}

    def add(path, course):
        rel = os.path.relpath(path, VAULT).replace(os.sep, '/')
        if rel in known and known[rel].get('course') == course and not everything:
            out[rel] = known[rel]
            return
        if rel not in only and not everything:
            return
        try:
            pages, ar = read_pages(path)
        except Exception as e:
            log('skip %s %s' % (rel, e))
            return
        out[rel] = {'course': course, 'file': os.path.basename(path), 'path': rel, 'n': len(pages), 'ar': round(ar, 4), 'pages': pages}
        log(f'{course} {len(pages):4d}p {rel}')

    log('reading PDFs with ' + ('PyMuPDF' if fitz else 'pypdf'))
    for d, c in LECTURE_DIRS.items():
        p = os.path.join(VAULT, 'Atlas', 'Resources', 'Lectures', d)
        if not os.path.isdir(p):
            continue
        for f in sorted(os.listdir(p)):
            if f.lower().endswith('.pdf'):
                add(os.path.join(p, f), c)
    # PDFs a deck cites that live outside the lecture folders
    for root, dirs, files in os.walk(os.path.join(VAULT, 'Efforts')):
        for f in files:
            if f.lower() == 'practice-exam-2026-solutions.pdf':
                add(os.path.join(root, f), 'c57')
    if len(out) < len(known) // 2:
        raise RuntimeError('only %d of %d known PDFs read; slides_text.json left as it was' % (len(out), len(known)))
    with open(INDEX + '.tmp', 'w', encoding='utf8') as fh:
        json.dump(out, fh, ensure_ascii=False)
    os.replace(INDEX + '.tmp', INDEX)
    log('files %d pages %d' % (len(out), sum(v['n'] for v in out.values())))
    return len(out)


if __name__ == '__main__':
    try:
        extract([a for a in sys.argv[1:] if not a.startswith('--')], '--all' in sys.argv)
    except RuntimeError as e:
        sys.exit(str(e))
