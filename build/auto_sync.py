"""The mechanical half of the nightly class sync (the scheduled task does the reading and writing).

    python build/auto_sync.py sync
        Starts Carrel if it is not running, syncs Canvas, saves every new or changed Canvas file into the vault
        (slides -> Atlas/Resources/Lectures/<course>, syllabi -> Attachments/Syllabi, the rest -> Efforts/Courses/<course>),
        and prints a JSON report: files saved, Canvas deadlines next to the planner's, and lecture decks that need a
        study set (each deck's slide text is written to a .txt file next to the report).

    python build/auto_sync.py publish build/extra/hodl-l2.json [...]
        Adds those sets' decks to the slide index and rebuilds Carrel's course data; the open app reloads into it.

Standard library only. Talks to Carrel's local server at 127.0.0.1:8765.
"""
import os, sys, json, time, subprocess, urllib.request, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = 'http://127.0.0.1:8765'
OUT = os.path.join(os.environ.get('LOCALAPPDATA') or ROOT, 'Carrel', 'auto_sync')
RECENT_DAYS = 7    # older decks without a set (the October backlog) stay under "New in the vault" to build by hand
MAX_SETS = 3       # study sets per run, newest decks first

sys.path.insert(0, HERE)
from config import VAULT, COURSES  # noqa: E402


def api(path, body=None, timeout=180):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='GET' if body is None else 'POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'null')


def ensure_carrel():
    try:
        api('/api/version', timeout=3)
        return 'running'
    except Exception:
        pass
    for attempt in range(2):
        # a launch can hang without a window; the second try kills it first
        if attempt:
            subprocess.run(['taskkill', '/IM', 'Carrel.exe', '/F'], capture_output=True)
            time.sleep(2)
        subprocess.Popen([os.path.join(ROOT, 'Carrel.exe')], cwd=ROOT, creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0))
        for _ in range(45):
            time.sleep(1)
            try:
                api('/api/version', timeout=2)
                return 'started'
            except Exception:
                pass
    raise SystemExit('Carrel did not start: nothing synced.')


def sync():
    os.makedirs(OUT, exist_ok=True)
    report = {'carrel': ensure_carrel(), 'ran': dt.datetime.now().isoformat(timespec='minutes')}
    cv = api('/api/canvas?refresh=1')
    if not cv.get('connected'):
        report['canvas_error'] = 'Canvas is not connected in Carrel (Settings).'
    elif cv.get('error'):
        report['canvas_error'] = cv['error']
    # every new or changed file, lectures and the rest
    lec = api('/api/lectures', timeout=600)
    if lec.get('error'):
        report['files_error'] = lec['error']
    want = [(c['course'], f) for c in lec.get('courses') or [] for f in c['files'] if f['status'] in ('new', 'updated')]
    report['saved'], report['failed'] = [], []
    if '--dry' in sys.argv:  # list what would be saved, save nothing
        report['would_save'] = [{'course': cid, 'name': f['name'], 'to': f['dest'], 'status': f['status']} for cid, f in want]
        want = []
    if want:
        r = api('/api/lectures/download', {'ids': [f['id'] for _, f in want]})
        if r.get('error'):
            report['files_error'] = r['error']
        else:
            while True:
                time.sleep(2)
                job = api('/api/lectures/job')
                if job.get('state') != 'running':
                    break
            by_dir = {'Atlas/Resources/Lectures/' + c['lectures']: (c['id'], 'lecture') for c in COURSES}
            by_dir.update({'Efforts/Courses/' + c['efforts']: (c['id'], 'other') for c in COURSES})
            for rel in job.get('saved') or []:
                cid, k = by_dir.get(rel.rsplit('/', 1)[0], (None, 'syllabus'))
                if k == 'syllabus':  # Attachments/Syllabi is shared: the course is the one the file came from
                    cid = next((c for c, f in want if os.path.splitext(os.path.basename(rel))[0].startswith(os.path.splitext(f['name'])[0])), None)
                report['saved'].append({'path': rel, 'course': cid, 'kind': k})
            report['failed'] = job.get('failed') or []
    # Canvas deadlines beside the planner's, for the next 60 days
    vault = api('/api/vault')
    today = dt.date.today().isoformat()
    soon = (dt.date.today() + dt.timedelta(days=60)).isoformat()
    planner = vault.get('planner', {}).get('deadlines', [])
    report['deadlines'] = {}
    for c in COURSES:
        items = [{'date': i['date'], 'time': i['time'], 'title': i['title'], 'kind': i['kind'], 'points': i.get('points'), 'url': i['url']}
                 for i in cv.get('items') or [] if i['course'] == c['id'] and i['kind'] != 'event' and today <= i['date'] <= soon]
        if items:
            report['deadlines'][c['id']] = {'canvas': items, 'planner': [{'date': d['date'], 'title': d['title']} for d in planner
                                                                          if d['course'] == c['id'] and d['date'] >= today]}
    # lecture decks that need a study set
    have = set()
    try:
        with open(os.path.join(ROOT, 'userdata', 'state.json'), encoding='utf8') as f:
            have = {g['file']['k'] for g in json.load(f).get('genunits') or []}  # sets built in the app
    except (OSError, ValueError, KeyError, TypeError):
        pass
    saved_now = {s['path'] for s in report['saved']}
    cutoff = (dt.date.today() - dt.timedelta(days=RECENT_DAYS)).isoformat()
    decks = [d for d in api('/api/newdecks') if d['path'] not in have and (d['path'] in saved_now or d['modified'] >= cutoff)]
    decks.sort(key=lambda d: d['modified'], reverse=True)
    report['study_sets_needed'], report['study_sets_later'] = [], [d['path'] for d in decks[MAX_SETS:]]
    units = {}
    try:
        txt = open(os.path.join(ROOT, 'app', 'data', 'courses.js'), encoding='utf8').read()
        for c in json.loads(txt.split('window.CARREL_COURSES=')[1].rstrip().rstrip(';')):
            units[c['id']] = [u['id'] for u in c['units']]
    except Exception:
        pass
    for d in decks[:MAX_SETS]:
        t = api('/api/pdftext?path=' + urllib.request.quote(d['path']))
        pages = t.get('pages') or []
        text = '\n\n'.join('[p.%d]\n%s' % (i + 1, p[:1800]) for i, p in enumerate(pages) if p and len(p) > 30)
        if len(text) < 400:
            report.setdefault('skipped', []).append({'path': d['path'], 'why': 'almost no extractable text (scanned slides?)'})
            continue
        slide = os.path.join(OUT, '%s-%s.txt' % (d['course'], os.path.splitext(d['file'])[0].replace(' ', '_')))
        with open(slide, 'w', encoding='utf8') as f:
            f.write(text)
        report['study_sets_needed'].append({'course': d['course'], 'path': d['path'], 'file': d['file'], 'pages': len(pages),
                                            'slide_text': slide, 'unit_ids_taken': units.get(d['course'], [])})
    path = os.path.join(OUT, 'report.json')
    with open(path, 'w', encoding='utf8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print('\nreport written to', path)


def publish(paths):
    decks = []
    for p in paths:
        u = json.load(open(p, encoding='utf8'))
        for k in ('id', 'label', 'title', 'short', 'src', 'topics', 'cards', 'quiz', 'written'):
            if k not in u:
                raise SystemExit('%s: missing "%s"' % (p, k))
        course = os.path.basename(p).split('-')[0]
        folder = next(c['lectures'] for c in COURSES if c['id'] == course)
        rel = 'Atlas/Resources/Lectures/%s/%s' % (folder, u['src'])
        if not os.path.exists(os.path.join(VAULT, *rel.split('/'))):
            raise SystemExit('%s: src "%s" is not a file in %s' % (p, u['src'], folder))
        decks.append(rel)
    subprocess.run([sys.executable, os.path.join(HERE, 'extract_slides.py')] + decks, cwd=HERE, check=True)
    subprocess.run([sys.executable, os.path.join(HERE, 'build_courses.py')], cwd=HERE, check=True)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'sync':
        sync()
    elif len(sys.argv) > 2 and sys.argv[1] == 'publish':
        publish(sys.argv[2:])
    else:
        print(__doc__)
