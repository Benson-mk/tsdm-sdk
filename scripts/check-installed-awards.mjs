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
const source = new URL("../tests/install/awards.mjs", import.meta.url);
const pinsURL = new URL("../evidence/awards/pins.json", import.meta.url);
const pins = JSON.parse(readFileSync(pinsURL));
assert.ok(
  process.env.TSDM_AWARDS_UPSTREAM,
  "Set TSDM_AWARDS_UPSTREAM to the pinned upstream source tree",
);
const upstream = resolve(process.env.TSDM_AWARDS_UPSTREAM);
const directory = mkdtempSync(join(tmpdir(), "tsdm-awards-"));
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
  copyFileSync(source, join(directory, "awards.mjs"));
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
  const results = JSON.parse(run(process.execPath, ["awards.mjs", upstream]));
  const packageDir = join(directory, "node_modules/tsdm-sdk");
  const guide = readFileSync(join(packageDir, "docs/awards.md"), "utf8");
  assert.equal(
    guide,
    readFileSync(new URL("../docs/awards.md", import.meta.url), "utf8"),
  );
  assert.match(
    readFileSync(join(packageDir, "README.md"), "utf8"),
    /\]\(docs\/awards.md\)/,
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
import { buyTitle } from "./guide.js";
const origin = "https://forum.test";
const calls = [];
const host = {origin,session:()=>({memberId:"35",continuity:"guide"}),transport:{async request(url,option){
  calls.push(option.method);
  const body = option.method === "GET" ? {ok:1,installed:1,uid:35,items:[{id:11,name:"Title",for_sale:1,owned:0,afford:1,price:10}],
    buy_form:{url:"plugin.php?id=tsdmtitle:tsdmtitle&action=buy",item_field:"buyid",fields:{formhash:"abcd1234",buysubmit:"true",
    tsdmtitle_return:"plugin.php?id=tsdmtitle:tsdmtitle&action=shop"}}}
    : {ok:1,uid:35,type:"result",schema:13,kind:"message",message:"Purchase acknowledged",alert:"right"};
  return {url,status:200,redirect:"none",contentType:"application/json",body:JSON.stringify(body)};
}}};
const declined = await buyTitle(host,11,async()=>false);
const accepted = await buyTitle(host,11,async(form)=>form.choice.kind==="buy-title" && form.choice.id===11);
const expected=["cancelled","acknowledged",["GET","GET","POST"]];
const actual=[declined.kind,accepted.kind,calls];
assert.deepEqual(actual, expected);
console.log(JSON.stringify({name:"packaged TypeScript declines and approves a title purchase",expected,actual}));
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
