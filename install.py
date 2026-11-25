"""Carrel installer. Run it once after downloading Carrel; run it again any time to repair or change settings.

    python install.py                       asks a few questions
    python install.py --yes --name "Alex"   no questions; defaults for the rest (what Claude Code uses)

Options:
    --name NAME          your first name (Claude uses it when tutoring you)
    --vault PATH         your Obsidian vault folder (default: Documents/MBAn Vault; an existing vault is fine)
    --yes                accept the defaults for every question
    --no-window          skip building the Carrel desktop window (Windows); Carrel then opens in your browser
    --startup            start Carrel when you sign in to Windows
    --no-tailscale       skip sharing Carrel to your phone through Tailscale
    --no-shortcuts       don't add desktop / Start-menu / startup shortcuts (for a second, test copy)

It installs one Python package (pypdf), writes carrel.config.json, creates the vault's folders and starter notes,
puts a Carrel shortcut on your desktop, and shares Carrel with your phone through Tailscale if Tailscale is set up.
It never deletes or overwrites your files.
"""
import os, sys, json, shutil, argparse, subprocess, platform

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ROOT, 'carrel.config.json')
WIN, MAC = os.name == 'nt', sys.platform == 'darwin'
PORT = 8765


def say(msg=''):
    print(msg, flush=True)


def step(n, title):
    say('\n[%d] %s' % (n, title))


def ask(prompt, default, auto):
    if auto:
        say('    %s %s' % (prompt, default))
        return default
    try:
        got = input('    %s [%s] ' % (prompt, default)).strip()
    except EOFError:
        got = ''
    return got or default


def yes(prompt, default, auto):
    a = ask(prompt + (' (Y/n)' if default else ' (y/N)'), 'y' if default else 'n', auto)
    return a.lower().startswith('y')


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def desktop_dir():
    if WIN:
        r = run(['powershell', '-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"])
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return os.path.join(os.path.expanduser('~'), 'Desktop')


def shortcut(path, target, workdir, minimized=False):
    ps = ("$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('%s'); $s.TargetPath = '%s'; "
          "$s.WorkingDirectory = '%s'; $s.IconLocation = '%s'; %s$s.Save()") % (
        path.replace("'", "''"), target.replace("'", "''"), workdir.replace("'", "''"),
        os.path.join(ROOT, 'desktop', 'carrel.ico').replace("'", "''"), '$s.WindowStyle = 7; ' if minimized else '')
    return run(['powershell', '-NoProfile', '-Command', ps]).returncode == 0


def find_tailscale():
    for c in [shutil.which('tailscale'), r'C:\Program Files\Tailscale\tailscale.exe',
              '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']:
        if c and os.path.exists(c):
            return c
    return None


def main():
    p = argparse.ArgumentParser(description='Install Carrel.')
    p.add_argument('--name')
    p.add_argument('--vault')
    p.add_argument('--yes', action='store_true')
    p.add_argument('--no-window', action='store_true')
    p.add_argument('--startup', action='store_true')
    p.add_argument('--no-tailscale', action='store_true')
    p.add_argument('--no-shortcuts', action='store_true')
    a = p.parse_args()
    auto = a.yes

    say('Carrel installer')
    say('================')
    if sys.version_info < (3, 9):
        sys.exit('Carrel needs Python 3.9 or newer; this is %s. Install it from https://www.python.org/downloads/' % platform.python_version())

    # 1. the one Python package the server needs
    step(1, 'Installing pypdf (reads lecture PDFs)')
    r = run([sys.executable, '-m', 'pip', 'install', '--user', '--upgrade', '--quiet', 'pypdf'])
    if r.returncode != 0:
        r = run([sys.executable, '-m', 'pip', 'install', '--upgrade', '--quiet', 'pypdf'])
    if r.returncode != 0:
        say(r.stderr[-800:])
        sys.exit('Could not install pypdf. Check your internet connection and run the installer again.')
    say('    done')

    # 2. you, and your vault
    step(2, 'Your name and your Obsidian vault')
    cfg = {}
    if os.path.exists(CONFIG):
        try:
            cfg = json.load(open(CONFIG, encoding='utf8'))
        except ValueError:
            cfg = {}
    name = a.name or ask('Your first name:', cfg.get('name') or os.environ.get('USERNAME') or os.environ.get('USER') or 'Student', auto and not a.name)
    default_vault = cfg.get('vault') or os.path.join(os.path.expanduser('~'), 'Documents', 'MBAn Vault')
    say('    Carrel keeps your lecture slides, files and planner in a folder you can open in Obsidian.')
    say('    Already have an MBAn vault? Give its folder. Otherwise press Enter for the default.')
    vault = os.path.abspath(os.path.expanduser(a.vault or ask('Vault folder:', default_vault, auto and not a.vault)))
    cfg.update(name=name.strip(), vault=vault)
    with open(CONFIG, 'w', encoding='utf8') as f:
        json.dump(cfg, f, indent=1, ensure_ascii=False)
    say('    saved %s' % os.path.relpath(CONFIG, ROOT))

    # 3. the vault's folders, starter notes and the app's starting data
    step(3, 'Setting up the vault and the study sets')
    os.environ['CARREL_VAULT'] = vault
    sys.path[:0] = [ROOT, os.path.join(ROOT, 'build')]
    import first_run, vault_sources
    made = first_run.ensure_vault(vault)
    first_run.ensure_app_data()
    try:
        vault_sources.write_js()
    except Exception as e:
        say('    (planner not read yet: %s)' % e)
    say('    vault ready at %s%s' % (vault, (' (added %s)' % ', '.join(made)) if made else ''))

    # 4. a way to open Carrel
    step(4, 'Creating the Carrel shortcut')
    launch = None
    if WIN:
        exe = os.path.join(ROOT, 'Carrel.exe')
        if not os.path.exists(exe) and not a.no_window and yes('Build the Carrel desktop window? (about 2 minutes, recommended)', True, auto):
            say('    building Carrel.exe ...')
            r = run(['cmd', '/c', os.path.join(ROOT, 'desktop', 'build_exe.cmd')], cwd=ROOT)
            if r.returncode != 0 or not os.path.exists(exe):
                say('    could not build the window (%s); Carrel will open in your browser instead.' % (r.stdout + r.stderr).strip()[-300:])
        launch = exe if os.path.exists(exe) else os.path.join(ROOT, 'Start Carrel.cmd')
        if a.no_shortcuts:
            say('    no shortcuts (--no-shortcuts); start Carrel with %s' % launch)
        ok = not a.no_shortcuts and shortcut(os.path.join(desktop_dir(), 'Carrel.lnk'), launch, ROOT)
        menu = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        if os.path.isdir(menu) and not a.no_shortcuts:
            shortcut(os.path.join(menu, 'Carrel.lnk'), launch, ROOT)
        if not a.no_shortcuts:
            say('    %s' % ('Carrel is on your desktop and in the Start menu.' if ok else 'Could not make a shortcut; open %s directly.' % launch))
        if not a.no_shortcuts and (a.startup or (not auto and yes('Start Carrel when you sign in to Windows? (lets your phone reach it any time)', True, False))):
            startup = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Carrel.lnk')
            say('    %s' % ('Carrel will start when you sign in.' if shortcut(startup, launch, ROOT, minimized=True) else 'Could not add the startup shortcut.'))
    else:
        launch = os.path.join(ROOT, 'Carrel.command')
        with open(launch, 'w') as f:
            f.write('#!/bin/bash\ncd "$(dirname "$0")"\nexec "%s" server.py\n' % sys.executable)
        os.chmod(launch, 0o755)
        link = os.path.join(desktop_dir(), 'Carrel.command')
        if not os.path.exists(link) and not a.no_shortcuts:
            try:
                os.symlink(launch, link)
            except OSError:
                pass
        say('    double-click Carrel.command (on your desktop and in this folder) to start Carrel; it opens in your browser.')

    # 5. Claude Code, for the tutor and the study-set builder
    step(5, 'Checking for Claude Code (the AI tutor)')
    claude = shutil.which('claude') or next((c for c in (os.path.expanduser(r'~\.local\bin\claude.exe'), os.path.expanduser('~/.local/bin/claude')) if os.path.exists(c)), None)
    if claude:
        r = run([claude, '--version'])
        say('    found Claude Code %s. If you have not yet, sign in once: run  claude  in a terminal and follow the prompts.' % r.stdout.strip())
    else:
        say('    not found. Carrel works without it, but the tutor and "Build a study set" need it.')
        say('    Install: https://docs.claude.com/en/docs/claude-code (then run  claude  once to sign in).')

    # 6. Tailscale, for the phone
    ts_url = None
    step(6, 'Sharing Carrel with your phone (Tailscale)')
    ts = None if a.no_tailscale else find_tailscale()
    if a.no_tailscale:
        say('    skipped.')
    elif not ts:
        say('    Tailscale is not installed. Install it from https://tailscale.com/download and sign in, then run')
        say('    the installer again (or see "Use Carrel on your phone" in the README).')
    else:
        r = run([ts, 'status', '--json'])
        try:
            st = json.loads(r.stdout)
        except ValueError:
            st = {}
        if st.get('BackendState') != 'Running':
            say('    Tailscale is installed but not signed in. Open Tailscale, sign in, then run the installer again.')
        elif auto or yes('Share Carrel with your own devices at a private https address?', True, False):
            r = run([ts, 'serve', '--bg', str(PORT)])
            out = (r.stdout + r.stderr).strip()
            if r.returncode == 0:
                ts_url = 'https://' + (st.get('Self') or {}).get('DNSName', '').rstrip('.')
                say('    shared at %s (only devices signed in to your Tailscale account can open it)' % ts_url)
            else:
                say('    Tailscale needs one click first: open the link below, click Enable, then run the installer again.')
                say('    ' + out[-400:])

    say('\nDone.')
    say('  1. Open Carrel from the shortcut. It will ask you to connect Canvas, then download and sort')
    say('     every lecture deck and class file into %s.' % vault)
    if ts_url:
        say('  2. On your phone: install Tailscale, sign in with the same account, open %s in Safari,' % ts_url)
        say('     then Share > Add to Home Screen.')
    say('  Instructions and troubleshooting: README.md')


if __name__ == '__main__':
    main()
