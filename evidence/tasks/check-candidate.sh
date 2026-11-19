#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
node evidence/tasks/fixture-pins.mjs "$upstream"
node scripts/check-installed-tasks.mjs "$archive" > "$output/tasks-installed.json"
python3 evidence/tasks/check-direct-guide.py "$archive" > "$output/tasks-direct.json"
sh evidence/credits/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/tasks-regressions.json"
import hashlib
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('credits-installed', 'credits-direct', 'tasks-installed', 'tasks-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash, name
    for observation in report['results']:
        assert observation['expected'] == (observation['observed'] if 'observed' in observation else observation['actual']), observation['name']
        if 'expectedRequests' in observation:
            assert observation['expectedRequests'] == observation['requests'], observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                  'receiptSHA256': hashlib.sha256(data).hexdigest()}
regressions['integrationBaseCommit'] = 'd0ef01226afa66d95f26383506773e734579c6ac'
regressions['command'] = 'sh evidence/tasks/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
