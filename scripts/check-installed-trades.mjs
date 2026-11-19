import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.0.tgz");
const bytes = readFileSync(archive);
const hash = (input, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(input).digest(encoding);
const read = (relative) => readFileSync(new URL(relative, import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "tsdm-trades-consumer-"));
const tsc = resolve("node_modules/typescript/bin/tsc");
const run = (command, args) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(
    join(cwd, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--engine-strict",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(cwd, "cache"),
    archive,
  ]);
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json")));
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  assert.equal(
    lock.packages["node_modules/tsdm-sdk"].integrity,
    `sha512-${hash(bytes, "sha512", "base64")}`,
  );
  const installed = join(cwd, "node_modules", "tsdm-sdk");
  const guide = readFileSync(join(installed, "docs", "trades.md"));
  assert.match(
    readFileSync(join(installed, "README.md"), "utf8"),
    /\]\(docs\/trades\.md\)/,
  );
  const example = /^```ts\n([\s\S]+?)^```$/m.exec(guide.toString());
  assert.ok(example);
  writeFileSync(join(cwd, "example.mts"), example[1]);
  writeFileSync(join(cwd, "empty-types.d.ts"), "");
  run(process.execPath, [
    tsc,
    "--strict",
    "--target",
    "es2024",
    "--lib",
    "es2024",
    "--module",
    "nodenext",
    "--types",
    join(cwd, "empty-types.d.ts"),
    "example.mts",
  ]);
  const consumer = read("../tests/install/trades.mjs");
  writeFileSync(join(cwd, "trades.mjs"), consumer);
  const results = JSON.parse(run(process.execPath, ["trades.mjs"]));
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed SDK and host",
        node: process.version,
        package: `tsdm-sdk@${lock.packages["node_modules/tsdm-sdk"].version}`,
        archiveSHA256: hash(bytes),
        archiveBytes: bytes.length,
        lockfileIntegrity: lock.packages["node_modules/tsdm-sdk"].integrity,
        guideSHA256: hash(guide),
        consumerSHA256: hash(consumer),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
