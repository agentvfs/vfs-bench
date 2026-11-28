"""Verify the original public input Sheet before publishing its CSV."""
import csv
import hashlib
import io
import json
import subprocess
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    source = json.loads((HERE / 'nhl.source.json').read_text())
    upstream = HERE.parents[3] / 'submodule/Toolathlon'
    preprocess = subprocess.check_output([
        'git', '-C',
        str(upstream), 'show',
        'HEAD:tasks/finalpool/nhl-b2b-analysis/preprocess/main.py'
    ])
    if hashlib.sha256(
            preprocess).hexdigest() != source['upstream_preprocess_sha256']:
        raise RuntimeError('Upstream NHL source declaration changed')
    with urllib.request.urlopen(source['url'], timeout=30) as response:
        raw = response.read()
    if hashlib.sha256(raw).hexdigest() != source['source_sha256']:
        raise RuntimeError(
            'Original NHL Sheet changed; review before refreshing')
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
    output = io.StringIO(newline='')
    csv.writer(output, lineterminator='\n').writerows(rows)
    data = output.getvalue().encode()
    if hashlib.sha256(data).hexdigest() != source['fixture_sha256']:
        raise RuntimeError('NHL capture normalization changed')
    (HERE / 'nhl.csv').write_bytes(data)
    print(f'Verified {len(rows) - 1} original NHL schedule rows')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
