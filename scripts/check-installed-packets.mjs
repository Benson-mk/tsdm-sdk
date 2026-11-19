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
const source = new URL("../tests/install/packets.mjs", import.meta.url);
const pinsURL = new URL("../evidence/packets/pins.json", import.meta.url);
const pins = JSON.parse(readFileSync(pinsURL));
assert.ok(
  process.env.TSDM_PACKETS_UPSTREAM,
  "Set TSDM_PACKETS_UPSTREAM to the pinned upstream source tree",
);
const upstream = resolve(process.env.TSDM_PACKETS_UPSTREAM);
const directory = mkdtempSync(join(tmpdir(), "tsdm-packets-"));
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
  copyFileSync(source, join(directory, "packets.mjs"));
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
  const results = JSON.parse(run(process.execPath, ["packets.mjs", upstream]));
  const packageDir = join(directory, "node_modules/tsdm-sdk");
  const guide = readFileSync(join(packageDir, "docs/packets.md"), "utf8");
  assert.equal(
    guide,
    readFileSync(new URL("../docs/packets.md", import.meta.url), "utf8"),
  );
  assert.match(
    readFileSync(join(packageDir, "README.md"), "utf8"),
    /\]\(docs\/packets.md\)/,
  );
  for (const link of ["../README.md#tasks", "account.md"]) {
    assert.ok(guide.includes(`](${link})`));
    assert.ok(readFileSync(join(packageDir, "docs", link.split("#")[0])));
  }
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
  const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    .pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  writeFileSync(
    join(directory, "guide-run.mjs"),
    `
import assert from "node:assert/strict";
import { followAward } from "./guide.js";
const calls = [];
const host = {origin:"https://forum.test",session:()=>({memberId:"35",continuity:"guide"}),transport:{async request(url,request){
  calls.push([request.method,request.effect,url]);
  return {url,status:200,redirect:"none",contentType:"text/html",body:"<main>Arrived</main>"};
}}};
const href="/plugin.php?id=tsdmbet:awardPacket&action=getaward&tid=8";
const refused=await followAward(host,"8",href,async()=>false);
const approved=await followAward(host,"8",href,async(form)=>form.threadId==="8");
const expected=["cancelled","award-arrived","unknown",[["GET",true,host.origin+href]]];
const actual=[refused.kind,approved.kind,approved.effect,calls];
assert.deepEqual(actual,expected);
console.log(JSON.stringify({name:"packaged TypeScript requires approval and distinguishes award arrival",expected,actual}));
`,
  );
  results.push(JSON.parse(run(process.execPath, ["guide-run.mjs"])));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: installed.version,
        archiveSHA256: digest(bytes),
        guideSHA256: digest(guide),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        ambientTypes: [],
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
