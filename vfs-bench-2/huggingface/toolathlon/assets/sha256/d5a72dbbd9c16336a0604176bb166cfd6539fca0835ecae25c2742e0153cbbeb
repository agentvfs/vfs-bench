"""Capture the public Hub candidates used for the task's ranking decision."""
import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
URL = ('https://huggingface.co/api/datasets?search=DeepScaleR'
       '&sort=downloads&direction=-1&limit=100&full=true')


def main():
    pages = []
    url = URL
    while url:
        with urllib.request.urlopen(url, timeout=60) as response:
            payload = response.read()
            link = response.headers.get('Link', '')
        pages.append({
            'url': url,
            'sha256': hashlib.sha256(payload).hexdigest(),
            'body': json.loads(payload)
        })
        url = None
        for part in link.split(','):
            if 'rel="next"' in part:
                url = part.split('<', 1)[1].split('>', 1)[0]
    snapshot = {
        'captured_at': datetime.now(timezone.utc).isoformat(),
        'pages': pages
    }
    (HERE / 'search.json').write_text(json.dumps(snapshot, indent=2) + '\n')
    print(f"Captured {sum(len(page['body']) for page in pages)} candidates")


if __name__ == '__main__':
    main()
