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
const pins = JSON.parse(read("../evidence/posts/upstream-pins.json"));
const upstream = process.env.TSDM_POSTS_UPSTREAM;
if (upstream) {
  for (const [file, sha256] of Object.entries(pins.sha256))
    assert.equal(hash(readFileSync(join(upstream, file))), sha256, file);
}
const cwd = mkdtempSync(join(tmpdir(), "tsdm-post-consumer-"));
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
  const consumer = read("../tests/install/posts.mjs");
  writeFileSync(join(cwd, "posts.mjs"), consumer);
  const installed = join(cwd, "node_modules/tsdm-sdk");
  const guide = readFileSync(join(installed, "docs/posts.md"));
  assert.deepEqual(guide, read("../docs/posts.md"));
  const readme = readFileSync(join(installed, "README.md"), "utf8");
  assert.match(readme, /^## Tasks$/m);
  for (const task of ["posts", "replies"]) {
    assert.ok(readme.includes(`](docs/${task}.md)`));
    assert.ok(readFileSync(join(installed, `docs/${task}.md`)).length);
  }
  for (const match of guide.toString().matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    assert.ok(readFileSync(resolve(installed, "docs", target)).length);
  }
  const example = /^```ts\n([\s\S]+?)^```$/m.exec(guide)?.[1];
  assert.ok(example);
  writeFileSync(join(cwd, "posts-guide.ts"), example);
  writeFileSync(
    join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        target: "ES2023",
        lib: ["ES2023"],
        types: [],
        strict: true,
        exactOptionalPropertyTypes: true,
      },
      files: ["posts-guide.ts"],
    }),
  );
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  const results = JSON.parse(run(process.execPath, ["posts.mjs"]));
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
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        ambientTypes: [],
        upstream: {
          commit: pins.commit,
          filesVerified: upstream ? Object.keys(pins.sha256).length : 0,
        },
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
