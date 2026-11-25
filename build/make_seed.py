"""Rebuild build/seed/courses.js: the shipped question bank, built without any vault (no personal notes, no slide text).

    python build/make_seed.py
"""
import os, re, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, 'seed')

with tempfile.TemporaryDirectory() as empty:
    env = dict(os.environ, CARREL_VAULT=empty, CARREL_APP_DATA=SEED)
    subprocess.run([sys.executable, os.path.join(HERE, 'build_courses.py')], cwd=HERE, env=env, check=True)
# the slide text is the instructors' material: each install reads it from its own downloaded PDFs
os.remove(os.path.join(SEED, 'slidetext.js'))
text = open(os.path.join(SEED, 'courses.js'), encoding='utf8').read()
leaks = re.findall(r'"mine":true|Efforts/Exams/', text)
if leaks:
    sys.exit('seed contains %d items from a personal vault; not safe to ship' % len(leaks))
print('build/seed/courses.js: %d KB' % (len(text) // 1024))
