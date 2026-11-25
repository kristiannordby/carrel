"""First start on a new computer: the vault's folders, the starting data, and the first full Canvas download.

The installer and the server both call ensure_vault() and ensure_app_data(); they never overwrite anything that exists.
The app's welcome screen starts the first sync once Canvas is connected:
    1. every file of every class on Canvas goes into the vault, sorted (slides -> Atlas/Resources/Lectures/<course>,
       syllabi -> Attachments/Syllabi, everything else -> Efforts/Courses/<course>);
    2. the lecture decks the shipped study sets are built on are read into build/slides_text.json, so each question
       links to its page in your own copy of the slides;
    3. the study sets and the planner data are rebuilt from this vault.
"""
import os, re, sys, json, time, shutil, threading, importlib, datetime as dt

from config import VAULT, COURSES, LECTURE_DIRS, ROOT

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, 'seed')
APP_DATA = os.path.join(ROOT, 'app', 'data')
STARTER = os.path.join(ROOT, 'starter-vault')
JOB = {'state': 'idle'}

FOLDERS = ['Atlas/Concepts', 'Attachments/Syllabi', 'Calendar/Daily', 'Efforts/Assignments', 'Efforts/Exams',
           'Efforts/Meetings', 'Efforts/Projects', 'Inbox', 'Archive', 'Templates']


def ensure_vault(vault=VAULT):
    """The vault's folder tree and starter notes (planner.md, Home.md, ...). Returns the files it created."""
    made = []
    for rel in FOLDERS + ['Atlas/Resources/Lectures/' + d for d in LECTURE_DIRS] + ['Efforts/Courses/' + c['efforts'] for c in COURSES]:
        os.makedirs(os.path.join(vault, *rel.split('/')), exist_ok=True)
    if os.path.isdir(STARTER):
        for root, _, files in os.walk(STARTER):
            for f in files:
                src = os.path.join(root, f)
                dest = os.path.join(vault, os.path.relpath(src, STARTER))
                if not os.path.exists(dest):
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.copyfile(src, dest)
                    made.append(os.path.relpath(dest, vault).replace(os.sep, '/'))
    return made


def ensure_app_data():
    """A fresh copy of the repo has no generated data yet: start from the shipped study sets."""
    os.makedirs(APP_DATA, exist_ok=True)
    seed = os.path.join(SEED, 'courses.js')
    if not os.path.exists(os.path.join(APP_DATA, 'courses.js')) and os.path.exists(seed):
        shutil.copyfile(seed, os.path.join(APP_DATA, 'courses.js'))
    if not os.path.exists(os.path.join(APP_DATA, 'vault.js')):
        with open(os.path.join(APP_DATA, 'vault.js'), 'w', encoding='utf8') as f:
            f.write('/* filled in by build/vault_sources.py; the local server refreshes this live */\nwindow.CARREL_VAULT=null;\n')


# -------------------------------------------------- the "done" flag, beside the Canvas token (outside the repo)
def _flag_path():
    import integrations
    return os.path.join(integrations.LOCAL, 'setup.json')


def flag():
    try:
        with open(_flag_path(), encoding='utf8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def set_flag(**kw):
    d = dict(flag(), **kw)
    os.makedirs(os.path.dirname(_flag_path()), exist_ok=True)
    with open(_flag_path(), 'w', encoding='utf8') as f:
        json.dump(d, f)
    return d


# -------------------------------------------------- which decks the shipped study sets use
def seed_decks():
    """Vault paths of the decks the shipped study sets link to, as they are named in this vault. A deck saved under
    a browser's duplicate name ('Lecture08 (1).pdf') matches the plain Canvas name and the other way round."""
    path = os.path.join(SEED, 'courses.js') if os.path.exists(os.path.join(SEED, 'courses.js')) else os.path.join(APP_DATA, 'courses.js')
    try:
        t = open(path, encoding='utf8').read()
        keys = [f['k'] for f in json.loads(t.split('window.CARREL_FILES=')[1].split(';\nwindow.CARREL_COURSES=')[0])]
    except (OSError, ValueError, IndexError):
        return []
    out = []
    for k in keys:
        cands = [k, re.sub(r' \(\d+\)(?=\.pdf$)', '', k, flags=re.I)]
        stem, ext = os.path.splitext(k)
        cands += ['%s (%d)%s' % (stem, n, ext) for n in (1, 2)]
        hit = next((c for c in cands if os.path.isfile(os.path.join(VAULT, *c.split('/')))), None)
        if hit and hit not in out:
            out.append(hit)
    return out


def rebuild(log=lambda s: None):
    """Read the seed decks' slide text, then rebuild the study sets and planner data from this vault."""
    import extract_slides, vault_sources
    decks = seed_decks()
    extract_slides.extract(decks, log=log)
    # build_courses reads slides_text.json when it is imported, so import it only now (and reload it if it was imported before)
    if 'build_courses' in sys.modules:
        importlib.reload(sys.modules['build_courses'])
    import build_courses
    build_courses.main()
    vault_sources.write_js()
    return len(decks)


# -------------------------------------------------- the first sync, as a background job the welcome screen watches
def status():
    out = {k: v for k, v in JOB.items()}
    out['done'] = flag().get('firstSync')
    return out


def start(integrations):
    if JOB.get('state') == 'running':
        return {'error': 'The first sync is already running.'}
    if not integrations.canvas_status()['connected']:
        return {'error': 'Connect Canvas first.'}
    JOB.clear()
    JOB.update(state='running', phase='Looking at your courses on Canvas…', done=0, total=0, current='', started=time.time())
    threading.Thread(target=_run, args=(integrations,), daemon=True).start()
    return status()


def _run(integrations):
    try:
        ensure_vault()
        listing = integrations.lecture_files(COURSES, LECTURE_DIRS, VAULT)
        if listing.get('error'):
            raise RuntimeError(listing['error'])
        files = [(c['course'], f) for c in listing.get('courses') or [] for f in c['files']]
        want = [f['id'] for _, f in files if f['status'] in ('new', 'updated')]
        JOB.update(courses=len(listing.get('courses') or []), found=len(files), already=len(files) - len(want))
        saved, failed = [], []
        if want:
            r = integrations.lecture_download(want, COURSES, LECTURE_DIRS, VAULT)
            if r.get('error'):
                raise RuntimeError(r['error'])
            while True:
                j = integrations._job
                JOB.update(phase='Downloading your class files…', done=j.get('done', 0), total=j.get('total', 0), current=j.get('current', ''))
                if j.get('state') != 'running':
                    break
                time.sleep(0.5)
            saved, failed = list(j.get('saved') or []), list(j.get('failed') or [])
        JOB.update(phase='Linking the study sets to your slides…', current='')
        n = rebuild(log=lambda s: JOB.update(current=s[:120]))
        where = {}
        for rel in saved:
            folder = rel.rsplit('/', 1)[0]
            where[folder] = where.get(folder, 0) + 1
        JOB.update(state='done', phase='Done', saved=len(saved), failed=failed[:20], folders=sorted(where.items()), decks=n, current='')
        set_flag(firstSync=dt.datetime.now().isoformat(timespec='minutes'))
    except Exception as e:
        JOB.update(state='failed', error=str(e), phase='Stopped')
