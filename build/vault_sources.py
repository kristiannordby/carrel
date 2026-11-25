"""Read deadlines, the class schedule and the A-Lab work plan straight out of the Obsidian vault.

Standard library only, so the local server can re-run it on every refresh.
    planner.md                         -> deadlines, weekly schedule, one-off sessions, grade weights
    Efforts/Courses/Analytics Lab/*.pptx -> milestones and this week's team goals (newest deck wins)
"""
import os, re, io, json, zipfile, hashlib, datetime as dt, html

try:
    from config import VAULT, COURSES, COURSE_BY_PLANNER, OVERRIDES, FIRST_NAME, ALAB_TEAM
except ImportError:  # imported from the server
    from build.config import VAULT, COURSES, COURSE_BY_PLANNER, OVERRIDES, FIRST_NAME, ALAB_TEAM

ME = FIRST_NAME  # your section of the A-Lab weekly-goals slide is headed by your first name
TERM_START, TERM_END = '2026-09-08', '2026-12-10'
NO_CLASS = ['2026-11-11', '2026-11-26', '2026-11-27']  # Veterans Day, Thanksgiving
HALF_TERM_END = {'072': '2026-10-21'}     # AAE is H1, ends with the in-class exam
HALF_TERM_START = {'hodl': '2026-11-02'}  # HODL is H2, Lecture 1 on Mon 11/2
DAYS = {'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6}


def read_shared(path):
    """Read a file even while PowerPoint or Word holds it open."""
    try:
        with open(path, 'rb') as f:
            return f.read()
    except PermissionError:
        import ctypes, msvcrt
        from ctypes import wintypes
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateFileW.restype = wintypes.HANDLE
        h = k.CreateFileW(path, 0x80000000, 7, None, 3, 0x80, None)
        if h == wintypes.HANDLE(-1).value:
            raise
        fd = msvcrt.open_osfhandle(h, os.O_RDONLY | os.O_BINARY)
        with os.fdopen(fd, 'rb') as f:
            return f.read()


def clean(s):
    s = s.replace('**', '').replace('`', '').strip()
    s = re.sub(r'\s+[—–]\s+', ': ', s)  # "HW1 — Linear optimization" -> "HW1: Linear optimization"
    return s.replace('—', ', ').replace('–', '-')


def table_rows(md, heading):
    """Rows (list of cells) of the first markdown table under a heading that starts with `heading`."""
    m = re.search(r'^#+\s*' + re.escape(heading) + r'.*$', md, re.M)
    if not m:
        return []
    rows, started = [], False
    for line in md[m.end():].splitlines():
        if line.startswith('#'):
            break
        if line.strip().startswith('|'):
            started = True
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if all(re.fullmatch(r':?-{2,}:?', c) for c in cells if c):
                continue
            rows.append(cells)
        elif started and line.strip() and not line.strip().startswith('|'):
            if rows:
                break
    return rows[1:] if rows else []


def to24(h, m, ap):
    h = int(h)
    m = int(m or 0)
    if ap == 'pm' and h != 12:
        h += 12
    if ap == 'am' and h == 12:
        h = 0
    return f'{h:02d}:{m:02d}'


def parse_range(s):
    """'8:30–10:00am' / '4:00–5:30pm' / '11:00am–12:00pm' -> ('08:30', '10:00')"""
    m = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)', s, re.I)
    if not m:
        return None, None
    ap2 = m.group(6).lower()
    ap1 = (m.group(3) or '').lower()
    if not ap1:
        # "8:30–10:00am": both morning; "4:00–5:30pm": both afternoon; "11:30–1:00pm": crosses noon
        ap1 = ap2
        if ap2 == 'pm' and int(m.group(1)) > int(m.group(4)) and int(m.group(1)) != 12:
            ap1 = 'am'
    return to24(m.group(1), m.group(2), ap1), to24(m.group(4), m.group(5), ap2)


def first_time(s):
    m = re.search(r'\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', s, re.I)
    return to24(m.group(1), m.group(2), m.group(3).lower()) if m else None


def kind_of(title):
    t = title.lower()
    if re.search(r'midterm|exam\b|in-class exam', t):
        return 'exam'
    if 'presentation' in t or 'pitch day' in t:
        return 'present'
    return 'due'


def parse_planner():
    path = os.path.join(VAULT, 'planner.md')
    md = read_shared(path).decode('utf8')
    out = {'deadlines': [], 'schedule': [], 'sessions': [], 'weights': {}, 'source': 'planner.md', 'noClass': NO_CLASS,
           'modified': dt.datetime.fromtimestamp(os.path.getmtime(path)).isoformat(timespec='minutes')}
    for cells in table_rows(md, 'Dueouts'):
        if len(cells) < 5:
            continue
        date = cells[0][:10]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            continue
        course = COURSE_BY_PLANNER.get(cells[2])
        title = clean(cells[1])
        notes = clean(cells[4])
        item = {'id': f'pl-{date}-{re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]}', 'date': date,
                'time': first_time(cells[4]), 'title': title, 'course': course, 'priority': cells[3],
                'major': cells[1].startswith('**'), 'notes': notes, 'kind': kind_of(title), 'src': 'planner'}
        for o in OVERRIDES:
            if o['course'] == course and re.search(r'\b' + re.escape(o['match']) + r'\b', title):
                item['moved'] = {'from': date, 'note': o['note']}
                item['date'] = o['date']
                item['id'] = item['id'].replace(date, o['date'])
        out['deadlines'].append(item)
    out['deadlines'].sort(key=lambda d: (d['date'], d['time'] or '99'))

    for cells in table_rows(md, 'Weekly class schedule'):
        if len(cells) < 4:
            continue
        name = re.sub(r'\s*\(.*?\)', '', cells[0]).strip()
        course = COURSE_BY_PLANNER.get(name)
        days = [DAYS[d] for d in re.findall(r'Mon|Tue|Wed|Thu|Fri', cells[2])]
        start, end = parse_range(cells[2])
        if course and days and start:
            out['schedule'].append({'course': course, 'what': clean(re.sub(r'\s*\(.*?\)', '', cells[1])), 'days': days,
                                    'start': start, 'end': end, 'loc': cells[3], 'from': HALF_TERM_START.get(course, TERM_START),
                                    'until': HALF_TERM_END.get(course, TERM_END)})

    # one-off sessions: the tables under "Non-recurring class sessions", each preceded by a bold course line
    m = re.search(r'^## Non-recurring class sessions.*?(?=^## )', md, re.M | re.S)
    if m:
        course = None
        for line in m.group(0).splitlines():
            b = re.match(r'\*\*(.+?)\*\*', line.strip())
            if b:
                course = COURSE_BY_PLANNER.get(b.group(1).strip())
                continue
            if line.startswith('|') and re.match(r'\|\s*\d{4}-\d{2}-\d{2}', line):
                c = [x.strip() for x in line.strip().strip('|').split('|')]
                s, e = parse_range(c[2]) if len(c) > 2 else (None, None)
                out['sessions'].append({'date': c[0][:10], 'course': course, 'title': clean(c[1]), 'start': s, 'end': e,
                                        'loc': c[3] if len(c) > 3 else ''})

    for hm in re.finditer(r'^## Grade weights\s*[—\-]\s*(.+?)\s*\(', md, re.M):
        course = COURSE_BY_PLANNER.get(hm.group(1).strip())
        rows = table_rows(md, hm.group(0).lstrip('# ').strip())
        if course:
            out['weights'][course] = [[clean(r[0]), r[1]] for r in rows if len(r) >= 2]
    return out


# ---------------------------------------------------------------- A-Lab decks
def pptx_slides(path):
    """Paragraph text per slide, in slide order, from the raw OOXML (no python-pptx needed)."""
    z = zipfile.ZipFile(io.BytesIO(read_shared(path)))
    names = sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)),
                   key=lambda n: int(re.search(r'(\d+)', n.rsplit('/', 1)[1]).group(1)))
    slides = []
    for n in names:
        xml = z.read(n).decode('utf8', 'ignore')
        paras = []
        for p in re.findall(r'<a:p>(.*?)</a:p>|<a:p [^>]*>(.*?)</a:p>', xml, re.S):
            body = p[0] or p[1]
            t = ''.join(re.findall(r'<a:t>(.*?)</a:t>', body, re.S))
            t = html.unescape(t).strip()
            if t:
                paras.append(t)
        slides.append(paras)
    return slides


MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def deck_date(fname, mtime):
    m = re.search(r'(20\d{2})[-_](\d{2})[-_](\d{2})', fname)
    if m:
        return '-'.join(m.groups())
    return dt.date.fromtimestamp(mtime).isoformat()


def md_to_iso(s, year=2026):
    s = s.strip()
    m = re.fullmatch(r'([A-Za-z]{3})\w*\s+(\d{1,2})', s)
    if m and m.group(1).lower() in MONTHS:
        return f'{year}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}'
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})', s)
    if m:
        return f'{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
    return None


def docx_paragraphs(path):
    z = zipfile.ZipFile(io.BytesIO(read_shared(path)))
    xml = z.read('word/document.xml').decode('utf8', 'ignore')
    paras = [html.unescape(''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', p))) for p in re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)]
    return [p.strip() for p in paras if p.strip()]


A_LAB_KINDS = {'.pptx': 'deck', '.docx': 'document', '.pdf': 'PDF', '.xlsx': 'spreadsheet', '.csv': 'data', '.md': 'note', '.sql': 'SQL', '.py': 'script'}


def parse_alab():
    folder = os.path.join(VAULT, 'Efforts', 'Courses', 'Analytics Lab')
    if not os.path.isdir(folder):
        return {}
    decks = []
    for f in os.listdir(folder):
        if f.lower().endswith('.pptx') and not f.startswith('~$'):
            p = os.path.join(folder, f)
            decks.append({'file': f, 'path': p, 'date': deck_date(f, os.path.getmtime(p))})
    decks.sort(key=lambda d: d['date'], reverse=True)
    out = {'decks': [{'file': d['file'], 'date': d['date']} for d in decks], 'milestones': [], 'mine': [], 'group': [],
           'team': {}, 'weekly': [], 'questions': [], 'week': None, 'source': None}
    seen_ms = set()
    for d in decks:  # newest first: the newest deck's plan wins, older decks only fill gaps
        try:
            slides = pptx_slides(d['path'])
        except Exception as e:
            out.setdefault('errors', []).append(f"{d['file']}: {e}")
            continue
        for paras in slides:
            # "Upcoming milestones" / timeline: a date line followed by its description
            for i, t in enumerate(paras[:-1]):
                iso = md_to_iso(t)
                if iso and iso >= d['date'] and len(paras[i + 1]) > 6 and not md_to_iso(paras[i + 1]):
                    key = iso
                    if key in seen_ms:
                        continue
                    seen_ms.add(key)
                    out['milestones'].append({'date': iso, 'title': clean(paras[i + 1]), 'from': d['file']})
            # "Weekly Goals 10/29 – 11/05" with per-person sections
            head = paras[0] if paras else ''
            wm = re.match(r'Weekly Goals\s+(\d{1,2}/\d{1,2})\s*[–\-]\s*(\d{1,2}/\d{1,2})', head)
            if wm and not out['week']:
                out['week'] = [md_to_iso(wm.group(1)), md_to_iso(wm.group(2))]
                out['source'] = d['file']
                who, names = None, {'GROUP', ME, *ALAB_TEAM} - {''}
                for t in paras[1:]:
                    # a person's section starts with their name: one listed in carrel.config.json ("alabTeam"), or, when
                    # none are listed, a lone capitalised word
                    if t in names or t.upper() == 'GROUP' or (not ALAB_TEAM and re.fullmatch(r'[A-Z][a-z]{1,15}', t)):
                        who = 'group' if t.upper() == 'GROUP' else t
                        continue
                    if t.upper() == 'WEEKLY TASKS':
                        who = 'weekly'
                        continue
                    if not who or t.endswith(':') and len(t) < 30:
                        continue
                    if who == 'group':
                        out['group'].append(clean(t))
                    elif who == 'weekly':
                        # a "Train the following models:" line owns the short model names under it
                        last = out['weekly'][-1] if out['weekly'] else ''
                        if last.startswith('Train') and len(t) < 40 and not t.startswith('Train'):
                            head_, _, items = last.partition(': ')
                            out['weekly'][-1] = head_.rstrip(':') + ': ' + (items + ', ' if items else '') + clean(t)
                        else:
                            out['weekly'].append(clean(t).rstrip(':'))
                    elif who == ME:
                        out['mine'].append(clean(t))
                    else:
                        out['team'].setdefault(who, []).append(clean(t))
            # sponsor Q&A from the meeting-notes slide
            if head.startswith('Weekly Update Meeting Notes') and not out['questions']:
                q = None
                for t in paras[1:]:
                    if re.match(r'(Q\d+:|\d\.)', t):
                        q = re.sub(r'^(Q\d+:|\d\.)\s*', '', t)
                    elif t.startswith('Response:') and q:
                        out['questions'].append({'q': q, 'a': t[len('Response:'):].strip()})
                        q = None
    out['milestones'].sort(key=lambda m: m['date'])
    # everything in the folder, newest first, and the text of dated meeting notes for Claude
    files = []
    for f in os.listdir(folder):
        p = os.path.join(folder, f)
        ext = os.path.splitext(f)[1].lower()
        if os.path.isfile(p) and ext in A_LAB_KINDS and not f.startswith('~$'):
            files.append({'file': f, 'kind': A_LAB_KINDS[ext], 'date': deck_date(f, os.path.getmtime(p))})
    files.sort(key=lambda x: x['date'], reverse=True)
    out['files'] = files[:30]
    notes = []
    for x in files:
        if x['kind'] == 'document' and re.search(r'notes|meeting', x['file'], re.I):
            try:
                notes.append({'file': x['file'], 'date': x['date'], 'text': '\n'.join(docx_paragraphs(os.path.join(folder, x['file'])))[:2500]})
            except Exception:
                pass
    out['notes'] = notes[:4]
    return out


FOLLOW_SKIP = ('planner.md', 'Templates', 'Calendar', '.obsidian', '.claudian', 'Archive', 'Claude outputs')
TAG_COURSE = {'#OM': 'c57', '#MLOps': '095', '#AAE': '072', '#ALab': 'alab', '#FAA': 'faa', '#HODL': 'hodl'}
LECT_COURSE = {'Optimization Methods': 'c57', 'ML Opt': '095', 'ML Ops': '095', 'Advanced Analytics Edge': '072', 'Analytics Lab': 'alab', 'From Analytics to Action': 'faa', 'HODL': 'hodl'}


NAME_COURSE = {'ML Ops': '095', 'Optimization Methods': 'c57', 'AAE': '072', 'Advanced Analytics Edge': '072', 'A-Lab': 'alab', 'Analytics Lab': 'alab', 'HODL': 'hodl'}


def parse_review_lists():
    """Each '## ' section of a '... Concepts to Review' note: something you flagged to re-derive before the exam."""
    out = []
    folder = os.path.join(VAULT, 'Efforts', 'Exams')
    if not os.path.isdir(folder):
        return out
    for f in sorted(os.listdir(folder)):
        if not (f.endswith('.md') and re.search(r'concepts? to review', f, re.I)):
            continue
        text = read_shared(os.path.join(folder, f)).decode('utf8', 'ignore')
        course = next((c for t, c in TAG_COURSE.items() if t in text), None) or next((c for k, c in NAME_COURSE.items() if f.startswith(k)), 'me')
        for sec in re.split(r'\n(?=## )', text)[1:]:
            head, _, body = sec.partition('\n')
            title = re.sub(r'^##\s*', '', head)
            title = re.sub(r'^[^\w$]*', '', title)              # drop a leading warning sign
            title = re.sub(r'^\d+[.)]\s*', '', title).strip()   # and the section number
            title = re.sub(r'\s*[\u2014\u2013-]+\s*lower priority$', '', title, flags=re.I)
            if not title:
                continue
            out.append({'id': 'rv-' + hashlib.md5((f + title).encode('utf8')).hexdigest()[:10], 'title': 'Re-derive: ' + clean(title),
                        'course': course, 'due': None, 'src': 'Efforts/Exams/' + f, 'kind': 'review', 'flagged': '\u26a0' in head,
                        'detail': body.strip()[:3500]})
    return out


NOTE_DIRS = (('Efforts', 'Exams'), ('Atlas', 'Concepts'))
NOTE_KINDS = (('cheat sheet', 'Cheat sheet'), ('flashcards', 'Flashcards'), ('concepts to review', 'To review'), ('practice', 'Practice'),
              ('quiz', 'Quiz'), ('index', 'Index'), ('review', 'Review'), ('notes', 'Notes'))
NOTE_COURSE = dict(NAME_COURSE, **{'Optimization': 'c57', 'Linear Optimization': 'c57', 'Convex Optimization': 'c57', 'ML OPT': '095'})
# a concept note with no course tag: the textbook or method it is about
NOTE_TEXT_COURSE = ((r'Modern Optimization Lens|robust regression|sparse regression', '095'),
                    (r'Introduction to Linear Optimization|Convex optimization\.pdf|simplex|BFS|linear program', 'c57'))


def note_labels(text):
    """Lecture and recitation labels a title or covers line names: 'Lec 1-7', 'L12-L13, Rec 6', 'Recitations 3-4'."""
    out = []
    for m in re.finditer(r'\b(Lec(?:ture)?s?\.?|L|Rec(?:itations?)?\.?|R)\s?(\d{1,2})([a-z]?)(?:\s?[-–]\s?(Lec\s?|L|Rec\s?|R)?(\d{1,2}))?\b', text):
        p = 'R' if m.group(1).startswith('R') else 'L'
        a = int(m.group(2))
        end = int(m.group(5)) if m.group(5) else None
        q = ('R' if m.group(4).startswith('R') else 'L') if m.group(4) else p
        if m.group(3):                      # 'L12a', also as the start of 'L12a-L13'
            out.append(p + str(a) + m.group(3))
        if end and q != p:                  # 'Rec 6-Lec 7' names two things, not a range
            out += [p + str(a), q + str(end)]
            continue
        b = end if end and end > a else a
        out += [p + str(n) for n in range(a, min(b, a + 15) + 1)]
    return list(dict.fromkeys(out))


def parse_notes():
    """Your study notes (Efforts/Exams and Atlas/Concepts): which course and lectures each covers, and which slides it cites.
    Only the index is built here; the server sends a note's text when you open it."""
    out = []
    lect, root = {}, os.path.join(VAULT, 'Atlas', 'Resources', 'Lectures')
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.lower().endswith('.pdf'):
                lect.setdefault(f, []).append(os.path.relpath(os.path.join(d, f), VAULT).replace(os.sep, '/'))
    every = {r for rs in lect.values() for r in rs}
    folder_of = {c: k for k, c in LECT_COURSE.items()}

    def pdf_links(s, course):
        """'[[Atlas/Resources/Lectures/ML Opt/Lec03_2026.pdf|Lec 3]]' exactly; a bare '[[Recitation4.pdf]]' (two courses
        have one) from the note's own course folder first."""
        out = []
        for m in re.findall(r'\[\[([^\]|#]+?\.pdf)', s):
            if m in every:
                out.append(m)
            elif os.path.basename(m) in lect:
                rs = lect[os.path.basename(m)]
                mine = [r for r in rs if '/Lectures/' + folder_of.get(course, '?') + '/' in r]
                out.append((mine or rs)[0])
        return out
    for parts in NOTE_DIRS:
        folder = os.path.join(VAULT, *parts)
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder)):
            if not f.endswith('.md'):
                continue
            full = os.path.join(folder, f)
            try:
                text = read_shared(full).decode('utf8', 'ignore')
            except OSError:
                continue
            name = f[:-3]
            front = text[3:text.find('\n---', 3)] if text.startswith('---') else ''
            covers = re.search(r'^covers:\s*(.+)$', front, re.M)
            course = (next((c for k, c in sorted(NOTE_COURSE.items(), key=lambda x: -len(x[0])) if name.startswith(k)), None)
                      or next((c for t, c in TAG_COURSE.items() if re.search(re.escape(t) + r'\b', text[:600])), None)
                      or next((c for k, c in LECT_COURSE.items() if '/Lectures/' + k + '/' in text), None)
                      or next((c for rx, c in NOTE_TEXT_COURSE if re.search(rx, text[:3000], re.I)), None))
            title = re.sub(r'^(ML Ops|ML OPT|Optimization Methods|AAE|A-Lab|HODL)\s*[-–—]\s*', '', name)
            # Midterm practice breakdowns go with the practice-exam set
            labels = note_labels(name + (' ; ' + covers.group(1) if covers else ''))
            if re.search(r'midterm 1 practice', name, re.I):
                labels.append('PE')
            pdfs = list(dict.fromkeys(pdf_links(text, course)))
            src = re.search(r'^Sources?:(.*)$', text, re.M)
            src_pdfs = pdf_links(src.group(1), course) if src else []
            kind = next((k for key, k in NOTE_KINDS if key in name.lower()), 'Concept' if parts[0] == 'Atlas' else 'Notes')
            out.append({'path': '/'.join(parts) + '/' + f, 'title': title, 'course': course, 'labels': labels, 'pdfs': pdfs,
                        'primary': src_pdfs[0] if len(set(src_pdfs)) == 1 else None, 'kind': kind,
                        # page refs open slides only where the note says they are PDF pages (not printed slide numbers)
                        'pages': bool(re.search(r'"p\. ?n" ?= ?PDF page|Slide refs ?= ?PDF page', text, re.I)),
                        'mtime': dt.datetime.fromtimestamp(os.path.getmtime(full)).date().isoformat(), 'size': len(text)})
    return out


def note_paths():
    """The notes the index covers, by vault-relative path: a directory listing, without reading any file."""
    out = []
    for parts in NOTE_DIRS:
        folder = os.path.join(VAULT, *parts)
        if os.path.isdir(folder):
            out += ['/'.join(parts) + '/' + f for f in sorted(os.listdir(folder)) if f.endswith('.md')]
    return out


def read_notes():
    """Every note's text, for searching them all from the palette."""
    out = {}
    for rel in note_paths():
        try:
            out[rel] = read_shared(os.path.join(VAULT, *rel.split('/'))).decode('utf8', 'ignore')
        except OSError:
            pass
    return out


def read_note(rel):
    """One note's text, for the side panel. Only the notes the index covers can be read."""
    if rel not in note_paths():
        return None
    return read_shared(os.path.join(VAULT, *rel.split('/'))).decode('utf8', 'ignore')


def parse_followups():
    """Open checkboxes you wrote in the vault: study topics to revisit (memory/*.md) and dated Tasks-plugin items."""
    out, today = [], dt.date.today().isoformat()
    for root, dirs, files in os.walk(VAULT):
        dirs[:] = [d for d in dirs if d not in FOLLOW_SKIP and not d.startswith('.')]
        for f in files:
            if not f.endswith('.md') or f in FOLLOW_SKIP:
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, VAULT).replace(os.sep, '/')
            in_memory = '/memory/' in '/' + rel
            try:
                text = read_shared(path).decode('utf8', 'ignore')
            except OSError:
                continue
            for ln, line in enumerate(text.splitlines()):
                m = re.match(r'\s*- \[ \] (.+)', line)
                if not m:
                    continue
                body = m.group(1)
                due = re.search(r'📅\s*(\d{4}-\d{2}-\d{2})', body)
                if not in_memory and not due:
                    continue
                if due and due.group(1) < today:
                    continue  # stale dated items are noise; the planner owns graded deadlines
                course = next((c for t, c in TAG_COURSE.items() if t in body), None)
                if not course:
                    course = next((c for k, c in LECT_COURSE.items() if '/' + k + '/' in '/' + rel + '/'), 'me')
                title = re.sub(r'\s*(📅|⏫|🔼|🔽)\s*\S*', '', body)
                title = re.sub(r'\s#\w+', '', title)
                title = re.sub(r'\s*\(requested [^)]*\)', '', title)
                title = clean(title.split(':')[0] if in_memory and ':' in title[:120] else title)[:140]
                out.append({'id': 'vf-' + hashlib.md5((rel + body).encode('utf8')).hexdigest()[:10], 'title': title, 'course': course,
                            'due': due.group(1) if due else None, 'src': rel, 'detail': clean(body)[:600]})
    return out


def build():
    return {'built': dt.datetime.now().isoformat(timespec='minutes'), 'vaultPath': VAULT, 'planner': parse_planner(), 'alab': parse_alab(), 'followups': parse_followups() + parse_review_lists(), 'notes': parse_notes(),
            'courses': [{k: c[k] for k in ('id', 'code', 'name', 'short', 'tag')} for c in COURSES]}


def write_js():
    """app/data/vault.js, the copy the app starts from before the server's live /api/vault answers."""
    data = build()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'data', 'vault.js')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'w', encoding='utf8') as fh:
        fh.write('/* generated by build/vault_sources.py; the local server refreshes this live */\nwindow.CARREL_VAULT=')
        json.dump(data, fh, ensure_ascii=False, indent=0)
        fh.write(';\n')
    os.replace(path + '.tmp', path)
    return data


if __name__ == '__main__':
    data = write_js()
    p = data['planner']
    print(len(p['deadlines']), 'deadlines;', len(p['schedule']), 'weekly slots;', len(p['sessions']), 'sessions;', list(p['weights']))
    print(json.dumps(data['alab'], indent=1, ensure_ascii=False)[:3000])
    print([d for d in p['deadlines'] if d.get('moved')])
    print(p['schedule'])
