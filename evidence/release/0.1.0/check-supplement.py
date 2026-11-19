"""Replay installed-package probes, direct guide examples and the live signed-out journey."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256, sha512
from base64 import b64encode
import json
from pathlib import Path
import re
from shutil import copyfile
import subprocess
import sys
from tempfile import TemporaryDirectory

record = Path(__file__).resolve().parent
root = record.parents[2]
out, upstream = (Path(arg).resolve() for arg in sys.argv[1:3])
manifest = json.loads((out / 'candidate.json').read_bytes())
archive = out / manifest['filename']
archive_bytes = archive.read_bytes()
digest = sha256(archive_bytes).hexdigest()
assert digest == manifest['sha256']

def output(command, dest, cwd=root):
    raw = subprocess.check_output(command, cwd=cwd)
    result = json.loads(raw)
    dest.write_bytes(raw)
    return result

def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

with TemporaryDirectory(prefix='tsdm-sdk-release-consumer-') as scratch:
    consumer = Path(scratch)
    (consumer / 'package.json').write_text('{"private":true,"type":"module"}\n')
    subprocess.run(['npm','install','--offline','--ignore-scripts','--engine-strict','--no-audit','--no-fund',
                    '--cache', consumer / 'cache', archive], cwd=consumer, check=True)
    lock = json.loads((consumer / 'package-lock.json').read_bytes())
    integrity = 'sha512-' + b64encode(sha512(archive_bytes).digest()).decode()
    assert lock['packages']['node_modules/tsdm-sdk']['integrity'] == integrity
    readme = consumer / 'node_modules/tsdm-sdk/README.md'
    copyfile(readme, out / 'README.md')
    args = {'media': [root / 'tests/install/fixtures/thread_plain.json'], 'device-status': [],
            'achievements': [archive, out / 'candidate.json', upstream]}
    for name, params in args.items():
        script = f'probe-{name}.mjs'
        copyfile(record / script, consumer / script)
        observed = json.loads(subprocess.check_output(['node', script, *params], cwd=consumer))
        save(f'{name}.json', {'archiveSHA256': digest, 'observations': observed} if name != 'achievements' else observed)
    example = (root / 'scripts/check-live-guest.ts').read_text()
    assert re.findall(r'^```ts\n(.*?)^```', readme.read_text(), re.M | re.S).count(example) == 1
    (consumer / 'check-live-guest.ts').write_text(example)
    command = ['node','--use-env-proxy','check-live-guest.ts','https://www.tsdm39.com','17']
    live = json.loads(subprocess.check_output(command, cwd=consumer, timeout=60))
    assert [r['status'] for r in live['requests']] == [200, 200]
    assert live['boardViewer'] == live['threadViewer'] == 'guest'
    assert live['board'] == '17' and live['rows'] > 0 and live['posts'] > 0
    save('guest-read.json', {'sha256': digest, 'lockIntegrity': integrity, 'command': ' '.join(command),
         'expected': 'Two guest GETs, the requested board and a matching listed thread with visible posts.', **live})

output(['node', record / 'probe-inventory-4-7.mjs', archive, out / 'candidate.json'], out / 'inventory-4-7-probes.json')
direct = out / 'direct'
direct.mkdir(exist_ok=True)

def guide(name):
    inputs = [out / 'README.md', upstream / 'test/data'] if name == 'board-thread' else [archive]
    if name == 'discovery':
        inputs.append(upstream / 'test/data')
    receipt = direct / f'{name}.json'
    output([sys.executable, root / 'evidence' / name / 'check-direct-guide.py', *inputs], receipt)
    return name, {'status': 'passed', 'receiptSHA256': sha256(receipt.read_bytes()).hexdigest()}

with ThreadPoolExecutor(max_workers=4) as workers:
    guides = dict(workers.map(guide, 'board-thread discovery account profile members messages notices spaces collections'.split()))
save('direct-guides.json', {'archiveSHA256': digest, 'guides': guides})
