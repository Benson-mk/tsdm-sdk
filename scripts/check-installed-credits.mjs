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
const input = new URL("tests/install/credits.mjs", root);
const pinsURL = new URL("evidence/credits/pins.json", root);
const pins = JSON.parse(readFileSync(pinsURL));
assert.ok(
  process.env.TSDM_CREDITS_UPSTREAM,
  "Set TSDM_CREDITS_UPSTREAM to the pinned upstream tree",
);
const upstream = resolve(process.env.TSDM_CREDITS_UPSTREAM);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [file, expected] of Object.entries(pins.files))
  assert.equal(
    digest(readFileSync(join(upstream, "test/data", file))),
    expected,
    file,
  );
const directory = mkdtempSync(join(tmpdir(), "tsdm-credits-"));
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
try {
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(input, join(directory, "credits.mjs"));
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
  const results = JSON.parse(run(process.execPath, ["credits.mjs", upstream]));
  const packageDir = join(directory, "node_modules/tsdm-sdk");
  assert.ok(
    readFileSync(join(packageDir, "README.md"), "utf8").includes(
      "](docs/credits.md)",
    ),
  );
  const guide = readFileSync(join(packageDir, "docs/credits.md"), "utf8");
  assert.equal(guide, readFileSync(new URL("docs/credits.md", root), "utf8"));
  assert.ok(guide.includes("](../README.md#tasks)"));
  for (const page of ["profile", "account"]) {
    assert.ok(guide.includes(`](${page}.md)`));
    assert.ok(readFileSync(join(packageDir, `docs/${page}.md`)).length);
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
  const tsc = new URL("node_modules/typescript/bin/tsc", root).pathname;
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  writeFileSync(
    join(directory, "guide-run.mjs"),
    `
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {checkIn,switchGroup} from "./guide.js";
const origin="https://forum.test";
const fixture=name=>JSON.parse(readFileSync(join(process.argv[2],"test/data/tsdmapp",name+".json"),"utf8"));
const makeHost=(memberId,bodies)=>{
  const seen=[];
  return {seen,origin,session:()=>({memberId,continuity:"guide"}),transport:{async request(url,request){
    seen.push(request.method);
    assert.ok(bodies.length);
    return {url,status:200,redirect:"none",contentType:"application/json",body:JSON.stringify(bodies.shift())};
  }}};
};
const before={...fixture("write_by_key/checkin_after"),checked_today:0,can_checkin:1};
const attendance=makeHost("31",[before]);
const cancelled=await checkIn(attendance,async()=>null);
const settings=makeHost("35",[fixture("form_v17_usergroup"),fixture("form_v17_usergroup_switch"),
  {ok:1,uid:35,type:"result",schema:13,kind:"handle",message_key:"usergroups_switch_succeed",handlekey:"switchgrouphk"}]);
const switched=await switchGroup(settings,"22",async form=>form.to==="字幕組");
const expected=["cancelled",["GET"],"switched",["GET","GET","POST"]];
const actual=[cancelled.kind,attendance.seen,switched.kind,settings.seen];
assert.deepEqual(actual,expected);
console.log(JSON.stringify({name:"packaged TypeScript declines check-in and approves an offered switch",expected,actual}));
`,
  );
  results.push(JSON.parse(run(process.execPath, ["guide-run.mjs", upstream])));
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
