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
assert.equal(
  process.argv.length,
  4,
  "Pass the SDK tarball and pinned upstream test/data path",
);
const [archive, fixtures] = process.argv.slice(2).map((path) => resolve(path));
const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "tsdm-account-consumer-"));
const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(
    join(cwd, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  for (const name of ["account.mjs", "account-pins.json"]) {
    copyFileSync(join(root, "tests/install", name), join(cwd, name));
  }
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
  const installed = join(cwd, "node_modules/tsdm-sdk");
  const readme = readFileSync(join(installed, "README.md"), "utf8");
  const guide = readFileSync(join(installed, "docs/account.md"), "utf8");
  assert.match(readme, /^## Tasks$/m);
  assert.ok(
    readme.includes("[Sign in and manage account security](docs/account.md)"),
  );
  assert.ok(guide.includes("[SDK tasks](../README.md#tasks)"));
  const example = guide.match(/^```ts\n([\s\S]+?)^```$/m)?.[1];
  assert.ok(example);
  writeFileSync(join(cwd, "account-example.ts"), example);
  const tsc = join(root, "node_modules/typescript/bin/tsc");
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
      files: ["account-example.ts"],
    }),
  );
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  const account = JSON.parse(run(process.execPath, ["account.mjs", fixtures]));
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed consumer and host handoffs",
        node: process.version,
        npm: run("npm", ["--version"]).trim(),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        documentation: {
          guide: "docs/account.md",
          links: "checked in tarball",
          example:
            "compiled against installed declarations without DOM types and executed",
        },
        archiveSHA256: createHash("sha256")
          .update(readFileSync(archive))
          .digest("hex"),
        ...account,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
