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
const root = new URL("../", import.meta.url);
const input = new URL("tests/install/media.mjs", root);
const pinsURL = new URL("evidence/media/pins.json", root);
const pins = JSON.parse(readFileSync(pinsURL));
assert.ok(
  process.env.TSDM_MEDIA_UPSTREAM,
  "Set TSDM_MEDIA_UPSTREAM to the pinned upstream tree",
);
const upstream = resolve(process.env.TSDM_MEDIA_UPSTREAM);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [file, expected] of Object.entries(pins.files))
  assert.equal(
    digest(readFileSync(join(upstream, "test/data", file))),
    expected,
    file,
  );
const directory = mkdtempSync(join(tmpdir(), "tsdm-media-"));
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
try {
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(input, join(directory, "media.mjs"));
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
  const archiveBytes = readFileSync(archive);
  const lock = JSON.parse(
    readFileSync(join(directory, "package-lock.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  const installed = lock.packages["node_modules/tsdm-sdk"];
  assert.equal(
    installed.integrity,
    "sha512-" + createHash("sha512").update(archiveBytes).digest("base64"),
  );
  const results = JSON.parse(run(process.execPath, ["media.mjs", upstream]));
  const packageDir = join(directory, "node_modules/tsdm-sdk");
  assert.ok(
    readFileSync(join(packageDir, "README.md"), "utf8").includes(
      "](docs/media.md)",
    ),
  );
  const guide = readFileSync(join(packageDir, "docs/media.md"), "utf8");
  assert.equal(guide, readFileSync(new URL("docs/media.md", root), "utf8"));
  assert.ok(guide.includes("](../README.md#tasks)"));
  assert.ok(guide.includes("](profile.md)"));
  assert.ok(readFileSync(join(packageDir, "docs/profile.md")).length);
  const example = /^```ts\n([\s\S]+?)^```$/m.exec(guide)?.[1];
  assert.ok(example);
  writeFileSync(join(directory, "guide.ts"), example);
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
  const tsc = new URL("node_modules/typescript/bin/tsc", root).pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  writeFileSync(
    join(directory, "guide-run.mjs"),
    `
import assert from "node:assert/strict";
import {retrieveAttachment} from "./guide.js";
const origin = "https://forum.test";
const traffic = [];
const host = {origin, session:()=>({memberId:"31",continuity:"guide"}), transport:{async request(url,request) {
  traffic.push([request.method,request.effect]);
  return {url,status:302,redirect:"none",contentType:"text/plain",bytes:new Uint8Array(),
    headers:{Location:"/forum.php?mod=misc&action=attachcredit&aid=36&formhash=fixture"}};
}}};
const asked = [];
const result = await retrieveAttachment(host,origin+"/forum.php?mod=attachment&aid=36",async id=>{asked.push(id);return false;});
const expected = ["credit-required",["36"],[["GET",false]]];
const actual = [result.kind,asked,traffic];
assert.deepEqual(actual,expected);
console.log(JSON.stringify({name:"packaged TypeScript stops a declined credit action",actual,expected}));
`,
  );
  results.push(JSON.parse(run(process.execPath, ["guide-run.mjs"])));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: installed.version,
        archiveSHA256: digest(archiveBytes),
        consumerSHA256: digest(readFileSync(input)),
        guideSHA256: digest(guide),
        pinsSHA256: digest(readFileSync(pinsURL)),
        upstreamCommit: pins.commit,
        fixturesVerified: Object.keys(pins.files).length,
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        ambientTypes: [],
        results,
        limitations: [
          "Controlled host transport only",
          "No deployed forum requests or account effects",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
