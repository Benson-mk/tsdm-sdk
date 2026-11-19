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
const cwd = mkdtempSync(join(tmpdir(), "tsdm-message-consumer-"));
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
  const consumer = read("../tests/install/messages.mjs");
  writeFileSync(join(cwd, "messages.mjs"), consumer);
  const installed = join(cwd, "node_modules/tsdm-sdk");
  const guide = read("../docs/messages.md");
  assert.deepEqual(readFileSync(join(installed, "docs/messages.md")), guide);
  assert.match(
    readFileSync(join(installed, "README.md"), "utf8"),
    /\[Read and send private messages\]\(docs\/messages.md\)/,
  );
  assert.match(guide.toString(), /\]\(\.\.\/README.md#tasks\)/);
  const example = /^```ts\n([\s\S]+?)^```$/m.exec(guide.toString())?.[1];
  assert.ok(example);
  writeFileSync(join(cwd, "messages.ts"), example);
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
  const typeRoots = new URL("../node_modules/@types", import.meta.url).pathname;
  run(process.execPath, [
    tsc,
    "--strict",
    "--noEmit",
    "--module",
    "NodeNext",
    "--lib",
    "ES2023",
    "--types",
    "node",
    "--typeRoots",
    typeRoots,
    "messages.ts",
  ]);
  const guideOutput = run(process.execPath, ["messages.ts"]).trim();
  assert.equal(guideOutput, "702 Fake message");
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed SDK and host",
        node: process.version,
        package: `tsdm-sdk@${lock.packages["node_modules/tsdm-sdk"].version}`,
        archiveSHA256: hash(bytes),
        archiveBytes: bytes.length,
        consumerSHA256: hash(consumer),
        guideSHA256: hash(guide),
        guideOutput,
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        results: JSON.parse(run(process.execPath, ["messages.mjs"])),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
