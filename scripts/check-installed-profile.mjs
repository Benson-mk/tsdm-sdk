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
assert.ok(
  process.argv.length >= 4,
  "Pass the archive, pinned test/data directory and optional scenario",
);
const [archive, fixtures] = process.argv
  .slice(2, 4)
  .map((path) => resolve(path));
const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "tsdm-profile-consumer-"));
const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(
    join(cwd, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  for (const file of ["profile.mjs", "profile-pins.json"]) {
    copyFileSync(join(root, "tests/install", file), join(cwd, file));
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
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
  assert.equal(
    lock.packages["node_modules/tsdm-sdk"].integrity,
    "sha512-" +
      createHash("sha512").update(readFileSync(archive)).digest("base64"),
  );
  const installed = join(cwd, "node_modules/tsdm-sdk");
  const { name, version } = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  let documentation;
  if (!process.argv[4]) {
    const readme = readFileSync(join(installed, "README.md"), "utf8");
    const guide = readFileSync(join(installed, "docs/profile.md"), "utf8");
    assert.match(readme, /^## Tasks$/m);
    assert.ok(
      readme.includes(
        "[Manage profile, privacy, devices and forum sync](docs/profile.md)",
      ),
    );
    assert.ok(guide.includes("[SDK tasks](../README.md#tasks)"));
    assert.ok(guide.includes("(account.md)"));
    assert.ok(readFileSync(join(installed, "docs/account.md"), "utf8"));
    const example = guide.match(/^```ts\n([\s\S]+?)^```$/m)?.[1];
    assert.ok(example);
    const tsc = join(root, "node_modules/typescript/bin/tsc");
    writeFileSync(join(cwd, "profile-guide.ts"), example);
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
        files: ["profile-guide.ts"],
      }),
    );
    run(process.execPath, [tsc, "--project", "tsconfig.json"]);
    documentation = {
      guide: "docs/profile.md",
      links: "checked in archive",
      typescript: run(process.execPath, [tsc, "--version"]).trim(),
      example:
        "compiled without DOM or ambient types and executed from the archive",
    };
  }
  const observed = JSON.parse(
    run(process.execPath, ["profile.mjs", fixtures, ...process.argv.slice(4)]),
  );
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed consumer and host handoffs",
        package: `${name}@${version}`,
        node: process.version,
        npm: run("npm", ["--version"]).trim(),
        archiveSHA256: createHash("sha256")
          .update(readFileSync(archive))
          .digest("hex"),
        documentation,
        ...observed,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
