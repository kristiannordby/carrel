"""Paths and course registry shared by the build scripts and the local server.

Your own settings live in carrel.config.json next to server.py (written by install.py, never committed):
    {"name": "Alex Smith", "vault": "C:\\Users\\alex\\Documents\\MBAn Vault", "alabTeam": ["Sam", "Priya"]}
CARREL_VAULT and CARREL_NAME override them.
"""
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_CONFIG = os.path.join(ROOT, 'carrel.config.json')
try:
    with open(LOCAL_CONFIG, encoding='utf8') as _f:
        LOCAL = json.load(_f)
except (OSError, ValueError):
    LOCAL = {}

VAULT = os.environ.get('CARREL_VAULT') or LOCAL.get('vault') or os.path.join(os.path.expanduser('~'), 'Documents', 'MBAn Vault')
NAME = (os.environ.get('CARREL_NAME') or LOCAL.get('name') or '').strip()
FIRST_NAME = NAME.split()[0] if NAME else ''
ALAB_TEAM = [n for n in LOCAL.get('alabTeam') or [] if isinstance(n, str)]  # teammates' names as they head the weekly-goals slide

# vault lecture folder -> course id
LECTURE_DIRS = {
    'Advanced Analytics Edge': '072',
    'ML Opt': '095',
    'Optimization Methods': 'c57',
    'Analytics Lab': 'alab',
    'From Analytics to Action': 'faa',
    'HODL': 'hodl',
}

COURSES = [
    {'id': 'c57', 'code': '15.C57', 'name': 'Optimization Methods', 'short': 'Opt Methods', 'tag': 'OM',
     'planner': 'Optimization Methods', 'lectures': 'Optimization Methods', 'efforts': 'Optimization Methods'},
    {'id': '095', 'code': '15.095', 'name': 'ML under Optimization', 'short': 'ML Ops', 'tag': 'MLOps',
     'planner': 'ML Ops', 'lectures': 'ML Opt', 'efforts': 'ML Opt'},
    {'id': '072', 'code': '15.072', 'name': 'Advanced Analytics Edge', 'short': 'Analytics Edge', 'tag': 'AAE',
     'planner': 'Advanced Analytics Edge', 'lectures': 'Advanced Analytics Edge', 'efforts': 'Advanced Analytics Edge'},
    {'id': 'alab', 'code': '15.572', 'name': 'Analytics Lab', 'short': 'A-Lab', 'tag': 'ALab',
     'planner': 'Analytics Lab', 'lectures': 'Analytics Lab', 'efforts': 'Analytics Lab'},
    {'id': 'faa', 'code': '15.681', 'name': 'From Analytics to Action', 'short': 'Analytics to Action', 'tag': 'FAA',
     'planner': 'From Analytics to Action', 'lectures': 'From Analytics to Action', 'efforts': 'From Analytics to Action'},
    # Canvas lists it as 15.776; the syllabus header says 15.773
    {'id': 'hodl', 'code': '15.776', 'alias': ['15.773'], 'name': 'Hands-On Deep Learning', 'short': 'HODL', 'tag': 'HODL',
     'planner': 'Hands-On Deep Learning', 'lectures': 'HODL', 'efforts': 'HODL'},
]
COURSE_BY_PLANNER = {c['planner']: c['id'] for c in COURSES}
COURSE_BY_TAG = {c['tag']: c['id'] for c in COURSES}

# Date changes the planner does not have yet. Keyed by (course id, item text prefix).
OVERRIDES = [
    {'course': '095', 'match': 'Midterm I', 'date': '2026-11-04',
     'note': 'Moved from Mon 11/02 to Wed 11/04.'},
]
