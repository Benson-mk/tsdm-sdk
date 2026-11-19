#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_PACKETS_UPSTREAM="$upstream" node scripts/check-installed-packets.mjs "$archive" > "$output/packets-installed.json"
python3 evidence/packets/check-direct-guide.py "$archive" > "$output/packets-direct.json"
sh evidence/batch-ratings/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/packets-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'batch-ratings-regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('packets-installed', 'packets-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash and report['results'], name
    for observation in report['results']:
        assert observation['expected'] == observation['actual'], observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                   'receiptSHA256': sha256(data).hexdigest()}
regressions['integrationBaseCommit'] = '8faa1c1563e058ae0dd43b09f00081f6dfa475ec'
regressions['command'] = 'sh evidence/packets/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
