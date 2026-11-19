"""Exercise packaged requests and curl helpers against an inert loopback forum."""
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/tsdm-sdk-0.1.0.tgz')
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/packets.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
functions = {}
exec(compile(blocks['python'], 'packets-guide.py', 'exec'), functions)
calls = []
results = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        calls.append({'method': self.command, 'path': url.path,
                      'query': parse_qs(url.query), 'fields': parse_qs(body, keep_blank_values=True),
                      'fixtureCookie': self.headers.get('Cookie') == 'fixture=packets'})
        if 'awardid=99' in url.query:
            self.send_response(302)
            self.send_header('Location', '/must-not-follow')
        else:
            self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"fixture":"inert"}')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def expected(method, path, query, fields=None):
    return {'method': method, 'path': path, 'query': {k: [v] for k, v in query.items()},
            'fields': {k: [v] for k, v in (fields or {}).items()}, 'fixtureCookie': True}


def observe(name, value, status, requests_expected):
    actual = {'status': value, 'requests': calls.copy()}
    wanted = {'status': status, 'requests': requests_expected}
    assert wanted == actual, (name, wanted, actual)
    results.append({'name': name, 'expected': wanted, 'actual': actual})
    calls.clear()


with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set('fixture','packets',domain='127.0.0.1')

        def shell(function, *args, data=''):
            env = {**os.environ, 'FORUM_ORIGIN': origin, 'FORUM_COOKIE': 'fixture=packets', 'NO_PROXY':'127.0.0.1'}
            result = subprocess.run(['sh','-c', blocks['sh'] + '\n"$@"','packets-guide',function,*args],
                input=data, text=True, capture_output=True, check=True, env=env)
            return int(result.stdout.splitlines()[-1]) if result.stdout.strip() else None

        def status(response):
            return None if response is None else response.status_code

        tid = '1265042'
        lean = {'tsdmapp':'json','nodoc':'1'}
        reads = [
            ('open','/plugin.php',{'id':'hongbao:open','tid':tid}),
            ('thread','/forum.php',{'mod':'viewthread','tid':tid,**lean}),
            ('record','/plugin.php',{'id':'hongbao:record','tid':tid,**lean}),
            ('daily','/forum.php',lean),
            ('award-details','/plugin.php',{'id':'tsdmbet:awardPacket','action':'showaward','tid':tid}),
        ]
        for op,path,query in reads:
            expected_read = [expected('GET',path,query)]
            target = None if op=='daily' else tid
            observe(f'requests reads {op}',status(functions['packet_read'](session,origin,op,target)),200,expected_read)
            observe(f'curl reads {op}',shell('packet_read',op,*([] if target is None else [target])),200,expected_read)
        for op,mode,query,fields in [
            ('grab','structured',{'id':'hongbao:grab','tsdmapp':'json'}, {'tid':tid,'formhash':'abcd1234','password':'fixture-passphrase-33'}),
            ('grab','legacy',{'id':'hongbao:grab'}, {'tid':tid,'formhash':'abcd1234','password':''}),
            ('withdraw','structured',{'id':'hongbao:withdraw','tsdmapp':'json'}, {'tid':tid,'formhash':'abcd1234'}),
            ('daily','legacy',{'id':'hongbao:daily'}, {'formhash':'abcd1234'}),
        ]:
            expected_write = [expected('POST','/plugin.php',query,fields)]
            observe(f'requests sends {op} {mode}',status(functions['packet_submit'](session,origin,op,mode,fields,approved=True)),200,expected_write)
            observe(f'curl sends {op} {mode}',shell('packet_submit','yes',op,mode,data=urlencode(fields)),200,expected_write)
        observe('requests declined POST',status(functions['packet_submit'](session,origin,'grab','structured',{},approved=False)),None,[])
        observe('curl declined POST',shell('packet_submit','no','grab','structured'),None,[])
        for award,status_code in [('11',200),('99',302)]:
            url=f'{origin}/plugin.php?id=tsdmbet:awardPacket&action=getaward&tid={tid}&awardid={award}'
            award_call=[expected('GET','/plugin.php',{'id':'tsdmbet:awardPacket','action':'getaward','tid':tid,'awardid':award})]
            observe(f'requests exact award GET HTTP {status_code}',status(functions['packet_award'](session,origin,tid,url,approved=True)),status_code,award_call)
            observe(f'curl exact award GET HTTP {status_code}',shell('packet_award','yes',tid,url),status_code,award_call)
        observe('requests declined award GET',status(functions['packet_award'](session,origin,tid,url,approved=False)),None,[])
        observe('curl declined award GET',shell('packet_award','no',tid,url),None,[])
    server.shutdown()
    thread.join()
print(json.dumps({'archiveSHA256':sha256(archive.read_bytes()).hexdigest(),'guideSHA256':sha256(guide).hexdigest(),
    'limitations':['Inert loopback HTTP with fictional credentials', 'No deployed forum requests or account effects'],
    'results':results}, ensure_ascii=False, indent=2))
