#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
python3 - "$upstream" <<'PY'
from hashlib import sha256
import json
from pathlib import Path
import sys

pins = json.loads(Path('evidence/bank/pins.json').read_bytes())
for root, group in ((Path(sys.argv[1]), 'upstreamFiles'), (Path.cwd(), 'controlledFiles')):
    for path, digest in pins[group].items():
        assert sha256((root / path).read_bytes()).hexdigest() == digest, path
PY
node scripts/check-installed-bank.mjs "$archive" > "$output/bank-installed.json"
python3 evidence/bank/check-direct-guide.py "$archive" > "$output/bank-direct.json"
sh evidence/packets/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/bank-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'packets-regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('bank-installed', 'bank-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash and report['results'], name
    for observation in report['results']:
        observed = observation['observed'] if name == 'bank-installed' else observation['actual']
        assert observation['expected'] == observed, observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                   'receiptSHA256': sha256(data).hexdigest()}
assert set(regressions['expected']['passingSuites']) == set(regressions['actual'])
regressions['integrationBaseCommit'] = '71e5b5f58842b2f7df08e344555a33b34b2d8074'
regressions['command'] = 'sh evidence/bank/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
