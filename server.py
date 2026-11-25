"""Carrel local server. Standard library only.

    python server.py            -> http://127.0.0.1:8765

Serves app/, streams lecture PDFs read-only from the Obsidian vault, re-reads planner.md and the A-Lab decks
on request, keeps your progress in userdata/state.json, and relays chat to Claude Code (`claude -p`) so no
API key is needed. Binds to localhost only.
"""
import os, io, re, sys, json, shutil, threading, subprocess, mimetypes, time, webbrowser, email.utils, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
USERDATA = os.path.join(ROOT, 'userdata')
STATE = os.path.join(USERDATA, 'state.json')
sys.path.insert(0, os.path.join(ROOT, 'build'))
import vault_sources  # noqa: E402
from config import VAULT, COURSES, LECTURE_DIRS, NAME  # noqa: E402
sys.path.insert(0, ROOT)
import integrations  # noqa: E402
import first_run  # noqa: E402

first_run.ensure_app_data()  # a fresh copy of the repo starts from the shipped study sets

PORT = int(os.environ.get('CARREL_PORT', '8765'))
ALLOW_HOSTS = {h.strip().lower() for h in os.environ.get('CARREL_ALLOW_HOSTS', '').split(',') if h.strip()}
mimetypes.add_type('application/manifest+json', '.webmanifest')
CLAUDE = shutil.which('claude') or shutil.which('claude.exe') or next(
    (p for p in (os.path.expanduser(r'~\.local\bin\claude.exe'), os.path.expanduser('~/.local/bin/claude')) if os.path.exists(p)), None)
if CLAUDE and not os.path.exists(CLAUDE):
    CLAUDE = None
VAULT_TYPES = {'.pdf', '.png', '.jpg', '.jpeg'}
MODELS = {'sonnet', 'opus', 'haiku'}
# the app's tutor prompt, read from app/js/claude.js so the warm spare matches what the browser sends
try:
    import re as _re
    _src = open(os.path.join(APP, 'js', 'claude.js'), encoding='utf8').read()
    _block = _src[_src.index('const SYSTEM = ['):_src.index("].join(")]
    WARM_SYSTEM = '\n'.join(s.replace("\\'", "'") for s in _re.findall(r"""^\s*['"](.+?)['"],\s*$""", _block, _re.M))
except (OSError, ValueError):
    WARM_SYSTEM = ''
_state_lock = threading.Lock()


def load_state():
    try:
        with open(STATE, encoding='utf8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def save_state(patch):
    with _state_lock:
        s = load_state()
        s.update(patch)
        os.makedirs(USERDATA, exist_ok=True)
        tmp = STATE + '.tmp'
        with open(tmp, 'w', encoding='utf8') as f:
            json.dump(s, f, ensure_ascii=False)
        # Windows refuses to replace a file another reader has open; a few short retries cover it
        for attempt in range(8):
            try:
                os.replace(tmp, STATE)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(0.05)
        # a dated copy once a day, so a bad write never costs more than a day
        snap = os.path.join(USERDATA, 'backups', time.strftime('%Y-%m-%d') + '.json')
        if not os.path.exists(snap):
            os.makedirs(os.path.dirname(snap), exist_ok=True)
            shutil.copyfile(STATE, snap)
            olds = sorted(f for f in os.listdir(os.path.dirname(snap)) if f.endswith('.json'))
            for f in olds[:-30]:  # keep a month of daily copies
                try:
                    os.remove(os.path.join(os.path.dirname(snap), f))
                except OSError:
                    pass


KNOWN_DECKS = None


def new_decks():
    """Lecture PDFs in the vault that the built data has never seen."""
    global KNOWN_DECKS
    path = os.path.join(ROOT, 'build', 'slides_text.json')
    stamp = os.path.getmtime(path) if os.path.exists(path) else 0
    if KNOWN_DECKS is None or KNOWN_DECKS[0] != stamp:
        try:
            with open(path, encoding='utf8') as f:
                KNOWN_DECKS = (stamp, set(json.load(f).keys()))
        except (OSError, ValueError):
            KNOWN_DECKS = (stamp, set())
    from config import LECTURE_DIRS
    out = []
    for folder, course in LECTURE_DIRS.items():
        base = os.path.join(VAULT, 'Atlas', 'Resources', 'Lectures', folder)
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if not f.lower().endswith('.pdf'):
                continue
            rel = os.path.relpath(os.path.join(base, f), VAULT).replace(os.sep, '/')
            if rel not in KNOWN_DECKS[1]:
                out.append({'path': rel, 'file': f, 'course': course, 'modified': time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(os.path.join(base, f))))})
    return out


def pdf_text(full):
    """Page texts of a PDF, with pypdf if it is installed (a cached copy in userdata after the first read)."""
    import hashlib
    key = hashlib.md5((full + str(os.path.getmtime(full))).encode('utf8')).hexdigest()
    cache = os.path.join(USERDATA, 'pdftext', key + '.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf8') as f:
            return json.load(f)
    try:
        import pypdf
    except ImportError:
        raise RuntimeError('pypdf is not installed (pip install pypdf)')
    reader = pypdf.PdfReader(io.BytesIO(vault_sources.read_shared(full)))
    pages = []
    for pg in reader.pages:
        try:
            t = pg.extract_text() or ''
        except Exception:
            t = ''
        pages.append(' '.join(t.split())[:4000])
    box = reader.pages[0].mediabox if reader.pages else None
    out = {'pages': pages, 'n': len(pages), 'ar': round(float(box.width) / float(box.height), 4) if box and float(box.height) else 1.333}
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def transcript(system, messages):
    """claude -p takes one prompt; fold earlier turns into it."""
    if len(messages) == 1:
        return messages[0]['content']
    parts = ['Earlier in this conversation:']
    for m in messages[:-1]:
        parts.append(('<user>\n' if m['role'] == 'user' else '<assistant>\n') + m['content'] + ('\n</user>' if m['role'] == 'user' else '\n</assistant>'))
    parts.append('Now reply to this message:\n' + messages[-1]['content'])
    return '\n\n'.join(parts)


_version = {'at': 0, 'v': ''}


def app_version():
    """A fingerprint of every file under app/ (names, sizes, times): any change on this PC changes it,
    and a phone that sees a new one reloads into the new version."""
    if time.time() - _version['at'] < 3:
        return _version['v']
    import hashlib
    h = hashlib.sha1()
    for dirpath, dirs, files in os.walk(APP):
        dirs.sort()
        for fn in sorted(files):
            try:
                st = os.stat(os.path.join(dirpath, fn))
            except OSError:
                continue
            h.update(('%s|%d|%d\n' % (os.path.relpath(os.path.join(dirpath, fn), APP), st.st_size, st.st_mtime_ns)).encode())
    _version.update(at=time.time(), v=h.hexdigest()[:12])
    return _version['v']


class Handler(BaseHTTPRequestHandler):
    server_version = 'Carrel/1'

    def log_message(self, fmt, *args):
        if os.environ.get('CARREL_LOG'):
            super().log_message(fmt, *args)

    # -------------------------------------------------- helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, cache=False):
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if path.endswith('.js'):
            ctype = 'text/javascript'
        try:
            stamp = email.utils.formatdate(os.path.getmtime(path), usegmt=True)
        except OSError:
            self.send_error(404)
            return
        # revalidate instead of re-sending: the data files are megabytes and rarely change
        if self.headers.get('If-Modified-Since') == stamp:
            self.send_response(304)
            self.send_header('Last-Modified', stamp)
            self.end_headers()
            return
        try:
            data = vault_sources.read_shared(path)
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text') or ctype.endswith('javascript') else ''))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Last-Modified', stamp)
        self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def local_only(self):
        # this machine, or your own devices through Tailscale: `tailscale serve` forwards https://<pc>.<tailnet>.ts.net
        # to this port, and only devices signed in to your tailnet can reach that name
        host = (self.headers.get('Host') or '').split(':')[0].lower()
        origin = self.headers.get('Origin')
        ok = lambda h: h in ('127.0.0.1', 'localhost') or h.endswith('.ts.net') or h in ALLOW_HOSTS
        if not ok(host):
            return False
        if origin and not ok((urllib.parse.urlparse(origin).hostname or '').lower()):
            return False
        return True

    # -------------------------------------------------- routes
    def do_GET(self):
        if not self.local_only():
            return self.send_error(403)
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        if path == '/api/health':
            return self.send_json({'ok': True, 'claude': bool(CLAUDE), 'vault': os.path.isdir(VAULT), 'name': NAME})
        if path == '/api/setup':
            f = first_run.flag()
            return self.send_json({'name': NAME, 'vault': VAULT, 'vaultExists': os.path.isdir(VAULT), 'claude': bool(CLAUDE),
                                   'canvas': integrations.canvas_status(), 'firstSync': f.get('firstSync'), 'skipped': f.get('skipped'),
                                   'job': first_run.status()})
        if path == '/api/vault':
            try:
                data = vault_sources.build()
                data['vaultPath'] = VAULT
                return self.send_json(data)
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)
        if path == '/api/newdecks':
            return self.send_json(new_decks())
        if path == '/api/pdftext':
            rel = urllib.parse.parse_qs(url.query).get('path', [''])[0]
            full = os.path.normpath(os.path.join(VAULT, rel))
            if not full.startswith(os.path.normpath(VAULT) + os.sep) or not full.lower().endswith('.pdf') or not os.path.isfile(full):
                return self.send_error(404)
            try:
                return self.send_json(pdf_text(full))
            except Exception as e:
                return self.send_json({'error': 'Could not read that PDF: %s' % e}, 500)
        if path == '/api/notes':
            return self.send_json(vault_sources.read_notes())
        if path == '/api/note':
            rel = urllib.parse.parse_qs(url.query).get('path', [''])[0]
            try:
                text = vault_sources.read_note(rel)
            except OSError as e:
                return self.send_json({'error': 'Could not read that note: %s' % e}, 500)
            return self.send_json({'path': rel, 'text': text}) if text is not None else self.send_error(404)
        if path == '/api/state':
            with _state_lock:
                state = load_state()
            return self.send_json(state)
        # Canvas and Outlook: synced data only; tokens stay in integrations' local secrets file
        if path == '/api/version':
            return self.send_json({'version': app_version()})
        if path == '/api/lectures':
            return self.send_json(integrations.lecture_files(COURSES, LECTURE_DIRS, VAULT))
        if path == '/api/lectures/job':
            return self.send_json({k: v for k, v in integrations._job.items()})
        if path in ('/api/canvas', '/api/outlook', '/api/connections'):
            force = urllib.parse.parse_qs(url.query).get('refresh', [''])[0] == '1'
            if path == '/api/canvas':
                return self.send_json(integrations.canvas_sync(COURSES, force))
            if path == '/api/outlook':
                return self.send_json(integrations.outlook_sync(force))
            return self.send_json({'canvas': integrations.canvas_status(), 'outlook': integrations.outlook_status()})
        if path.startswith('/vault/'):
            rel = path[len('/vault/'):]
            full = os.path.normpath(os.path.join(VAULT, rel))
            if not full.startswith(os.path.normpath(VAULT) + os.sep) or os.path.splitext(full)[1].lower() not in VAULT_TYPES:
                return self.send_error(403)
            if not os.path.isfile(full):
                # the shipped study sets may name a deck 'Lecture08 (1).pdf' where Canvas saved 'Lecture08.pdf', or the reverse
                stem, ext = os.path.splitext(full)
                alt = [re.sub(r' \(\d+\)$', '', stem) + ext] + ['%s (%d)%s' % (stem, n, ext) for n in (1, 2)]
                full = next((a for a in alt if os.path.isfile(a)), None)
                if not full:
                    return self.send_error(404)
            return self.send_file(full, cache=True)
        if path == '/':
            path = '/index.html'
        full = os.path.normpath(os.path.join(APP, path.lstrip('/')))
        if not full.startswith(APP + os.sep) or not os.path.isfile(full):
            return self.send_error(404)
        return self.send_file(full)

    def do_POST(self):
        if not self.local_only():
            return self.send_error(403)
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/state':
            try:
                save_state(self.body_json())
                return self.send_json({'ok': True})
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)
        if path == '/api/claude':
            return self.claude()
        if path == '/api/lectures/download':
            try:
                return self.send_json(integrations.lecture_download(self.body_json().get('ids') or [], COURSES, LECTURE_DIRS, VAULT))
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)
        if path == '/api/setup/firstsync':
            return self.send_json(first_run.start(integrations))
        if path == '/api/setup/skip':
            return self.send_json(first_run.set_flag(skipped=True))
        if path.startswith('/api/connect/'):
            try:
                b = self.body_json()
                act = path[len('/api/connect/'):]
                out = {'canvas': lambda: integrations.canvas_connect(b.get('base'), b.get('token')),
                       'canvas/off': integrations.canvas_disconnect,
                       'outlook': lambda: integrations.outlook_start(b.get('clientId'), b.get('tenant')),
                       'outlook/off': integrations.outlook_disconnect}.get(act)
                return self.send_json(out()) if out else self.send_error(404)
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)
        self.send_error(404)

    # -------------------------------------------------- Claude Code relay (server-sent events)
    def sse(self, obj):
        self.wfile.write(b'data: ' + json.dumps(obj, ensure_ascii=False).encode('utf8') + b'\n\n')
        self.wfile.flush()

    def claude(self):
        req = self.body_json()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if not CLAUDE:
            return self.sse({'error': 'Claude Code (the claude command) was not found on this machine.'})
        model = req.get('model') if req.get('model') in MODELS else 'sonnet'
        system = (req.get('system') or '')[:6000]
        messages = [m for m in (req.get('messages') or []) if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), str)]
        if not messages or messages[-1]['role'] != 'user':
            return self.sse({'error': 'Nothing to send.'})
        users = sum(1 for m in messages if m['role'] == 'user')
        sess = POOL.session(req.get('thread'), model, system, users)
        if sess is None:
            return self.sse({'error': 'Could not start Claude Code.'})
        sent = False
        ok = False
        try:
            # a live session that has seen every earlier turn only needs the new message
            text = messages[-1]['content'] if sess.seen == users - 1 and sess.seen > 0 else transcript(system, messages)
            for kind, val in sess.ask(text):
                if kind == 't':
                    self.sse({'t': val})
                    sent = True
                elif kind == 'error':
                    if re.search(r'authenticat|oauth|log ?in|401', val, re.I):
                        POOL.flush()  # signed out: no warm process is any good until Claude Code signs in again
                        val = 'Claude Code is signed out: ' + val
                    self.sse({'error': val})
                    break
                elif kind == 'done':
                    if not sent and val:
                        self.sse({'t': val})
                    self.sse({'done': True})
                    ok = True
                    break
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the browser stopped listening (Stop button)
        finally:
            if ok:
                sess.seen = users
                POOL.release(sess)
            else:
                POOL.drop(sess)


def _kill_on_close_job():
    """A Windows job object: every Claude process placed in it dies when this server exits, however it exits."""
    if os.name != 'nt':
        return None
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateJobObjectW.restype = wintypes.HANDLE
        job = k.CreateJobObjectW(None, None)

        class LIMIT(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64), ('LimitFlags', wintypes.DWORD),
                        ('MinimumWorkingSetSize', ctypes.c_size_t), ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ('r', 'w', 'o', 'rt', 'wt', 'ot')]

        class EXT(ctypes.Structure):
            _fields_ = [('Basic', LIMIT), ('Io', IO), ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                        ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
        info = EXT()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
            return None
        return (k, job)
    except Exception:
        return None


JOB = _kill_on_close_job()


def _adopt(proc):
    if JOB:
        try:
            k, job = JOB
            h = k.OpenProcess(0x1F0FFF, False, proc.pid)
            if h:
                k.AssignProcessToJobObject(job, h)
                k.CloseHandle(h)
        except Exception:
            pass


class Session:
    """One long-lived `claude -p --input-format stream-json` process: it keeps the conversation in memory."""

    def __init__(self, model, system):
        self.model, self.system = model, system
        self.thread = None
        self.seen = 0
        self.used = time.time()
        self.busy = False
        self.proc = subprocess.Popen(
            [CLAUDE, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
             '--include-partial-messages', '--model', model, '--tools', '', '--strict-mcp-config',
             '--no-session-persistence', '--safe-mode', '--system-prompt', system],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            # Claude Code thinks before answering by default, which leaves the chat blank for 10-30 s; a tutor reply should start at once
            env=dict(os.environ, MAX_THINKING_TOKENS='0'),
            cwd=USERDATA, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        _adopt(self.proc)

    def alive(self):
        return self.proc.poll() is None

    def ask(self, text):
        line = json.dumps({'type': 'user', 'message': {'role': 'user', 'content': text}}, ensure_ascii=False) + '\n'
        try:
            self.proc.stdin.write(line.encode('utf8'))
            self.proc.stdin.flush()
        except OSError:
            yield 'error', 'Claude Code stopped unexpectedly. Try again.'
            return
        for raw in self.proc.stdout:
            try:
                ev = json.loads(raw)
            except ValueError:
                continue
            if ev.get('type') == 'stream_event':
                e = ev.get('event', {})
                if e.get('type') == 'content_block_delta' and e.get('delta', {}).get('type') == 'text_delta':
                    yield 't', e['delta']['text']
            elif ev.get('type') == 'result':
                if ev.get('is_error'):
                    yield 'error', ev.get('result') or 'Claude Code returned an error.'
                else:
                    yield 'done', ev.get('result')
                return
        yield 'error', 'Claude Code closed before answering.'

    def kill(self):
        if self.alive():
            self.proc.kill()


class Pool:
    """A warm spare per (model, system) so the first token arrives in about a second, plus one session per chat thread."""
    MAX_SESSIONS, IDLE = 6, 15 * 60

    def __init__(self):
        self.lock = threading.Lock()
        self.spares = {}
        self.threads = {}

    def _spawn(self, model, system):
        try:
            return Session(model, system)
        except OSError:
            return None

    def _refill(self, model, system):
        s = self._spawn(model, system)
        if not s:
            return
        with self.lock:
            old = self.spares.get((model, system))
            self.spares[(model, system)] = s
        if old:
            old.kill()

    def warm(self, model='sonnet', system=''):
        threading.Thread(target=self._refill, args=(model, system), daemon=True).start()

    def session(self, thread, model, system, users):
        with self.lock:
            self._reap()
            s = self.threads.get(thread) if thread else None
            one_off = False
            if s and s.busy:
                # the thread is mid-reply in another request: answer this one from a throwaway process
                s, one_off = None, True
            elif s and (not s.alive() or s.model != model or s.system != system or s.seen != users - 1):
                self.threads.pop(thread, None)
                s.kill()
                s = None
            if not s:
                s = self.spares.pop((model, system), None)
                if s and not s.alive():
                    s = None
                refill = True
            else:
                refill = False
            if s:
                s.busy = True  # under the lock, so a second request on this thread cannot take it too
        if not s:
            s = self._spawn(model, system)
            if s:
                s.busy = True
        if refill:
            self.warm(model, system)
        if s:
            s.thread = None if one_off else thread
            s.used = time.time()
            if s.thread:
                with self.lock:
                    old = self.threads.get(s.thread)
                    self.threads[s.thread] = s  # registered now, so a second request sees it busy
                if old and old is not s:
                    old.kill()
        return s

    def release(self, s):
        with self.lock:
            s.busy = False
            s.used = time.time()
            if s.thread:
                self.threads[s.thread] = s
            else:
                s.kill()

    def drop(self, s):
        with self.lock:
            if s.thread and self.threads.get(s.thread) is s:
                self.threads.pop(s.thread)
        s.kill()

    def _reap(self):
        now = time.time()
        for k, s in list(self.threads.items()):
            if not s.busy and (now - s.used > self.IDLE or not s.alive()):
                s.kill()
                self.threads.pop(k)
        idle = sorted((s.used, k) for k, s in self.threads.items() if not s.busy)
        while len(self.threads) > self.MAX_SESSIONS and idle:
            _, k = idle.pop(0)
            self.threads.pop(k).kill()

    def flush(self):
        """Drop every idle process: after a sign-in problem they hold stale credentials, so the next request starts fresh."""
        with self.lock:
            spares, self.spares = list(self.spares.values()), {}
            for k, s in list(self.threads.items()):
                if not s.busy:
                    spares.append(self.threads.pop(k))
        for s in spares:
            s.kill()

    def close(self):
        with self.lock:
            for s in list(self.spares.values()) + list(self.threads.values()):
                s.kill()


POOL = Pool()


class Server(ThreadingHTTPServer):
    # on Windows SO_REUSEADDR lets two servers share a port silently; refuse instead so the next port is tried
    allow_reuse_address = os.name != 'nt'
    daemon_threads = True
    # the phone reaches Carrel through tailscale serve, which opens one connection per file all at once;
    # the default backlog of 5 refuses the rest and the phone gets 502s and a blank page
    request_queue_size = 128


def main():
    os.makedirs(USERDATA, exist_ok=True)
    srv = None
    for port in range(PORT, PORT + 10):  # if another Carrel (or anything) holds the port, take the next one
        try:
            srv = Server(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if srv is None:
        sys.exit('Ports %d to %d are all in use. Close the other Carrel window and try again.' % (PORT, PORT + 9))
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    print('Carrel is running at', url)
    print('Vault:', VAULT, '(found)' if os.path.isdir(VAULT) else '(NOT FOUND, set CARREL_VAULT)')
    print('Claude Code:', CLAUDE or 'not found (chat falls back to an API key set in the app)')
    print('Press Ctrl+C to stop.')
    if '--no-browser' not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    if CLAUDE:
        POOL.warm('sonnet', WARM_SYSTEM)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        POOL.close()


if __name__ == '__main__':
    main()
