"""Print the extracted text of one lecture PDF, page by page: python dump_pages.py Lecture12.pdf"""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(here, 'slides_text.json'), encoding='utf8'))
for k, v in S.items():
    if v['file'].lower() == sys.argv[1].lower():
        for i, t in enumerate(v['pages'], 1):
            print(f'===== {v["file"]} p.{i}\n{t}\n')
