import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdtempDisposableSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

assert.equal(process.versions.node.split(".")[0], "26", "Use Node.js 26.x");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const archivePath = resolve(
  process.argv[2] ?? join(root, "dist/tsdm-sdk-0.1.0.tgz"),
);
const manifestPath = resolve(
  process.argv[3] ?? join(root, "tests/rehearsal/release.json"),
);
const receiptPath = resolve(
  process.argv[4] ?? join(root, "evidence/rehearsal/receipt.json"),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const archive = readFileSync(archivePath);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integrity = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

assert.equal(basename(archivePath), manifest.filename);
assert.equal(sha256(archive), manifest.sha256);
assert.equal(manifest.name, "tsdm-sdk");
assert.equal(manifest.version, "0.1.0");
assert.equal(manifest.tag, "v0.1.0");
const precommit = process.argv[5] === "--candidate";
if (precommit) {
  const inputs = readFileSync(join(dirname(manifestPath), "package-inputs.json"));
  assert.equal(manifest.packageInputsSHA256, sha256(inputs));
} else {
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
}
assert.equal(
  manifest.assetUrl,
  "https://github.com/Benson-mk/tsdm-sdk/releases/download/v0.1.0/tsdm-sdk-0.1.0.tgz",
);

using scratch = mkdtempDisposableSync(join(tmpdir(), "tsdm-sdk-41-"));
const workspace = scratch.path;
const originalIntegrity = integrity(archive);
const sourceConsumer = readFileSync(
  join(root, "tests/rehearsal/consume.mts"),
  "utf8",
);
const tsc = join(root, "node_modules/typescript/bin/tsc");
assert.ok(existsSync(tsc), "Run npm ci before the rehearsal");

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

function writeConsumerFiles(directory) {
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(directory, "consume.mjs"),
    `import { createForumClient } from "tsdm-sdk";
const client = createForumClient({
  origin: "https://forum.test",
  transport: { async request() { throw new Error("import probe made a request"); } },
});
if (typeof client.readThread !== "function") throw new Error("missing readThread");
console.log(JSON.stringify({ import: "tsdm-sdk", method: "readThread" }));
`,
  );
  writeFileSync(join(directory, "consume.mts"), sourceConsumer);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          target: "ES2023",
          lib: ["ES2023"],
          types: [],
          strict: true,
          noEmit: true,
        },
        files: ["consume.mts"],
      },
      null,
      2,
    ) + "\n",
  );
}

function emptyCache(directory) {
  const cache = join(directory, "npm-cache");
  mkdirSync(cache, { recursive: true });
  assert.deepEqual(readdirSync(cache), []);
  return cache;
}

const exec = promisify(execFile);
function npmInstall(directory, cache, mode, url) {
  const args = [
    mode === "ci" ? "ci" : "install",
    "--cache",
    cache,
    "--ignore-scripts",
    "--engine-strict",
    "--no-audit",
    "--no-fund",
    "--fetch-retries=0",
    "--fetch-timeout=10000",
    ...(url ? ["--save-exact", url] : []),
  ];
  return exec("npm", args, { cwd: directory, timeout: 20000 });
}

function installedVersion(directory) {
  return JSON.parse(
    readFileSync(join(directory, "node_modules/tsdm-sdk/package.json"), "utf8"),
  ).version;
}

function lockEntry(directory) {
  const lock = JSON.parse(
    readFileSync(join(directory, "package-lock.json"), "utf8"),
  );
  return { lock, entry: lock.packages["node_modules/tsdm-sdk"] };
}

const newerDirectory = join(workspace, "newer-package");
mkdirSync(newerDirectory);
run("tar", ["-xzf", archivePath, "-C", newerDirectory], root);
const newerPackageDirectory = join(newerDirectory, "package");
const newerPackageJsonPath = join(newerPackageDirectory, "package.json");
const newerPackageJson = JSON.parse(readFileSync(newerPackageJsonPath, "utf8"));
newerPackageJson.version = "0.1.1";
writeFileSync(
  newerPackageJsonPath,
  JSON.stringify(newerPackageJson, null, 2) + "\n",
);
const packCache = emptyCache(join(workspace, "pack"));
const newerPackOutput = JSON.parse(
  run(
    "npm",
    [
      "pack",
      newerPackageDirectory,
      "--offline",
      "--ignore-scripts",
      "--pack-destination",
      newerDirectory,
      "--cache",
      packCache,
      "--json",
    ],
    root,
  ),
)[0];
const newerArchivePath = join(newerDirectory, newerPackOutput.filename);
const newerArchive = readFileSync(newerArchivePath);
assert.equal(newerPackOutput.name, "tsdm-sdk");
assert.equal(newerPackOutput.version, "0.1.1");

const originalAssetPath = new URL(manifest.assetUrl).pathname;
const originalManifestPath = originalAssetPath.replace(
  manifest.filename,
  "release.json",
);
const newerAssetPath = originalAssetPath
  .replace("/v0.1.0/", "/v0.1.1/")
  .replace(manifest.filename, newerPackOutput.filename);
const alteredArchive = Buffer.from(archive);
// Change the gzip MTIME without changing the tar stream.
assert.equal(archive[3] & 2, 0, "The npm archive has no gzip header CRC");
alteredArchive[4] ^= 1;
assert.notEqual(sha256(alteredArchive), manifest.sha256);
assert.deepEqual(gunzipSync(alteredArchive), gunzipSync(archive));
let stage = "manifest";
const requests = [];
await using server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  requests.push({ stage, path });
  if (path === originalManifestPath) {
    const body = readFileSync(manifestPath);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": body.length,
    });
    response.end(body);
    return;
  }
  const newerAvailable = stage !== "manifest" && stage !== "install";
  if (path === originalAssetPath || (newerAvailable && path === newerAssetPath)) {
    const bytes =
      path === originalAssetPath
        ? stage === "altered"
          ? alteredArchive
          : archive
        : newerArchive;
    response.writeHead(200, {
      "content-type": "application/gzip",
      "content-length": bytes.length,
    });
    response.end(bytes);
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const originalUrl = baseUrl + originalAssetPath;
const newerUrl = baseUrl + newerAssetPath;
const servedManifest = await fetch(baseUrl + originalManifestPath, {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
});
assert.equal(servedManifest.status, 200);
assert.deepEqual(await servedManifest.json(), manifest);

const consumer = join(workspace, "consumer");
mkdirSync(consumer);
writeConsumerFiles(consumer);
const initialCache = emptyCache(consumer);
stage = "install";
await npmInstall(consumer, initialCache, "install", originalUrl);
const initialRuntime = JSON.parse(
  run(process.execPath, ["consume.mjs"], consumer),
);
assert.deepEqual(initialRuntime, { import: "tsdm-sdk", method: "readThread" });
run(process.execPath, [tsc, "--project", "tsconfig.json"], consumer);
assert.equal(installedVersion(consumer), "0.1.0");
const initialLock = lockEntry(consumer);
assert.equal(
  initialLock.lock.packages[""].dependencies["tsdm-sdk"],
  originalUrl,
);
assert.equal(initialLock.entry.version, "0.1.0");
assert.equal(initialLock.entry.resolved, originalUrl);
assert.equal(initialLock.entry.integrity, originalIntegrity);
const pinnedPackageJson = readFileSync(join(consumer, "package.json"));
const pinnedLockfile = readFileSync(join(consumer, "package-lock.json"));

const upgradeCache = emptyCache(join(workspace, "upgrade"));
stage = "upgrade";
await npmInstall(consumer, upgradeCache, "install", newerUrl);
assert.equal(installedVersion(consumer), "0.1.1");
const upgradedLock = lockEntry(consumer);
assert.equal(upgradedLock.lock.packages[""].dependencies["tsdm-sdk"], newerUrl);
assert.equal(upgradedLock.entry.resolved, newerUrl);
assert.equal(upgradedLock.entry.version, "0.1.1");
assert.equal(upgradedLock.entry.integrity, integrity(newerArchive));

writeFileSync(join(consumer, "package.json"), pinnedPackageJson);
writeFileSync(join(consumer, "package-lock.json"), pinnedLockfile);
rmSync(join(consumer, "node_modules"), { recursive: true, force: true });
const restoreCache = emptyCache(join(workspace, "restore"));
stage = "restore";
await npmInstall(consumer, restoreCache, "ci");
assert.equal(installedVersion(consumer), "0.1.0");
assert.deepEqual(
  readFileSync(join(consumer, "package-lock.json")),
  pinnedLockfile,
);
assert.deepEqual(readFileSync(join(consumer, "package.json")), pinnedPackageJson);
const restoredLock = lockEntry(consumer);
assert.equal(restoredLock.entry.resolved, originalUrl);
assert.equal(restoredLock.entry.integrity, originalIntegrity);
assert.deepEqual(
  JSON.parse(run(process.execPath, ["consume.mjs"], consumer)),
  initialRuntime,
);
stage = "verify-newer";
const availableNewer = await fetch(newerUrl, {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
});
assert.equal(availableNewer.status, 200);
assert.equal(
  sha256(Buffer.from(await availableNewer.arrayBuffer())),
  sha256(newerArchive),
);

const alteredConsumer = join(workspace, "altered-consumer");
mkdirSync(alteredConsumer);
writeFileSync(join(alteredConsumer, "package.json"), pinnedPackageJson);
writeFileSync(join(alteredConsumer, "package-lock.json"), pinnedLockfile);
const alteredCache = emptyCache(alteredConsumer);
stage = "altered";
let alteredError;
try {
  await npmInstall(alteredConsumer, alteredCache, "ci");
} catch (error) {
  alteredError = error;
}
assert.ok(alteredError, "Altered bytes unexpectedly installed");
const alteredOutput = `${alteredError.stdout}\n${alteredError.stderr}`;
assert.equal(alteredError.code, 1);
assert.match(alteredOutput, /npm error code EINTEGRITY\b/);
const expectedPaths = {
  manifest: originalManifestPath,
  install: originalAssetPath,
  upgrade: newerAssetPath,
  restore: originalAssetPath,
  "verify-newer": newerAssetPath,
  altered: originalAssetPath,
};
const observedPaths = Object.fromEntries(
  requests.map(({ stage, path }) => [stage, path]),
);
assert.deepEqual(observedPaths, expectedPaths);
assert.ok(requests.every(({ stage, path }) => expectedPaths[stage] === path));

const receipt = {
  schema: 1,
  status: "passed",
  scope: "Local release rehearsal using loopback HTTP",
  package: {
    ...manifest,
    integrity: originalIntegrity,
  },
  newerAsset: {
    version: "0.1.1",
    filename: basename(newerArchivePath),
    sha256: sha256(newerArchive),
  },
  prerequisites: {
    node: process.version,
    npm: run("npm", ["--version"], root).trim(),
    typescript: run(process.execPath, [tsc, "--version"], root).trim(),
    typecheck: "strict NodeNext, ES2023, types: [], noEmit",
  },
  commands: [
    precommit ? "python3 evidence/release/0.1.0/build-candidate.py <output>" : "sh tests/rehearsal/build-source.sh <full-source-commit> <output>",
    `npm run test:rehearsal -- <output>/tsdm-sdk-0.1.0.tgz <output>/${precommit ? "candidate.json <output>/receipt.json --candidate" : "release.json <output>/receipt.json"}`,
    `npm install --cache <empty> --ignore-scripts --engine-strict --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000 --save-exact <loopback>${originalAssetPath}`,
    "node consume.mjs",
    "node <repo>/node_modules/typescript/bin/tsc --project tsconfig.json",
    `npm install --cache <empty> --ignore-scripts --engine-strict --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000 --save-exact <loopback>${newerAssetPath}`,
    "npm ci --cache <empty> --ignore-scripts --engine-strict --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000",
    "node consume.mjs",
    "npm ci --cache <empty> --ignore-scripts --engine-strict --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000",
  ],
  steps: [
    {
      name: "manifest",
      expected:
        `The manifest names tsdm-sdk 0.1.0, tag v0.1.0, ${precommit ? "package input fingerprint" : "full source commit"}, exact filename and archive SHA-256.`,
      observed: "The versioned manifest matched the local manifest and its SHA-256 matched the archive bytes.",
    },
    {
      name: "initial-versioned-install",
      expected:
        "An empty-cache install from the loopback v0.1.0 URL creates a lock entry for that URL and its integrity hash.",
      observed: {
        version: initialLock.entry.version,
        resolved: initialLock.entry.resolved.replace(baseUrl, "<loopback>"),
        integrity: initialLock.entry.integrity,
        import: initialRuntime,
      },
    },
    {
      name: "declarations",
      expected:
        "The package-root ESM consumer and declarations compile without DOM types.",
      observed: "Runtime import and no-emit TypeScript check both passed.",
    },
    {
      name: "newer-version",
      expected:
        "Changing the dependency to a newer versioned URL installs 0.1.1.",
      observed: {
        version: upgradedLock.entry.version,
        resolved: upgradedLock.entry.resolved.replace(baseUrl, "<loopback>"),
        integrity: upgradedLock.entry.integrity,
      },
    },
    {
      name: "lockfile-restore",
      expected:
        "Restoring the original package.json and lockfile, then running npm ci with an empty cache, installs 0.1.0 again.",
      observed: {
        version: installedVersion(consumer),
        resolved: restoredLock.entry.resolved.replace(baseUrl, "<loopback>"),
        integrity: restoredLock.entry.integrity,
        manifestRestored: true,
        lockRestored: true,
        import: initialRuntime,
        newerAssetStillAvailable: true,
      },
    },
    {
      name: "altered-byte-integrity",
      expected:
        "A one-byte change at the pinned v0.1.0 URL fails the empty-cache npm ci with EINTEGRITY.",
      observed: {
        error: "EINTEGRITY",
        exitStatus: alteredError.code,
        alteredSHA256: sha256(alteredArchive),
        sameUncompressedPayload: true,
      },
    },
  ],
  loopback: {
    expectedPaths,
    observedPaths,
  },
};

mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
