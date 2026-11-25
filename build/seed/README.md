# Seed data

`courses.js` is the question bank a fresh install starts from: every study set in `build/decks` and `build/extra`,
already linked to slide pages. It is built **without** anyone's vault, so it holds none of the cheat sheets,
practice sets or flashcards a maintainer keeps in their own `Efforts/Exams`, and no slide text.

Regenerate it after adding or changing study sets (needs a `build/slides_text.json` that covers the decks):

    python build/make_seed.py

On a new computer, Carrel copies this file to `app/data/courses.js` on first start. After the first Canvas sync it
reads the user's own copies of the decks and rebuilds `app/data/courses.js` (and `slidetext.js`) from them.
