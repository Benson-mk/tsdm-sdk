"""Reconcile actual request routes from the archive replays with #4, section 6."""
from hashlib import sha256
import json
from pathlib import Path
import re
from subprocess import check_output
import sys

archive, output = map(Path, sys.argv[1:3])
base = check_output(["git", "rev-parse", sys.argv[3]], text=True).strip()
archive_hash = sha256(archive.read_bytes()).hexdigest()
inventory_path = Path(__file__).with_name('inventory.json')
inventory = json.loads(inventory_path.read_bytes())
expected = sorted(inventory['operations'])
assert len(expected) == len(set(map(tuple, expected))) == 35
suites = {}


def read_report(name):
    raw = (output / (name + '.json')).read_bytes()
    report = json.loads(raw)
    assert report['archiveSHA256'] == archive_hash, name
    suites[name] = {'receiptSHA256': sha256(raw).hexdigest()}
    if 'results' in report:
        assert report['results']
        for row in report['results']:
            assert row['expected'] == row['actual'], row['name']
        suites[name]['observationGroups'] = len(report['results'])
    return report


def installed_requests(value):
    if isinstance(value, list):
        if len(value) == 5 and isinstance(value[1], dict) and value[1].get('id') == 'pokemon:pokemon':
            yield [value[0], value[1]['endpoint'], value[1]['action']]
        else:
            for item in value:
                yield from installed_requests(item)


def observed(name, driver, count):
    report = read_report(name)
    operations = []
    prefix = '' if driver == 'SDK' else driver + ' '
    for row in report['results']:
        match = re.fullmatch(prefix + r'(GET|POST) (\w+)/(\w+)', row['name'])
        if not match:
            continue
        if driver == 'SDK':
            routes = list(installed_requests(row['actual']))
        else:
            routes = [[call['method'], call['query']['endpoint'], call['query']['action']]
                      for call in row['actual']['requests'] if call['query']['id'] == 'pokemon:pokemon']
        assert routes == [list(match.groups())], (name, driver, row['name'])
        operations.extend(routes)
    assert len(operations) == count, (name, driver, operations)
    return operations


actual = {}
for driver, suffix in [('SDK', 'installed'), ('requests', 'direct'), ('curl', 'direct')]:
    roster = observed('pokemon-' + suffix, driver, 21)
    battles = observed('pokemon-battles-' + suffix, driver, 14)
    actual[driver] = sorted(roster + battles)
    assert actual[driver] == expected, driver
regressions = read_report('pokemon-regressions')
for name in regressions['expected']['passingSuites']:
    assert regressions['actual'][name]['status'] == 'passed', name

print(json.dumps({'archiveSHA256': archive_hash,
                  'integrationBaseCommit': base,
                  'upstreamCommit': inventory['upstreamCommit'], 'inventorySource': inventory['source'],
                  'inventorySHA256': sha256(inventory_path.read_bytes()).hexdigest(),
                  'command': 'sh evidence/pokemon-battles/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT" "$BASE"',
                  'expected': expected, 'actual': actual, 'suites': suites,
                  'regressions': {'expected': regressions['expected'],
                                  'actual': {name: regressions['actual'][name]
                                             for name in regressions['expected']['passingSuites']}},
                  'limitations': ['Separate bootstrap traces qualify both #35 paths outside the 35 operations',
                                  'Controlled hosts only. Deployment, permissions and game effects unobserved.']}, indent=2))
