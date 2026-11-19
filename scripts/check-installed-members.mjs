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
import { fileURLToPath } from "node:url";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.0.tgz");
const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const input = join(root, "tests/install/members.mjs");
const pins = JSON.parse(
  readFileSync(join(root, "evidence/members/upstream-pins.json"), "utf8"),
);
const upstream = process.env.TSDM_MEMBERS_UPSTREAM;
if (upstream) {
  for (const [file, expected] of Object.entries(pins.sha256)) {
    assert.equal(digest(readFileSync(join(upstream, file))), expected, file);
  }
}
const cwd = mkdtempSync(join(tmpdir(), "tsdm-members-consumer-"));
const run = (command, args) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(
    join(cwd, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(input, join(cwd, "members.mjs"));
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
  const bytes = readFileSync(archive);
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
  assert.equal(
    lock.packages["node_modules/tsdm-sdk"].integrity,
    "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  );
  let guideCheck;
  if (process.argv.length < 4) {
    const installed = join(cwd, "node_modules/tsdm-sdk");
    const readme = readFileSync(join(installed, "README.md"), "utf8");
    const guide = readFileSync(join(installed, "docs/members.md"), "utf8");
    assert.ok(
      readme.includes(
        "[Find members, make friends and save favourites](docs/members.md)",
      ),
    );
    assert.ok(guide.includes("(../README.md#tasks)"));
    assert.ok(guide.includes("(account.md)"));
    assert.ok(readFileSync(join(installed, "docs/account.md"), "utf8"));
    const example = guide.match(/^```ts\n([\s\S]+?)^```$/m)?.[1];
    assert.ok(example);
    writeFileSync(join(cwd, "members-guide.ts"), example);
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          lib: ["ES2023"],
          types: [],
          strict: true,
          exactOptionalPropertyTypes: true,
        },
        files: ["members-guide.ts"],
      }),
    );
    const tsc = join(root, "node_modules/typescript/bin/tsc");
    run(process.execPath, [tsc, "--project", "tsconfig.json"]);
    guideCheck = {
      links: "checked in archive",
      declarations: run(process.execPath, [tsc, "--version"]).trim(),
      typescript:
        "compiled without DOM or ambient types and executed in the installed consumer",
    };
  }
  const results = JSON.parse(
    run(process.execPath, ["members.mjs", ...process.argv.slice(3)]),
  );
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed consumer and host transport",
        node: process.version,
        package: `tsdm-sdk@${lock.packages["node_modules/tsdm-sdk"].version}`,
        archiveSHA256: digest(bytes),
        syntheticInputsSHA256: digest(readFileSync(input)),
        sourcePin: {
          commit: pins.commit,
          verifiedFiles: upstream ? Object.keys(pins.sha256).length : 0,
        },
        guideCheck,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
