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
const directory = mkdtempSync(join(tmpdir(), "tsdm-activity-"));
const input = new URL("../tests/install/activity.mjs", import.meta.url);
const root = new URL("../", import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (file, args) =>
  execFileSync(file, args, { cwd: directory, encoding: "utf8" });
const upstream = resolve(process.env.TSDM_ACTIVITY_UPSTREAM ?? "");
assert.ok(
  process.env.TSDM_ACTIVITY_UPSTREAM,
  "Set TSDM_ACTIVITY_UPSTREAM to the pinned upstream tree",
);
const pins = JSON.parse(
  readFileSync(new URL("evidence/activity/pins.json", root)),
);
for (const [file, digest] of Object.entries(pins.files)) {
  assert.equal(
    sha(readFileSync(join(upstream, "test/data", file))),
    digest,
    file,
  );
}
try {
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  copyFileSync(input, join(directory, "activity.mjs"));
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
  const installed = lock.packages["node_modules/tsdm-sdk"];
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  assert.equal(
    installed.integrity,
    "sha512-" + createHash("sha512").update(archiveBytes).digest("base64"),
  );
  const results = JSON.parse(
    run(process.execPath, ["activity.mjs", upstream, ...process.argv.slice(3)]),
  );
  const packageDir = join(directory, "node_modules/tsdm-sdk");
  const readme = readFileSync(join(packageDir, "README.md"), "utf8");
  assert.ok(readme.includes("](docs/activity.md)"));
  const guide = readFileSync(join(packageDir, "docs/activity.md"), "utf8");
  assert.equal(guide, readFileSync(new URL("docs/activity.md", root), "utf8"));
  assert.ok(guide.includes("](../README.md#tasks)"));
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
    join(directory, "run-guide.mjs"),
    `
import assert from "node:assert/strict";
import {inspect, respond} from "./guide.js";
const origin="https://forum.test";
let requests = 0;
let effects = 0;
const session = {memberId:"31",continuity:"guide"};
const host = {origin, session:()=>session, transport:{async request(url, options) {
  requests++;
  effects += Number(options.effect);
  const path = new URL(url);
  const data = path.searchParams.get("mod") === "viewthread"
    ? {ok:1,type:"thread",schema:23,uid:31,formhash:"fixture",thread:{tid:90},
       recommend:{shown:1,can:1,add:{label:"Support",count:2}}}
    : {ok:1,type:"ratings",schema:48,uid:31,tid:90,pid:302,count:0,logs:[],totals:[]};
  return {url,redirect:"none",status:200,contentType:"application/json",body:JSON.stringify(data)};
}}};
const read = await inspect(host,{view:"ratings",threadId:"90",postId:"302"});
const result = await respond(host,{action:"recommend",threadURL:origin+"/forum.php?mod=viewthread&tid=90"},async form=>{
  assert.equal(form.evaluation.label,"Support");
  return null;
});
const expected = ["ratings",0,"cancelled",2,0];
const actual = [read.kind,read.rows.length,result.kind,requests,effects];
assert.deepEqual(actual,expected);
console.log(JSON.stringify({name:"installed guide read and cancelled approval",expected,actual}));
`,
  );
  const guideRun = JSON.parse(run(process.execPath, ["run-guide.mjs"]));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        package: installed.version,
        archiveSHA256: sha(archiveBytes),
        consumerSHA256: sha(readFileSync(input)),
        pinsSHA256: sha(
          readFileSync(new URL("evidence/activity/pins.json", root)),
        ),
        upstreamCommit: pins.commit,
        fixturesVerified: Object.keys(pins.files).length,
        guideSHA256: sha(guide),
        typescript: run(process.execPath, [tsc, "--version"]).trim(),
        ambientTypes: [],
        results: [...results, guideRun],
        limitations: [
          "Recorded bodies and synthetic host responses only",
          "No forum network traffic or account effects",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
