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

pins = json.loads(Path('evidence/moderation/pins.json').read_bytes())
for root, group in ((Path(sys.argv[1]), 'upstreamFiles'), (Path.cwd(), 'controlledFiles')):
    for path, digest in pins[group].items():
        assert sha256((root / path).read_bytes()).hexdigest() == digest, path
PY
node scripts/check-installed-moderation.mjs "$archive" > "$output/moderation-installed.json"
python3 evidence/moderation/check-direct-guide.py "$archive" > "$output/moderation-direct.json"
base=9078f9cafb29e962bc79b6010d597dd7edf76dff
sh evidence/pokemon-battles/check-candidate.sh "$upstream" "$archive" "$output" "$base"
python3 - "$archive" "$output" "$base" <<'PY' > "$output/moderation-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:3])
base = sys.argv[3]
digest = sha256(archive.read_bytes()).hexdigest()
summary = json.loads((output / 'pokemon-regressions.json').read_bytes())
assert summary['archiveSHA256'] == digest
battle_raw = (output / 'pokemon-battles-combined.json').read_bytes()
battle = json.loads(battle_raw)
assert battle['archiveSHA256'] == digest and battle['integrationBaseCommit'] == base
assert set(battle['actual']) == {'SDK', 'requests', 'curl'}
assert all(rows == battle['expected'] for rows in battle['actual'].values())
for name in ('pokemon-battles-installed', 'pokemon-battles-direct', 'moderation-installed', 'moderation-direct'):
    raw = (output / (name + '.json')).read_bytes()
    report = json.loads(raw)
    assert report['archiveSHA256'] == digest and report['results'], name
    for observation in report['results']:
        if 'observed' in observation:
            assert observation['expected'] == observation['observed'], observation['name']
            assert observation['expectedRequests'] == observation['requests'], observation['name']
        else:
            assert observation['expected'] == observation['actual'], observation['name']
    summary['expected']['passingSuites'].append(name)
    summary['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                               'receiptSHA256': sha256(raw).hexdigest()}
assert set(summary['expected']['passingSuites']) == set(summary['actual'])
summary['pokemonInventoryReceipt'] = {'operationsPerDriver': len(battle['expected']), 'receiptSHA256': sha256(battle_raw).hexdigest()}
summary['integrationBaseCommit'] = base
summary['command'] = 'sh evidence/moderation/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(summary, indent=2))
PY
