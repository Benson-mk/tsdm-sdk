import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.versions.node.split(".")[0] !== "26" || process.argv.length !== 3) {
  throw new Error(
    "Run with Node.js 26.x: node scripts/check-installed-sdk.mjs <tarball>",
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
const archive = resolve(process.argv[2]);
const fixtureRoot =
  process.env.TSDM_READ_FIXTURES && resolve(process.env.TSDM_READ_FIXTURES);
const discoveryRoot =
  process.env.TSDM_DISCOVERY_FIXTURES &&
  resolve(process.env.TSDM_DISCOVERY_FIXTURES);
const cwd = mkdtempSync(join(tmpdir(), "tsdm-sdk-consumer-"));
console.error(`Clean consumer: ${cwd}`);
writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}\n');
for (const [source, target] of [
  ["consumer.mjs", "consumer.mjs"],
  ["types.ts", "types.ts"],
  ["fixtures/thread_plain.json", "thread_plain.json"],
  ...(discoveryRoot
    ? [
        ["discovery.mjs", "discovery.mjs"],
        ["discovery-pins.json", "discovery-pins.json"],
      ]
    : []),
  ...(fixtureRoot
    ? [
        ["board-thread.mjs", "board-thread.mjs"],
        ["board-thread-pins.json", "board-thread-pins.json"],
      ]
    : []),
]) {
  copyFileSync(join(root, "tests/install", source), join(cwd, target));
}
const exec = (command, args) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
const sha256 = (contents) =>
  createHash("sha256").update(contents).digest("hex");
const npmVersion = exec("npm", ["--version"]).trim();
execFileSync(
  "npm",
  [
    "install",
    "--offline",
    "--ignore-scripts",
    "--engine-strict",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(cwd, "npm-cache"),
    archive,
  ],
  { cwd, stdio: ["ignore", 2, 2] },
);
const observed = JSON.parse(exec(process.execPath, ["consumer.mjs"]));
const boardThread =
  fixtureRoot &&
  JSON.parse(
    execFileSync(process.execPath, ["board-thread.mjs"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TSDM_READ_FIXTURES: fixtureRoot },
    }),
  );
const installed = join(cwd, "node_modules/tsdm-sdk");
const readme = readFileSync(join(installed, "README.md"), "utf8");
assert.match(
  readme,
  /\[Read a public board and open a thread\]\(#read-a-public-board-and-open-a-thread\)/,
);
assert.match(readme, /^## Read a public board and open a thread$/m);
const guidePath = "docs/discovery.md";
assert.ok(readme.includes(`](${guidePath})`), "README discovery link");
const guide = readFileSync(join(installed, guidePath), "utf8");
assert.match(guide, /\]\(\.\.\/README\.md#tasks\)/);
assert.match(readme, /^## Tasks$/m);
const example = guide.match(/^```ts\n([\s\S]+?)^```$/m)?.[1];
assert.ok(example, "Packaged TypeScript discovery example");
writeFileSync(join(cwd, "discovery-guide.ts"), example);
const documentation = {
  guide: guidePath,
  checkedLinks: [
    "README.md#read-a-public-board-and-open-a-thread",
    "docs/discovery.md",
    "README.md#tasks",
  ],
  example: discoveryRoot
    ? "compiled and executed from installed guide"
    : "compiled from installed guide",
};
const discovery =
  discoveryRoot &&
  JSON.parse(
    execFileSync(process.execPath, ["discovery.mjs"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TSDM_DISCOVERY_FIXTURES: discoveryRoot },
    }),
  );
const tsc = join(root, "node_modules/typescript/bin/tsc");
const typescript = exec(process.execPath, [tsc, "--version"]).trim();
writeFileSync(
  join(cwd, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        lib: ["ES2023"],
        types: [],
        strict: true,
        noEmit: true,
      },
      files: ["types.ts", "discovery-guide.ts"],
    },
    null,
    2,
  ) + "\n",
);
execFileSync(process.execPath, [tsc, "--project", "tsconfig.json"], {
  cwd,
  stdio: ["ignore", 2, 2],
});

const packageJson = JSON.parse(
  readFileSync(join(installed, "package.json"), "utf8"),
);
assert.equal(packageJson.name, "tsdm-sdk");
assert.equal(packageJson.version, "0.1.0");
assert.equal(packageJson.private, true);
assert.equal(packageJson.type, "module");
assert.equal(packageJson.engines.node, "26.x");
assert.deepEqual(packageJson.exports, {
  ".": { types: "./index.d.ts", import: "./index.js" },
});
assert.deepEqual(packageJson.dependencies ?? {}, {});
const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
const bytes = readFileSync(archive);
const integrity =
  "sha512-" + createHash("sha512").update(bytes).digest("base64");
assert.equal(lock.packages["node_modules/tsdm-sdk"].integrity, integrity);
assert.match(
  readFileSync(join(installed, "README.md"), "utf8"),
  /unofficial TypeScript SDK for the TSDM forum/,
);
const notices = ["parse5-8.0.1.LICENSE", "entities-8.1.0.LICENSE"];
const noticeSha256 = {};
for (const notice of notices) {
  const bytes = readFileSync(join(installed, "notices", notice));
  assert.deepEqual(
    bytes,
    readFileSync(join(root, "evidence/history/notices", notice)),
    `Installed ${notice} matches the retained upstream notice byte-for-byte`,
  );
  noticeSha256[notice] = sha256(bytes);
}

// SHA-256 of the standard MIT permission and warranty text with whitespace
// collapsed to single spaces, excluding the title and copyright notice.
const mitTermsSha256 =
  "fe2a9817987f862eaced948f0468c7f51d2fedfc48c5c505b246a49a3870e9a5";
const licensePath = join(installed, "LICENSE");
const readmeLicenseTarget =
  readme.match(/(?<!!)\[[^\]\n]+\]\(((?:\.\/)?LICENSE)\)/)?.[1];
const licenseFailures = [];
if (packageJson.license !== "MIT") {
  licenseFailures.push(
    `package.json license expected "MIT", got ${JSON.stringify(packageJson.license)}`,
  );
}
if (!readmeLicenseTarget) {
  licenseFailures.push("README.md is missing a relative link to LICENSE");
}
if (!existsSync(licensePath)) {
  licenseFailures.push("LICENSE is missing from the installed package");
}
assert.deepEqual(licenseFailures, [], "Installed first-party distribution terms");

const license = readFileSync(licensePath);
const terms = license
  .toString("utf8")
  .trim()
  .match(
    /^(?:MIT License[ \t]*\r?\n\s*)?Copyright \(c\) [^\r\n]+\r?\n([\s\S]+)$/,
  )?.[1];
assert.equal(
  terms && sha256(terms.trim().replace(/\s+/g, " ")),
  mitTermsSha256,
  "Installed LICENSE must contain a copyright notice and the standard MIT terms",
);
assert.ok(
  license.equals(readFileSync(join(root, "LICENSE"))),
  "Installed LICENSE must match the repository LICENSE byte-for-byte",
);

console.log(
  JSON.stringify(
    {
      archive: basename(archive),
      sha256: sha256(bytes),
      integrity,
      node: process.version,
      npm: npmVersion,
      typescript,
      typecheck: "strict NodeNext, ES2023, types: [], noEmit",
      notices,
      noticeSha256,
      license: {
        identifier: packageJson.license,
        readmeTarget: readmeLicenseTarget,
        sha256: sha256(license),
        terms: "standard MIT",
        matchesRepository: true,
      },
      ...observed,
      ...(boardThread ? { boardThread } : {}),
      documentation,
      ...(discovery ? { discovery } : {}),
    },
    null,
    2,
  ),
);
