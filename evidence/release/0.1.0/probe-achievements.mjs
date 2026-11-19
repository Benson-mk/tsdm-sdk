import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAwardsClient } from "tsdm-sdk";

// Copy this script into a clean npm project that installed the candidate tarball.
const [archive, manifestPath, upstream] = process.argv.slice(2);
assert.ok(
  archive && manifestPath && upstream,
  "Usage: node probe-achievements.mjs <archive> <release.json> <upstream-tree>",
);
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const archiveBytes = readFileSync(archive);
const archiveSHA256 = hash(archiveBytes);
const lockIntegrity = `sha512-${hash(archiveBytes, "sha512", "base64")}`;
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const installed = JSON.parse(
  readFileSync("node_modules/tsdm-sdk/package.json", "utf8"),
);
assert.equal(process.versions.node.split(".")[0], "26");
assert.equal(archiveSHA256, manifest.sha256);
assert.equal(installed.name, manifest.name);
assert.equal(installed.version, manifest.version);
assert.equal(lock.packages["node_modules/tsdm-sdk"].integrity, lockIntegrity);

const upstreamCommit = "02df67e39ded906def5b868e8f8311ba735b316c";
const schemaFixture = "test/data/tsdmapp/v4/achievement_v68_empty.json";
const nativeFixture = "test/data/achievements_empty_x5.html";
const regression = "test/regression/test_1036_magic_achievement_v4_test.dart";
const sourceSHA256 = {
  [schemaFixture]:
    "e1dcbddc05abfe557bb011b6778ecd657e32ff7ab53fefdb7035846b76b4441c",
  [nativeFixture]:
    "e942345245e818631554438bcfd0d7fd56f581307c47b7288ac1b50c1715f63f",
  [regression]:
    "e75e01efc4e82e30e84bbebfc41564c189f2ea4c5b998cc2d0dfbca14ffb153e",
};
function pinnedFile(path) {
  const bytes = readFileSync(join(upstream, path));
  assert.equal(hash(bytes), sourceSHA256[path], path);
  return bytes.toString("utf8");
}

// Reproduce the row the pinned Dart regression adds to the empty schema-68 fixture.
pinnedFile(regression);
const structured = JSON.parse(pinnedFile(schemaFixture));
const achievement = {
  id: 1,
  name: "初来乍到",
  description: "发第一帖",
  icon: "",
  rank: "1",
  reward: { value: "5", unit: "天使币" },
  progress: 1,
  requirements: 3,
  percent: 34,
};
structured.list = [achievement];
const native = pinnedFile(nativeFixture);
assert.match(native, /discuz_uid = '1000'/);
assert.match(native, /<p class="emp">暂无成就<\/p>/);

const origin = "https://forum.test";
const nativeUrl = `${origin}/plugin.php?id=tsdmtitle%3Aachi`;
const structuredUrl = `${nativeUrl}&tsdmapp=json&tsdmv=4&nodoc=1`;
const statusUrl = `${origin}/plugin.php?id=tsdmapp%3Aapi&action=status`;
const supported = (uid, on) =>
  JSON.stringify({ ok: 1, uid: Number(uid), v4: 1, achievement: on ? 1 : 0 });
const populatedHtml = native.replace(
  '<p class="emp">暂无成就</p>',
  '<p>First post</p><p>Progress <progress value="1" max="3"></progress></p><div hidden>hidden</div>',
);
const cases = [
  [
    "schema 68 with earned row",
    "31",
    true,
    [[structuredUrl, structured]],
    {
      kind: "awards-view",
      catalogue: "achievements",
      memberId: "31",
      records: [achievement],
      metadata: { activated: 0, achitype: 0, types: [] },
    },
  ],
  [
    "native explicit empty",
    "1000",
    false,
    [[nativeUrl, native]],
    {
      kind: "awards-view",
      catalogue: "achievements",
      memberId: "1000",
      records: [],
      metadata: { representation: "native", empty: true },
    },
  ],
  [
    "unavailable structured then native content",
    "1000",
    true,
    [
      [structuredUrl, { ok: 0, error: "unsupported" }],
      [nativeUrl, populatedHtml],
    ],
    {
      kind: "awards-view",
      catalogue: "achievements",
      memberId: "1000",
      records: [{ text: "First post\nProgress 1 / 3" }],
      metadata: { representation: "native", empty: false },
    },
  ],
  [
    "unexpected viewer",
    "31",
    false,
    [[nativeUrl, native]],
    { kind: "session-changed" },
  ],
  [
    "guest markup",
    "1000",
    false,
    [[nativeUrl, native.replace("discuz_uid = '1000'", "discuz_uid = '0'")]],
    { kind: "refused" },
  ],
];
cases.push([
  "missing status plugin still reads the native achievement page",
  "1000",
  false,
  [[nativeUrl, native]],
  cases[1][4],
  404,
]);
const observations = [];
for (const [name, memberId, on, pages, expected, statusCode = 200] of cases) {
  const calls = [];
  const session = { memberId, continuity: "fixture-session" };
  const inputs = [[statusUrl, JSON.parse(supported(memberId, on))], ...pages];
  const client = createAwardsClient({
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const entry = inputs[calls.length];
        calls.push({ url, method: request.method });
        assert.equal(url, entry?.[0], name);
        const value = entry[1],
          html = typeof value === "string";
        return {
          url,
          status: url === statusUrl ? statusCode : 200,
          redirect: "none",
          contentType: html ? "text/html" : "application/json",
          body: html ? value : JSON.stringify(value),
        };
      },
    },
  });
  const observed = await client.read("achievements");
  assert.deepEqual(
    calls,
    inputs.map(([url]) => ({ url, method: "GET" })),
    name,
  );
  assert.deepEqual(observed, expected, name);
  observations.push({ name, requests: calls, expected, observed });
}
console.log(
  JSON.stringify(
    {
      package: `${installed.name}@${installed.version}`,
      archiveSHA256,
      lockIntegrity,
      node: process.version,
      upstreamCommit,
      sourceSHA256,
      observations,
    },
    null,
    2,
  ),
);
