"""Trace packed Python and curl media examples against two inert loopback origins."""
from contextlib import ExitStack
from email import policy
from email.parser import BytesParser
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/tsdm-sdk-0.1.0.tgz')
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/media.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
namespace = {}
exec(compile(blocks['python'], 'packed-media-guide.py', 'exec'), namespace)

calls = []
results = []
photo = b'\xff\xd8\xff\x00synthetic image bytes\xff\xd9'
sha = lambda value: hashlib.sha256(value).hexdigest()
protected_headers = ('Cookie', 'Authorization', 'Referer', 'X-Tsdmapp-Device', 'X-Tsdmapp-Client')
fixture_cookie = 'fixture_media_session=loopback'
fixture_headers = {'Authorization': 'Bearer fixture', 'Referer': 'https://forum.invalid/',
                   'X-Tsdmapp-Device': 'fixture-device', 'X-Tsdmapp-Client': 'fixture-app'}


def trace(operation, target, *, fields=None, file=None, headers=None, destination='forum'):
    path = urlsplit(target)
    expected_headers = {'Cookie': fixture_cookie} if headers is None else headers
    return {'destination': destination, 'method': operation, 'path': path.path,
            'query': parse_qs(path.query, keep_blank_values=True), 'fields': fields or {},
            'file': file, 'credentialHeaders': expected_headers}


class Server(BaseHTTPRequestHandler):
    def do_GET(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        content_type = self.headers.get('Content-Type', '')
        fields, file = {}, None
        if content_type.startswith('multipart/form-data'):
            parts = BytesParser(policy=policy.default).parsebytes(f'Content-Type: {content_type}\r\n\r\n'.encode() + body)
            for part in parts.iter_parts():
                name = part.get_param('name', header='content-disposition')
                if part.get_filename() is None:
                    fields[name] = [part.get_content()]
                else:
                    file = {'field': name, 'filename': part.get_filename(), 'mime': part.get_content_type(),
                            'sha256': sha(part.get_payload(decode=True))}
        elif body:
            assert content_type == 'application/x-www-form-urlencoded', content_type
            fields = parse_qs(body.decode(), keep_blank_values=True)
        observed = trace(self.command, self.path, fields=fields, file=file,
                         headers={key: self.headers[key] for key in protected_headers if key in self.headers},
                         destination=self.server.role)
        calls.append(observed)
        if self.server.role == 'forum' and observed['query'].get('ck') == ['frozen']:
            self.send_response(302)
            self.send_header('Location', self.server.storage + '/blob/file.jpg?sign=storage-fixture')
            payload = b''
        else:
            self.send_response(200)
            payload = photo if self.server.role == 'storage' else b'{"fixture":"inert"}'
        self.send_header('Content-Type', 'image/jpeg' if self.server.role == 'storage' else 'application/json')
        self.end_headers()
        self.wfile.write(payload)

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, expected, body_matches):
    assert calls == expected, (name, calls, expected)
    assert body_matches, name
    results.append({'name': name, 'expected': expected, 'actual': calls.copy()})
    calls.clear()


with ExitStack() as stack:
    temp = Path(stack.enter_context(TemporaryDirectory()))
    certificate, key = temp/'trust.pem', temp/'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                    '-keyout', str(key), '-out', str(certificate)], check=True, capture_output=True)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    servers = {}
    for role in ('forum', 'storage'):
        server = stack.enter_context(ThreadingHTTPServer(('127.0.0.1', 0), Server))
        server.role = role
        server.socket = context.wrap_socket(server.socket, server_side=True)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        stack.callback(worker.join)
        stack.callback(server.shutdown)
        servers[role] = (server, f'https://127.0.0.1:{server.server_port}')
    forum = servers['forum'][1]
    storage = servers['storage'][1]
    servers['forum'][0].storage = storage
    clean_session = requests.Session
    session = clean_session()
    session.verify = certificate
    session.trust_env = False
    session.cookies.set('fixture_media_session', 'loopback', domain='127.0.0.1', path='/')
    session.headers.update(fixture_headers)
    python_headers = {'Cookie': fixture_cookie, **fixture_headers}
    post = '/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=7'
    album = '/misc.php?mod=swfupload&action=swfupload&operation=album'
    filing = '/home.php?mod=spacecp&ac=upload'
    credit = '/forum.php?mod=misc&action=attachcredit&aid=36&formhash=fixture'
    continuation = '/forum.php?mod=attachment&aid=36&ck=frozen'
    photo_file = {'field': 'Filedata', 'filename': 'photo.jpg', 'mime': 'image/jpeg', 'sha256': sha(photo)}
    upload_fields = {'uid': ['31'], 'hash': ['fixture-account-hash']}
    filing_fields = {'formhash': 'fixture', 'albumsubmit': 'true', 'title[42]': '', 'albumop': 'selectalbum', 'albumid': '1'}
    for operation, offered in [('upload', post), ('album', album)]:
        actual = namespace['upload_image'](session, forum, offered, operation, '31', 'fixture-account-hash',
                                           'photo.jpg', photo, 'image/jpeg', approved=True)
        full = offered + ('&type=image&simple=2' if operation == 'upload' else '')
        observe('Python multipart ' + operation,
                [trace('POST', full, fields=upload_fields, file=photo_file, headers=python_headers)], actual.status_code == 200)
    actual = namespace['file_pictures'](session, forum, filing, filing_fields, approved=True)
    encoded_fields = {name: [value] for name, value in filing_fields.items()}
    observe('Python approved album filing', [trace('POST', filing + '&tsdmapp=json', fields=encoded_fields, headers=python_headers)], actual.status_code == 200)
    actual = namespace['charge_credit'](session, forum, credit, approved=True)
    observe('Python deliberate credit GET', [trace('GET', credit, headers=python_headers)], actual.status_code == 200)
    cancelled = namespace['charge_credit'](session, forum, credit)
    observe('Python credit without approval', [], cancelled is None)
    for path in ['/plugin.php?id=tsdmapp%3Aapi&action=smilies', '/data/cache/common_smilies_var.js',
                 '/data/avatar/noavatar.svg', '/forum.php?mod=image&aid=36&size=300x300',
                 '/forum.php?mod=attachment&aid=36']:
        actual = namespace['read_forum'](session, forum, path)
        observe('Python ordinary read ' + path, [trace('GET', path, headers=python_headers)], actual.status_code == 200)
    actual = namespace['read_forum'](session, forum, continuation)
    location = actual.headers['Location']
    observe('Python forum redirect stops before external request', [trace('GET', continuation, headers=python_headers)],
            actual.status_code == 302 and location.startswith(storage))
    def isolated_with_fixture_ca():
        fresh = clean_session()
        fresh.verify = certificate
        return fresh
    with patch.object(requests, 'Session', isolated_with_fixture_ca):
        actual = namespace['read_external'](location)
    external = urlsplit(location).path + '?' + urlsplit(location).query
    observe('Python external handoff sends no forum credentials', [trace('GET', external, headers={}, destination='storage')], actual.content == photo)

    jar = temp/'cookies.txt'
    jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tTRUE\t0\tfixture_media_session\tloopback\n')
    image = temp/'photo.jpg'
    image.write_bytes(photo)
    body = temp/'fields.txt'
    body.write_text(urlencode(filing_fields))
    output, reply_headers = temp/'response.bin', temp/'headers.txt'
    env = dict(os.environ, CURL_CA_BUNDLE=str(certificate), SSL_CERT_FILE=str(certificate), NO_PROXY='127.0.0.1',
               FORUM_COOKIE_JAR=str(jar), MEDIA_OUTPUT=str(output), MEDIA_HEADERS=str(reply_headers),
               IMAGE_PATH=str(image), IMAGE_MIME='image/jpeg', UPLOAD_UID='31', UPLOAD_HASH='fixture-account-hash',
               ALBUM_BODY=str(body))
    def shell(mode, approval='', **values):
        return subprocess.run(['sh', '-eu', '-c', blocks['sh']], env=env | values | {'MEDIA_MODE': mode, 'MEDIA_APPROVAL': approval}, capture_output=True)
    for operation, dest in [('post', post + '&type=image&simple=2'), ('album', album)]:
        actual = shell('upload-image', 'upload-image', UPLOAD_URL=forum + dest)
        assert actual.returncode == 0, actual.stderr.decode()
        observe('curl multipart ' + operation, [trace('POST', dest, fields=upload_fields, file=photo_file)], output.exists())
    actual = shell('file-album', 'file-album', FILE_URL=forum + filing + '&tsdmapp=json')
    assert actual.returncode == 0, actual.stderr.decode()
    observe('curl approved album filing', [trace('POST', filing + '&tsdmapp=json', fields=encoded_fields)], output.exists())
    actual = shell('charge-credit', CREDIT_URL=forum + credit)
    observe('curl credit without approval', [], actual.returncode == 2)
    actual = shell('charge-credit', 'charge-credit', CREDIT_URL=forum + credit)
    assert actual.returncode == 0, actual.stderr.decode()
    observe('curl deliberate credit GET', [trace('GET', credit)], output.exists())
    actual = shell('read', READ_URL=forum + continuation)
    assert actual.returncode == 0, actual.stderr.decode()
    observe('curl forum redirect stops before external request', [trace('GET', continuation)], '302' in reply_headers.read_text())
    actual = shell('external', STORAGE_URL=location)
    assert actual.returncode == 0, actual.stderr.decode()
    observe('curl external handoff sends no forum credentials', [trace('GET', external, headers={}, destination='storage')], output.read_bytes() == photo)

print(json.dumps({'archiveSHA256': sha(archive.read_bytes()), 'guideSHA256': sha(guide),
                  'python': sys.version.split()[0], 'requests': requests.__version__,
                  'curl': subprocess.check_output(['curl', '--version'], text=True).splitlines()[0],
                  'limitations': ['Two inert HTTPS loopback origins', 'No deployed forum traffic or effects'],
                  'results': results}, ensure_ascii=False, indent=2))
