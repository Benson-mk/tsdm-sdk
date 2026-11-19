import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const bundle = resolve(process.argv[2] ?? "dist/forum-client/index.js");
const directory = mkdtempSync(join(tmpdir(), "tsdm-historical-replies-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const installed = join(directory, "node_modules/@tsdm/forum-client");
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, "package.json"),
    '{"type":"module","exports":"./index.js"}\n',
  );
  copyFileSync(bundle, join(installed, "index.js"));
  const results = [];
  for (const [name, binding] of [
    ["publication", "publicationCases"],
    ["replies", "replyCases"],
    ["editing", "editingCases"],
  ]) {
    const test = readFileSync(
      new URL(`../../tests/consumer/${name}.mjs`, import.meta.url),
    );
    const entry = join(directory, `${name}.mjs`);
    writeFileSync(entry, `${test}\nconsole.log(JSON.stringify(${binding}));\n`);
    const observations = JSON.parse(
      execFileSync(process.execPath, [entry], {
        cwd: directory,
        encoding: "utf8",
      }),
    );
    assert.ok(Array.isArray(observations) && observations.length > 0);
    results.push({ name, inputSHA256: digest(test), observations });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        historicalBundleSHA256: digest(readFileSync(bundle)),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
