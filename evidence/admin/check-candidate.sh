#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
base=52dc3362f38ae9baf3e353875ebf3f6c3f853892
prior=moderator-queues-combined
mkdir -p "$output"
git merge-base --is-ancestor "$base" HEAD
python3 - "$upstream" <<'PY'
from hashlib import sha256
import json
from pathlib import Path
import sys
pins = json.loads(Path('evidence/admin/pins.json').read_bytes())
for root, group in ((Path(sys.argv[1]), 'upstreamFiles'), (Path.cwd(), 'controlledFiles')):
    for path, digest in pins[group].items():
        assert sha256((root / path).read_bytes()).hexdigest() == digest, path
PY
node scripts/check-installed-admin.mjs "$archive" > "$output/admin-installed.json"
python3 evidence/admin/check-direct-guide.py "$archive" > "$output/admin-direct.json"
sh evidence/moderator-queues/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" "$base" "$prior" <<'PY' > "$output/admin-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys
archive, output = map(Path, sys.argv[1:3])
base, prior_name = sys.argv[3:]
digest = sha256(archive.read_bytes()).hexdigest()
prior = (output / (prior_name + '.json')).read_bytes()
summary = json.loads(prior)
assert summary['archiveSHA256'] == digest
assert all(summary['actual'][name]['status'] == 'passed' for name in summary['expected']['passingSuites'])
for name in ('admin-installed', 'admin-direct'):
    raw = (output / (name + '.json')).read_bytes()
    report = json.loads(raw)
    assert report['archiveSHA256'] == digest and report['results'], name
    for row in report['results']:
        if 'observed' in row:
            assert row['expected'] == row['observed'] and row['expectedRequests'] == row['requests'], row['name']
        else:
            assert row['expected'] == row['actual'], row['name']
    summary['expected']['passingSuites'].append(name)
    summary['actual'][name] = {'status':'passed', 'observationGroups':len(report['results']), 'receiptSHA256':sha256(raw).hexdigest()}
assert set(summary['expected']['passingSuites']) == set(summary['actual'])
summary['integrationBaseCommit'] = base
summary['adminPinsSHA256'] = sha256(Path('evidence/admin/pins.json').read_bytes()).hexdigest()
summary['priorReceiptSHA256'] = sha256(prior).hexdigest()
summary['command'] = 'sh evidence/admin/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
summary['adminLimitations'] = ['Fictional administrators, targets and transactions only.',
                               'Raw credential inputs compared in memory and omitted from receipts.',
                               'Deployment availability, permissions and persisted effects unobserved.']
print(json.dumps(summary, indent=2))
PY
