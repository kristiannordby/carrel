# Optional: a nightly class sync with Claude

Carrel already saves new lecture slides from Canvas while it is open. This optional scheduled task goes further, once
a night: it saves every new Canvas file for each class, adds new deadlines from those files and Canvas to your
`planner.md`, and writes a Carrel study set (questions, flashcards, written problems) for each new lecture deck.

It needs the **Claude desktop app** (scheduled tasks run while the app is open), Claude Code, and a finished Carrel
install with Canvas connected.

## Set it up

1. In the Claude desktop app, open **Scheduled** in the sidebar and create a new task (or ask Claude Code:
   *"create a scheduled task that runs every day at 9 PM with the prompt in docs/nightly-sync.md"*).
2. Schedule: every day at 21:00.
3. Working folder: your Carrel folder.
4. Prompt: copy everything below the line, and replace the three `<...>` placeholders.

---

You keep <YOUR NAME>'s MIT Sloan MBAn class materials in sync. Three jobs, in order: (1) pull every new Canvas file for each class into their Obsidian vault, (2) update the vault's planner from what those files and Canvas say, (3) write a Carrel study set for each new lecture deck. Work without asking questions; finish with a short report.

## Places
- Carrel app (local study app): <CARREL FOLDER, e.g. C:\Users\you\Documents\Carrel> — run commands from this folder. Its server is http://127.0.0.1:8765.
- Obsidian vault: <VAULT FOLDER, as in carrel.config.json>

Courses (Carrel id → code, name, planner "Course" column, vault folder name under Atlas/Resources/Lectures/ and Efforts/Courses/, Tasks tag, short name):
- c57 → 15.C57 Optimization Methods | "Optimization Methods" | Optimization Methods | #OM | OM
- 095 → 15.095 ML under a Modern Optimization Lens | "ML Ops" | ML Opt | #MLOps | MLO
- 072 → 15.072 Advanced Analytics Edge (ended 10/21) | "Advanced Analytics Edge" | Advanced Analytics Edge | #AAE | AAE
- alab → 15.572 Analytics Lab | "Analytics Lab" | Analytics Lab | #ALab | ALab
- faa → 15.681 From Analytics to Action | "From Analytics to Action" | From Analytics to Action | #FAA | FAA
- hodl → 15.776 Hands-On Deep Learning (half-semester from 11/2) | "Hands-On Deep Learning" | HODL | #HODL | HODL

## 1. Sync files
Run: `python build/auto_sync.py sync`
It starts Carrel if needed, syncs Canvas, saves every new or changed Canvas file into the vault (slides → Atlas/Resources/Lectures/<folder>, syllabi → Attachments/Syllabi, everything else → Efforts/Courses/<folder>), and prints a JSON report (also saved as auto_sync/report.json in Carrel's local data folder) with: `saved` (path, course, kind), `failed`, `canvas_error`, `deadlines` (per course: upcoming Canvas items next to the planner's deadlines), `study_sets_needed`, `study_sets_later`.
- If it exits with "Carrel did not start", or `canvas_error` says the token was rejected, stop and report that (a new Canvas token goes in Carrel's Settings).
- Never delete, move or rename files in the vault, except that you may move a file the script saved into the wrong course folder.

## 2. Update the vault
Read `planner.md` (vault root) first; it is the single source of truth for graded deliverables. Its sections: `## Dueouts` (one table, all courses, sorted by date; columns Due Date "YYYY-MM-DD (Ddd)" | Item | Course | Priority | Notes; bold the Item for major graded milestones), `## Task index` (every Dueouts row mirrored as `- [ ] <short name>: <item> 📅 YYYY-MM-DD #Tag` with ⏫ for High), weekly schedule, non-recurring sessions, grade weights, standing rules, sources.
For each course in the report:
- Read the new non-lecture files the script saved (`kind` "other" or "syllabus"; PDFs with `python -c "import pypdf; ..."`, .docx/.pptx via zipfile) and the Canvas items in `deadlines`.
- A graded deliverable or exam that is not in Dueouts (match by meaning and a date within ~3 days, not exact wording): add a Dueouts row in date order (re-sort; never append at the end) AND its Task-index checkbox. If the vault has a `Dashboard.md` with a month grid, add it to the matching day cell too. Notes column: where the info came from (e.g. "Per Canvas assignment, 120 pts" or "Per HW4.pdf"), plus anything practical.
- A date that conflicts with an existing row: do NOT change the row; list the conflict in your report.
- Ignore ungraded items, attendance check-ins, class-session calendar events, and anything already past.
- A new syllabus: fill in missing schedule, grade weights, standing rules and a `## Sources` wikilink, the way the existing courses are written.
Style: terse, technical; Obsidian wikilinks `[[path|alias]]`; markdown tables. Keep the file's line endings and UTF-8. Do not touch `.obsidian/`, `Archive/`, `Templates/`.

## 3. Write study sets
For each entry in `study_sets_needed` (at most 3; the rest are in `study_sets_later` for the next run), read its `slide_text` file (pages tagged [p.N]) and write a set to `build/extra/<course>-<id>.json` in the Carrel folder:
```
{"id": "l7", "label": "L7", "title": "lecture title", "short": "2-4 words", "src": "<exact PDF file name>",
 "brief": "4-6 sentence summary", "kp": ["8-10 one-line key points"],
 "topics": [{"n": "name", "x": "2-3 sentence explanation"}],
 "cards": [{"f": "front", "b": "back", "x": "one-line intuition or trap", "t": 0, "ref": "<exact PDF file name> p.N"}],
 "quiz": [{"q": "question", "o": ["correct", "wrong", "wrong", "wrong"], "a": 0, "e": "why the right one is right and why the tempting wrong one fails", "d": "easy|medium|hard", "t": 0, "src": "<exact PDF file name> p.N"}],
 "written": [{"q": "exam-style open question", "m": "model answer", "k": ["rubric points"], "t": 0}]}
```
- id/label from the deck: lecture N → "lN"/"LN", recitation N → "rN"/"RN", a pre-read for lecture N → "pN"/"PN"; never reuse an id listed in `unit_ids_taken`. `src` must be the exact file name (with its extension).
- 4-7 topics in lecture order; 12-16 cards; 15-18 quiz questions with the correct option FIRST (Carrel shuffles), about 30% easy / 45% medium / 25% hard, several needing a small calculation or formulation step; 2 written questions. `t` is a topic index. Every card and quiz item cites the page it comes from.
- Ground everything in the slide text only; skip what the text does not support. LaTeX between $...$ (escape backslashes for JSON). Write to the standard of a strong TA preparing students for a closed-book exam.
- Validate each file with `python -c "import json; json.load(open(r'<file>', encoding='utf8'))"`.
Then run: `python build/auto_sync.py publish build/extra/<file1>.json [build/extra/<file2>.json ...]`. Its last lines print per-course unit counts; confirm each course you wrote for gained a set. If it fails, fix the JSON and rerun; never edit Carrel's code.

## Report
End with a short plain summary: files saved per course (and any failed), planner rows added (date, course, item), conflicts to check, study sets built (course, label, title, question count), and decks left for the next run. If nothing was new, say so in one line.
