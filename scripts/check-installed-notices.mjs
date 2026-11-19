import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.0.tgz");
const upstream = resolve(process.argv[3] ?? "");
assert.ok(process.argv[3], "Pass the pinned tsdm_client checkout as the second argument");
const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => readFileSync(file, "utf8");
const pins = JSON.parse(read(join(root, "evidence/notices/upstream-pins.json")));
for (const [file, sha256] of Object.entries(pins.sha256)) {
  assert.equal(digest(readFileSync(join(upstream, file))), sha256, file);
}
const cwd = mkdtempSync(join(tmpdir(), "tsdm-notice-consumer-"));
const run = (command, args) => execFileSync(command, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}\n');
  const inputs = {};
  for (const file of ["run.mjs", "consume.mjs", "deliberate.mjs"]) {
    const path = join(root, "tests/notices", file);
    copyFileSync(path, join(cwd, file));
    inputs[file] = digest(readFileSync(path));
  }
  const archivedPages = [1, 2].map((number) => {
    const { uid, time, notices, has_more, next, counts } = JSON.parse(
      read(join(upstream, `test/data/tsdmapp/v4/notify_paged_p${number}.json`)),
    );
    return { uid, time, notices: notices.map(({ id, dateline, new: unread, type, authorid }) => (
      { id, dateline, new: unread, type, authorid }
    )), has_more, next, counts: counts && { notice: counts.notice } };
  });
  writeFileSync(join(cwd, "archived-pages.json"), JSON.stringify(archivedPages));
  run("npm", ["install", "--offline", "--ignore-scripts", "--engine-strict", "--no-audit",
    "--no-fund", "--cache", join(cwd, "cache"), archive]);
  const bytes = readFileSync(archive);
  const lock = JSON.parse(read(join(cwd, "package-lock.json")));
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  assert.equal(lock.packages["node_modules/tsdm-sdk"].integrity,
    "sha512-" + createHash("sha512").update(bytes).digest("base64"));
  const results = JSON.parse(run(process.execPath, ["run.mjs"]));
  const installed = join(cwd, "node_modules/tsdm-sdk");
  const readme = read(join(installed, "README.md"));
  const guides = [...readme.matchAll(/\]\((docs\/[\w-]+\.md)\)/g)].map(([, file]) => file);
  assert.deepEqual(guides, ["docs/discovery.md", "docs/account.md", "docs/profile.md", "docs/members.md", "docs/notices.md"]);
  for (const file of guides) assert.equal(read(join(installed, file)), read(join(root, file)));
  const guide = read(join(installed, "docs/notices.md"));
  assert.match(guide, /\]\(\.\.\/README\.md#tasks\)/);
  assert.match(readme, /^## Tasks$/m);
  const example = guide.match(/^```ts\n([\s\S]+?)^```$/m)?.[1];
  assert.ok(example);
  writeFileSync(join(cwd, "notice-guide.ts"), example);
  writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "NodeNext", lib: ["ES2023"], typeRoots: [join(root, "node_modules/@types")], types: ["node"], strict: true, noEmit: true },
    files: ["notice-guide.ts"],
  }));
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  const pollOnly = run(process.execPath, ["notice-guide.ts"]);
  assert.match(pollOnly, /26771.*complete.*exhausted/);
  assert.doesNotMatch(pollOnly, /cleared/);
  const guideOutput = run(process.execPath, ["notice-guide.ts", "--acknowledge"]);
  assert.match(guideOutput, /26771.*complete.*exhausted/);
  assert.match(guideOutput, /cleared/);
  console.log(JSON.stringify({
    evidence: "controlled clean installed consumer and packed TypeScript guide",
    node: process.version, package: "tsdm-sdk@0.1.0", archiveSHA256: digest(bytes),
    upstreamCommit: pins.commit, verifiedSources: Object.keys(pins.sha256), inputs,
    archivedPagesSHA256: digest(readFileSync(join(cwd, "archived-pages.json"))),
    guides, typescript: run(process.execPath, [tsc, "--version"]).trim(),
    guideOutput: { pollOnly: pollOnly.trim(), acknowledged: guideOutput.trim().split("\n") }, results,
  }, null, 2));
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
