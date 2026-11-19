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
const source = new URL("../tests/install/pokemon-battles.mjs", import.meta.url);
const pinsURL = new URL(
  "../evidence/pokemon-battles/pins.json",
  import.meta.url,
);
const pins = JSON.parse(readFileSync(pinsURL));
assert.ok(
  process.env.TSDM_POKEMON_UPSTREAM,
  "Set TSDM_POKEMON_UPSTREAM to the pinned upstream source tree",
);
const upstream = resolve(process.env.TSDM_POKEMON_UPSTREAM);
const directory = mkdtempSync(join(tmpdir(), "tsdm-pokemon-"));
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
try {
  for (const [file, hash] of Object.entries(pins.files))
    assert.equal(digest(readFileSync(join(upstream, file))), hash, file);
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(source, join(directory, "pokemon.mjs"));
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
  const { results } = JSON.parse(
    run(process.execPath, ["pokemon.mjs", upstream]),
  );
  const dir = join(directory, "node_modules/tsdm-sdk");
  const guide = readFileSync(join(dir, "docs/pokemon-battles.md"), "utf8");
  assert.equal(
    guide,
    readFileSync(
      new URL("../docs/pokemon-battles.md", import.meta.url),
      "utf8",
    ),
  );
  assert.match(
    readFileSync(join(dir, "README.md"), "utf8"),
    /\]\(docs\/pokemon-battles.md\)/,
  );
  for (const link of [
    "pokemon.md",
    "pokemon.md#direct-http",
    "../README.md#tasks",
  ]) {
    assert.ok(guide.includes(`](${link})`));
    const [path, fragment] = link.split("#");
    const linked = readFileSync(join(dir, "docs", path), "utf8");
    if (fragment)
      assert.match(
        linked.toLowerCase(),
        new RegExp(`^#+ ${fragment.replaceAll("-", " ")}$`, "m"),
      );
  }
  const sample = /^```ts\n([\s\S]+?)^```$/m.exec(guide)?.[1];
  assert.ok(sample);
  writeFileSync(join(directory, "guide.ts"), sample);
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
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
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  const guideTest = new URL(
    "../tests/install/pokemon-battles-guide.mjs",
    import.meta.url,
  );
  copyFileSync(guideTest, join(directory, "guide-run.mjs"));
  results.push(JSON.parse(run(process.execPath, ["guide-run.mjs"])));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: installed.version,
        archiveSHA256: digest(bytes),
        guideSHA256: digest(guide),
        guideTestSHA256: digest(readFileSync(guideTest)),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        consumerSHA256: digest(readFileSync(source)),
        upstreamCommit: pins.commit,
        pinsSHA256: digest(readFileSync(pinsURL)),
        fixturesVerified: Object.keys(pins.files).length,
        results,
        limitations: [
          "Controlled host transport only",
          "No deployed requests or account effects",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
