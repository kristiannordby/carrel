# Carrel

A study app for the MIT Sloan MBAn, Fall 2026. It runs on your own computer and opens on your phone through Tailscale.

- **Study sets for every lecture** of Optimization Methods (15.C57), ML under a Modern Optimization Lens (15.095), Analytics Edge (15.072), From Analytics to Action (15.681) and Hands-On Deep Learning (15.776): about 1,900 quiz questions, 1,800 flashcards and 230 written problems, each linked to the exact slide it comes from.
- **Your class files, sorted automatically.** Connect Canvas once and Carrel downloads every lecture deck, syllabus and handout for your six classes into an [Obsidian](https://obsidian.md) vault, one folder per class, and keeps saving new slides as they are posted.
- **Deadlines and planning**: every graded deliverable for the six classes, Canvas assignments, a calendar, tasks, an exam-day view and a study plan that schedules your weakest lectures first.
- **A Claude tutor** (optional, through Claude Code on your computer): explains any question or slide, grades your written answers, and builds a study set from any new deck.
- **Spaced repetition, mock exams, topic mastery**, and it all works offline on your phone once loaded.

Everything stays on your computer: your progress, your Canvas token and your files. Nothing is uploaded anywhere.

> **Let Claude install it for you.** If you use [Claude Code](https://docs.claude.com/en/docs/claude-code), download Carrel (step 2 below), open a terminal in the Carrel folder, run `claude`, and say *"Install Carrel for me."* It follows [CLAUDE.md](CLAUDE.md) and asks you only for what it needs.

---

## What you need

| | |
|---|---|
| A computer | Windows 10 or 11 (recommended). macOS works too; Carrel then opens in your browser instead of its own window. Keep it on while you want to use Carrel from your phone. |
| Python 3.9 or newer | Free. Step 1. |
| Your MIT Canvas account | To download your class files. |
| A Tailscale account | Free. To open Carrel on your phone, anywhere. Step 3. |
| A phone | iPhone or Android, for Carrel on the go. |
| Claude Code (optional) | For the tutor and for new study sets. Needs a Claude subscription. Step 5. |
| About 1 GB of disk | For the slides. |

---

## Install, step by step

Set aside 15 minutes. Do the steps in order.

### 1. Install Python

**Windows**
1. Go to https://www.python.org/downloads/ and click **Download Python 3.x**.
2. Open the downloaded file.
3. **On the first screen, tick "Add python.exe to PATH"** at the bottom. This matters.
4. Click **Install Now**, then **Close** when it finishes.

**Mac:** download the macOS installer from the same page, open it and click through. (Or `brew install python`.)

### 2. Download Carrel

**Easiest (no Git):**
1. On this page on GitHub, click the green **Code** button, then **Download ZIP**.
2. Open your Downloads folder, right-click **carrel-main.zip**, choose **Extract All…**, then **Extract**.
3. Move the extracted **carrel-main** folder somewhere permanent, for example `Documents`, and rename it **Carrel**. Carrel runs from this folder, so don't delete it.

**With Git:**
```bash
git clone https://github.com/kristiannordby/carrel.git
```

### 3. Install Tailscale on your computer

Tailscale gives Carrel a private web address that only your own devices can open, from anywhere: home, class or cellular. It is free for personal use.

1. Go to https://tailscale.com/download, download Tailscale for your computer, and install it.
2. Open Tailscale (Windows: the icon by the clock, possibly under the **^** arrow; Mac: the menu bar) and click **Log in**.
3. Sign in with Google, Microsoft or GitHub, and **remember which one**: your phone must use the same account.

### 4. Run the installer

**Windows:** open the Carrel folder and double-click **Install Carrel.cmd**.
- If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.

**Mac:** open Terminal, type `bash ` (with a space), drag **install.command** from the Carrel folder into the Terminal window, and press Return.

The installer asks a few questions. Press Enter to accept a suggestion.

| It asks | What to answer |
|---|---|
| Your first name | The name Claude calls you when tutoring. |
| Vault folder | Where your class files and planner go. Press Enter for `Documents\MBAn Vault`. If you already have an Obsidian vault for the MBAn, type its folder; Carrel adds its folders and never overwrites your files. |
| Build the Carrel desktop window? | **y** (Windows). It takes about 2 minutes. Without it, Carrel opens in your browser instead. |
| Start Carrel when you sign in? | **y** if you want your phone to reach Carrel any time the computer is on. |
| Share Carrel with your own devices? | **y**. |

If Tailscale prints a link and says HTTPS or Serve is not enabled: open the link, click **Enable**, and run the installer again. This is a one-time switch in your Tailscale account.

At the end it prints your private phone address, like `https://your-laptop.tail1234.ts.net`. Note it down.

### 5. Install Claude Code (recommended)

Claude Code runs the tutor ("Explain concept", "Ask Claude"), grades written answers, and builds study sets for new decks. Carrel works without it; those buttons just stay off.

**Windows:** open **PowerShell** (Start menu, type PowerShell) and paste:
```powershell
irm https://claude.ai/install.ps1 | iex
```
**Mac:** open Terminal and paste:
```bash
curl -fsSL https://claude.ai/install.sh | bash
```
Then type `claude` in the same window, press Enter, and sign in with your Claude account when the browser opens. Type `/exit` to leave. If anything differs, see https://docs.claude.com/en/docs/claude-code.

### 6. Start Carrel and connect Canvas

1. Double-click **Carrel** on your desktop (Mac: **Carrel.command**).
2. The welcome screen opens. Enter your name and click **Next**.
3. Connect Canvas:
   1. Click **your Canvas settings** in the welcome screen (it opens https://canvas.mit.edu/profile/settings) and sign in.
   2. Scroll to **Approved Integrations** and click **+ New Access Token**.
   3. Purpose: `Carrel`. Leave the expiry empty, or choose a date after finals. Click **Generate Token**.
   4. Copy the long token (Canvas shows it only once), paste it into Carrel, and click **Connect Canvas**.
4. Click **Download and sort my class files**. Carrel saves every file from your six classes into your vault, sorted:

| What | Where in your vault |
|---|---|
| Lecture slides and recitations | `Atlas/Resources/Lectures/<class>/` |
| Syllabi | `Attachments/Syllabi/` |
| Homework, solutions, handouts, data | `Efforts/Courses/<class>/` |

It then links every study set to your copy of the slides. This takes a few minutes the first time. When it says **Your vault is ready**, click **Open Carrel**.

From then on, Carrel checks Canvas while it is open and saves new lecture slides on its own (Settings, Lecture files, to see or change this).

### 7. Put Carrel on your phone

1. Install **Tailscale** from the App Store or Google Play, open it, tap **Log in**, and use **the same account** as in step 3. Allow the VPN configuration when asked.
2. Open **Safari** (iPhone) or **Chrome** (Android) and go to the address the installer printed (step 4). To see it again, double-click **Phone setup\1. Share Carrel with my phone** on Windows.
3. Add it to your home screen. iPhone: **Share** button, **Add to Home Screen**, keep **Open as Web App** on, **Add**. Android: menu, **Add to Home screen**.
4. Open Carrel from your home screen. It runs full screen like an app.

To use it away from home, keep Tailscale on. On iPhone: Tailscale settings, **VPN On Demand**, on. Your answers sync between phone and computer whenever both can reach each other. With the computer off, the phone still runs your quizzes and flashcards from its saved copy.

More detail: [Phone setup/Checklist.md](Phone%20setup/Checklist.md).

### 8. Open your vault in Obsidian (optional)

Install Obsidian from https://obsidian.md, choose **Open folder as vault**, and pick your vault folder. `planner.md` holds every deadline for the six classes. Carrel reads it, so edits there show up in Carrel's calendar and Today page.

---

## Using Carrel

- **Today**: what's due, today's classes, your review queue, and a study plan.
- **Study**: pick a class, then a lecture. Quiz, Flashcards, Written and Brief tabs. Click a question number to open its slide.
- **Calendar** and **Tasks**: every deadline from the planner and Canvas.
- Press `/` to search everything and `?` to see the keyboard shortcuts.

When Carrel finds a new deck in your vault without a study set, it lists it under **New in the vault** for that class. Click **Build the study set** (needs Claude Code).

Want this to happen overnight on its own, with new deadlines added to your planner? See [docs/nightly-sync.md](docs/nightly-sync.md).

## Updating

- **Git:** in the Carrel folder, run `git pull`, then run the installer again.
- **ZIP:** download the new ZIP and extract it. Copy `carrel.config.json` and the `userdata` folder from your old Carrel folder into the new one, replace the old folder, then run the installer again.

Your progress (`userdata/`), settings (`carrel.config.json`) and vault are never part of an update.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Python was not found" | Reinstall Python and tick **Add python.exe to PATH** (step 1). Then close and reopen any window. |
| The installer can't build the desktop window | Carrel still works: the shortcut opens it in your browser. To retry, run `desktop\build_exe.cmd`. |
| Canvas: "did not accept that token" | Make a new token (step 6) and paste it in Settings, Connections. |
| The phone can't connect | Check that Tailscale says Connected on the phone and is signed in with the same account, and that Carrel is open on the computer. |
| The phone shows a page about HTTPS or Serve | Run the installer again and click the link it prints, then **Enable**. |
| Claude buttons say "not connected" | Install Claude Code (step 5), run `claude` once to sign in, then close and reopen Carrel. |
| "Claude Code on your PC is signed out" | Run `claude auth login` in a terminal, sign in, retry. |
| A question's slide doesn't open | Your copy of that deck is missing or has a different file name. Check Settings, Lecture files, or ask Claude Code to find the deck. |
| Anything else | Open a terminal in the Carrel folder, run `claude`, and describe the problem. CLAUDE.md tells Claude how Carrel works. |

## Privacy

- Carrel's server listens only on your own computer. Through Tailscale, only devices signed in to your Tailscale account can reach it.
- Your Canvas token is stored in your user profile (`%LOCALAPPDATA%\Carrel` on Windows, `~/.carrel` on Mac), never in the Carrel folder or the vault, and is only used to read from Canvas.
- Your progress is in `userdata/`, and your files are in your vault. Neither is uploaded anywhere.
- The Claude tutor runs through your own Claude Code sign-in.

## Uninstall

Delete the Carrel folder and the Carrel shortcuts (desktop, Start menu, and `shell:startup` if you chose to start with Windows). Optionally delete `%LOCALAPPDATA%\Carrel` (Mac: `~/.carrel`). To stop sharing with your phone: `tailscale serve reset`. Your vault is yours to keep.

---

## For maintainers

```
install.py, Install Carrel.cmd, install.command   the installer
server.py              local server: the app, vault PDFs, live planner, saved state, Claude relay, setup endpoints
integrations.py        Canvas (assignments, announcements, file sync) and Outlook
app/                   the app: index.html, css/, js/ (welcome.js is the first-start flow); data/ is generated
build/config.py        the six classes, their codes and vault folders; reads carrel.config.json
build/first_run.py     vault skeleton, seed data, the first full Canvas sync and rebuild
build/build_courses.py builds app/data/courses.js from decks/ and extra/ and links every item to a slide
build/extract_slides.py reads lecture PDFs into build/slides_text.json (opt-in per deck; --all re-reads every one)
build/vault_sources.py reads planner.md, notes and A-Lab decks from the vault
build/auto_sync.py     the mechanical half of the nightly sync (docs/nightly-sync.md)
build/decks, build/extra   the study sets (extra/<class>-<id>.json, one per lecture)
build/seed/courses.js  the question bank a fresh install starts from (python build/make_seed.py)
starter-vault/         planner.md and Home.md copied into a new vault
desktop/               the desktop window (pywebview) and its exe build
tests/                 node tests/logic.test.mjs
```

- **Add or fix a study set:** edit or add `build/extra/<class>-<id>.json` (format in [docs/nightly-sync.md](docs/nightly-sync.md), step 3). Run `python build/auto_sync.py publish build/extra/<file>.json` to see it in your own Carrel, then `python build/make_seed.py` so new installs get it.
- **Checks:** `node tests/logic.test.mjs` (needs Node 18 or newer, and a vault set up by the installer).
- Personal files are kept out of git by `.gitignore`: `userdata/`, `carrel.config.json`, `app/data/` and `build/slides_text.json`. The slide text is the instructors' material: each install reads it from its own downloaded PDFs.
