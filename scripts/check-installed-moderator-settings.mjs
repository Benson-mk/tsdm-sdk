import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.0.tgz");
const directory = mkdtempSync(join(tmpdir(), "tsdm-moderator-panel-"));
const source = new URL(
  "../tests/install/moderator-settings.mjs",
  import.meta.url,
);
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
try {
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(source, join(directory, "consumer.mjs"));
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--engine-strict",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(directory, "cache"),
    archive,
  ]);
  const lock = JSON.parse(
    readFileSync(join(directory, "package-lock.json"), "utf8"),
  );
  const bytes = readFileSync(archive);
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  const installed = lock.packages["node_modules/tsdm-sdk"];
  assert.equal(
    installed.integrity,
    "sha512-" + digest(bytes, "sha512", "base64"),
  );
  const { results } = JSON.parse(run(process.execPath, ["consumer.mjs"]));
  const docs = join(directory, "node_modules", "tsdm-sdk", "docs");
  const guide = readFileSync(join(docs, "moderator-settings.md"), "utf8");
  assert.equal(
    guide,
    readFileSync(
      new URL("../docs/moderator-settings.md", import.meta.url),
      "utf8",
    ),
  );
  assert.match(
    readFileSync(join(docs, "../README.md"), "utf8"),
    /\]\(docs\/moderator-settings.md\)/,
  );
  for (const link of [
    "moderator-queues.md",
    "moderator-queues.md#direct-http",
    "admin.md",
  ]) {
    assert.ok(guide.includes(`](${link})`));
    const [name, fragment] = link.split("#");
    const text = readFileSync(join(docs, name), "utf8");
    if (fragment) assert.match(text, /^## Direct HTTP$/m);
  }
  const snippet = /^```ts\n([\s\S]+?)^```$/m.exec(guide)?.[1];
  assert.ok(snippet);
  writeFileSync(join(directory, "guide.ts"), snippet);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        target: "ES2023",
        lib: ["ES2023"],
        types: [],
        strict: true,
        exactOptionalPropertyTypes: true,
      },
      files: ["guide.ts"],
    }),
  );
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  copyFileSync(
    new URL("../tests/install/moderator-settings-guide.mjs", import.meta.url),
    join(directory, "guide-run.mjs"),
  );
  results.push(JSON.parse(run(process.execPath, ["guide-run.mjs"])));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: installed.version,
        archiveSHA256: digest(bytes),
        consumerSHA256: digest(readFileSync(source)),
        guideSHA256: digest(guide),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
