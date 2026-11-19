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
const repo = new URL("../", import.meta.url);
const input = new URL("../tests/install/spaces.mjs", import.meta.url);
const pins = JSON.parse(
  readFileSync(new URL("evidence/spaces/upstream-pins.json", repo)),
);
const upstream = process.env.TSDM_SPACES_UPSTREAM;
const directory = mkdtempSync(join(tmpdir(), "tsdm-spaces-"));
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(input, join(directory, "spaces.mjs"));
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
  const bytes = readFileSync(archive);
  const lock = JSON.parse(
    readFileSync(join(directory, "package-lock.json"), "utf8"),
  );
  assert.equal(
    lock.packages["node_modules/tsdm-sdk"].integrity,
    "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  );
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  const installed = join(directory, "node_modules/tsdm-sdk");
  const installedReadme = readFileSync(join(installed, "README.md"), "utf8");
  const guides = ["spaces", "messages"];
  for (const guideName of guides) {
    assert.ok(installedReadme.includes(`](docs/${guideName}.md)`));
    assert.deepEqual(
      readFileSync(join(installed, `docs/${guideName}.md`)),
      readFileSync(new URL(`docs/${guideName}.md`, repo)),
    );
  }
  const guide = readFileSync(join(installed, "docs/spaces.md"), "utf8");
  assert.ok(
    guide.includes("(../README.md#tasks)") && guide.includes("(account.md)"),
  );
  assert.ok(readFileSync(join(installed, "docs/account.md")).length);
  const example = /^```ts\n([\s\S]+?)^```$/m.exec(guide)?.[1];
  assert.ok(example);
  writeFileSync(join(directory, "spaces-guide.ts"), example);
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
      files: ["spaces-guide.ts"],
    }),
  );
  const tsc = new URL("node_modules/typescript/bin/tsc", repo).pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  if (upstream) {
    for (const [file, expected] of Object.entries(pins.sha256))
      assert.equal(digest(readFileSync(join(upstream, file))), expected, file);
  }
  const results = JSON.parse(
    run(process.execPath, ["spaces.mjs", ...process.argv.slice(3)]),
  );
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: lock.packages["node_modules/tsdm-sdk"].version,
        archiveSHA256: digest(bytes),
        syntheticInputsSHA256: digest(readFileSync(input)),
        guideSHA256: digest(guide),
        guides,
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        ambientTypes: [],
        sourcePin: {
          commit: pins.commit,
          verifiedFiles: upstream ? Object.keys(pins.sha256).length : 0,
        },
        evidence: "controlled installed SDK and host boundary",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
