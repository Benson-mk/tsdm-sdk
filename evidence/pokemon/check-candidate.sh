#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_POKEMON_UPSTREAM="$upstream" node scripts/check-installed-pokemon.mjs "$archive" > "$output/pokemon-installed.json"
python3 evidence/pokemon/check-direct-guide.py "$archive" > "$output/pokemon-direct.json"
sh evidence/bank/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/pokemon-regressions.json"
from hashlib import sha256
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'bank-regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('pokemon-installed', 'pokemon-direct'):
    data = (output / (name + '.json')).read_bytes()
    report = json.loads(data)
    assert report['archiveSHA256'] == archive_hash and report['results'], name
    for observation in report['results']:
        assert observation['expected'] == observation['actual'], observation['name']
    regressions['expected']['passingSuites'].append(name)
    regressions['actual'][name] = {'status': 'passed', 'observationGroups': len(report['results']),
                                   'receiptSHA256': sha256(data).hexdigest()}
regressions['integrationBaseCommit'] = '87e93bc8d68ee99d2ffc4c304d5eda59148e00fe'
regressions['command'] = 'sh evidence/pokemon/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
