#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
base=f2f1888832c95dbf9738cddd0c58260208c4ef14
mkdir -p "$output"
git merge-base --is-ancestor "$base" HEAD
python3 - "$upstream" <<'PY'
from hashlib import sha256
import json
from pathlib import Path
import sys
pins = json.loads(Path('evidence/moderator-settings/pins.json').read_bytes())
for root, group in ((Path(sys.argv[1]), 'upstreamFiles'), (Path.cwd(), 'controlledFiles')):
    for path, digest in pins[group].items():
        assert sha256((root / path).read_bytes()).hexdigest() == digest, path
PY
node scripts/check-installed-moderator-settings.mjs "$archive" > "$output/moderator-settings-installed.json"
python3 evidence/moderator-settings/check-direct-guide.py "$archive" > "$output/moderator-settings-direct.json"
sh evidence/admin/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" "$base" <<'PY' > "$output/moderator-settings-combined.json"
from hashlib import sha256
import json
from pathlib import Path
import sys
archive, output = map(Path, sys.argv[1:3])
base = sys.argv[3]
digest = sha256(archive.read_bytes()).hexdigest()
prior = (output / 'admin-regressions.json').read_bytes()
summary = json.loads(prior)
assert summary['archiveSHA256'] == digest
assert all(summary['actual'][name]['status'] == 'passed' for name in summary['expected']['passingSuites'])
for name in ['moderator-settings-installed', 'moderator-settings-direct']:
    raw = (output / (name + '.json')).read_bytes()
    report = json.loads(raw)
    assert report['archiveSHA256'] == digest and report['results'], name
    for row in report['results']:
        assert row['expected'] == row['actual'], (name, row['name'])
    summary['expected']['passingSuites'].append(name)
    summary['actual'][name] = {'status':'passed','observationGroups':len(report['results']),
                               'receiptSHA256':sha256(raw).hexdigest()}
assert set(summary['expected']['passingSuites']) == set(summary['actual'])
pins = Path('evidence/moderator-settings/pins.json').read_bytes()
summary['upstreamCommit'] = json.loads(pins)['upstreamCommit']
summary['moderatorSettingsPinsSHA256'] = sha256(pins).hexdigest()
summary['adminRegressionReceiptSHA256'] = sha256(prior).hexdigest()
summary['integrationBaseCommit'] = base
summary['command'] = 'sh evidence/moderator-settings/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
summary['moderatorSettingsLimitations'] = ['Fictional moderator and fixture targets only.',
    'The moderator settings path uses no administrator grant.',
    'Deployment support, real permission and persisted effects unobserved.']
print(json.dumps(summary, indent=2))
PY
