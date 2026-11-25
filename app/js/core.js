/* Carrel core: namespace, DOM helpers, dates, persistent store (localStorage mirrored to the local server), router. */
(function () {
  'use strict';
  const C = (window.C = window.C || {});

  // ------------------------------------------------------------ DOM
  C.$ = (sel, el) => (el || document).querySelector(sel);
  C.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  C.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  C.html = (el, markup) => { el.innerHTML = markup; C.renderMath(el); return el; };
  C.icon = {
    slide: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/></svg>',
    spark: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    chat: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    x: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M5 5l10 10M15 5L5 15"/></svg>',
    left: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>',
    right: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>',
    shuffle: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M3 6h3.5l7 8H17M3 14h3.5l2-2.3M11.5 8.3l2-2.3H17M15 4l2 2-2 2M15 12l2 2-2 2"/></svg>',
    trash: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"/></svg>',
    ext: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M11 4h5v5M16 4l-7 7M14 12v4H4V6h4"/></svg>',
    flag: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M5 17.5V3.5M5 4h9l-2 3.5 2 3.5H5"/></svg>',
    edit: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3"/></svg>',
    copy: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M13 7V4.5A1 1 0 0 0 12 3.5H4.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1H7"/></svg>',
    print: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M6 7V3.5h8V7M6 14H4V8h12v6h-2M6 11.5h8V17H6z"/></svg>',
    menu: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/></svg>',
    sidebar: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13"/></svg>',
  };

  // ------------------------------------------------------------ math (KaTeX, loaded deferred from app/vendor)
  // "\$" (how Obsidian writes a dollar sign) is a literal dollar and never opens or closes math; inside $...$ KaTeX reads it.
  // Single-dollar math follows Pandoc's rule so prices stay text ("$5 for 10 units and $3 beyond"): the opening $ is
  // followed by a non-space (and not "/", as in "$/h"), the closing $ follows a non-space and is not followed by a digit.
  // A space before the closing $ is allowed only when the span holds TeX markup (\ ^ _ {), as in "$|r_{(q)}| = $".
  C.MATH1 = String.raw`\$(?![\s$/])(?:(?=[^$\n]*[\\^_{])(?:\\.|[^$\n\\])+?|(?:\\.|[^$\n\\])+?(?<!\s))\$(?!\d)`;
  const MATH_ANY = String.raw`\\\$|\$\$[\s\S]+?\$\$|` + C.MATH1 + String.raw`|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]`;
  const MATH = new RegExp(MATH_ANY);
  const MATH_SPLIT = new RegExp('(' + MATH_ANY + ')', 'g');
  C.renderMath = function (el) {
    if (!el || !window.katex) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('code,pre,textarea,script,style,.katex') ? NodeFilter.FILTER_REJECT : MATH.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const parts = n.nodeValue.split(MATH_SPLIT);
      if (parts.length < 2) return;
      const frag = document.createDocumentFragment();
      parts.forEach((p, i) => {
        if (i % 2 === 0 || p === '\\$') { if (p) frag.appendChild(document.createTextNode(i % 2 ? '$' : p)); return; }
        const display = p.startsWith('$$') || p.startsWith('\\[');
        const tex = p.replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '').replace(/^\\\(|\\\)$/g, '').replace(/^\\\[|\\\]$/g, '');
        const span = document.createElement('span');
        try { window.katex.render(tex, span, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch (e) { span.textContent = p; }
        frag.appendChild(span);
      });
      n.parentNode.replaceChild(frag, n);
    });
  };
  // deck text uses **bold**, *italic*, `code`; keep $math$ for KaTeX
  C.inline = function (s) {
    const parts = String(s || '').split(new RegExp(String.raw`(\$\$[\s\S]+?\$\$|` + C.MATH1 + ')', 'g'));
    return parts.map((p, i) => {
      if (i % 2) return C.esc(p);
      let h = C.esc(p);
      h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
      return h.replace(/\n/g, '<br>');
    }).join('');
  };

  // ------------------------------------------------------------ dates (all local, ISO yyyy-mm-dd)
  const pad = (n) => String(n).padStart(2, '0');
  C.iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  C.parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  C.today = () => C.iso(new Date());
  C.addDays = (s, n) => { const d = C.parse(s); d.setDate(d.getDate() + n); return C.iso(d); };
  C.daysBetween = (a, b) => Math.round((C.parse(b) - C.parse(a)) / 86400000);
  C.DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  C.DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  C.MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  C.MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  C.fmtShort = (s) => { const d = C.parse(s); return C.DOW[d.getDay()] + ' ' + C.MON[d.getMonth()] + ' ' + d.getDate(); };
  C.fmtLong = (s) => { const d = C.parse(s); return C.DOWL[d.getDay()] + ', ' + C.MONL[d.getMonth()] + ' ' + d.getDate(); };
  C.fmtTime = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m ? ':' + pad(m) : '') + ' ' + ap; };
  C.rel = (s) => {
    const n = C.daysBetween(C.today(), s);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n < 0) return -n + ' days ago';
    if (n < 7) return 'in ' + n + ' days';
    return 'in ' + n + ' days';
  };

  // ------------------------------------------------------------ hashing (stable ids for questions/cards)
  C.hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  C.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ------------------------------------------------------------ events
  const handlers = {};
  C.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  C.emit = (ev, data) => (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  // ------------------------------------------------------------ server detection
  C.server = { ok: false, claude: false, vault: false, checked: false };
  C.api = async function (path, opts) {
    const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  };
  // your name: from Settings, or else from the installer (carrel.config.json, sent with /api/health); prompts to Claude use it
  C.me = () => String((C.settings && C.settings().name) || C.server.name || '').trim();
  C.who = () => C.me().split(' ')[0] || 'The student';
  C.probe = async function () {
    if (location.protocol === 'file:') { C.server.checked = true; return C.server; }
    try {
      const h = await C.api('/api/health');
      Object.assign(C.server, h, { ok: true, checked: true });
    } catch (e) { C.server.checked = true; }
    return C.server;
  };

  // ------------------------------------------------------------ store
  // Everything the app remembers lives under a handful of keys. localStorage is the fast copy;
  // when the local server is up each key is also written to userdata/state.json so it survives a cleared browser.
  const PREFIX = 'carrel.';
  const mem = {};
  const dirty = new Set();
  let flushTimer = null;
  C.store = {
    get(k, d) {
      if (k in mem) return mem[k];
      try { const v = localStorage.getItem(PREFIX + k); if (v != null) return (mem[k] = JSON.parse(v)); } catch (e) {}
      return d;
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) {}
      if (C.server.ok && k !== 'settings.secret') { dirty.add(k); clearTimeout(flushTimer); flushTimer = setTimeout(C.store.flush, 600); }
      C.emit('store:' + k, v);
    },
    update(k, d, fn) { const v = C.store.get(k, d); const out = fn(v) || v; C.store.set(k, out); return out; },
    async flush() {
      if (!C.server.ok || !dirty.size) return;
      const body = {}; dirty.forEach((k) => (body[k] = mem[k])); dirty.clear();
      try { await C.api('/api/state', { method: 'POST', body: JSON.stringify(body) }); } catch (e) { Object.keys(body).forEach((k) => dirty.add(k)); }
    },
    async pull() {
      // server copy wins for keys the browser does not have, newer stamp wins otherwise;
      // question progress merges answer by answer, so a phone and the PC never erase each other's work
      if (!C.server.ok) return 0;
      let changed = 0;
      try {
        const remote = await C.api('/api/state');
        Object.keys(remote).forEach((k) => {
          const local = C.store.get(k);
          const rs = remote[k] && remote[k]._t, ls = local && local._t;
          if (PER_ENTRY.has(k) && local && remote[k] && typeof local === 'object' && typeof remote[k] === 'object') {
            const m = mergeEntries(local, remote[k]);
            if (JSON.stringify(m) !== JSON.stringify(local)) { mem[k] = m; try { localStorage.setItem(PREFIX + k, JSON.stringify(m)); } catch (e) {} changed++; }
            if (JSON.stringify(m) !== JSON.stringify(remote[k])) dirty.add(k);
            return;
          }
          if (Array.isArray(local) && Array.isArray(remote[k])) {
            const merged = mergeLists(local, remote[k]);
            mem[k] = merged;
            try { localStorage.setItem(PREFIX + k, JSON.stringify(merged)); } catch (e) {}
            if (merged.length !== remote[k].length) dirty.add(k);
            if (merged.length !== local.length) changed++;
          } else if (local == null || (rs && (!ls || rs > ls))) {
            if (JSON.stringify(local) !== JSON.stringify(remote[k])) changed++;
            mem[k] = remote[k]; try { localStorage.setItem(PREFIX + k, JSON.stringify(remote[k])); } catch (e) {}
          }
          else if (ls && (!rs || ls > rs)) dirty.add(k);
        });
        C.store.flush();
      } catch (e) {}
      C.store.pulledAt = Date.now();
      return changed;
    },
  };
  // keys whose entries carry their own time ("at"): merged entry by entry, newest wins; "_gone" marks an undone answer
  const PER_ENTRY = new Set(['progress']);
  function mergeEntries(a, b) {
    const gone = Object.assign({}, b._gone || {});
    Object.entries(a._gone || {}).forEach(([k, t]) => { if (!(gone[k] >= t)) gone[k] = t; });
    const out = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
      if (k === '_t' || k === '_gone') return;
      const x = a[k], y = b[k];
      const pick = !x ? y : !y ? x : ((y.at || 0) > (x.at || 0) ? y : x);
      if (pick && !(gone[k] >= (pick.at || 0))) out[k] = pick;
    });
    const month = Date.now() - 30 * 864e5;
    Object.keys(gone).forEach((k) => { if (gone[k] < month) delete gone[k]; });
    if (Object.keys(gone).length) out._gone = gone;
    out._t = Math.max(a._t || 0, b._t || 0);
    return out;
  }
  C.mergeEntries = mergeEntries;
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const k = e.key.slice(PREFIX.length);
    try { mem[k] = e.newValue == null ? undefined : JSON.parse(e.newValue); } catch (err) { delete mem[k]; }
    if (mem[k] === undefined) delete mem[k];
    C.emit('store:' + k, mem[k]);
  });
  // lists (deadlines you added, chat history, quiz history) merge by id or content rather than one side replacing the other
  function mergeLists(a, b) {
    const seen = new Set(), out = [];
    // entries that are plain objects dedupe by their id or timestamp; arrays and anything else by content
    // (arrays have a built-in .at method, so x.at must be checked as a number)
    const idOf = (x) => (x && typeof x === 'object' && !Array.isArray(x) && (x.id != null || typeof x.at === 'number') ? 'k:' + (x.id != null ? x.id : x.at) : 'j:' + JSON.stringify(x));
    a.concat(b).forEach((x) => { const id = idOf(x); if (!seen.has(id)) { seen.add(id); out.push(x); } });
    return out;
  }
  C.mergeLists = mergeLists;
  window.addEventListener('beforeunload', () => { if (dirty.size && C.server.ok && navigator.sendBeacon) { const body = {}; dirty.forEach((k) => (body[k] = mem[k])); navigator.sendBeacon('/api/state', new Blob([JSON.stringify(body)], { type: 'application/json' })); } });
  C.stamp = (o) => { o._t = Date.now(); return o; };

  C.settings = () => Object.assign({ theme: 'auto', model: 'sonnet', apiModel: 'claude-sonnet-5-5', backend: 'auto', name: '', sleepNeed: 8, taskWindow: 7 }, C.store.get('settings', {}));

  // ------------------------------------------------------------ data access
  C.data = {
    courses: () => window.CARREL_COURSES || [],
    files: () => window.CARREL_FILES || [],
    vault: () => window.CARREL_VAULT || { planner: { deadlines: [], schedule: [], sessions: [], weights: {} }, alab: {}, courses: [] },
    course: (id) => (window.CARREL_COURSES || []).find((c) => c.id === id) || (C.data.vault().courses || []).find((c) => c.id === id),
    unit: (cid, uid) => { const c = C.data.course(cid); return c && c.units ? c.units.find((u) => u.id === uid) : null; },
    courseName: (id) => { const c = C.data.course(id); return c ? c.short : id === 'me' ? 'Personal' : 'Other'; },
  };
  C.slideText = null;
  C.loadSlideText = function () {
    if (C.slideText) return Promise.resolve(C.slideText);
    if (C._slideTextP) return C._slideTextP;
    C._slideTextP = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'data/slidetext.js';
      s.onload = () => { C.slideText = window.CARREL_SLIDETEXT || []; res(C.slideText); };
      s.onerror = () => { C.slideText = []; res(C.slideText); };
      document.head.appendChild(s);
    });
    return C._slideTextP;
  };

  // ------------------------------------------------------------ focus that survives innerHTML re-renders
  const FOCUS_ATTRS = ['id', 'data-k', 'data-o', 'data-c', 'data-w', 'data-d', 'data-u', 'data-mode', 'data-flag', 'data-edit', 'data-hide', 'data-review', 'data-sl', 'data-explain', 'data-teach', 'data-pane', 'data-v', 'data-a', 'data-h', 'data-copy', 'data-i', 'data-del'];
  C.focusKey = function () {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    for (const at of FOCUS_ATTRS) {
      const v = a.getAttribute(at);
      if (v != null) {
        const host = a.closest('[data-id]');
        return { at, v, host: host && host !== a ? host.dataset.id : null };
      }
    }
    return null;
  };
  C.restoreFocus = function (k, root) {
    if (!k) return;
    const sel = k.at === 'id' ? '#' + CSS.escape(k.v) : '[' + k.at + '="' + CSS.escape(k.v) + '"]';
    const scope = k.host ? (root || document).querySelector('[data-id="' + CSS.escape(k.host) + '"]') || root || document : root || document;
    const el = scope.querySelector(sel);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  };
  C.keepFocus = function (fn) { const k = C.focusKey(); const r = fn(); C.restoreFocus(k); return r; };
  // safety net for every in-place re-render: if a user action rebuilt the DOM and focus fell to <body>,
  // put it back on the same control (by id or data key), or failing that on the region's heading
  let lastKey = null, lastAct = 0;
  document.addEventListener('focusin', () => { const k = C.focusKey(); if (k) lastKey = k; });
  const keyOf = (node) => {
    const a = node && node.closest && node.closest('button, a, input, select, textarea, [tabindex]');
    if (!a) return null;
    for (const at of FOCUS_ATTRS) {
      const v = a.getAttribute(at);
      if (v != null) { const host = a.closest('[data-id]'); return { at, v, host: host && host !== a ? host.dataset.id : null }; }
    }
    return null;
  };
  ['keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, (e) => {
    lastAct = Date.now();
    lastKey = keyOf(ev === 'keydown' ? document.activeElement : e.target);
  }, true));
  new MutationObserver(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    if (!lastKey || Date.now() - lastAct > 1500) return;
    queueMicrotask(() => { if (document.activeElement === document.body) C.restoreFocus(lastKey); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // one polite status region for screen readers
  let srTimer;
  C.announce = function (msg) {
    const r = C.$('#srStatus');
    if (!r) return;
    r.textContent = '';
    clearTimeout(srTimer);
    srTimer = setTimeout(() => (r.textContent = msg), 60);
  };
  C.shortcutsOn = () => C.settings().shortcuts !== false;

  // ------------------------------------------------------------ toast with optional undo
  let toastTimer;
  C.toast = function (msg, action) {
    const t = C.$('#toast');
    t.hidden = false;
    t.innerHTML = '';
    clearTimeout(toastTimer);
    setTimeout(() => {
      t.innerHTML = '<span>' + C.esc(msg) + '</span>' + (action ? '<button type="button" class="linkbtn">' + C.esc(action.label) + '</button><button type="button" class="linkbtn" data-dismiss aria-label="Dismiss">' + '\u00d7' + '</button>' : '');
      if (action) {
        t.querySelector('button').onclick = () => { action.fn(); t.hidden = true; };
        t.querySelector('[data-dismiss]').onclick = () => (t.hidden = true);
      }
    }, 30);
    const hide = () => { if (!t.matches(':hover') && !t.contains(document.activeElement)) t.hidden = true; else toastTimer = setTimeout(hide, 2000); };
    toastTimer = setTimeout(hide, action ? 12000 : 3200);
  };

  // ------------------------------------------------------------ router: #/view/a/b?x=y
  C.routes = {};
  C.route = { view: 'today', parts: [], q: {} };
  C.parseHash = function () {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x).replace(/[<>"'`\\]/g, ''); } catch (e) { return ''; } });
    const q = {};
    // values from the URL are data: strip anything that could close an attribute or open a tag
    const clean = (x) => { try { return decodeURIComponent(x).replace(/[<>"'`\\]/g, ''); } catch (e) { return ''; } };
    (qs || '').split('&').filter(Boolean).forEach((kv) => { const i = kv.indexOf('='); q[clean(i < 0 ? kv : kv.slice(0, i))] = clean(i < 0 ? '' : kv.slice(i + 1)); });
    return { view: parts[0] || 'today', parts: parts.slice(1), q };
  };
  C.go = function (hash, replace) {
    if (!hash.startsWith('#')) hash = '#/' + hash.replace(/^\//, '');
    if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) { location.hash = hash; return; }
    C.render();
  };
  C.setQuery = function (patch) {
    const r = C.parseHash();
    Object.assign(r.q, patch);
    Object.keys(r.q).forEach((k) => (r.q[k] === '' || r.q[k] == null) && delete r.q[k]);
    const qs = Object.keys(r.q).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(r.q[k])).join('&');
    history.replaceState(null, '', '#/' + [r.view].concat(r.parts).map(encodeURIComponent).join('/') + (qs ? '?' + qs : ''));
  };
  // phones: the header's centre title and its right-hand button (the quiz puts the topic and its flag there)
  C.mhead = function (title, rightHtml) {
    const t = C.$('#mTitle'), r = C.$('#mRight');
    if (t) t.textContent = title || '';
    if (r) r.innerHTML = rightHtml || '';
  };
  C.render = function () {
    const r = (C.route = C.parseHash());
    const view = C.routes[r.view] ? r.view : 'today';
    C.$$('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === view ? 'page' : 'false'));
    const main = C.$('#main');
    if (C._lastView !== view) { main.innerHTML = ''; window.scrollTo(0, 0); }
    C._lastView = view;
    document.title = (C.routes[view].title || 'Carrel') + ' · Carrel';
    C.mhead(C.routes[view].title || 'Carrel'); // the phone header: the page's name; a view may put its own in
    const viewChanged = C._renderedOnce && C._prevView !== view;
    C._prevView = view;
    C._renderedOnce = true;
    try {
      const k = viewChanged ? null : C.focusKey();
      C.routes[view].render(main, r);
      if (viewChanged) { const h = main.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } } else C.restoreFocus(k, main);
    } catch (e) { console.error(e); main.innerHTML = '<div class="page"><div class="state"><h3>This view failed to draw</h3><p>' + C.esc(e.message) + '</p><a class="btn" href="javascript:location.reload()">Reload</a></div></div>'; }
  };
})();
