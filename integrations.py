"""Canvas and Outlook for Carrel. Standard library only.

Tokens live in %LOCALAPPDATA%\\Carrel\\secrets.json, outside OneDrive, and never reach the browser: the app asks
this server for the synced data, and the server talks to Canvas and Microsoft Graph. The last good result of each
sync is kept beside the secrets, so the dashboard has something to show at once and when offline.

Canvas: a personal access token (Canvas > Account > Settings > New access token), pasted into Carrel's Settings.
Outlook: Microsoft's device-code sign-in with an app registration you own (its client ID goes in Settings);
scopes are read-only: User.Read, Calendars.Read, Mail.Read, offline_access.
"""
import os, re, json, time, html, threading, datetime as dt, urllib.parse, urllib.request, urllib.error

LOCAL = os.environ.get('CARREL_SECRETS_DIR') or (os.path.join(os.environ['LOCALAPPDATA'], 'Carrel') if os.environ.get('LOCALAPPDATA') else os.path.expanduser('~/.carrel'))
SECRETS = os.path.join(LOCAL, 'secrets.json')
LOGIN = os.environ.get('CARREL_LOGIN_URL', 'https://login.microsoftonline.com')
GRAPH = os.environ.get('CARREL_GRAPH_URL', 'https://graph.microsoft.com/v1.0')
SCOPES = 'offline_access User.Read Calendars.Read Mail.Read'
CANVAS_DEFAULT = 'https://canvas.mit.edu'
FRESH = 600  # seconds a sync result is served before Canvas or Graph is asked again
_lock = threading.Lock()


# -------------------------------------------------- local files
def _read(name, default):
    try:
        with open(os.path.join(LOCAL, name), encoding='utf8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(name, obj):
    os.makedirs(LOCAL, exist_ok=True)
    path = os.path.join(LOCAL, name)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def secrets():
    return _read('secrets.json', {})


def save_secrets(fn):
    with _lock:
        s = secrets()
        fn(s)
        _write('secrets.json', s)


def _http(url, method='GET', headers=None, data=None, timeout=25):
    """Returns (status, headers, parsed json or text). Never raises for HTTP errors."""
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        raw, status, hdrs = e.read(), e.code, e.headers
    try:
        return status, hdrs, json.loads(raw or b'null')
    except ValueError:
        return status, hdrs, raw.decode('utf8', 'replace')


def _local(iso):
    """'2026-11-03T03:59:00Z' -> local (date, 'HH:MM') on this machine."""
    if not iso:
        return None, None
    t = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    t = t.astimezone()
    return t.strftime('%Y-%m-%d'), t.strftime('%H:%M')


def _plain(s, n=420):
    s = re.sub(r'<(script|style)[\s\S]*?</\1>', ' ', s or '', flags=re.I)
    s = re.sub(r'<br\s*/?>|</p>|</li>|</div>', '\n', s, flags=re.I)
    s = re.sub(r'</?(p|div|h\d|li|ul|ol|tr|td|table|blockquote)\b[^>]*>', ' ', s, flags=re.I)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))  # inline tags (b, a, span) vanish without leaving a gap
    s = re.sub(r'[ \t\xa0]+', ' ', s)
    s = re.sub(r'\n\s*\n+', '\n', s).strip()
    return s if len(s) <= n else s[:n].rsplit(' ', 1)[0] + '…'


# -------------------------------------------------- Canvas
def _carrel_course(name, code, courses):
    hay = (name or '') + ' ' + (code or '')
    for c in courses:
        for code in [c['code']] + list(c.get('alias') or []):
            if re.search(r'(?<![\w.])' + re.escape(code) + r'(?![\w])', hay, re.I):
                return c['id']
    return None


def canvas_status():
    s = secrets().get('canvas') or {}
    return {'connected': bool(s.get('token')), 'base': s.get('base') or CANVAS_DEFAULT, 'user': s.get('user')}


def canvas_connect(base, token):
    base = (base or CANVAS_DEFAULT).strip().rstrip('/')
    if not re.match(r'^https?://', base):
        base = 'https://' + base
    token = (token or '').strip()
    if not token:
        return {'error': 'Paste the access token from Canvas first.'}
    st, _, me = _http(base + '/api/v1/users/self', headers={'Authorization': 'Bearer ' + token})
    if st == 401:
        return {'error': 'Canvas did not accept that token. Make a new one under Account > Settings > New access token.'}
    if st != 200 or not isinstance(me, dict):
        return {'error': 'Could not reach Canvas at %s (HTTP %s). Check the address.' % (base, st)}
    user = me.get('name') or me.get('short_name') or 'you'
    save_secrets(lambda s: s.__setitem__('canvas', {'base': base, 'token': token, 'user': user}))
    _write('canvas.json', {})
    return {'ok': True, 'user': user}


def canvas_disconnect():
    save_secrets(lambda s: s.pop('canvas', None))
    _write('canvas.json', {})
    return {'ok': True}


def _canvas_get(base, token, path, params=None):
    """GET with Canvas pagination (Link: rel="next"); returns a list or a dict."""
    url = base + path + ('?' + urllib.parse.urlencode(params, doseq=True) if params else '')
    out, pages = [], 0
    while url and pages < 10:
        st, hdrs, body = _http(url, headers={'Authorization': 'Bearer ' + token})
        # a bad token and a tab the course hides from students both answer 401; only the first means sign in again
        if st == 401 and ('invalid access token' in json.dumps(body).lower() or hdrs.get('WWW-Authenticate')):
            raise PermissionError('canvas-auth')
        if st != 200:
            raise RuntimeError('Canvas answered HTTP %s for %s' % (st, path))
        if not isinstance(body, list):
            return body
        out += body
        m = re.search(r'<([^>]+)>;\s*rel="next"', hdrs.get('Link') or '')
        url, pages = (m.group(1) if m else None), pages + 1
    return out


def canvas_sync(courses, force=False):
    s = secrets().get('canvas') or {}
    if not s.get('token'):
        return {'connected': False}
    cached = _read('canvas.json', {})
    if not force and cached.get('fetched') and time.time() - cached['fetched'] < FRESH:
        return dict(cached, connected=True, user=s.get('user'))
    base, token = s['base'], s['token']
    try:
        today = dt.date.today()
        raw = _canvas_get(base, token, '/api/v1/courses', {'enrollment_state': 'active', 'per_page': 50, 'include[]': ['term', 'teachers']})
        raw = [c for c in raw if isinstance(c, dict) and c.get('id') and not c.get('access_restricted_by_date')]
        cs = [{'id': c['id'], 'name': c.get('name'), 'code': c.get('course_code'), 'carrel': _carrel_course(c.get('name'), c.get('course_code'), courses)} for c in raw]
        staff = sorted({t.get('display_name') for c in raw for t in (c.get('teachers') or []) if t.get('display_name')})
        by_id = {c['id']: c for c in cs}
        items = []
        for p in _canvas_get(base, token, '/api/v1/planner/items', {'start_date': (today - dt.timedelta(days=14)).isoformat(),
                                                                    'end_date': (today + dt.timedelta(days=150)).isoformat(), 'per_page': 100}):
            kind = p.get('plannable_type')
            if kind not in ('assignment', 'quiz', 'discussion_topic', 'calendar_event', 'assessment_request', 'wiki_page'):
                continue
            pl = p.get('plannable') or {}
            date, tm = _local(pl.get('due_at') or pl.get('todo_date') or p.get('plannable_date') or pl.get('start_at'))
            if not date:
                continue
            sub = p.get('submissions') if isinstance(p.get('submissions'), dict) else {}
            c = by_id.get(p.get('course_id')) or {}
            url = p.get('html_url') or ''
            items.append({
                'id': 'cv-%s-%s' % (kind, p.get('plannable_id')),
                'title': pl.get('title') or pl.get('name') or 'Canvas item',
                'date': date, 'time': None if tm == '23:59' and kind == 'calendar_event' else tm,
                'kind': {'assignment': 'assignment', 'quiz': 'quiz', 'discussion_topic': 'discussion', 'calendar_event': 'event'}.get(kind, kind),
                'course': c.get('carrel') or 'canvas', 'courseName': c.get('name') or p.get('context_name'),
                'points': pl.get('points_possible'),
                'submitted': bool(sub.get('submitted')), 'graded': bool(sub.get('graded')), 'missing': bool(sub.get('missing')),
                'done': bool(sub.get('submitted') or (p.get('planner_override') or {}).get('marked_complete')),
                'url': url if url.startswith('http') else base + url,
            })
        anns = []
        if cs:
            raw = _canvas_get(base, token, '/api/v1/announcements', {'context_codes[]': ['course_%s' % c['id'] for c in cs],
                                                                    'start_date': (today - dt.timedelta(days=21)).isoformat(),
                                                                    'end_date': (today + dt.timedelta(days=1)).isoformat(), 'per_page': 50})
            for a in raw if isinstance(raw, list) else []:
                cid = int(str(a.get('context_code', '')).replace('course_', '') or 0)
                c = by_id.get(cid) or {}
                anns.append({'id': 'ca-%s' % a.get('id'), 'title': a.get('title') or 'Announcement', 'posted': a.get('posted_at') or a.get('created_at'),
                             'course': c.get('carrel') or 'canvas', 'courseName': c.get('name'), 'author': (a.get('author') or {}).get('display_name'),
                             'text': _plain(a.get('message')), 'url': a.get('html_url') or ''})
            anns.sort(key=lambda a: a['posted'] or '', reverse=True)
        out = {'fetched': time.time(), 'courses': cs, 'items': items, 'announcements': anns[:20], 'staff': staff}
        _write('canvas.json', out)
        return dict(out, connected=True, user=s.get('user'))
    except PermissionError:
        return dict(cached, connected=True, user=s.get('user'), error='Canvas no longer accepts the saved token. Make a new one and paste it in Settings.', reauth=True)
    except Exception as e:
        return dict(cached, connected=True, user=s.get('user'), error='Canvas sync failed: %s. Showing the last sync.' % e)


# -------------------------------------------------- Canvas files -> the vault's lecture folders
SLIDE_TYPES = re.compile(r'\.(pdf|pptx?|key)$', re.I)
LECTURE_HINT = re.compile(r'(lec(ture)?s?([\s_-]*\d|(?![a-z]))|(?<=[\s_-])l\d{1,2}[a-z]?(?![\d])|slides?|recitation|(?<![a-z])rec[\s_-]?\d|session[\s_-]?\d|class[\s_-]?\d|week[\s_-]?\d|in-?class|post-?class|deck)', re.I)
NOT_LECTURE = re.compile(r'(syllabus|solution|(?<![a-z])soln?s?(?![a-z])|answer|key\b|homework|\bhw[\s_-]?\d|pset|problem[\s_-]?set|exam|midterm|final|quiz|grade|roster|rubric|template)', re.I)
SYLLABUS = re.compile(r'syllabus', re.I)
SYLLABI = 'Attachments/Syllabi'
_job = {'state': 'idle'}


def _safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name or 'file').strip().rstrip('. ')
    return name[:150] or 'file'


def _course_files(base, token, cid):
    """A course's slide-type files, from the Files tab, or from Modules when Files is hidden."""
    try:
        folders = {f['id']: f.get('full_name', '') for f in _canvas_get(base, token, '/api/v1/courses/%s/folders' % cid, {'per_page': 100}) if isinstance(f, dict)}
        files = _canvas_get(base, token, '/api/v1/courses/%s/files' % cid, {'per_page': 100})
        src = 'files'
    except RuntimeError:  # Files tab hidden for students: walk the modules instead
        folders, files, src = {}, [], 'modules'
        for m in _canvas_get(base, token, '/api/v1/courses/%s/modules' % cid, {'include[]': ['items'], 'per_page': 50}):
            for it in (m.get('items') or []):
                if it.get('type') == 'File' and it.get('content_id'):
                    st, _, f = _http('%s/api/v1/courses/%s/files/%s' % (base, cid, it['content_id']), headers={'Authorization': 'Bearer ' + token})
                    if st == 200 and isinstance(f, dict):
                        f['_module'] = m.get('name') or ''
                        files.append(f)
    out = []
    for f in files if isinstance(files, list) else []:
        name = f.get('display_name') or f.get('filename') or ''
        if not SLIDE_TYPES.search(name) or f.get('locked_for_user') or f.get('hidden_for_user'):
            continue
        where = f.get('_module') or re.sub(r'^course files/?', '', folders.get(f.get('folder_id'), ''))
        out.append({'id': f['id'], 'name': name, 'folder': where, 'size': f.get('size') or 0, 'updated': f.get('updated_at') or f.get('modified_at'),
                    'lecture': bool(LECTURE_HINT.search(name + ' ' + where)) and not NOT_LECTURE.search(name + ' ' + where)})
    return out, src


def lecture_files(courses, lecture_dirs, vault):
    """Per course: its Canvas slide files and whether each is already in the vault folder."""
    s = secrets().get('canvas') or {}
    if not s.get('token'):
        return {'connected': False}
    base, token = s['base'], s['token']
    synced = _read('lecture_sync.json', {})
    dir_of = {cid: name for name, cid in lecture_dirs.items()}
    efforts_of = {c['id']: c.get('efforts') for c in courses}
    cached = _read('canvas.json', {})
    if not cached.get('courses'):
        cached = canvas_sync(courses, force=True)
    out = []
    for c in cached.get('courses') or []:
        cid = c.get('carrel')
        if not cid or cid not in dir_of:
            continue
        # slides go to the lecture folder, a syllabus beside the others, anything else (assignments, data) to the course's Efforts folder
        lect = 'Atlas/Resources/Lectures/' + dir_of[cid]
        other = 'Efforts/Courses/' + (efforts_of.get(cid) or dir_of[cid])
        dest = lambda f: lect if f['lecture'] else SYLLABI if SYLLABUS.search(f['name']) else other
        have = {}
        for rel in (lect, other, SYLLABI):
            folder = os.path.join(vault, *rel.split('/'))
            if os.path.isdir(folder):
                for fn in os.listdir(folder):
                    try:
                        have.setdefault(fn.lower(), os.path.getsize(os.path.join(folder, fn)))
                    except OSError:
                        pass
        # a size match stands in for a renamed copy, but not for files Carrel saved itself or tiny ones that collide by chance
        mine = {os.path.basename(r['path']).lower() for r in synced.values() if r.get('path', '').startswith((lect + '/', other + '/', SYLLABI + '/'))}
        sizes = {n for fn, n in have.items() if fn not in mine and n >= 20000}
        entry = {'course': cid, 'canvasName': c.get('name'), 'folder': lect, 'files': []}
        try:
            files, entry['source'] = _course_files(base, token, c['id'])
        except PermissionError:
            return {'connected': True, 'error': 'Canvas no longer accepts the saved token. Make a new one and paste it in Settings.'}
        except Exception as e:
            entry['error'] = 'Could not list files: %s' % e
            files = []
        for f in files:
            rec = synced.get(str(f['id']))
            name = _safe_name(f['name'])
            f['dest'] = dest(f)
            if rec and os.path.exists(os.path.join(vault, rec['path'])):
                f['status'] = 'updated' if (f['updated'] or '') > (rec.get('updated') or '') else 'synced'
                f['path'] = rec['path']
            elif name.lower() in have or (f['size'] >= 20000 and f['size'] in sizes):
                f['status'] = 'have'  # same name, or a file of exactly this size, is already there
            else:
                f['status'] = 'new'
            entry['files'].append(f)
        entry['files'].sort(key=lambda f: (f['status'] not in ('new', 'updated'), not f['lecture'], f['folder'].lower(), f['name'].lower()))
        out.append(entry)
    return {'connected': True, 'courses': out, 'job': {k: v for k, v in _job.items() if k != 'thread'}}


def lecture_download(ids, courses, lecture_dirs, vault):
    """Download the chosen files into their course's lecture folder, in the background."""
    if _job.get('state') == 'running':
        return {'error': 'A download is already running.'}
    s = secrets().get('canvas') or {}
    if not s.get('token'):
        return {'error': 'Connect Canvas first.'}
    want = {str(i) for i in ids}
    # which course each file belongs to, from a fresh listing
    listing = lecture_files(courses, lecture_dirs, vault)
    plan = [(c, f) for c in listing.get('courses') or [] for f in c['files'] if str(f['id']) in want]
    if not plan:
        return {'error': 'None of those files are on Canvas any more.'}
    _job.clear()
    _job.update(state='running', total=len(plan), done=0, current='', saved=[], failed=[])
    threading.Thread(target=_download_all, args=(s['base'], s['token'], plan, vault), daemon=True).start()
    return {'ok': True, 'job': {k: v for k, v in _job.items()}}


def _download_all(base, token, plan, vault):
    synced = _read('lecture_sync.json', {})
    for c, f in plan:
        _job['current'] = f['name']
        dest = None
        try:
            st, _, meta = _http('%s/api/v1/files/%s' % (base, f['id']), headers={'Authorization': 'Bearer ' + token})
            if st != 200 or not isinstance(meta, dict) or not meta.get('url'):
                raise RuntimeError('Canvas would not hand out this file (HTTP %s)' % st)
            target = f.get('dest') or c['folder']
            folder = os.path.join(vault, *target.split('/'))
            os.makedirs(folder, exist_ok=True)
            rel = f.get('path') if f.get('status') == 'updated' else None  # an update overwrites only a file Carrel saved
            if not rel:
                name = _safe_name(meta.get('display_name') or f['name'])
                stem, ext = os.path.splitext(name)
                n = 1
                while os.path.exists(os.path.join(folder, name)):
                    n += 1
                    name = '%s (%d)%s' % (stem, n, ext)
                rel = target + '/' + name
            dest = os.path.join(vault, *rel.split('/'))
            # the download URL carries its own signature; no token goes to the file host
            req = urllib.request.Request(meta['url'])
            with urllib.request.urlopen(req, timeout=120) as r, open(dest + '.part', 'wb') as out:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(dest + '.part', dest)
            synced[str(f['id'])] = {'path': rel, 'updated': meta.get('updated_at') or f.get('updated'), 'size': meta.get('size')}
            _write('lecture_sync.json', synced)
            _job['saved'].append(rel)
        except Exception as e:
            _job['failed'].append({'name': f['name'], 'error': str(e)})
            if dest and os.path.exists(dest + '.part'):
                os.remove(dest + '.part')
        _job['done'] += 1
    _job.update(state='done', current='', finished=time.time())


# -------------------------------------------------- Outlook (Microsoft Graph)
_flow = {}  # the sign-in in progress: user_code, verification_uri, expires, state, error


def outlook_status():
    s = secrets().get('outlook') or {}
    f = {k: v for k, v in _flow.items() if k in ('user_code', 'verification_uri', 'expires', 'state', 'error')}
    return {'connected': bool(s.get('refresh')), 'user': s.get('user'), 'clientId': s.get('client_id') or '', 'tenant': s.get('tenant') or 'organizations', 'flow': f or None}


def outlook_start(client_id, tenant):
    client_id, tenant = (client_id or '').strip(), (tenant or 'organizations').strip() or 'organizations'
    if not re.match(r'^[0-9a-fA-F-]{36}$', client_id):
        return {'error': 'That is not an application (client) ID. It looks like 00000000-0000-0000-0000-000000000000.'}
    st, _, body = _http('%s/%s/oauth2/v2.0/devicecode' % (LOGIN, tenant), 'POST', data={'client_id': client_id, 'scope': SCOPES})
    if st != 200 or not isinstance(body, dict) or 'device_code' not in body:
        msg = body.get('error_description', '') if isinstance(body, dict) else ''
        return {'error': 'Microsoft refused to start sign-in: ' + (msg.split('\r\n')[0] or 'HTTP %s' % st)}
    save_secrets(lambda s: s.__setitem__('outlook', dict(s.get('outlook') or {}, client_id=client_id, tenant=tenant)))
    _flow.clear()
    _flow.update(user_code=body['user_code'], verification_uri=body.get('verification_uri') or 'https://microsoft.com/devicelogin',
                 expires=time.time() + int(body.get('expires_in', 900)), state='waiting', device=body['device_code'], interval=int(body.get('interval', 5)))
    threading.Thread(target=_poll, args=(client_id, tenant, body['device_code']), daemon=True).start()
    return outlook_status()


def _poll(client_id, tenant, device):
    interval = _flow.get('interval', 5)
    while _flow.get('device') == device and time.time() < _flow.get('expires', 0):
        time.sleep(interval)
        st, _, body = _http('%s/%s/oauth2/v2.0/token' % (LOGIN, tenant), 'POST', data={
            'grant_type': 'urn:ietf:params:oauth:grant-type:device_code', 'client_id': client_id, 'device_code': device})
        err = body.get('error') if isinstance(body, dict) else 'bad_response'
        if st == 200 and isinstance(body, dict) and body.get('access_token'):
            _store_tokens(body)
            _, _, me = _http(GRAPH + '/me?$select=displayName,mail,userPrincipalName', headers={'Authorization': 'Bearer ' + body['access_token']})
            user = (me or {}).get('mail') or (me or {}).get('userPrincipalName') or (me or {}).get('displayName') if isinstance(me, dict) else None
            save_secrets(lambda s: s['outlook'].__setitem__('user', user))
            _write('outlook.json', {})
            _flow.update(state='done')
            return
        if err == 'authorization_pending':
            continue
        if err == 'slow_down':
            interval += 5
            continue
        _flow.update(state='failed', error={'authorization_declined': 'Sign-in was declined.', 'expired_token': 'The code expired. Start again.'}.get(
            err, (body.get('error_description') or err).split('\r\n')[0] if isinstance(body, dict) else 'Sign-in failed.'))
        return
    if _flow.get('device') == device and _flow.get('state') == 'waiting':
        _flow.update(state='failed', error='The code expired. Start again.')


def _store_tokens(body):
    def put(s):
        o = s.setdefault('outlook', {})
        o['access'] = body['access_token']
        o['expires'] = time.time() + int(body.get('expires_in', 3600)) - 120
        if body.get('refresh_token'):
            o['refresh'] = body['refresh_token']
    save_secrets(put)


def _access():
    o = secrets().get('outlook') or {}
    if not o.get('refresh'):
        return None
    if o.get('access') and time.time() < o.get('expires', 0):
        return o['access']
    st, _, body = _http('%s/%s/oauth2/v2.0/token' % (LOGIN, o.get('tenant') or 'organizations'), 'POST', data={
        'grant_type': 'refresh_token', 'client_id': o['client_id'], 'refresh_token': o['refresh'], 'scope': SCOPES})
    if st != 200 or not isinstance(body, dict) or not body.get('access_token'):
        raise PermissionError('outlook-auth')
    _store_tokens(body)
    return body['access_token']


def outlook_disconnect():
    save_secrets(lambda s: s.__setitem__('outlook', {k: v for k, v in (s.get('outlook') or {}).items() if k in ('client_id', 'tenant')}))
    _flow.clear()
    _write('outlook.json', {})
    return {'ok': True}


def _graph(path, token, params=None, limit=6):
    url = GRAPH + path + ('?' + urllib.parse.urlencode(params, safe='$,:\'/', quote_via=urllib.parse.quote) if params else '')
    out = []
    while url and limit:
        st, _, body = _http(url, headers={'Authorization': 'Bearer ' + token, 'Prefer': 'outlook.timezone="UTC"'})
        if st == 401:
            raise PermissionError('outlook-auth')
        if st != 200 or not isinstance(body, dict):
            raise RuntimeError('Microsoft Graph answered HTTP %s for %s' % (st, path.split('?')[0]))
        out += body.get('value') or []
        url, limit = body.get('@odata.nextLink'), limit - 1
    return out


URGENT = re.compile(r'\b(urgent|asap|action required|deadline|due|exam|midterm|final|quiz|grade|reschedul\w*|cancel\w*|interview|offer|sponsor|deliverable|reminder|today|tomorrow)\b', re.I)
BULK = re.compile(r'(no-?reply|newsletter|digest|notifications?@|mailer|marketing|news@|updates@|events@)', re.I)


def _priority(m, staff):
    """Score an email; four points or more makes it priority. Returns (score, reasons)."""
    score, why = 0, []
    sender = ((m.get('from') or {}).get('emailAddress') or {})
    addr, name = (sender.get('address') or '').lower(), sender.get('name') or ''
    if m.get('importance') == 'high':
        score += 3; why.append('marked high importance')
    if (m.get('flag') or {}).get('flagStatus') == 'flagged':
        score += 3; why.append('flagged in Outlook')
    if name and name.lower() in staff:
        score += 3; why.append('from your course staff')
    if URGENT.search(m.get('subject') or ''):
        score += 2; why.append('subject mentions ' + URGENT.search(m.get('subject') or '').group(0).lower())
    if addr.endswith('mit.edu') and not BULK.search(addr):
        score += 1
    if m.get('inferenceClassification') == 'focused':
        score += 1
    if not m.get('isRead'):
        score += 1
    if BULK.search(addr) or BULK.search(name):
        score -= 3
    return score, why


def outlook_sync(force=False):
    o = secrets().get('outlook') or {}
    staff = _read('canvas.json', {}).get('staff') or []  # course teachers from the last Canvas sync
    if not o.get('refresh'):
        return {'connected': False}
    cached = _read('outlook.json', {})
    if not force and cached.get('fetched') and time.time() - cached['fetched'] < FRESH:
        return dict(cached, connected=True, user=o.get('user'))
    try:
        token = _access()
        now = dt.datetime.now(dt.timezone.utc)
        z = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
        evs = []
        for e in _graph('/me/calendarView', token, {'startDateTime': z(now - dt.timedelta(days=14)), 'endDateTime': z(now + dt.timedelta(days=90)),
                                                    '$top': 200, '$orderby': 'start/dateTime',
                                                    '$select': 'id,subject,start,end,location,isAllDay,webLink,showAs,isCancelled'}):
            if e.get('isCancelled'):
                continue
            all_day = bool(e.get('isAllDay'))
            s_iso, e_iso = (e.get('start') or {}).get('dateTime'), (e.get('end') or {}).get('dateTime')
            if all_day:  # all-day events are midnight to midnight in the event's own zone; keep the dates as written
                sd, ed = s_iso[:10], (dt.date.fromisoformat(e_iso[:10]) - dt.timedelta(days=1)).isoformat()
                st_, et_ = None, None
            else:
                (sd, st_), (ed, et_) = _local(s_iso[:19] + 'Z'), _local(e_iso[:19] + 'Z')
            evs.append({'id': 'ol-' + e['id'][-24:], 'title': e.get('subject') or '(no title)', 'date': sd, 'endDate': ed, 'start': st_, 'end': et_,
                        'allDay': all_day, 'loc': ((e.get('location') or {}).get('displayName') or '').strip(), 'showAs': e.get('showAs'), 'url': e.get('webLink')})
        since = z(now - dt.timedelta(days=10))
        msgs = _graph('/me/mailFolders/inbox/messages', token, {'$top': 60, '$filter': 'receivedDateTime ge ' + since, '$orderby': 'receivedDateTime desc',
                                                               '$select': 'id,subject,from,receivedDateTime,importance,flag,isRead,bodyPreview,webLink,inferenceClassification'}, limit=2)
        staff = {n.lower() for n in staff if n}
        mail = []
        for m in msgs:
            score, why = _priority(m, staff)
            if score >= 4:
                sender = ((m.get('from') or {}).get('emailAddress') or {})
                mail.append({'id': 'om-' + m['id'][-24:], 'subject': m.get('subject') or '(no subject)', 'from': sender.get('name') or sender.get('address'),
                             'received': m.get('receivedDateTime'), 'preview': (m.get('bodyPreview') or '')[:240], 'unread': not m.get('isRead'),
                             'score': score, 'why': why, 'url': m.get('webLink')})
        # the 12 strongest, newest first
        mail = sorted(sorted(mail, key=lambda x: (-x['score'], x['received'] or ''))[:12], key=lambda x: x['received'] or '', reverse=True)
        out = {'fetched': time.time(), 'events': evs, 'mail': mail, 'scanned': len(msgs)}
        _write('outlook.json', out)
        return dict(out, connected=True, user=o.get('user'))
    except PermissionError:
        return dict(cached, connected=True, user=o.get('user'), error='Microsoft asks you to sign in again. Open Settings and sign in to Outlook.', reauth=True)
    except Exception as e:
        return dict(cached, connected=True, user=o.get('user'), error='Outlook sync failed: %s. Showing the last sync.' % e)
