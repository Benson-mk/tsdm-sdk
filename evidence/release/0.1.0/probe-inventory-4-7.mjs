import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const origin = "https://forum.test";
const continuity = "synthetic-login";
const member = { memberId: "31", continuity };
const account = { ok: 1, api: 1, version: "4.0.0", uid: 31, v4: 1 };
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

function request(path, query, { fields = null, ...options } = {}) {
  return {
    origin,
    path,
    query,
    method: "GET",
    fresh: true,
    session: member,
    effect: null,
    fields,
    fieldCount: fields ? Object.keys(fields).length : 0,
    ...options,
  };
}

async function runInstalledProbes() {
  const { createAwardsClient, createForumClient, createMemberClient, createModeratorPanelClient } =
    await import("tsdm-sdk");
  const results = [];

  async function probe(name, responses, expected, journey) {
    const requests = [];
    const transport = {
      async request(url, options) {
        const target = new URL(url);
        const response = responses[requests.length];
        const fields = options.body === undefined ? null : new URLSearchParams(options.body);
        requests.push({
          origin: target.origin,
          path: target.pathname,
          query: Object.fromEntries(target.searchParams),
          method: options.method ?? "GET",
          fresh: options.fresh ?? null,
          session: options.session ?? null,
          effect: options.effect ?? null,
          fields: fields ? Object.fromEntries(fields) : null,
          fieldCount: fields?.size ?? 0,
        });
        if (!response) throw new Error("Unexpected synthetic request");
        const { data, status = 200, contentType = "application/json" } = response;
        return {
          url, status, contentType, redirect: "none",
          body: typeof data === "string" ? data : JSON.stringify(data),
        };
      },
    };
    let observed;
    try {
      observed = { result: await journey(transport, () => requests.length), requests };
    } catch (error) {
      observed = { error: `${error.name}: ${error.message}`, requests };
    }
    results.push({
      name,
      status: isDeepStrictEqual(observed, expected) ? "passed" : "failed",
      expected,
      observed,
    });
  }

  for (const [catalogue, plugin, action, parameters] of [
    ["mymedals", "dsu_medalCenter%3Amemcp", "mymedal", { page: "1" }],
    ["medalgrant", "dsu_medalCenter%3Amemcp", "grant", { page: "1" }],
    ["titleexchange", "tsdmtitle%3Atsdmtitle", "exchange", { page: "1", filter: "all" }],
    ["titleissue", "tsdmtitle%3Atsdmtitle", "issue", {}],
  ]) {
    await probe(
      `native ${catalogue} returns its exact browser destination`,
      [{ data: { ok: 1, uid: 31, installed: 0 } }],
      {
        result: {
          kind: "awards-handoff", catalogue,
          url: `${origin}/plugin.php?id=${plugin}&action=${action}`,
        },
        requests: [request("/plugin.php", { id: "tsdmapp:api", action: catalogue, ...parameters })],
      },
      async (transport) => {
        const result = await createAwardsClient({ origin, session: () => member, transport }).read(catalogue);
        return { kind: result.kind, catalogue: result.catalogue ?? null, url: result.url ?? null };
      },
    );
  }

  const achievement = {
    name: "Synthetic Contributor",
    description: "Make three contributions",
    requirements: 3,
    progress: 2,
    percent: 66,
    reward: { value: 5, unit: "points" },
  };
  await probe(
    "structured achievement preserves populated progress and reward",
    [{ data: {...account, achievement:1} }, { data: { ok: 1, uid: 31, type: "achievement", schema: 68, activated: 1, list: [achievement] } }],
    {
      result: { kind: "awards-view", memberId: "31", activated: 1, records: [achievement] },
      requests: [request("/plugin.php",{id:"tsdmapp:api",action:"status"}),request("/plugin.php", { id: "tsdmtitle:achi", tsdmapp: "json", tsdmv: "4", nodoc: "1" })],
    },
    async (transport) => {
      const result = await createAwardsClient({ origin, session: () => member, transport }).read("achievements");
      return {
        kind: result.kind, memberId: result.memberId ?? null,
        activated: result.metadata?.activated ?? null, records: result.records ?? null,
      };
    },
  );

  const mentionOptions = { session: continuity, effect: false };
  const identityRead = request("/plugin.php", { id: "tsdmapp:api", action: "status" }, mentionOptions);
  const mentionPost = (fields) => request("/plugin.php", { id: "atplus:search" }, {
    ...mentionOptions, method: "POST", fields,
  });
  const memberClient = (transport) => createMemberClient({ origin, session: () => continuity, transport });
  await probe(
    "atplus init returns distinct recent member and friend",
    [
      { data: account },
      { data: { ok: 1, uid: 31, recent: [{ uid: 104, username: "Synthetic Recent" }], friends: [{ uid: 205, username: "Synthetic Friend" }] } },
      { data: account },
    ],
    {
      result: { kind: "atplus", recent: [{ id: "104", name: "Synthetic Recent" }], friends: [{ id: "205", name: "Synthetic Friend" }] },
      requests: [identityRead, mentionPost({ op: "init" }), identityRead],
    },
    (transport) => memberClient(transport).loadMentionCandidates("31"),
  );
  await probe(
    "atplus search returns a member for a numeric UID query",
    [{ data: account }, { data: { ok: 1, uid: 31, list: [{ uid: 205, username: "Synthetic Friend" }] } }, { data: account }],
    {
      result: { kind: "members", members: [{ id: "205", name: "Synthetic Friend" }] },
      requests: [identityRead, mentionPost({ op: "search", q: "205" }), identityRead],
    },
    (transport) => memberClient(transport).searchMentionMembers("31", "205"),
  );
  await probe(
    "host combines stock mention names with the intended member's friends",
    [
      { data: account }, { status: 404, data: {} }, { data: account },
      { data: "<?xml version='1.0'?><root><![CDATA[Synthetic Stock,Synthetic Friend]]></root>", contentType: "text/xml" },
      { data: account },
      { data: {
        ok: 1, uid: 31, type: "friend", schema: 10, owner: { uid: 31, username: "Synthetic Owner" },
        self: 1, view: "me", kind: "", group: -1, page: 1, pages: 1, has_next: 0, count: 1,
        groups: [{ id: 1, name: "Synthetic group" }], friends: [{ uid: 205, username: "Synthetic Friend", gid: 1 }],
      } },
    ],
    {
      result: {
        stockKind: "native", friendsKind: "friends", ownerId: "31",
        friends: [{ id: "205", name: "Synthetic Friend", groupId: "1" }], others: ["Synthetic Stock"],
      },
      requests: [
        identityRead, mentionPost({ op: "init" }), identityRead,
        request("/misc.php", { mod: "getatuser", inajax: "1" }, mentionOptions), identityRead,
        request("/home.php", { mod: "space", do: "friend", uid: "31", tsdmapp: "json", nodoc: "1" }, { session: null }),
      ],
    },
    async (transport) => {
      const stock = await memberClient(transport).loadMentionCandidates("31");
      const friends = await createForumClient({ origin, transport }).readFriends({ scope: "own", accountId: "31" });
      const friendNames = new Set((friends.members ?? []).map(({ name }) => name.toLowerCase()));
      return {
        stockKind: stock.kind, friendsKind: friends.kind, ownerId: friends.ownerId ?? null,
        friends: friends.members ?? null,
        others: stock.names?.filter((name) => !friendNames.has(name.toLowerCase())) ?? null,
      };
    },
  );

  const banRoute = { mod: "modcp", action: "member", op: "ban" };
  const fields = { formhash: "a1b2c3d4", uid: "71", username: "", bansubmit: "true" };
  await probe(
    "moderator panel submits offered visit restriction 5 once after approval",
    [
      { data: { ...account, modcp_pages_v4: ["member"] } },
      { data: {
        ok: 1, uid: 31, type: "modcp_member", schema: 43, op: "ban",
        member: { uid: 71, username: "Synthetic Target", status: "normal" },
        ban: {
          choices: [{ value: "4", label: "Posting restriction" }, { value: "5", label: "Visit restriction" }],
          reason_required: 1, crimes: [],
          submit: {
            url: "forum.php?mod=modcp&action=member&op=ban", method: "POST", fields,
            status_field: "bannew", days_field: "banexpirynew", reason_field: "reason",
          },
        },
      } },
      { data: { ok: 1, uid: 31, type: "result", schema: 13, kind: "message", message_key: "modcp_member_ban_succeed", alert: "right" } },
    ],
    {
      result: {
        target: "71", offered: ["4", "5"],
        declined: { kind: "not-confirmed", operation: "ban-member" },
        requestsAfterDecline: 2,
        acknowledged: { kind: "acknowledged", operation: "ban-member", code: "modcp_member_ban_succeed" },
      },
      requests: [
        request("/plugin.php", { id: "tsdmapp:api", action: "status" }, { effect: false }),
        request("/forum.php", { ...banRoute, uid: "71", tsdmapp: "json", nodoc: "1", tsdmv: "4" }, { effect: false }),
        request("/forum.php", { ...banRoute, tsdmapp: "json", tsdmv: "4" }, {
          method: "POST", effect: true,
          fields: { ...fields, bannew: "5", banexpirynew: "7", reason: "Synthetic reason" },
        }),
      ],
    },
    async (transport, countRequests) => {
      const client = createModeratorPanelClient({ origin, session: () => member, transport });
      const lookup = await client.lookupPanelMember("ban", { uid: "71" });
      if (lookup.kind !== "panel-member") return lookup;
      const declined = await client.changeMemberBan(lookup.page, "5", 7, "Synthetic reason", false);
      const requestsAfterDecline = countRequests();
      const acknowledged = await client.changeMemberBan(lookup.page, "5", 7, "Synthetic reason", true);
      return { target: lookup.page.memberId, offered: lookup.page.choices?.map(({ value }) => value) ?? null, declined, requestsAfterDecline, acknowledged };
    },
  );
  return results;
}

if (process.argv[2] === "--installed-consumer") {
  console.log(JSON.stringify(await runInstalledProbes()));
} else {
  assert.match(process.version, /^v26\./);
  assert.ok([3,4].includes(process.argv.length), "Pass the archive and optionally its candidate manifest");
  const archive = resolve(process.argv[2]);
  const manifest = JSON.parse(readFileSync(process.argv[3] ?? new URL("./candidate.json", import.meta.url), "utf8"));
  const archiveBytes = readFileSync(archive);
  const archiveSHA256 = hash(archiveBytes);
  assert.equal(archiveSHA256, manifest.sha256, "Use the exact release candidate archive");
  const integrity = `sha512-${hash(archiveBytes, "sha512", "base64")}`;
  const consumer = mkdtempSync(join(tmpdir(), "tsdm-inventory-4-7-"));
  try {
    const run = (command, args) => execFileSync(command, args, { cwd: consumer, encoding: "utf8" });
    writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
    copyFileSync(fileURLToPath(import.meta.url), join(consumer, "probe.mjs"));
    run("npm", ["install", "--offline", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund", "--cache", join(consumer, "cache"), archive]);
    const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8"));
    assert.deepEqual(Object.keys(lock.packages), ["", "node_modules/tsdm-sdk"]);
    assert.equal(lock.packages["node_modules/tsdm-sdk"].integrity, integrity);
    assert.equal(lock.packages["node_modules/tsdm-sdk"].version, manifest.version);
    const results = JSON.parse(run(process.execPath, ["probe.mjs", "--installed-consumer"]));
    console.log(JSON.stringify({
      archive: manifest.filename, archiveSHA256, integrity, packageInputsSHA256: manifest.packageInputsSHA256,
      node: process.version, npm: run("npm", ["--version"]).trim(),
      scriptSHA256: hash(readFileSync(new URL(import.meta.url))),
      evidence: "clean offline installed consumer using only synthetic transport responses",
      results,
    }, null, 2));
    if (results.some(({ status }) => status !== "passed")) process.exitCode = 1;
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}
