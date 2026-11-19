#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_BATCH_RATINGS_UPSTREAM="$upstream" node scripts/check-installed-batch-ratings.mjs "$archive" > "$output/batch-ratings-installed.json"
python3 evidence/batch-ratings/check-direct-guide.py "$archive" > "$output/batch-ratings-direct.json"
sh evidence/awards/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/batch-ratings-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'awards-regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('batch-ratings-installed', 'batch-ratings-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash and report['results'], name
    for observation in report['results']:
        assert observation['expected'] == observation['observed'], observation['name']
        if 'expectedRequests' in observation:
            assert observation['expectedRequests'] == observation['requests'], observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                   'receiptSHA256': sha256(data).hexdigest()}
regressions['integrationBaseCommit'] = 'dc865189a576ea7ed504e6fb594071c5e6c77930'
regressions['command'] = 'sh evidence/batch-ratings/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
