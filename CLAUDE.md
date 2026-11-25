# CLAUDE.md

Carrel is a local study app for MIT Sloan MBAn students (Fall 2026): a Python standard-library server (`server.py`, port 8765), a vanilla-JS app (`app/`), and build scripts (`build/`) that turn study sets and the student's Obsidian vault into the app's data. The student opens it on their computer and, through Tailscale, on their phone. README.md is the human install guide; this file is for you.

## If the user asks you to install Carrel

Do the whole install for them, following these steps in order. The user is usually not technical: explain each thing you need from them in one plain sentence, and keep going without asking about anything you can find out yourself.

### Ground rules
- **The user does every sign-in and handles every secret themselves**: Canvas, Tailscale and Claude. Never ask them to paste a Canvas token, password or code into the chat, and never type one anywhere. The Canvas token goes into Carrel's own welcome screen, which they fill in.
- Never delete or overwrite files in their vault or in `userdata/`. The installer only adds files.
- Never commit or push anything from their copy. `carrel.config.json`, `userdata/` and `app/data/` are theirs.
- Run commands from the repository root (the folder holding this file).

### Step 1: check the computer
- OS: Windows (best supported; Carrel gets its own window) or macOS (opens in the browser).
- Python 3.9 or newer: `python --version` (Windows; also try `py --version`) or `python3 --version` (Mac). If it's missing, tell them to install it from https://www.python.org/downloads/ and, **on Windows, to tick "Add python.exe to PATH"** on the installer's first screen. Wait for them, then re-check in a new shell.
- Claude Code is present, since you are running in it. Check `claude --version` works from a normal shell; Carrel's server looks for `claude` on PATH or in `~/.local/bin`.

### Step 2: ask the user, in one message
1. Their first name (Claude uses it when tutoring).
2. Where to keep their Obsidian vault. Default: `Documents/MBAn Vault`. If they already have an MBAn vault, use its folder; Carrel only adds folders and starter notes there.
3. Windows only: should Carrel start when they sign in? (Recommended if they want it on their phone.)
4. Whether Tailscale is installed and signed in on this computer, and which account they used.

### Step 3: run the installer
```bash
python install.py --yes --name "<first name>" --vault "<vault folder>" [--startup]
```
(Use `python3` on Mac and `py` on Windows if `python` is missing.) It installs `pypdf`, writes `carrel.config.json`, creates the vault's folders, `planner.md` and `Home.md`, and the starting data. On Windows it builds `Carrel.exe` (about 2 minutes, in a private venv under `%TEMP%\cbuild`) and adds Desktop and Start-menu shortcuts; on Mac it writes `Carrel.command`. Then it checks for Claude Code and, if Tailscale is signed in, runs `tailscale serve --bg 8765`. Read its output and fix anything it reports:
- **pypdf failed:** usually no internet, or a Python without pip. Try `python -m ensurepip --upgrade`, then rerun.
- **The window build failed:** fine; the shortcut points to `Start Carrel.cmd` (browser mode). Mention it, and offer to retry `desktop\build_exe.cmd` later.
- **Tailscale not installed or not signed in:** see step 5.

### Step 4: start Carrel and check it
- Windows: start `Carrel.exe` (or `Start Carrel.cmd`). Mac: `python3 server.py`, which opens the browser.
- Check `curl -s http://127.0.0.1:8765/api/health`. You should get `{"ok": true, "claude": true, "vault": true, ...}`. `claude: false` means the server can't see Claude Code: put it on PATH and restart Carrel.
- Carrel shows a **welcome screen** on first start. Tell the user to:
  1. Enter their name and click **Next**.
  2. Click **your Canvas settings**, sign in, go to **Approved Integrations**, click **+ New Access Token** (purpose "Carrel", no expiry needed), click **Generate Token**, copy the token, paste it into Carrel, and click **Connect Canvas**.
  3. Click **Download and sort my class files**, and wait until it says **Your vault is ready** (a few minutes; a few hundred MB).
- You can watch progress with `curl -s http://127.0.0.1:8765/api/setup`: `job.state` goes running → done, and `firstSync` gets a date. When it's done, confirm the slides landed with a directory listing of `<vault>/Atlas/Resources/Lectures/*`. Each of the six class folders should have PDFs, except Analytics Lab, which has few.

### Step 5: the phone (Tailscale)
1. Tailscale on the computer: if it isn't installed, give them https://tailscale.com/download, wait, and have them sign in from the Tailscale icon. They should remember which account they used.
2. Run `tailscale serve --bg 8765` (Windows: `"C:\Program Files\Tailscale\tailscale.exe"` if it isn't on PATH; Mac: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`). If it prints a link saying HTTPS or Serve must be enabled, give the user the link: they click **Enable** in their Tailscale admin page. Then run the command again.
3. Get the address: `tailscale status --json`, take `Self.DNSName` without its trailing dot, and prefix `https://`.
4. Tell them: install Tailscale on the phone (App Store or Google Play), sign in with the same account, open the address in Safari or Chrome, then Share, **Add to Home Screen**. On iPhone, Tailscale settings, **VPN On Demand**, on, so it works away from home.
5. Optional check from the computer: `curl -s https://<address>/api/health` should answer like the local one.

### Step 6: wrap up
Tell them how to open Carrel (desktop shortcut), their phone address, and where their files are. Mention two optional extras: opening the vault in Obsidian (https://obsidian.md, "Open folder as vault"), and the nightly sync task in `docs/nightly-sync.md`, which you can set up for them as a scheduled task in the Claude desktop app if they want.

## Troubleshooting
- **Port 8765 is in use:** another Carrel is running. Close every Carrel window. On Windows, also check `Get-Process Carrel`, and stop leftovers with `Stop-Process -Name Carrel -Force`. If a relaunch shows no window, kill it and launch again.
- **A blank page on the phone, or 502s:** the computer is asleep, Carrel isn't running, or `tailscale serve` was reset. Rerun `tailscale serve --bg 8765`.
- **"Claude Code on your PC is signed out":** the user runs `claude auth login`. After that Carrel picks it up on the next message, with no restart.
- **Canvas 401, or "no longer accepts the saved token":** the user makes a new token and pastes it in Carrel's Settings, Connections.
- **The first sync failed partway:** the welcome screen's **Try again** resumes it; files already saved are skipped. Or `POST /api/setup/firstsync` (it has no body).
- **A question's slide doesn't open:** the user's copy of that deck has a different file name from the one the study set was built on. Compare `GET /api/lectures` with the `CARREL_FILES` keys in `app/data/courses.js`. The server already tries `Name (1).pdf` against `Name.pdf` and the reverse.

## How it fits together
- `build/config.py`: the six classes (`COURSES`: id, code, name, vault folder) and `LECTURE_DIRS`. It reads `carrel.config.json` (`name`, `vault`, optional `alabTeam`).
- `server.py`: serves `app/`, streams vault PDFs (`/vault/...`), live planner data (`/api/vault`), saved state (`/api/state` ↔ `userdata/state.json`), the Claude Code relay (`/api/claude`, SSE, pooled `claude -p` processes), Canvas and Outlook (`integrations.py`), and setup (`/api/setup`, `/api/setup/firstsync`).
- `build/first_run.py`: `ensure_vault()`, `ensure_app_data()` (copies `build/seed/courses.js` when `app/data/courses.js` is missing), and the first-sync job. The job downloads every Canvas file, reads the decks the seed study sets cite into `build/slides_text.json`, and rebuilds.
- `build/build_courses.py`: builds `app/data/courses.js` and `slidetext.js` from `build/decks/*.html` and `build/extra/*.json`, plus the user's own practice notes in `<vault>/Efforts/Exams`, linking every item to a slide page by TF-IDF. Carrel runs it on every start.
- `build/extract_slides.py`: per-deck slide text. A deck joins the index only when named, or with `--all`; unindexed decks show in the app as "New in the vault", ready for a study set.
- `build/vault_sources.py`: parses `planner.md` (Dueouts table, weekly schedule, sessions, grade weights), notes, and A-Lab weekly-update decks.
- Study-set format and the nightly sync: `docs/nightly-sync.md`. After editing the sets, `python build/make_seed.py` refreshes the shipped seed. It refuses to write one that contains personal-vault items.
- Tests: `node tests/logic.test.mjs`.
- Server changes need a Carrel restart. Changes under `app/` reload open windows and phones on their own: `/api/version` fingerprints the folder.
