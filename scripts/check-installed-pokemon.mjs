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
const source = new URL(
  "../tests/install/pokemon-consumer.mjs",
  import.meta.url,
);
const pinsURL = new URL("../evidence/pokemon/pins.json", import.meta.url);
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
  for (const name of ["pokemon-status.json", "pokemon-types.ts"]) {
    copyFileSync(
      new URL(`../tests/install/${name}`, import.meta.url),
      join(directory, name),
    );
  }
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
  const guide = readFileSync(join(dir, "docs/pokemon.md"), "utf8");
  assert.equal(
    guide,
    readFileSync(new URL("../docs/pokemon.md", import.meta.url), "utf8"),
  );
  assert.match(
    readFileSync(join(dir, "README.md"), "utf8"),
    /\]\(docs\/pokemon.md\)/,
  );
  for (const link of ["../README.md#tasks", "account.md"]) {
    assert.ok(guide.includes(`](${link})`));
    assert.ok(readFileSync(join(dir, "docs", link.split("#")[0])));
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
      files: ["pokemon-types.ts", "guide.ts"],
    }),
  );
  run(process.execPath, [tsc, "--project", "tsconfig.json"]);
  writeFileSync(
    join(directory, "guide-run.mjs"),
    `
import assert from "node:assert/strict";
import { renamePet } from "./guide.js";
const calls=[];
let continuity="sample";
const host={origin:"https://forum.test",session:()=>({memberId:"31",continuity}),transport:{async request(url,request) {
  calls.push([request.method,request.effect]);
  const action=new URL(url).searchParams.get("action");
  const data=action==="status"?{uid:31,ok:1,formhash:"abcdef12"}:{success:true,error:null,code:0,data:action==="detail"?{id:7}:null};
  return {url,status:200,contentType:"application/json",body:JSON.stringify(data),redirect:"none"};
}}};
const denied=await renamePet(host,7,"Blue",async()=>false);
const accepted=await renamePet(host,7,"Blue",async observed=>observed.uid===31&&observed.id===7&&observed.name==="Blue");
const stale=await renamePet(host,7,"Blue",async()=>{continuity="new";return true;});
const expected=["cancelled","success","session-changed",[["GET",false],["GET",false],["GET",false],["GET",false],["POST",true],["GET",false],["GET",false]]];
const actual=[denied.kind,accepted.kind,stale.kind,calls];
assert.deepEqual(actual,expected);
console.log(JSON.stringify({name:"packaged TypeScript honors consent and same-login boundary",expected,actual}));
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
        scenarioSHA256: digest(
          readFileSync(
            new URL("../tests/install/pokemon-status.json", import.meta.url),
          ),
        ),
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
