import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.match(process.version, /^v26\./);
const archive = readFileSync(
  resolve(process.argv[2] ?? "dist/forum-client/index.js"),
);
const input = readFileSync(
  new URL("../../tests/consumer/drafts.mjs", import.meta.url),
);
const cwd = mkdtempSync(join(tmpdir(), "tsdm-historical-drafts-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const installed = join(cwd, "node_modules/@tsdm/forum-client");
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, "package.json"),
    '{"type":"module","exports":"./index.js"}\n',
  );
  writeFileSync(join(installed, "index.js"), archive);
  writeFileSync(
    join(cwd, "drafts.mjs"),
    `${input}\nconsole.log(JSON.stringify(draftCases));\n`,
  );
  const results = JSON.parse(
    execFileSync(process.execPath, ["drafts.mjs"], { cwd, encoding: "utf8" }),
  );
  assert.ok(Array.isArray(results) && results.length > 0);
  console.log(
    JSON.stringify(
      {
        historicalBundleSHA256: digest(archive),
        inputSHA256: digest(input),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
