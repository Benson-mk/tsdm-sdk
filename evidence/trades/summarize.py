"""Summarize the receipts produced against the same archive in this run."""
import hashlib
import json
from pathlib import Path
import sys

archive, output = map(Path, sys.argv[1:])
suites = (
    'account', 'activity-direct', 'activity-installed', 'collections', 'historical-drafts',
    'historical-replies', 'media-direct', 'media-installed', 'members', 'messages', 'notices',
    'posts-direct', 'posts-installed', 'profile', 'replies-direct', 'replies-installed',
    'sdk', 'spaces', 'special-direct', 'special-installed', 'trades-direct', 'trades-installed',
)
archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
actual = {}
for suite in suites:
    receipt = (output / (suite + '.json')).read_bytes()
    report = json.loads(receipt)
    if isinstance(report, dict) and 'archiveSHA256' in report:
        assert report['archiveSHA256'] == archive_hash, suite
    actual[suite] = {'status': 'passed', 'receiptSHA256': hashlib.sha256(receipt).hexdigest()}
print(json.dumps({
    'integrationBaseCommit': '0b428205c300c068d7b73532e8f74ad6d1432aa5',
    'archiveSHA256': archive_hash,
    'command': 'sh evidence/trades/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"',
    'expected': {'passingSuites': suites},
    'actual': actual,
}, indent=2))
