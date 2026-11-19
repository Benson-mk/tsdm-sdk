#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_AWARDS_UPSTREAM="$upstream" node scripts/check-installed-awards.mjs "$archive" > "$output/awards-installed.json"
python3 evidence/awards/check-direct-guide.py "$archive" > "$output/awards-direct.json"
sh evidence/tasks/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/awards-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'tasks-regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('awards-installed', 'awards-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash and report['results'], name
    for observation in report['results']:
        assert observation['expected'] == observation['actual'], observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                   'receiptSHA256': sha256(data).hexdigest()}
regressions['integrationBaseCommit'] = '0c004cc5aafe3e91ee885872a77a2e1f1967f7c5'
regressions['command'] = 'sh evidence/awards/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
