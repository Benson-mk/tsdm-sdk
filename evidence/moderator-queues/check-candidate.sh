#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
base=dfdaf112b595fb7c262e83efe30e0a31278b3023
git merge-base --is-ancestor "$base" HEAD
mkdir -p "$output"
python3 - "$upstream" <<'PY'
from hashlib import sha256
import json
from pathlib import Path
import sys
pins = json.loads(Path('evidence/moderator-queues/pins.json').read_bytes())
for name, digest in pins['files'].items():
    assert sha256((Path(sys.argv[1]) / name).read_bytes()).hexdigest() == digest, name
PY
node scripts/check-installed-moderator-queues.mjs "$archive" > "$output/moderator-queues-installed.json"
python3 evidence/moderator-queues/check-direct-guide.py "$archive" > "$output/moderator-queues-direct.json"
sh evidence/moderation/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" "$base" <<'PY' > "$output/moderator-queues-combined.json"
from hashlib import sha256
import json
from pathlib import Path
import sys
archive, output = map(Path, sys.argv[1:3])
base = sys.argv[3]
digest = sha256(archive.read_bytes()).hexdigest()
prior = (output / 'moderation-regressions.json').read_bytes()
summary = json.loads(prior)
assert summary['archiveSHA256'] == digest
assert all(summary['actual'][name]['status'] == 'passed' for name in summary['expected']['passingSuites'])
for name in ['moderator-queues-installed', 'moderator-queues-direct']:
    raw = (output / (name + '.json')).read_bytes()
    data = json.loads(raw)
    assert data['archiveSHA256'] == digest and data['results'], name
    for row in data['results']:
        assert row['expected'] == row['actual'], (name,row['name'])
    summary['expected']['passingSuites'].append(name)
    summary['actual'][name] = {'status':'passed','observationGroups':len(data['results']),
                               'receiptSHA256':sha256(raw).hexdigest()}
assert set(summary['expected']['passingSuites']) == set(summary['actual'])
pins = Path('evidence/moderator-queues/pins.json').read_bytes()
summary['upstreamCommit'] = json.loads(pins)['upstreamCommit']
summary['moderatorPanelPinsSHA256'] = sha256(pins).hexdigest()
summary['priorModerationReceiptSHA256'] = sha256(prior).hexdigest()
summary['integrationBaseCommit'] = base
summary['command'] = 'sh evidence/moderator-queues/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
summary['moderatorPanelLimitations'] = ['Fictional moderator, administrator and targets only',
    'Installed handoff carries target selection, no credential or effect',
    'Separate fictional administrator HTTP host observes the deletion receipt',
    'Deployment availability, permissions and persisted effects unobserved']
print(json.dumps(summary, indent=2))
PY
