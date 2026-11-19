#!/usr/bin/env python3
"""Verify an anonymous install using the exact command in INSTALL.md.

    python3 verify-public.py ARCHIVE RELEASE_JSON INSTALL_MD --tsc node_modules/typescript/bin/tsc

Use Node.js 26 and a locally available TypeScript 6.0.3 compiler. Redirect
stdout to save the JSON receipt. --loopback-origin is for fixture tests and
substitutes only the destination origin; its receipt is labeled loopback.
"""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import ssl
import subprocess
import tempfile
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener,
)


RELEASE_ROOT = "https://github.com/Benson-mk/tsdm-sdk/releases/download"
INSTALL_ARGS = ["npm", "install", "--save-exact", "--engine-strict"]
TYPESCRIPT_VERSION = "6.0.3"


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def install_command(guide, asset_url):
    """Read exactly one documented single-line npm install from a shell block."""
    shell_blocks = re.findall(r"^```(?:sh|bash)\s*\n(.*?)^```\s*$", guide, re.M | re.S)
    commands = [
        line.strip()
        for block in shell_blocks
        for line in block.splitlines()
        if re.match(r"^\s*npm\s+install\b", line)
    ]
    require(len(commands) == 1, "INSTALL.md must contain exactly one npm install command")
    argv = shlex.split(commands[0])
    require(argv == [*INSTALL_ARGS, asset_url], "INSTALL.md command differs from the release install contract")
    return commands[0], argv


def release_identity(manifest, archive):
    require(isinstance(manifest, dict), "release.json must be a JSON object")
    version = manifest.get("version")
    require(isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version), "invalid release version")
    tag = f"v{version}"
    filename = f"tsdm-sdk-{version}.tgz"
    asset_url = f"{RELEASE_ROOT}/{tag}/{filename}"
    source = manifest.get("sourceCommit")
    require(isinstance(source, str) and re.fullmatch(r"[0-9a-f]{40}", source), "final release.json needs the full source commit")
    require(
        manifest.get("name") == "tsdm-sdk"
        and manifest.get("tag") == tag
        and manifest.get("filename") == filename
        and manifest.get("assetUrl") == asset_url,
        "inconsistent release identity or asset URL",
    )
    require(archive.name == filename, "local archive filename differs from release.json")
    return asset_url


class AssetRedirects(HTTPRedirectHandler):
    def __init__(self, loopback_origin):
        super().__init__()
        self.loopback_origin = loopback_origin

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlsplit(newurl)
        allowed = (
            f"{url.scheme}://{url.netloc}" == self.loopback_origin
            if self.loopback_origin
            else url.scheme == "https" and not url.username and not url.password
        )
        require(allowed, "asset redirect left the permitted transport")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def tls_context():
    defaults = ssl.get_default_verify_paths()
    bundles = [
        defaults.openssl_cafile,
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/opt/homebrew/etc/ca-certificates/cert.pem",
    ]
    try:
        import certifi
    except ImportError:
        pass
    else:
        bundles.append(certifi.where())

    # Explicit paths keep the verifier independent of inherited SSL settings.
    # create_default_context also consults SSLKEYLOGFILE, which this probe ignores.
    keylog = os.environ.pop("SSLKEYLOGFILE", None)
    try:
        for bundle in dict.fromkeys(bundles):
            if not bundle or not Path(bundle).is_file():
                continue
            try:
                context = ssl.create_default_context(cafile=bundle)
            except OSError:
                continue
            if context.cert_store_stats()["x509_ca"]:
                return context
    finally:
        if keylog is not None:
            os.environ["SSLKEYLOGFILE"] = keylog
    raise VerificationError("no usable CA bundle found; install platform CA certificates or certifi")


def asset_opener(loopback_origin=None):
    handlers = [ProxyHandler({}), AssetRedirects(loopback_origin)]
    if not loopback_origin:
        handlers.append(HTTPSHandler(context=tls_context()))
    return build_opener(*handlers)


def fetch(opener, url, size):
    request = Request(url, headers={"User-Agent": "tsdm-sdk-public-install-verifier"})
    with opener.open(request, timeout=30) as response:
        require(response.status == 200, "asset download did not return HTTP 200")
        # A signed redirect URL and HTTP error bodies are never part of a receipt.
        return response.read(size + 1)


def clean_environment(root, node, npm):
    home = root / "home"
    cache = root / "cache"
    scratch = root / "tmp"
    for directory in (home, cache, scratch):
        directory.mkdir()
    user_config = root / "user.npmrc"
    global_config = root / "global.npmrc"
    for config in (user_config, global_config):
        config.touch()
    return {
        "PATH": os.pathsep.join(dict.fromkeys([str(node.parent), str(npm.parent), *os.defpath.split(os.pathsep)])),
        "HOME": str(home),
        "TMPDIR": str(scratch),
        "LANG": "C",
        "NPM_CONFIG_CACHE": str(cache),
        "NPM_CONFIG_USERCONFIG": str(user_config),
        "NPM_CONFIG_GLOBALCONFIG": str(global_config),
        "NPM_CONFIG_IGNORE_SCRIPTS": "true",
        "NPM_CONFIG_AUDIT": "false",
        "NPM_CONFIG_FUND": "false",
        "NPM_CONFIG_UPDATE_NOTIFIER": "false",
    }


def run(argv, cwd, env, failure):
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
    require(result.returncode == 0, failure)
    return result.stdout.strip()


def check_install(project, manifest, install_url, integrity):
    package = json.loads((project / "package.json").read_bytes())
    lock = json.loads((project / "package-lock.json").read_bytes())
    name = manifest["name"]
    dependency = {name: install_url}
    installed_path = f"node_modules/{name}"
    packages = lock.get("packages", {})
    require(package.get("dependencies") == dependency, "package.json dependency is not the exact asset URL")
    require(isinstance(packages, dict) and set(packages) == {"", installed_path}, "lockfile has unexpected package entries")
    require(packages[""].get("dependencies") == dependency, "lockfile root does not pin the asset URL")
    installed = packages[installed_path]
    require(installed.get("version") == manifest["version"], "lockfile version differs from release.json")
    require(installed.get("resolved") == install_url, "lockfile resolved URL differs from the install URL")
    require(installed.get("integrity") == integrity, "lockfile SHA-512 integrity differs from the verified tarball")
    installed_package = json.loads((project / installed_path / "package.json").read_bytes())
    require(
        installed_package.get("name") == name
        and installed_package.get("version") == manifest["version"]
        and installed_package.get("type") == "module",
        "installed manifest differs from the release package identity or ESM format",
    )


def check_imports(project, node, tsc, env):
    (project / "consume.mjs").write_text(
        '''import { createForumClient } from "tsdm-sdk";
const client = createForumClient({
  origin: "https://forum.test",
  transport: { async request() { throw new Error("Unexpected request"); } },
});
if (typeof client.readThread !== "function") throw new Error("Missing readThread");
''',
        encoding="utf-8",
    )
    run([node, "consume.mjs"], project, env, "ESM package-root import failed")
    (project / "consume.mts").write_text(
        '''import { createForumClient, type ForumTransport, type ThreadReadResult } from "tsdm-sdk";
declare const transport: ForumTransport;
const client = createForumClient({ origin: "https://forum.test", transport });
const result: ThreadReadResult = await client.readThread("https://forum.test/forum.php?mod=viewthread&tid=123");
if (result.kind === "thread") {
  const url: string | undefined = result.thread.posts[0]?.url;
  void url;
}
// @ts-expect-error The consumer is compiled without DOM globals.
void document;
''',
        encoding="utf-8",
    )
    (project / "tsconfig.json").write_text(json.dumps({
        "compilerOptions": {
            "module": "NodeNext", "target": "ES2023", "lib": ["ES2023"],
            "types": [], "strict": True, "noEmit": True,
        },
        "files": ["consume.mts"],
    }), encoding="utf-8")
    run([node, tsc, "--project", "tsconfig.json"], project, env, "installed declarations failed strict NodeNext type checking")


def verify(args):
    manifest_bytes = args.release_json.read_bytes()
    manifest = json.loads(manifest_bytes)
    asset_url = release_identity(manifest, args.archive)
    archive = args.archive.read_bytes()
    archive_digest = sha256(archive)
    require(manifest.get("sha256") == archive_digest, "local archive SHA-256 differs from release.json")
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode("ascii")
    documented, argv = install_command(args.install_md.read_text(encoding="utf-8"), asset_url)

    install_url = asset_url
    if args.loopback_origin:
        require(re.fullmatch(r"http://127\.0\.0\.1:[1-9]\d{0,4}", args.loopback_origin), "expected a loopback HTTP origin with an explicit port")
        require(int(args.loopback_origin.rsplit(":", 1)[1]) <= 65535, "invalid loopback port")
        install_url = args.loopback_origin + urlsplit(asset_url).path
        argv[-1] = install_url
    manifest_url = install_url.rsplit("/", 1)[0] + "/release.json"

    node_name, npm_name = shutil.which("node"), shutil.which("npm")
    require(node_name and npm_name, "Node.js 26 and npm are required on PATH")
    node = Path(node_name).absolute()
    npm = Path(npm_name).absolute()
    tsc = args.tsc.resolve()
    require(tsc.is_file(), "a local TypeScript compiler is required")

    with tempfile.TemporaryDirectory(prefix="tsdm-public-install-") as directory:
        root = Path(directory)
        project = root / "consumer"
        project.mkdir()
        env = clean_environment(root, node, npm)
        node_version = run([node, "--version"], project, env, "Node.js version check failed")
        require(re.fullmatch(r"v26\.\d+\.\d+", node_version), "verification requires Node.js 26.x")
        npm_version = run([npm, "--version"], project, env, "npm version check failed")
        require(re.fullmatch(r"\d+\.\d+\.\d+", npm_version), "unexpected npm version format")
        typescript = run([node, tsc, "--version"], project, env, "TypeScript version check failed")
        require(typescript == f"Version {TYPESCRIPT_VERSION}", "verification requires TypeScript 6.0.3")

        opener = asset_opener(args.loopback_origin)
        require(fetch(opener, manifest_url, len(manifest_bytes)) == manifest_bytes, "downloaded release.json differs from the final local manifest")
        require(fetch(opener, install_url, len(archive)) == archive, "downloaded archive differs from the qualified local archive")

        (project / "package.json").write_text('{"private":true,"type":"module"}\n', encoding="utf-8")
        # Version checks and downloads must leave the actual install with a cold cache.
        shutil.rmtree(env["NPM_CONFIG_CACHE"])
        Path(env["NPM_CONFIG_CACHE"]).mkdir()
        run([npm, *argv[1:]], project, env, "anonymous npm install failed")
        check_install(project, manifest, install_url, integrity)
        check_imports(project, node, tsc, env)

    return {
        "status": "passed",
        "mode": "loopback" if args.loopback_origin else "public",
        "name": manifest["name"], "version": manifest["version"],
        "tag": manifest["tag"], "sourceCommit": manifest["sourceCommit"],
        "assetUrl": asset_url, "manifestUrl": asset_url.rsplit("/", 1)[0] + "/release.json",
        "archiveSHA256": archive_digest, "archiveBytes": len(archive),
        "manifestSHA256": sha256(manifest_bytes), "lockfileIntegrity": integrity,
        "installCommand": documented,
        "node": node_version, "npm": npm_version, "typescript": TYPESCRIPT_VERSION,
        "esm": "passed", "declarations": "strict NodeNext ES2023 without DOM types",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("archive", type=Path)
    parser.add_argument("release_json", type=Path)
    parser.add_argument("install_md", type=Path)
    parser.add_argument("--tsc", type=Path, required=True, help="local TypeScript 6.0.3 bin/tsc")
    parser.add_argument("--loopback-origin", help="fixture origin such as http://127.0.0.1:8080")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args), separators=(",", ":")))
    except VerificationError as error:
        parser.exit(1, f"Verification failed: {error}\n")
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, "Verification failed: local input, asset transfer, or subprocess error\n")


if __name__ == "__main__":
    main()
