"""Normalize the four existing study decks into one dataset and link every item to a lecture slide.

Inputs:  build/decks/*.html (the published 15.072, 15.095, 15.C57 decks), build/slides_text.json
Outputs: app/data/courses.js, app/data/slidetext.js
"""
import os, re, json, math
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DATA = os.environ.get('CARREL_APP_DATA') or os.path.join(HERE, '..', 'app', 'data')  # make_seed.py points it elsewhere
DECKS = os.path.join(HERE, 'decks')
EXTRA = os.path.join(HERE, 'extra')  # hand-written sets for lectures the decks never covered

SLIDES = json.load(open(os.path.join(HERE, 'slides_text.json'), encoding='utf8'))
FILES = sorted(SLIDES.keys(), key=lambda k: (SLIDES[k]['course'], k))
FILE_IDX = {k: i for i, k in enumerate(FILES)}


# ---------------------------------------------------------------- deck readers
def read(name):
    return open(os.path.join(DECKS, name), encoding='utf8').read()


def const_json(s, name):
    i = s.find('const %s = ' % name) + len('const %s = ' % name)
    return json.JSONDecoder().raw_decode(s[i:])[0]


def script_json(s):
    m = re.search(r'<script type="application/json" id="data">', s)
    return json.loads(s[m.end():s.find('</script>', m.end())])


# ---------------------------------------------------------------- slide index
WORD = re.compile(r"[a-zA-Z][a-zA-Z\-']+|\d+(?:\.\d+)?")
STOP = set('''the and for that with this from are was were has have had not but you your its into than then them they
there their what which when where who whom how why can could would should will shall may might must also very more most
less each per any all some such only other both between over under about after before again because does did doing
being been our out off one two use used using via here these those just like get gets got make makes made set sets
equal equals given let true false page slide lecture recitation class mit sloan'''.split())


def toks(text):
    out = []
    for w in WORD.findall(text.lower()):
        w = w.strip("-'")
        if len(w) < 3 and not w.isdigit():
            continue
        if w in STOP:
            continue
        if len(w) > 4 and w.endswith('s') and not w.endswith('ss'):
            w = w[:-1]
        out.append(w)
    return out


class Index:
    """TF-IDF over every slide page of one course."""

    def __init__(self, course):
        self.docs = []  # (file key, page number 1-based, vector, norm)
        df = Counter()
        raw = []
        for k in FILES:
            if SLIDES[k]['course'] != course:
                continue
            for p, t in enumerate(SLIDES[k]['pages'], 1):
                tf = Counter(toks(t))
                raw.append((k, p, tf))
                df.update(tf.keys())
        n = max(1, len(raw))
        self.idf = {w: math.log((n + 1) / (c + 0.5)) for w, c in df.items()}
        for k, p, tf in raw:
            vec = {w: (1 + math.log(c)) * self.idf[w] for w, c in tf.items()}
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1
            self.docs.append((k, p, vec, norm))

    def best(self, text, files=None):
        q = Counter(toks(text))
        qv = {w: (1 + math.log(c)) * self.idf.get(w, 0) for w, c in q.items()}
        qn = math.sqrt(sum(v * v for v in qv.values())) or 1
        best = (None, 0, 0.0)
        for k, p, vec, norm in self.docs:
            if files and k not in files:
                continue
            s = sum(qv[w] * vec[w] for w in qv if w in vec) / (qn * norm)
            # very short pages (title slides, section dividers) are poor targets
            if len(vec) < 6 or p == 1:
                s *= 0.6
            elif 'outline' in vec or 'agenda' in vec:
                s *= 0.75
            if s > best[2]:
                best = (k, p, s)
        return best


# ---------------------------------------------------------------- source strings -> candidate files
def course_files(course):
    return [k for k in FILES if SLIDES[k]['course'] == course]


def lec_map(course):
    """lecture number -> file keys, recitation number -> file keys"""
    lec, rec = defaultdict(list), defaultdict(list)
    for k in course_files(course):
        f = SLIDES[k]['file']
        m = re.search(r'(?:C57-L|C57_Lec|Lec|Lecture)[-_ ]?0?(\d+)', f, re.I)
        if m and not re.search(r'rec', f, re.I):
            lec[int(m.group(1))].append(k)
            continue
        m = re.search(r'Lecture(\d+)_presentation', f)
        if m:
            lec[int(m.group(1))].append(k)
            continue
        m = re.search(r'(?:Recitation|Rec|rec)[ _-]?(\d+)', f, re.I)
        if m:
            rec[int(m.group(1))].append(k)
    if course == 'c57':
        # Fall_2026_15_C57-5.pdf duplicates L5; keep L5 canonical
        lec[5] = [k for k in lec[5] if k.endswith('C57-L5.pdf')] or lec[5]
    return lec, rec


LEC = {c: lec_map(c) for c in ('c57', '095', '072')}


class Missing(list):
    """files_from_src found none of the decks a source names: this vault lacks them (or names them differently).
    Empty and falsy, so 'files or course_files(...)' still falls back, but link() leaves such items unlinked
    rather than pinning them to whichever deck of the course happens to be there."""


NAMES_A_DECK = re.compile(r'\.pdf\b|\b(?:Lec|Lecture|L|Rec|Recitation|R)\s?\d', re.I)


def files_from_src(course, src):
    out = []
    by_name = {SLIDES[k]['file'].lower(): k for k in course_files(course)}
    # a deck named in full, dots and all ('15.776 Lecture 2.pdf'), which the pattern below cuts at the first dot
    for name, k in sorted(by_name.items(), key=lambda x: src.lower().find(x[0])):
        if '.' in name[:-4] and name in src.lower() and k not in out:
            out.append(k)
    for name in re.findall(r'[\w\-\(\) ]+?\.pdf', src):
        k = by_name.get(name.strip().lower())
        if k and k not in out:
            out.append(k)
    lec, rec = LEC.get(course, ({}, {}))
    for m in re.finditer(r'\b(Lec|L|Lecture)\s?(\d+)\b', src):
        for k in lec.get(int(m.group(2)), []):
            if k not in out:
                out.append(k)
    for m in re.finditer(r'\b(Rec|Recitation|R)\s?(\d+)', src):
        for k in rec.get(int(m.group(2)), []):
            if k not in out:
                out.append(k)
    if re.search(r'practice[ -]exam|Practice exam|^PE\b', src, re.I):
        out += [k for k in course_files(course) if 'practice-exam' in k and k not in out]
    return out or (Missing() if NAMES_A_DECK.search(src or '') else out)


def parse_ref(course, src):
    """'L3 p.12', 'Rec4 pp.5–7', 'Practice exam 2a, p.4' -> (file key, page) for the first cited page."""
    if not src:
        return None
    lec, rec = LEC[course]
    for part in re.split(r'[;/]', src):
        part = part.strip()
        m = re.match(r'(L|Lec)\s?(\d+)\s*,?\s*pp?\.\s?(\d+)', part)
        if m and lec.get(int(m.group(2))):
            return lec[int(m.group(2))][0], int(m.group(3))
        m = re.match(r'Rec\s?(\d+)\s*,?\s*pp?\.\s?(\d+)', part)
        if m and rec.get(int(m.group(1))):
            return rec[int(m.group(1))][0], int(m.group(2))
        m = re.match(r'Practice exam.*?pp?\.\s?(\d+)', part, re.I)
        if m:
            pe = [k for k in course_files(course) if 'practice-exam' in k]
            if pe:
                return pe[0], int(m.group(1))
    return None


def clamp_page(k, p):
    return max(1, min(p, SLIDES[k]['n']))


# ---------------------------------------------------------------- builders
def slide_tuple(ref):
    if not ref or not ref[0]:
        return None
    return [FILE_IDX[ref[0]], clamp_page(ref[0], ref[1])]


def link(index, text, files):
    if isinstance(files, Missing):
        return None
    k, p, s = index.best(text, set(files) if files else None)
    if not k and files:
        k, p, s = index.best(text)
    if not k:
        return None
    return [FILE_IDX[k], p, round(s, 3)]


def norm_q(s):
    return re.sub(r'\W+', ' ', s.lower()).strip()


def unit_label(uid, src=''):
    m = re.match(r'l(\d+)$', uid)
    if m:
        return 'L' + m.group(1)
    if uid.startswith('r') and uid[1:].isdigit():
        return 'R' + uid[1:]
    return {'pe': 'PE', 'rv': 'Rev', 'rc': 'Rev'}.get(uid, uid.upper())


def build_c57():
    deck = read('c57.html')
    L = const_json(deck, 'L')
    T = const_json(deck, 'TAGS')
    U = {u['id']: u for u in script_json(read('c57studio.html'))}
    idx = Index('c57')
    units = []
    for l in L:
        uid = l['id']
        st = U.get(uid, {})
        topics = [{'n': n} for n in l['topics']]
        tpos = {t['n']: i for i, t in enumerate(topics)}
        for t in st.get('topics', []):
            i = tpos.get(t['name'])
            if i is None:
                tpos[t['name']] = i = len(topics)
                topics.append({'n': t['name']})
            topics[i]['x'] = t.get('explain', '')
            topics[i]['sl'] = [[FILE_IDX[s_['file']] if s_['file'] in FILE_IDX else None, s_['page'], s_.get('label', '')]
                               for s_ in t.get('slides', []) if any(k.endswith('/' + s_['file']) for k in FILES)]
            deck_i = next((FILE_IDX[k] for k in FILES if k.endswith('/' + (st.get('deck') or '?'))), None)
            for s_ in topics[i]['sl']:
                if s_[0] is None:
                    s_[0] = deck_i
            topics[i]['sl'] = [s_ for s_ in topics[i]['sl'] if s_[0] is not None]  # a deck this vault does not have
        files = files_from_src('c57', l['src'] + ' ' + st.get('deck', ''))
        tags = T.get(uid, {})
        cards = []
        for i, c in enumerate(l['cards']):
            t = tags.get('cards', [])[i] if i < len(tags.get('cards', [])) else None
            sl = link(idx, ' '.join(c[:2]), files)
            cards.append({'f': c[0], 'b': c[1], 'x': c[2] if len(c) > 2 else '', 't': t, 's': sl})
        quiz, seen = [], set()
        for i, q in enumerate(st.get('mc', [])):
            ref = parse_ref('c57', q.get('src', ''))
            sl = slide_tuple(ref) or link(idx, q['q'] + ' ' + q['o'][0] + ' ' + q['e'], files)
            t = q.get('t')
            if t is not None and st.get('topics') and t < len(st['topics']):
                t = tpos.get(st['topics'][t]['name'], t)
            quiz.append({'q': q['q'], 'o': q['o'], 'a': 0, 'e': q['e'], 'd': q.get('d', 'medium'), 't': t, 's': sl, 'src': q.get('src', '')})
            seen.add(norm_q(q['q']))
        for i, q in enumerate(l.get('quiz', [])):
            if norm_q(q['q']) in seen:
                continue
            t = tags.get('quiz', [])[i] if i < len(tags.get('quiz', [])) else None
            sl = link(idx, q['q'] + ' ' + q['o'][0] + ' ' + q['e'], files)
            quiz.append({'q': q['q'], 'o': q['o'], 'a': 0, 'e': q['e'], 'd': q.get('d', 'medium'), 't': t, 's': sl, 'src': ''})
        written = []
        for q in st.get('or', []):
            ref = parse_ref('c57', q.get('src', ''))
            sl = slide_tuple(ref) or link(idx, q['q'] + ' ' + q.get('model', ''), files)
            t = q.get('t')
            if t is not None and st.get('topics') and t < len(st['topics']):
                t = tpos.get(st['topics'][t]['name'], t)
            written.append({'q': q['q'], 'm': q.get('model', ''), 'k': q.get('rubric', []), 'pts': q.get('pts'), 't': t, 's': sl, 'src': q.get('src', '')})
        units.append({'id': uid, 'label': unit_label(uid), 'title': l['title'], 'short': l.get('short', l['title']), 'src': l['src'],
                      'brief': st.get('brief', ''), 'kp': st.get('keyPoints', []), 'files': [FILE_IDX[k] for k in files],
                      'topics': topics, 'cards': cards, 'quiz': quiz, 'written': written})
    return units


def build_072():
    deck = read('072.html')
    L = const_json(deck, 'L')
    T = const_json(deck, 'TAGS')
    idx = Index('072')
    units = []
    for l in L:
        uid = l['id']
        files = files_from_src('072', l['src']) or course_files('072')
        tags = T.get(uid, {})
        topics = [{'n': n} for n in tags.get('topics', l.get('topics', []))]
        cards = []
        for i, c in enumerate(l['cards']):
            t = tags.get('cards', [])[i] if i < len(tags.get('cards', [])) else None
            cards.append({'f': c[0], 'b': c[1], 'x': c[2] if len(c) > 2 else '', 't': t, 's': link(idx, ' '.join(c[:2]), files)})
        quiz = []
        for i, q in enumerate(l['quiz']):
            t = tags.get('quiz', [])[i] if i < len(tags.get('quiz', [])) else None
            quiz.append({'q': q['q'], 'o': q['o'], 'a': 0, 'e': q['e'], 'd': q.get('d', 'medium'), 't': t,
                         's': link(idx, q['q'] + ' ' + q['o'][0] + ' ' + q['e'], files), 'src': ''})
        units.append({'id': uid, 'label': unit_label(uid), 'title': l['title'], 'short': l.get('short', l['title']), 'src': l['src'],
                      'brief': '', 'kp': [], 'files': [FILE_IDX[k] for k in files], 'topics': topics, 'cards': cards, 'quiz': quiz, 'written': []})
    return units


def build_095():
    d = script_json(read('095.html'))
    idx = Index('095')
    units = []
    for sec in d['sections']:
        sid = sec['id']
        src = sec['src']
        files = files_from_src('095', src)
        m = re.match(r'(Lec|Rec)\s?(\d+)', src)
        label = (m.group(1)[0] + m.group(2)) if m else ('HW1' if src.startswith('HW1') else 'All')
        if label.startswith('L'):
            label = 'L' + m.group(2)
        cards = [{'f': c['f'], 'b': c['b'], 'x': c.get('x', ''), 't': 0, 'bk': bool(c.get('bk')),
                  's': link(idx, c['f'] + ' ' + c['b'], files)} for c in d['cards'] if c['s'] == sid]
        quiz = [{'q': q['q'], 'o': q['o'], 'a': q['a'], 'e': q.get('x', ''), 'd': 'medium', 't': 0,
                 's': link(idx, q['q'] + ' ' + q['o'][q['a']] + ' ' + q.get('x', ''), files), 'src': ''}
                for q in d['mc'] if q['sec'] == sid]
        written = [{'q': q['q'], 'm': q.get('m', ''), 'k': q.get('k', []), 'x': q.get('x', ''), 't': 0,
                    's': link(idx, q['q'] + ' ' + q.get('m', ''), files), 'src': ''} for q in d['wr'] if q['sec'] == sid]
        units.append({'id': 's%d' % sid, 'label': label, 'title': sec['name'], 'short': sec['name'], 'src': src,
                      'brief': '', 'kp': [], 'files': [FILE_IDX[k] for k in files], 'topics': [{'n': sec['name']}],
                      'cards': cards, 'quiz': quiz, 'written': written})
    return units


def extra_units(course):
    """Hand-built units in build/extra/<course>-*.json, slide-linked the same way."""
    out = []
    if not os.path.isdir(EXTRA):
        return out
    idx = None
    for f in sorted(os.listdir(EXTRA)):
        if not (f.startswith(course + '-') and f.endswith('.json')):
            continue
        u = json.load(open(os.path.join(EXTRA, f), encoding='utf8'))
        idx = idx or Index(course)
        files = files_from_src(course, u['src'])
        # a practice exam spans the whole course: items without a page ref search every deck
        search = None if u.get('label') == 'PM' else files
        for c in u.get('cards', []):
            c.setdefault('x', '')
            c['s'] = slide_tuple(parse_ref_any(course, c.pop('ref', None))) or link(idx, c['f'] + ' ' + c['b'], search)
        for q in u.get('quiz', []):
            q.setdefault('a', 0)
            q.setdefault('d', 'medium')
            q.setdefault('src', q.pop('ref', '') or '')
            q['s'] = slide_tuple(parse_ref_any(course, q['src'])) or link(idx, q['q'] + ' ' + q['o'][q['a']] + ' ' + q.get('e', ''), search)
        for q in u.get('written', []):
            q['s'] = link(idx, q['q'] + ' ' + q.get('m', ''), search)
        u['files'] = [FILE_IDX[k] for k in files]
        u.setdefault('brief', '')
        u.setdefault('kp', [])
        u.setdefault('written', [])
        u['new'] = True
        out.append(u)
    return out


NOTE_PREFIX = {'c57': 'Optimization Methods', '095': 'ML Ops', '072': 'AAE'}


def vault_practice_units(course):
    """Your own practice sets in Efforts/Exams ('## P5. ...' problems, each with a '> [!success]- Answer' callout)
    become written practice: the problem above the callout, the callout as the model answer."""
    from config import VAULT
    folder = os.path.join(VAULT, 'Efforts', 'Exams')
    out = []
    if course not in NOTE_PREFIX or not os.path.isdir(folder):
        return out
    idx = None
    for f in sorted(os.listdir(folder)):
        if not (f.startswith(NOTE_PREFIX[course]) and f.endswith('.md')):
            continue
        text = open(os.path.join(folder, f), encoding='utf8', errors='ignore').read().replace('\r', '')
        if not (re.search(r'^## P\d+\.', text, re.M) and '[!success]' in text):
            continue
        # wikilinks become their alias; Obsidian's \$ stays a dollar for KaTeX
        plain = lambda s: re.sub(r'!?\[\[([^\]|]*\|)?([^\]]*)\]\]', lambda m: m.group(2) or '', s).strip()
        topics, written = [], []
        for sec in re.split(r'\n(?=## )', text):
            m = re.match(r'## (P\d+)\.\s*(.+)', sec)
            if not m:
                continue
            body = re.split(r'\n---\s*\n', sec[m.end():])[0]
            q, _, ans = body.partition('\n> [!success]')
            if not ans:
                continue
            # the answer is the callout: its lines up to the first one outside it
            lines = []
            for l in ans.split('\n')[1:]:
                if not l.startswith('>'):
                    break
                lines.append(re.sub(r'^>\s?', '', l))
            topics.append({'n': m.group(1) + ' ' + plain(m.group(2)), 'x': '', 'sl': []})
            written.append({'q': plain(q) or plain(m.group(2)), 'm': plain('\n'.join(lines)), 'k': [], 't': len(topics) - 1, 'src': f[:-3] + ', ' + m.group(1)})
        if not written:
            continue
        idx = idx or Index(course)
        for w in written:
            w['s'] = link(idx, w['q'] + ' ' + w['m'], None)
        title = re.sub(r'^' + re.escape(NOTE_PREFIX[course]) + r'\s*-\s*', '', f[:-3])
        lead = next((plain(p) for p in re.split(r'\n\s*\n', text) if p.strip() and not p.lstrip().startswith(('#', '---', '|', '>')) and len(p) > 80), '')
        out.append({'id': 'v' + str(abs(hash_text(f)) % 10 ** 6), 'label': 'PS', 'title': title + ' (your notes)', 'short': 'Your practice set',
                    'src': 'Efforts/Exams/' + f, 'brief': lead[:600], 'kp': [], 'topics': topics, 'cards': [], 'quiz': [], 'written': written, 'files': [], 'new': True})
    return out


def attach_note_questions(course, units):
    """'## Exam-style questions' in your cheat sheets: each numbered question with a '> [!success]- Answer' callout
    joins the Written tab of the lecture the note is named for ('Lec10 Cheat Sheet' -> L10, 'Recitations 3-4' -> R3)."""
    from config import VAULT
    folder = os.path.join(VAULT, 'Efforts', 'Exams')
    if course not in NOTE_PREFIX or not os.path.isdir(folder):
        return 0
    plain = lambda s: re.sub(r'!?\[\[([^\]|]*\|)?([^\]]*)\]\]', lambda m: m.group(2) or '', s).strip()
    by_label = {}
    for u in units:
        by_label.setdefault(u['label'], u)          # the first set with a label, where a lecture has several
    idx, n = None, 0
    for f in sorted(os.listdir(folder)):
        if not (f.startswith(NOTE_PREFIX[course]) and f.endswith('.md')):
            continue
        text = open(os.path.join(folder, f), encoding='utf8', errors='ignore').read().replace('\r', '')
        sec = re.search(r'^## [^\n]*[Ee]xam-style[^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
        if not sec:
            continue
        m = re.search(r'\b(Lec|Recitations?|L)\s?(\d+)', f[len(NOTE_PREFIX[course]):])
        if not m:
            continue
        u = by_label.get(('R' if m.group(1).startswith('Rec') else 'L') + m.group(2))
        if not u:
            continue
        # a question may run over several lines, but never into the next numbered one
        for k, q, ans in re.findall(r'^(\d+)\.\s+([^\n]*(?:\n(?!\d+\.)(?!> \[!success\])[^\n]*)*?)\n> \[!success\][^\n]*\n((?:>[^\n]*(?:\n|$))+)', sec.group(1) + '\n', re.M):
            ans = '\n'.join(re.sub(r'^>\s?', '', l) for l in ans.strip().split('\n'))
            w = {'q': plain(q), 'm': plain(ans), 'k': [], 't': None, 'src': 'Your ' + f[len(NOTE_PREFIX[course]):-3].strip(' -') + ', Q' + k, 'mine': True}
            idx = idx or Index(course)
            w['s'] = link(idx, w['q'] + ' ' + w['m'], [FILES[i] for i in u.get('files', [])] or None)
            u.setdefault('written', []).append(w)
            n += 1
    return n


def attach_more_note_questions(course, units):
    """Two more shapes of your own practice, joined to the lecture's Written tab:
    - a '# Self-check' list of numbered questions followed by '> [!success]- Answer N' callouts (the L10-L11 review);
    - a quiz of '**E1.** question' items, each followed by its answer callout, under Easy / Medium / Hard headings (the
      L12-L13 quiz). Its 'Scope.' paragraph says which items belong to which lecture ('L13 ...: E6–E8, M9–M12'), and an
      item that uses 'data set P' carries that data set from the 'Shared data' section with it."""
    from config import VAULT
    folder = os.path.join(VAULT, 'Efforts', 'Exams')
    if course not in NOTE_PREFIX or not os.path.isdir(folder):
        return 0
    plain = lambda s: re.sub(r'!?\[\[([^\]|]*\|)?([^\]]*)\]\]', lambda m: m.group(2) or '', s).strip()
    callout = lambda s: '\n'.join(re.sub(r'^>\s?', '', l) for l in s.strip().split('\n') if l.startswith('>'))
    by_label = {}
    for u in units:
        by_label.setdefault(u['label'], u)
    idx, n = None, 0

    def add(u, q, ans, src):
        nonlocal idx, n
        if not u or not q.strip() or not ans.strip():
            return
        idx = idx or Index(course)
        w = {'q': plain(q), 'm': plain(ans), 'k': [], 't': None, 'src': src, 'mine': True}
        w['s'] = link(idx, w['q'] + ' ' + w['m'], [FILES[i] for i in u.get('files', [])] or None)
        u.setdefault('written', []).append(w)
        n += 1

    for f in sorted(os.listdir(folder)):
        if not (f.startswith(NOTE_PREFIX[course]) and f.endswith('.md')):
            continue
        name = f[len(NOTE_PREFIX[course]):-3].strip(' -')
        first = re.search(r'\b(L|Lec|Rec)\s?(\d+)', name)
        home = by_label.get(('R' if first.group(1) == 'Rec' else 'L') + first.group(2)) if first else None
        text = open(os.path.join(folder, f), encoding='utf8', errors='ignore').read().replace('\r', '')
        # self-check: questions first, answers after
        sec = re.search(r'^#{1,3} Self-check[^\n]*\n(.*?)(?=^#{1,3} |\Z)', text, re.M | re.S)
        if sec and home:
            qs = dict(re.findall(r'^(\d+)\.\s+([^\n]+)', sec.group(1), re.M))
            for k, ans in re.findall(r'^> \[!success\][-+]? Answer (\d+)[^\n]*\n((?:>[^\n]*(?:\n|$))+)', sec.group(1) + '\n', re.M):
                if k in qs:
                    add(home, qs[k], callout(ans), 'Your ' + name + ', self-check ' + k)
        # quiz items: **E1.** ... > [!success]- Answer
        items = re.findall(r'^\*\*([EMH]\d+)\.\*\*\s*([^\n]*(?:\n(?!\*\*[EMH]\d+\.\*\*)(?!> \[!success\])[^\n]*)*?)\n+> \[!success\][^\n]*\n((?:>[^\n]*(?:\n|$))+)', text + '\n', re.M)
        if not items:
            continue
        where = {}
        scope = re.search(r'\*\*Scope\.\*\*([^\n]+)', text)
        for sent in re.split(r'(?<=\.)\s+(?=[A-Z])', scope.group(1) if scope else ''):
            lab = re.search(r'\b(L|Rec\s?)(\d+)', sent)
            if not lab or ':' not in sent:
                continue
            target = by_label.get(('R' if lab.group(1).startswith('Rec') else 'L') + lab.group(2))
            for p, a, b in re.findall(r'\b([EMH])(\d+)(?:\s?[–-]\s?[EMH]?(\d+))?', sent.split(':', 1)[1]):
                for i in range(int(a), int(b or a) + 1):
                    where[p + str(i)] = target
        shared = {}
        sh = re.search(r'^## Shared data\n(.*?)(?=^## |\Z)', text, re.M | re.S)
        if sh:
            for block in re.split(r'\n(?=\*\*Data set )', '\n' + sh.group(1)):
                m = re.match(r'\s*\*\*Data set (\w+)', block)
                if m:
                    shared[m.group(1)] = block.strip()
        for k, q, ans in items:
            sets = [shared[s] for s in dict.fromkeys(re.findall(r'[Dd]ata sets? ([A-Z]\w*)', q)) if s in shared]
            add(where.get(k, home), (q.strip() + ('\n\n' + '\n\n'.join(sets) if sets else '')), callout(ans), 'Your ' + name + ', ' + k)
    return n


def attach_note_flashcards(course, units):
    """Your Spaced Repetition flashcard notes ('<course> - Flashcards (...)'): each '## N. Topic (L12 ...)' section's
    'term::definition' lines and 'question / ? / answer' blocks become cards in the lecture the heading names.
    Cards the decks already have (same front) are skipped, so only the ones missing from the app are added."""
    from config import VAULT
    folder = os.path.join(VAULT, 'Efforts', 'Exams')
    if course not in NOTE_PREFIX or not os.path.isdir(folder):
        return 0
    plain = lambda s: re.sub(r'!?\[\[([^\]|]*\|)?([^\]]*)\]\]', lambda m: m.group(2) or '', s).strip()
    norm = lambda s: re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()[:60]
    by_label = {}
    for u in units:
        by_label.setdefault(u['label'], u)
    have = {norm(c['f']) for u in units for c in u['cards']}
    idx, n = None, 0
    for f in sorted(os.listdir(folder)):
        if not (f.startswith(NOTE_PREFIX[course]) and 'Flashcards' in f and f.endswith('.md')):
            continue
        text = open(os.path.join(folder, f), encoding='utf8', errors='ignore').read().replace('\r', '')
        for sec in re.split(r'\n(?=## )', text):
            head = re.match(r'## ([^\n]+)', sec)
            lab = head and re.search(r'\((?:[^)]*?)\b(L|Rec\s?)(\d+)', head.group(1))
            u = lab and by_label.get(('R' if lab.group(1).startswith('Rec') else 'L') + lab.group(2))
            if not u:
                continue
            cards = [(t, d) for t, d in re.findall(r'^(?![\s|>#-]|```)([^\n:]{1,200}?)\s*:{2,3}\s*(\S[^\n]*)$', sec, re.M)]
            for block in re.split(r'\n\s*\n', sec):
                q, sep, a = block.partition('\n?\n')
                if sep and q.strip() and a.strip() and not q.lstrip().startswith('#'):
                    cards.append((q.strip(), a.strip()))
            for front, back in cards:
                # the same card under a longer or shorter front ("Robust 1 (box) results" / "... on the L13 table")
                k = norm(front)
                if k in have or any(len(min(k, h, key=len)) >= 6 and (h.startswith(k) or k.startswith(h)) for h in have):
                    continue
                have.add(norm(front))
                idx = idx or Index(course)
                c = {'f': plain(front), 'b': plain(back), 'x': '', 't': None, 'mine': True}
                c['s'] = link(idx, c['f'] + ' ' + c['b'], [FILES[i] for i in u.get('files', [])] or None)
                u['cards'].append(c)
                n += 1
    return n


def hash_text(s):
    import hashlib
    return int(hashlib.md5(s.encode('utf8')).hexdigest()[:8], 16)


def parse_ref_any(course, src):
    """Also accepts an exact deck name: 'Lecture12a.pdf p.5'."""
    if not src:
        return None
    for k in course_files(course):  # a full deck name with dots in it, as files_from_src
        name = SLIDES[k]['file'].lower()
        i = src.lower().find(name)
        if '.' in name[:-4] and i >= 0:
            m = re.match(r'\s*,?\s*pp?\.\s?(\d+)', src[i + len(name):])
            if m:
                return k, int(m.group(1))
    m = re.search(r'([\w\-\(\) ]+\.pdf)\s*,?\s*pp?\.\s?(\d+)', src)
    if m:
        name = m.group(1).strip().lower()
        for k in course_files(course):
            if SLIDES[k]['file'].lower() == name:
                return k, int(m.group(2))
    if course in LEC:
        r = parse_ref(course, src)
        if r:
            return r
    return None


def unit_order(u):
    lab = u['label']
    m = re.match(r'([A-Za-z]+)(\d+)', lab)
    if not m:
        return (9, 0, u['id'])
    kind = {'L': 0, 'R': 1, 'HW': 2}.get(m.group(1), 3)
    return (0, int(m.group(2)) + (0.5 if kind == 1 else 0), u['id'])


def main():
    from config import COURSES
    built = {'c57': build_c57(), '095': build_095(), '072': build_072()}
    for c in COURSES:  # courses without a published deck (HODL, A-Lab, FAA) get only their build/extra sets
        built.setdefault(c['id'], [])
    for c in built:
        built[c] += extra_units(c) + vault_practice_units(c)
        attach_note_questions(c, built[c])
        attach_more_note_questions(c, built[c])
        attach_note_flashcards(c, built[c])
    courses = []
    for c in COURSES:
        units = built.get(c['id'], [])
        if c['id'] != '072':
            units.sort(key=unit_order)
        courses.append({k: c[k] for k in ('id', 'code', 'name', 'short', 'tag')} | {'units': units})
    # hand-checked slide links for quiz items the text matcher placed with low confidence
    ov_path = os.path.join(HERE, 'link_overrides.json')
    if os.path.exists(ov_path):
        overrides = json.load(open(ov_path, encoding='utf8'))
        for c in courses:
            for u in c['units']:
                for q in u['quiz']:
                    key = '%s|%s|%s' % (c['id'], u['id'], q['q'][:80])
                    if key in overrides:
                        o = overrides[key]
                        fi = o and next((FILE_IDX[k] for k in FILES if SLIDES[k]['course'] == c['id'] and SLIDES[k]['file'] == o['file']), None)
                        if not o or fi is not None:  # an override for a deck this vault does not have is skipped
                            q['s'] = o and [fi, o['page']]
    files = [{'k': k, 'f': SLIDES[k]['file'], 'c': SLIDES[k]['course'], 'n': SLIDES[k]['n'], 'ar': SLIDES[k]['ar']} for k in FILES]
    os.makedirs(APP_DATA, exist_ok=True)
    # written beside the old files and swapped in, so a build that fails part way leaves the last good data in place
    with open(os.path.join(APP_DATA, 'courses.js.tmp'), 'w', encoding='utf8') as fh:
        fh.write('/* generated by build/build_courses.py */\nwindow.CARREL_FILES=')
        json.dump(files, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\nwindow.CARREL_COURSES=')
        json.dump(courses, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')
    with open(os.path.join(APP_DATA, 'slidetext.js.tmp'), 'w', encoding='utf8') as fh:
        fh.write('/* generated by build/build_courses.py */\nwindow.CARREL_SLIDETEXT=')
        json.dump([SLIDES[k]['pages'] for k in FILES], fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')
    for f in ('courses.js', 'slidetext.js'):
        os.replace(os.path.join(APP_DATA, f + '.tmp'), os.path.join(APP_DATA, f))
    for c in courses:
        n = lambda key: sum(len(u[key]) for u in c['units'])
        linked = sum(1 for u in c['units'] for q in u['quiz'] if q['s'])
        print(f"{c['code']}: {len(c['units'])} units, {n('cards')} cards, {n('quiz')} quiz ({linked} linked), {n('written')} written")


if __name__ == '__main__':
    main()
