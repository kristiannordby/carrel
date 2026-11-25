"""Carrel as a desktop app: the local server plus a native window (WebView2), no browser tab.

Packaged by desktop/build_exe.cmd into Carrel.exe, which sits beside app/, build/ and server.py and runs
them from disk, so changes to the app take effect without rebuilding the exe. Only the Python runtime and
the window library live inside it.

    python desktop/carrel_desktop.py     (the same thing, unpackaged)
"""
import os, sys, io, threading, contextlib

# stdlib modules server.py and build/*.py import; named here so the packager bundles them
import json, re, math, html, zipfile, hashlib, datetime, shutil, subprocess, mimetypes, time, webbrowser  # noqa: F401
import email.utils, urllib.parse, urllib.request, http.server, collections, ctypes  # noqa: F401
if os.name == 'nt':
    import ctypes.wintypes, msvcrt  # noqa: F401
import pypdf  # noqa: F401
import webview

ROOT = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT, os.path.join(ROOT, 'build')]

LOADING = """<!doctype html><meta charset="utf-8"><title>Carrel</title>
<style>:root{--paper:#f6f1e7;--ink:#1d2b2c;--muted:#6b6f72}
@media (prefers-color-scheme: dark){:root{--paper:#11161f;--ink:#ece6da;--muted:#a4a9b3}}
html,body{height:100%;margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
body{display:grid;place-items:center}p{margin:0}p+p{color:var(--muted);font-size:14px}</style>
<div><p>Carrel</p><p id="m">Reading your practice notes from the vault…</p></div>"""

FAILED = """<!doctype html><meta charset="utf-8"><style>body{font:16px/1.5 system-ui,sans-serif;margin:3rem;max-width:40rem}</style>
<h1>Carrel could not start</h1><p>%s</p><p>Carrel has to stay in the folder with app, build and server.py.</p>"""


def boot(window, state):
    if not os.path.exists(os.path.join(ROOT, 'server.py')):
        window.load_html(FAILED % ('server.py was not found next to Carrel.exe.'))
        return
    # refresh question sets from the vault, as Start Carrel.cmd does; on failure the last build is kept
    try:
        import build_courses
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            build_courses.main()
    except Exception:
        pass
    window.evaluate_js("document.getElementById('m').textContent = 'Starting…'")
    try:
        import server
        os.makedirs(server.USERDATA, exist_ok=True)
        srv = None
        for port in range(server.PORT, server.PORT + 10):
            try:
                srv = server.Server(('127.0.0.1', port), server.Handler)
                break
            except OSError:
                continue
        if srv is None:
            raise RuntimeError('Ports %d to %d are all in use.' % (server.PORT, server.PORT + 9))
    except Exception as e:
        window.load_html(FAILED % html.escape(str(e)))
        return
    state.update(server=server, srv=srv)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    if server.CLAUDE:
        server.POOL.warm('sonnet', server.WARM_SYSTEM)
    window.load_url('http://127.0.0.1:%d/' % srv.server_address[1])


def main():
    state = {}
    webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
    webview.settings['ALLOW_DOWNLOADS'] = True
    window = webview.create_window('Carrel', html=LOADING, width=1360, height=900, min_size=(380, 520), background_color='#F6F1E7', text_select=True)
    # a fixed profile keeps the window's storage between launches; kept out of OneDrive, which syncs its
    # locked files badly (your progress itself is also saved to userdata/state.json by the server)
    profile = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~/Library/Application Support'), 'Carrel', 'webview')
    webview.start(boot, (window, state), private_mode=False, storage_path=profile)
    if state.get('srv'):
        state['srv'].shutdown()
        state['server'].POOL.close()


if __name__ == '__main__':
    main()
