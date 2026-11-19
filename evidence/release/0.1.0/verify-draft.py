"""Check an unpublished draft against the qualified rebuild and its source tag."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys

out = Path(sys.argv[1]).resolve()
repo = 'Benson-mk/tsdm-sdk'
release = json.loads((out / 'release.json').read_bytes())
tag = release['tag']
source = release['sourceCommit']

def api(endpoint, *args):
    return subprocess.check_output(['gh', 'api', f'repos/{repo}/{endpoint}', *args])

def get(endpoint):
    return json.loads(api(endpoint))

settings = get('immutable-releases')
assert settings['enabled'] is True
ref = get(f'git/ref/tags/{tag}')['object']
while ref['type'] == 'tag':
    ref = get('git/tags/' + ref['sha'])['object']
assert ref['type'] == 'commit' and ref['sha'] == source, ref
drafts = [r for r in get('releases?per_page=100') if r['tag_name'] == tag]
assert len(drafts) == 1 and drafts[0]['draft'] is True
draft = get('releases/' + str(drafts[0]['id']))
link = f'https://github.com/{repo}/blob/{source}/evidence/release/0.1.0/README.md'
assert link in draft['body']
assets = draft['assets']
assert sorted(a['name'] for a in assets) == sorted([release['filename'], 'release.json'])
assert sha256((out / release['filename']).read_bytes()).hexdigest() == release['sha256']
observations = []
for a in sorted(assets, key=lambda a: a['name']):
    expected = (out / a['name']).read_bytes()
    digest = 'sha256:' + sha256(expected).hexdigest()
    assert a['state'] == 'uploaded' and a['digest'] == digest and a['size'] == len(expected)
    assert api('releases/assets/' + str(a['id']), '-H', 'Accept: application/octet-stream') == expected
    observations.append({k:a[k] for k in ['id','name','size','state','digest']})
print(json.dumps({'repository':repo,'tag':tag,'sourceCommit':source,'releaseId':draft['id'],'draft':True,
                  'immutability':settings,'qualificationLink':link,'assets':observations,'downloadedBytesMatched':True}, indent=2))
