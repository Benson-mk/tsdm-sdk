#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_CREDITS_UPSTREAM="$upstream" node scripts/check-installed-credits.mjs "$archive" > "$output/credits-installed.json"
python3 evidence/credits/check-direct-guide.py "$archive" > "$output/credits-direct.json"
sh evidence/trades/check-candidate.sh "$upstream" "$archive" "$output"
python3 - "$archive" "$output" <<'PY' > "$output/credits-regressions.json"
import hashlib
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
regressions = json.loads((output / 'regressions.json').read_bytes())
assert regressions['archiveSHA256'] == archive_hash
for name in ('credits-installed', 'credits-direct'):
    report = json.loads((output / (name + '.json')).read_bytes())
    assert report['archiveSHA256'] == archive_hash, name
    assert report['results'], name
    for observation in report['results']:
        assert observation['expected'] == observation['actual'], observation['name']
regressions['integrationBaseCommit'] = '3a639282434b011ec14eb3c4140691a4e805d9a5'
regressions['command'] = 'sh evidence/credits/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"'
print(json.dumps(regressions, indent=2))
PY
