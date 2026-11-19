import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.0.tgz");
const hash = (input, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(input).digest(encoding);
const read = (relative) => readFileSync(new URL(relative, import.meta.url));
const inputs = read("../tests/install/collections.mjs");
const guide = read("../docs/collections.md");
const pinFile = read("../evidence/collections/upstream-pins.json");
const pins = JSON.parse(pinFile);
const upstream = process.env.TSDM_COLLECTIONS_UPSTREAM;
if (upstream) {
  for (const [file, expected] of Object.entries(pins.sha256)) {
    assert.equal(hash(readFileSync(join(upstream, file))), expected, file);
  }
}
const cwd = mkdtempSync(join(tmpdir(), "tsdm-collections-"));
const run = (command, args) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(
    join(cwd, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  const install = [
    "install",
    "--offline",
    "--ignore-scripts",
    "--engine-strict",
    "--no-audit",
    "--no-fund",
    "--cache",
    "./cache",
    archive,
  ];
  run("npm", install);
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
  const bytes = readFileSync(archive);
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  assert.equal(
    lock.packages["node_modules/tsdm-sdk"].integrity,
    `sha512-${hash(bytes, "sha512", "base64")}`,
  );
  const installed = join(cwd, "node_modules/tsdm-sdk");
  assert.deepEqual(readFileSync(join(installed, "docs/collections.md")), guide);
  const readme = readFileSync(join(installed, "README.md"), "utf8");
  const packagedGuides = [...readme.matchAll(/\]\((docs\/[^)#]+\.md)\)/g)].map(
    (match) => match[1],
  );
  assert.ok(packagedGuides.includes("docs/collections.md"));
  assert.ok(packagedGuides.includes("docs/spaces.md"));
  for (const path of packagedGuides)
    assert.deepEqual(readFileSync(join(installed, path)), read(`../${path}`));
  assert.match(guide.toString(), /\]\(\.\.\/README.md#tasks\)/);
  assert.match(readme, /^## Tasks$/m);
  const ts = /^```ts\n([\s\S]+?)^```$/m.exec(guide.toString())?.[1];
  assert.ok(ts);
  writeFileSync(join(cwd, "example.ts"), ts);
  writeFileSync(
    join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        target: "ES2023",
        types: [],
        strict: true,
        exactOptionalPropertyTypes: true,
      },
      files: ["example.ts"],
    }),
  );
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
  run(process.execPath, [tsc, "--noEmit", "--project", "tsconfig.json"]);
  const example = run(process.execPath, ["example.ts"]).trim();
  assert.equal(example, "91 Example Archive");
  writeFileSync(join(cwd, "collections.mjs"), inputs);
  const results = JSON.parse(run(process.execPath, ["collections.mjs"]));
  console.log(
    JSON.stringify(
      {
        evidence:
          "controlled installed SDK and host transport, with fictitious accounts",
        node: process.version,
        npm: run("npm", ["--version"]).trim(),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        package: `tsdm-sdk@${lock.packages["node_modules/tsdm-sdk"].version}`,
        install: [...install.slice(0, -1), "<archive>"],
        archiveBytes: bytes.length,
        archiveSHA256: hash(bytes),
        syntheticInputsSHA256: hash(inputs),
        guideSHA256: hash(guide),
        sourcePin: { commit: pins.commit, manifestSHA256: hash(pinFile) },
        packagedGuides,
        guideExample: { expected: "91 Example Archive", observed: example },
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
