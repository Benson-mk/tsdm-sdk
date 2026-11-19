import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const upstream = process.argv[2];
assert.ok(upstream, "Supply the pinned tsdm_client source directory");
const pins = JSON.parse(readFileSync(new URL("pins.json", import.meta.url)));
for (const [path, expected] of Object.entries(pins.sha256)) {
  const bytes = readFileSync(join(upstream, path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, path);
}
