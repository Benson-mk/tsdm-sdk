"""Build a precommit candidate in isolation and fingerprint the complete input set."""
from hashlib import sha256
import json
from pathlib import Path
from shutil import copy2
import subprocess
import sys
from tempfile import TemporaryDirectory

root = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
inputs = [root / name for name in ('README.md', 'LICENSE', 'package.json', 'package-lock.json',
                                   'vite.sdk.config.ts', 'tsconfig.sdk.json', 'scripts/stage-sdk.mjs')]
for pattern in ('src/**/*.ts', 'docs/*.md', 'evidence/history/notices/*.LICENSE'):
    inputs.extend(root.glob(pattern))

with TemporaryDirectory(prefix='tsdm-sdk-candidate-') as scratch:
    build = Path(scratch)
    rows = []
    for source in sorted(inputs):
        name = source.relative_to(root)
        target = build / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copy2(source, target)
        rows.append({'path': name.as_posix(), 'mode': '100755' if target.stat().st_mode & 0o111 else '100644',
                     'sha256': sha256(target.read_bytes()).hexdigest()})
    proof = (json.dumps(rows, indent=2) + '\n').encode()
    (out / 'package-inputs.json').write_bytes(proof)
    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-fund', '--no-audit'], cwd=build, check=True)
    subprocess.run(['npm', 'run', 'pack:sdk'], cwd=build, check=True)
    archive, = (build / 'dist').glob('*.tgz')
    copy2(archive, out / archive.name)
    manifest = {'name': 'tsdm-sdk', 'version': '0.1.0', 'tag': 'v0.1.0',
                'packageInputsSHA256': sha256(proof).hexdigest(), 'filename': archive.name,
                'sha256': sha256(archive.read_bytes()).hexdigest(),
                'assetUrl': f'https://github.com/Benson-mk/tsdm-sdk/releases/download/v0.1.0/{archive.name}'}
    (out / 'candidate.json').write_text(json.dumps(manifest, indent=2) + '\n')
