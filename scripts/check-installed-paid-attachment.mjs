import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const archive = resolve(process.argv[2] ?? "dist/tsdm-sdk-0.1.1.tgz");
assert.ok(
  process.env.TSDM_MEDIA_UPSTREAM,
  "Set TSDM_MEDIA_UPSTREAM to the pinned upstream tree",
);
const upstream = resolve(process.env.TSDM_MEDIA_UPSTREAM);
const consumer = readFileSync(
  new URL("../tests/install/paid-attachment.mjs", import.meta.url),
);
const bytes = readFileSync(archive);
const cwd = mkdtempSync(join(tmpdir(), "tsdm-paid-attachment-consumer-"));
const run = (command, args) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
try {
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}\n');
  writeFileSync(join(cwd, "paid-attachment.mjs"), consumer);
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
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json")));
  assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
  const installed = lock.packages["node_modules/tsdm-sdk"];
  assert.equal(
    installed.integrity,
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  );
  const results = JSON.parse(
    run(process.execPath, ["paid-attachment.mjs", upstream]),
  );
  console.log(
    JSON.stringify(
      {
        evidence: "controlled installed SDK and host",
        node: process.version,
        package: `tsdm-sdk@${installed.version}`,
        archiveSHA256: createHash("sha256").update(bytes).digest("hex"),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
