import assert from "node:assert/strict";
import { createModeratorPanelClient } from "tsdm-sdk";
const base = "https://forum.test";
const owner = { memberId: "31", continuity: "fictional-settings" };
const json = { tsdmapp: "json", nodoc: "1" };
const out = [];
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  out.push({ name, expected, actual });
}
const trace = (method, query, fields = null, effect = method === "POST") => [
  method,
  { mod: "modcp", ...query },
  fields,
  effect,
];
function replay(responses) {
  let session = owner;
  const calls = [];
  const client = createModeratorPanelClient({
    origin: base,
    session: () => session,
    transport: {
      async request(url, request) {
        const at = new URL(url);
        assert.equal(at.origin, base);
        assert.equal(
          at.pathname,
          at.searchParams.get("id") === "tsdmapp:api"
            ? "/plugin.php"
            : "/forum.php",
        );
        assert.equal(request.fresh, true);
        assert.deepEqual(request.session, session);
        calls.push([
          request.method,
          Object.fromEntries(at.searchParams),
          request.body === undefined
            ? null
            : Object.fromEntries(new URLSearchParams(request.body)),
          request.effect,
        ]);
        assert.ok(responses.length, "unexpected dispatch");
        let reply = responses.shift();
        if (typeof reply === "function") reply = reply();
        if (reply instanceof Error) throw reply;
        return {
          url,
          status: 200,
          redirect: "none",
          contentType:
            typeof reply === "string" ? "text/html" : "application/json",
          body: typeof reply === "string" ? reply : JSON.stringify(reply),
          ...reply?.response,
        };
      },
    },
  });
  return {
    client,
    calls,
    replace() {
      session = { ...owner, continuity: "new-session" };
    },
  };
}
const accessURL = "forum.php?mod=modcp&action=forumaccess";
const rights = [
  "view",
  "post",
  "reply",
  "getattach",
  "getimage",
  "postattach",
  "postimage",
];
const access = {
  ok: 1,
  uid: 31,
  type: "modcp_forumaccess",
  schema: 38,
  fid: 10,
  page: 1,
  pages: 1,
  keyword: "",
  can_add: 1,
  forums: [{ fid: 10, name: "Fiction" }],
  list: [
    {
      uid: 71,
      fid: 10,
      username: "fictional_member",
      view: 0,
      post: 0,
      reply: -1,
    },
  ],
  search: {
    url: accessURL,
    method: "POST",
    fields: { formhash: "abcdef12", searchsubmit: "true" },
    fid_field: "fid",
    user_field: "suser",
  },
  add: {
    url: accessURL,
    method: "POST",
    fields: { formhash: "abcdef12", op: "", addsubmit: "true" },
    fid_field: "fid",
    user_field: "new_user",
    restore_field: "deleteaccess",
    restore_value: "1",
    deny_value: "-1",
    deny_fields: Object.fromEntries(rights.map((x) => [x, `new_${x}`])),
  },
  result: { done: 0, error: 0, error_key: "" },
};
const accessRead = trace("GET", { action: "forumaccess", fid: "10", ...json });
const accessWrite = (body) =>
  trace("POST", { action: "forumaccess", tsdmapp: "json" }, body);
{
  const { client, calls } = replay([
    access,
    { ...access, keyword: "fictional_member" },
    { ...access, result: { done: 1, error: 0, error_key: "" } },
    access,
    { ...access, list: [], result: { done: 1, error: 0, error_key: "" } },
  ]);
  const first = await client.readForumAccess("10");
  assert.equal(first.kind, "forum-access");
  const searched = await client.searchForumAccess(
    first.page,
    "fictional_member",
  );
  assert.equal(searched.kind, "forum-access");
  const declined = await client.setForumAccess(
    searched.page,
    "fictional_member",
    ["view"],
    false,
  );
  const deniedView = await client.setForumAccess(
    searched.page,
    "fictional_member",
    ["view"],
    true,
  );
  const second = await client.readForumAccess("10");
  const restored = await client.setForumAccess(
    second.page,
    "fictional_member",
    [],
    true,
  );
  check(
    "access list, scoped search, complete deny set and group restoration",
    [
      searched.page.items[0]?.rights.reply,
      declined.kind,
      deniedView,
      restored,
      calls,
    ],
    [
      -1,
      "not-confirmed",
      { kind: "acknowledged", operation: "set-forum-access" },
      { kind: "acknowledged", operation: "set-forum-access" },
      [
        accessRead,
        accessWrite({
          formhash: "abcdef12",
          searchsubmit: "true",
          fid: "10",
          suser: "fictional_member",
        }),
        accessWrite({
          formhash: "abcdef12",
          op: "",
          addsubmit: "true",
          fid: "10",
          new_user: "fictional_member",
          new_view: "-1",
          new_post: "-1",
          new_reply: "-1",
          new_getattach: "-1",
          new_getimage: "-1",
          new_postattach: "-1",
          new_postimage: "-1",
        }),
        accessRead,
        accessWrite({
          formhash: "abcdef12",
          op: "",
          addsubmit: "true",
          fid: "10",
          new_user: "fictional_member",
          deleteaccess: "1",
        }),
      ],
    ],
  );
}
for (const [name, reply, kind, code] of [
  [
    "protected staff",
    { ...access, result: { done: 0, error: 1, error_key: "staff" } },
    "refused",
    "staff",
  ],
  [
    "whitelist",
    { ...access, result: { done: 0, error: 1, error_key: "whitelist" } },
    "refused",
    "whitelist",
  ],
  ["wrong forum", { ...access, fid: 11, result: { done: 1 } }, "uncertain"],
  [
    "expired panel",
    { ok: 0, uid: 31, error: "modcp_login", formhash: "abcdef12" },
    "refused",
    "panel-login",
  ],
  ["lost reply", new Error("lost"), "uncertain"],
  ["silent redraw", access, "redrawn"],
]) {
  const { client, calls } = replay([access, reply]);
  const page = await client.readForumAccess("10");
  const result = await client.setForumAccess(
    page.page,
    "fictional_member",
    ["reply"],
    true,
  );
  const reuse = await client.setForumAccess(
    page.page,
    "fictional_member",
    ["reply"],
    true,
  );
  check(
    `access ${name} attributed to one attempted change`,
    [
      result.kind,
      result.operation,
      result.code ?? null,
      reuse.kind,
      calls.length,
    ],
    [kind, "set-forum-access", code ?? null, "stale", 2],
  );
}
{
  const { client, calls, replace } = replay([access]);
  const page = await client.readForumAccess("10");
  replace();
  check(
    "re-login as same moderator invalidates opened access form",
    [
      (
        await client.setForumAccess(
          page.page,
          "fictional_member",
          ["reply"],
          true,
        )
      ).kind,
      calls,
    ],
    ["session-changed", [accessRead]],
  );
}
const v4 = { ...json, tsdmv: "4" };
const capability = {
  ok: 1,
  uid: 31,
  v4: 1,
  modcp_pages_v4: ["member", "ipban", "editforum", "announcement"],
};
const status = ["GET", { id: "tsdmapp:api", action: "status" }, null, false];
const form = (action, op, fields, extra = {}) => ({
  url: `forum.php?mod=modcp&action=${action}${op ? `&op=${op}` : ""}`,
  method: "POST",
  fields: { formhash: "abcdef12", ...fields },
  ...extra,
});
const result = (key, extra = {}) => ({
  ok: 1,
  uid: 31,
  type: "result",
  schema: 13,
  kind: "message",
  message_key: key,
  alert: "right",
  ...extra,
});
const member = (op) => ({
  uid: 31,
  ok: 1,
  type: "modcp_member",
  schema: 43,
  op,
  member: { uid: 71, username: "fictional_member", status: "normal" },
  [op]:
    op === "ban"
      ? {
          choices: [
            { value: "4", label: "Mute" },
            { value: "5", label: "Block" },
          ],
          reason_required: 1,
          crimes: [],
          submit: form(
            "member",
            "ban",
            { username: "", uid: "71", bansubmit: "true" },
            {
              status_field: "bannew",
              days_field: "banexpirynew",
              reason_field: "reason",
            },
          ),
        }
      : {
          bio: "old",
          signature: "signed",
          submit: form(
            "member",
            "edit",
            { username: "", uid: "71", editsubmit: "true" },
            {
              bio_field: "bionew",
              signature_field: "signaturenew",
              clearavatar_field: "clearavatar",
              clearavatar_value: "1",
            },
          ),
        },
});
for (const op of ["ban", "edit"]) {
  const key =
    op === "ban" ? "modcp_member_ban_succeed" : "members_edit_succeed";
  const write =
    op === "ban"
      ? (client, page, approved) =>
          client.changeMemberBan(page, "4", 7, "fictional reason", approved)
      : (client, page, approved) =>
          client.editPanelMember(
            page,
            { bio: "new", signature: "signed", clearAvatar: true },
            approved,
          );
  const { client, calls } = replay([capability, member(op), result(key)]);
  const lookup = await client.lookupPanelMember(
    op,
    op === "ban" ? { uid: "71" } : { username: "fictional_member" },
  );
  assert.equal(lookup.kind, "panel-member");
  const declined = await write(client, lookup.page, false);
  const effect = await write(client, lookup.page, true);
  const expectedBody =
    op === "ban"
      ? {
          bannew: "4",
          banexpirynew: "7",
          reason: "fictional reason",
          bansubmit: "true",
        }
      : {
          bionew: "new",
          signaturenew: "signed",
          clearavatar: "1",
          editsubmit: "true",
        };
  check(
    `member ${op} confirms offered target and separate action`,
    [lookup.page.memberId, declined.kind, effect, calls],
    [
      "71",
      "not-confirmed",
      {
        kind: "acknowledged",
        operation: op === "ban" ? "ban-member" : "edit-member",
        code: key,
      },
      [
        status,
        trace("GET", {
          action: "member",
          op,
          ...(op === "ban" ? { uid: "71" } : { username: "fictional_member" }),
          ...v4,
        }),
        trace(
          "POST",
          { action: "member", op, tsdmapp: "json", tsdmv: "4" },
          { formhash: "abcdef12", username: "", uid: "71", ...expectedBody },
        ),
      ],
    ],
  );
}
{
  const { client, calls } = replay([
    capability,
    {
      ok: 0,
      uid: 31,
      error: "message",
      message_key: "modcp_member_ban_illegal",
    },
  ]);
  check(
    "protected staff refusal identifies the attempted lookup",
    [await client.lookupPanelMember("ban", { uid: "71" }), calls.length],
    [
      {
        kind: "refused",
        code: "modcp_member_ban_illegal",
        operation: "lookup-member-ban",
      },
      2,
    ],
  );
}
const bans = (list, result = { added: 0, error_key: "" }) => ({
  ok: 1,
  uid: 31,
  type: "modcp_ipban",
  schema: 44,
  list,
  result,
  submit: form(
    "member",
    "ipban",
    { ipbansubmit: "true" },
    { ip_field: "ipnew", days_field: "validitynew", ids_field: "delete[]" },
  ),
});
const oneBan = { id: 44, ip: "192.0.2.7", can_delete: 1 },
  protectedBan = { id: 45, ip: "192.0.2.8", can_delete: 0 };
{
  const { client, calls } = replay([
    capability,
    bans([protectedBan]),
    bans([oneBan, protectedBan], { added: 1 }),
    capability,
    bans([oneBan, protectedBan]),
    bans([protectedBan]),
  ]);
  const initial = await client.readIpBans();
  const refused = await client.deleteIpBans(initial.page, ["45"], true);
  const added = await client.addIpBan(initial.page, "192.0.2.7", 3, true);
  const list = await client.readIpBans();
  const deleted = await client.deleteIpBans(list.page, ["44"], true);
  check(
    "IP bans list, add and permission-checked deletion",
    [refused, added, deleted, calls],
    [
      {
        kind: "refused",
        operation: "delete-ip-bans",
        code: "ip-ban-delete-unavailable",
      },
      { kind: "completed", operation: "add-ip-ban" },
      {
        kind: "completed",
        operation: "delete-ip-bans",
        confirmedIds: ["44"],
        remainingIds: [],
        unknownIds: [],
      },
      [
        status,
        trace("GET", { action: "member", op: "ipban", ...v4 }),
        trace(
          "POST",
          { action: "member", op: "ipban", tsdmapp: "json", tsdmv: "4" },
          {
            formhash: "abcdef12",
            ipbansubmit: "true",
            ipnew: "192.0.2.7",
            validitynew: "3",
          },
        ),
        status,
        trace("GET", { action: "member", op: "ipban", ...v4 }),
        trace(
          "POST",
          { action: "member", op: "ipban", tsdmapp: "json", tsdmv: "4" },
          { formhash: "abcdef12", ipbansubmit: "true", "delete[0]": "44" },
        ),
      ],
    ],
  );
}
{
  const { client, calls } = replay([
    capability,
    bans([]),
    bans([], { added: 0, error_key: "cidr" }),
  ]);
  const page = await client.readIpBans();
  check(
    "IP range refusal overrides a redrawn response with ok 1",
    [await client.addIpBan(page.page, "192.0.2.0/24", 1, true), calls.length],
    [{ kind: "refused", operation: "add-ip-ban", code: "cidr" }, 3],
  );
}
const logRecord = {
  id: 654,
  uid: 31,
  username: "fictional moderator",
  action: "member",
  op: "edit",
  fid: 10,
  forum: "Fiction",
  tids: [],
  pids: [],
  uids: [71],
  dateline: 1700000000,
  reason: "fixture",
};
{
  const { client, calls } = replay([
    {
      ok: 1,
      uid: 31,
      type: "modcp_log",
      schema: 24,
      enabled: 1,
      keyword: "fixture",
      page: 2,
      pages: 3,
      show_ip: 0,
      entries: [{ ...logRecord, ip: "192.0.2.11" }],
    },
  ]);
  const log = await client.readPanelLog("fixture", 2);
  check(
    "operator log preserves supplied route and obeys IP visibility",
    [
      log.kind,
      log.page?.hasNext,
      log.page?.entries[0]?.operator,
      log.page?.entries[0]?.ip,
      log.page?.entries[0]?.memberIds,
      calls,
    ],
    [
      "panel-log",
      true,
      "fictional moderator",
      null,
      ["71"],
      [trace("GET", { action: "log", keyword: "fixture", page: "2", ...json })],
    ],
  );
}
{
  const markup =
    '<form method="get" action="forum.php?mod=modcp&amp;action=log"><input name="keyword"></form><table id="list_modcp_logs"><tr><td>Time</td><td>Fictional moderator</td><td></td><td>forum<br>editforum</td><td>Fiction</td><td>fixture</td></tr></table>';
  const { client, calls } = replay([markup]);
  const log = await client.readPanelLog();
  check(
    "native log preserves independent action and operation text",
    [
      log.kind,
      log.page?.entries[0]?.action,
      log.page?.entries[0]?.operation,
      calls,
    ],
    [
      "panel-log",
      "forum",
      "editforum",
      [trace("GET", { action: "log", ...json })],
    ],
  );
}
const notes = (items) => ({
  ok: 1,
  uid: 31,
  type: "modcp_home",
  schema: 39,
  fid: 0,
  counts: { notes: items.length, forums: 1 },
  forums: [{ fid: 10, name: "Fiction" }],
  notes: items,
  add: form(
    "home",
    null,
    { op: "addnote", submit: "true" },
    {
      message_field: "newmessage",
      supermod_field: "newaccess[2]",
      moderator_field: "newaccess[3]",
      days_field: "newexpiration",
      days_default: 30,
    },
  ),
  delete: form(
    "home",
    null,
    { op: "delete", notlistsubmit: "yes" },
    { ids_field: "delete[]" },
  ),
});
const note = (id, message, canDelete = 1) => ({
  id,
  message,
  admin: "fictional moderator",
  to_supermod: 1,
  to_moderator: 0,
  can_delete: canDelete,
});
{
  const existing = note(90, "Other note", 0),
    added = note(91, "Fixture note");
  const { client, calls } = replay([
    notes([existing]),
    notes([existing, added]),
    notes([existing, added]),
    notes([existing]),
  ]);
  const initial = await client.readManagementNotes();
  const decline = await client.addManagementNote(
    initial.page,
    { message: "Fixture note", toSupermod: true, toModerator: false, days: 5 },
    false,
  );
  const made = await client.addManagementNote(
    initial.page,
    {
      message: " Fixture note ",
      toSupermod: true,
      toModerator: false,
      days: 5,
    },
    true,
  );
  const fresh = await client.readManagementNotes();
  const protectedNote = await client.deleteManagementNotes(
    fresh.page,
    ["90"],
    true,
  );
  const removed = await client.deleteManagementNotes(fresh.page, ["91"], true);
  check(
    "management notes show selection, audience and expiration and confirm deletion",
    [decline.kind, made, protectedNote, removed, calls],
    [
      "not-confirmed",
      { kind: "completed", operation: "add-note", confirmedIds: ["91"] },
      {
        kind: "refused",
        operation: "delete-notes",
        code: "note-delete-unavailable",
      },
      {
        kind: "completed",
        operation: "delete-notes",
        confirmedIds: ["91"],
        remainingIds: [],
        unknownIds: [],
      },
      [
        trace("GET", { action: "home", ...json }),
        trace(
          "POST",
          { action: "home", tsdmapp: "json" },
          {
            formhash: "abcdef12",
            op: "addnote",
            submit: "true",
            newmessage: "Fixture note",
            "newaccess[2]": "1",
            newexpiration: "5",
          },
        ),
        trace("GET", { action: "home", ...json }),
        trace(
          "POST",
          { action: "home", tsdmapp: "json" },
          {
            formhash: "abcdef12",
            op: "delete",
            notlistsubmit: "yes",
            "delete[0]": "91",
          },
        ),
      ],
    ],
  );
}
{
  const { client, calls } = replay([
    notes([]),
    notes([note(91, "Unrelated note")]),
  ]);
  const page = await client.readManagementNotes();
  check(
    "a concurrently created different note cannot confirm this addition",
    [
      await client.addManagementNote(
        page.page,
        { message: "Fixture note", toSupermod: true, toModerator: false },
        true,
      ),
      calls.length,
    ],
    [{ kind: "uncertain", operation: "add-note" }, 2],
  );
}
const rulePage = (rules, editable = 1, updated = 0) => ({
  ok: 1,
  uid: 31,
  type: "modcp_editforum",
  schema: 46,
  fid: 10,
  need_forum: 0,
  rules,
  editable,
  updated,
  forums: [{ fid: 10, name: "Fiction" }],
  submit: form(
    "forum",
    "editforum",
    { fid: "10", editsubmit: "true" },
    { rules_field: "rulesnew" },
  ),
});
{
  const { client, calls } = replay([
    capability,
    rulePage("Original"),
    rulePage("Updated", 1, 1),
  ]);
  const rules = await client.readForumRules("10");
  const decline = await client.saveForumRules(rules.page, "Updated", false);
  const saved = await client.saveForumRules(rules.page, "Updated", true);
  check(
    "forum rules are read and saved only on the selected forum",
    [rules.page.rules, decline.kind, saved, calls],
    [
      "Original",
      "not-confirmed",
      { kind: "completed", operation: "save-rules" },
      [
        status,
        trace("GET", { action: "forum", op: "editforum", fid: "10", ...v4 }),
        trace(
          "POST",
          { action: "forum", op: "editforum", tsdmapp: "json", tsdmv: "4" },
          {
            formhash: "abcdef12",
            fid: "10",
            editsubmit: "true",
            rulesnew: "Updated",
          },
        ),
      ],
    ],
  );
}
const rulesHtml = (
  value,
  disabled = false,
  message = "",
) => `<form method="post" action="forum.php?mod=modcp&amp;action=forum&amp;op=editforum">
  <input type="hidden" name="formhash" value="abcdef12"><input type="hidden" name="fid" value="10">
  <textarea name="rulesnew" ${disabled ? "readonly" : ""}>${value}</textarea><button name="editsubmit" value="true">Save</button>${message}</form>`;
{
  const { client, calls } = replay([
    { ok: 1, uid: 31, v4: 0 },
    rulesHtml("Original"),
    rulesHtml("Original", true, "版规更新成功，请继续操作"),
  ]);
  const rules = await client.readForumRules("10");
  check(
    "a native locked rule editor overrides the generic success caption",
    [await client.saveForumRules(rules.page, "Updated", true), calls],
    [
      { kind: "refused", operation: "save-rules", code: "rules-locked" },
      [
        status,
        trace("GET", { action: "forum", op: "editforum", fid: "10" }),
        trace(
          "POST",
          { action: "forum", op: "editforum" },
          {
            formhash: "abcdef12",
            fid: "10",
            editsubmit: "true",
            rulesnew: "Updated",
          },
        ),
      ],
    ],
  );
}
const recs = (
  items,
  locked = false,
  message = "",
) => `<ul><li class="a"><a href="forum.php?mod=modcp&amp;action=forum&amp;op=recommend">Recommendations</a></li></ul>
  <select name="fid"><option selected value="10">Fiction</option></select>
  ${
    items.length
      ? `<form method="post" action="forum.php?mod=modcp&amp;action=forum&amp;show=">
  ${Object.entries({
    formhash: "abcdef12",
    op: "recommend",
    page: "1",
    fid: "10",
    check: "",
  })
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${value}">`,
    )
    .join("")}
  <table>${items
    .map(
      (
        item,
      ) => `<tr><td><input type="checkbox" name="delete[]" value="${item.id}"></td><td><input name="order[${item.id}]" value="${item.order}" ${locked ? "readonly" : ""}></td>
  <td><input name="subject[${item.id}]" value="${item.subject}"></td><td>Fictional author</td><td>Fictional moderator</td><td><input name="expirationrecommend[${item.id}]" value="${item.expiration}"></td></tr>`,
    )
    .join("")}</table>
  <p><button name="editsubmit" value="yes">Save</button>${message}</p></form>`
      : '<p class="emp">No results</p>'
  }`;
const recA = { id: "801", order: 1, subject: "Old", expiration: "" },
  recB = { id: "802", order: 2, subject: "Other", expiration: "" };
const newRec = {
  ...recA,
  order: 3,
  subject: "New",
  expiration: "2027-1-2 03:04",
};
const recRead = trace("GET", { action: "forum", op: "recommend", fid: "10" });
{
  const { client, calls } = replay([
    recs([recA, recB]),
    recs([newRec], false, "推荐主题更新成功，请继续操作"),
  ]);
  const rows = await client.readRecommendations("10");
  const refused = await client.saveRecommendations(
    rows.page,
    { edits: [newRec], remove: ["802"] },
    false,
  );
  const saved = await client.saveRecommendations(
    rows.page,
    { edits: [newRec], remove: ["802"] },
    true,
  );
  check(
    "recommendations preserve untouched fields while editing and removing exact selected rows",
    [rows.page.items.map((row) => row.id), refused.kind, saved, calls],
    [
      ["801", "802"],
      "not-confirmed",
      {
        kind: "completed",
        operation: "save-recommendations",
        confirmedIds: ["801", "802"],
        remainingIds: [],
        unknownIds: [],
      },
      [
        recRead,
        trace(
          "POST",
          { action: "forum" },
          {
            formhash: "abcdef12",
            op: "recommend",
            page: "1",
            fid: "10",
            check: "",
            "delete[0]": "802",
            "order[801]": "3",
            "subject[801]": "New",
            "expirationrecommend[801]": "2027-1-2 03:04",
            "order[802]": "2",
            "subject[802]": "Other",
            "expirationrecommend[802]": "",
            editsubmit: "yes",
          },
        ),
      ],
    ],
  );
}
{
  const { client, calls } = replay([recs([recA], true)]);
  const rows = await client.readRecommendations("10");
  check(
    "automatically ordered recommendations are read-only",
    [
      rows.page.editable,
      await client.saveRecommendations(rows.page, { remove: ["801"] }, true),
      calls,
    ],
    [
      false,
      {
        kind: "refused",
        operation: "save-recommendations",
        code: "recommendations-locked",
      },
      [recRead],
    ],
  );
}
const draft = {
  subject: "Fictional board notice",
  type: "text",
  start: "2099-01-03",
  end: "2099-02-03",
  message: "[b]Fixture[/b]",
};
const updated = {
  ...draft,
  type: "link",
  subject: "Fictional link",
  message: "https://example.test/notice",
};
const trigger = (op, id, draft) => ({
  id,
  subject: draft.subject,
  type: draft.type === "text" ? 0 : 1,
  starttime: draft.start,
  endtime: draft.end,
  message: draft.message,
  displayorder: id === 0 ? "" : "7",
  submit: form(
    "announcement",
    op,
    {
      id: id === 0 ? "" : String(id),
      displayorder: id === 0 ? "" : "7",
      submit: "true",
    },
    {
      subject_field: "subject",
      type_field: "type",
      start_field: "starttime",
      end_field: "endtime",
      message_fields: { 0: "message[0]", 1: "message[1]" },
    },
  ),
});
const announcement = (op, list = [], changes = {}) => ({
  ok: 1,
  uid: 31,
  type: "modcp_announcement",
  schema: 47,
  op,
  list,
  form: trigger(op === "edit" ? "edit" : "add", op === "edit" ? 66 : 0, draft),
  manage: form(
    "announcement",
    "manage",
    { submit: "true" },
    { ids_field: "delete[]", order_field: "order[{id}]" },
  ),
  result: changes,
});
const annItem = (id, subject, editable = 1) => ({
  id,
  subject,
  editable,
  type: 0,
  author: "fixture moderator",
  starttime: 1700000000,
  endtime: 1700001000,
});
const annGet = trace("GET", { action: "announcement", ...v4 });
const annPost = (op, body, structured = true) =>
  trace(
    "POST",
    {
      action: "announcement",
      op,
      ...(structured && { tsdmapp: "json", tsdmv: "4" }),
    },
    body,
  );
const annValues = (id, input) => ({
  formhash: "abcdef12",
  id: id === 0 ? "" : String(id),
  displayorder: id === 0 ? "" : "7",
  submit: "true",
  subject: input.subject,
  type: input.type === "text" ? "0" : "1",
  starttime: input.start,
  endtime: input.end,
  "message[0]": input.type === "text" ? input.message : "",
  "message[1]": input.type === "link" ? input.message : "",
});
{
  const { client, calls } = replay([
    capability,
    announcement("add", [annItem(65, "Protected", 0)]),
    announcement(
      "add",
      [annItem(65, "Protected", 0), annItem(66, draft.subject)],
      { added: 1 },
    ),
    capability,
    announcement("edit"),
    {
      ...announcement("edit", [], { edited: 1 }),
      form: trigger("edit", 66, updated),
    },
    capability,
    announcement("add", [
      annItem(65, "Protected", 0),
      annItem(66, updated.subject),
    ]),
    announcement("manage", [annItem(65, "Protected", 0)], { deleted: 1 }),
  ]);
  const initial = await client.readPanelAnnouncements();
  const declined = await client.createPanelAnnouncement(
    initial.page,
    draft,
    false,
  );
  const created = await client.createPanelAnnouncement(
    initial.page,
    draft,
    true,
  );
  const open = await client.readPanelAnnouncement("66");
  assert.equal(
    open.kind,
    "announcement-form",
    JSON.stringify({ created, open, calls }),
  );
  const edited = await client.editPanelAnnouncement(open.form, updated, true);
  const list = await client.readPanelAnnouncements();
  const protectedRow = await client.deletePanelAnnouncements(
    list.page,
    ["65"],
    true,
  );
  const removed = await client.deletePanelAnnouncements(
    list.page,
    ["66"],
    true,
  );
  check(
    "announcement list, create, edit text to link and delete are separately scoped",
    [
      initial.page.items.map((item) => item.id),
      declined.kind,
      created,
      open.form.id,
      edited,
      protectedRow,
      removed,
      calls,
    ],
    [
      ["65"],
      "not-confirmed",
      { kind: "acknowledged", operation: "create-announcement" },
      "66",
      { kind: "completed", operation: "edit-announcement" },
      {
        kind: "refused",
        operation: "delete-announcements",
        code: "announcement-delete-unavailable",
      },
      {
        kind: "completed",
        operation: "delete-announcements",
        confirmedIds: ["66"],
        remainingIds: [],
        unknownIds: [],
      },
      [
        status,
        annGet,
        annPost("add", annValues(0, draft)),
        status,
        trace("GET", { action: "announcement", op: "edit", id: "66", ...v4 }),
        annPost("edit", annValues(66, updated)),
        status,
        annGet,
        annPost("manage", {
          formhash: "abcdef12",
          submit: "true",
          "delete[0]": "66",
        }),
      ],
    ],
  );
}
const nativeAnn = (
  input,
  id = "66",
) => `<form method="post" action="forum.php?mod=modcp&amp;action=announcement&amp;op=edit">
  <input type="hidden" name="formhash" value="abcdef12"><input type="hidden" name="id" value="${id}"><input type="hidden" name="displayorder" value="7">
  <input name="subject" value="${input.subject}"><select name="type"><option value="0" ${input.type === "text" ? "selected" : ""}>Text</option><option value="1" ${input.type === "link" ? "selected" : ""}>Link</option></select>
  <input name="starttime" value="${input.start}"><input name="endtime" value="${input.end}"><textarea name="message[0]">${input.type === "text" ? input.message : ""}</textarea>
  <input name="message[1]" value="${input.type === "link" ? input.message : ""}"><button name="submit" value="true">Submit</button></form>`;
{
  const target = trace("GET", { action: "announcement", op: "edit", id: "66" });
  const { client, calls } = replay([
    { ok: 1, uid: 31, v4: 0 },
    nativeAnn(draft),
    nativeAnn(draft),
    nativeAnn(updated),
  ]);
  const shown = await client.readPanelAnnouncement("66");
  const effect = await client.editPanelAnnouncement(shown.form, updated, true);
  check(
    "native announcement edit uses fresh readback of the exact announcement",
    [effect, calls],
    [
      { kind: "completed", operation: "edit-announcement" },
      [status, target, annPost("edit", annValues(66, updated), false), target],
    ],
  );
}
for (const [name, response, type, code] of [
  [
    "expired panel",
    { ok: 0, uid: 31, error: "modcp_login", formhash: "abcdef12" },
    "refused",
    "panel-login",
  ],
  [
    "server rejected link",
    result("modcp_ann_urlerror", { ok: 0, alert: "error" }),
    "refused",
    "modcp_ann_urlerror",
  ],
  ["lost response", new Error("lost acknowledgement"), "uncertain"],
  [
    "mismatched edit",
    {
      ...announcement("edit", [], { edited: 1 }),
      form: trigger("edit", 67, updated),
    },
    "uncertain",
  ],
]) {
  const { client, calls } = replay([
    capability,
    announcement("edit"),
    response,
  ]);
  const edit = await client.readPanelAnnouncement("66");
  const verdict = await client.editPanelAnnouncement(edit.form, updated, true);
  check(
    `announcement ${name} preserves attempted operation and sends once`,
    [verdict.kind, verdict.operation, verdict.code ?? null, calls.length],
    [type, "edit-announcement", code ?? null, 3],
  );
}
const oldMode = { ok: 1, uid: 31, v4: 0 };
const ipMarkup = (
  rows,
  echo = "",
  caption = "",
) => `<form method="post" action="forum.php?mod=modcp&amp;action=member&amp;op=ipban">
  <input type="hidden" name="formhash" value="abcdef12"><div class="exfm"><input name="ipnew" value="${echo}">
  <input name="validitynew"><p><button name="ipbansubmit" value="true">Submit</button>${caption}</p></div>
  <table class="dt">${rows.map(([id, ip, locked]) => `<tr><td><input name="delete[]" type="checkbox" value="${id}" ${locked ? "disabled" : ""}></td><td>${ip}</td><td>Fiction</td><td>Fixture moderator</td><td>Start</td><td>End</td></tr>`).join("")}</table></form>`;
{
  const { client, calls } = replay([
    oldMode,
    ipMarkup([
      [44, "192.0.2.7", false],
      [45, "192.0.2.8", true],
    ]),
    ipMarkup([[45, "192.0.2.8", true]]),
  ]);
  const shown = await client.readIpBans();
  const deleted = await client.deleteIpBans(shown.page, ["44"], true);
  check(
    "native IP ban list keeps disabled rows visible and verifies selected deletion",
    [shown.page.items.map((row) => [row.id, row.canDelete]), deleted, calls],
    [
      [
        ["44", true],
        ["45", false],
      ],
      {
        kind: "completed",
        operation: "delete-ip-bans",
        confirmedIds: ["44"],
        remainingIds: [],
        unknownIds: [],
      },
      [
        status,
        trace("GET", { action: "member", op: "ipban" }),
        trace(
          "POST",
          { action: "member", op: "ipban" },
          { formhash: "abcdef12", ipbansubmit: "true", "delete[0]": "44" },
        ),
      ],
    ],
  );
}
{
  const { client, calls } = replay([
    oldMode,
    ipMarkup([]),
    ipMarkup([], "fictional invalid address", "请输入标准 IP 地址"),
  ]);
  const shown = await client.readIpBans();
  check(
    "native IP refusal uses the redrawn invalid target and caption",
    [
      await client.addIpBan(shown.page, "fictional invalid address", 1, true),
      calls.length,
    ],
    [{ kind: "refused", operation: "add-ip-ban", code: "ip-ban-refused" }, 3],
  );
}
{
  const shown = {
    ...member("ban"),
    ban: {
      ...member("ban").ban,
      choices: [{ value: "0", label: "Lift ban" }],
      reason_required: 0,
    },
  };
  const { client, calls } = replay([
    capability,
    shown,
    result("modcp_member_ban_succeed"),
  ]);
  const lookup = await client.lookupPanelMember("ban", { uid: "71" });
  const unoffered = await client.changeMemberBan(lookup.page, "5", 7, "", true);
  const lift = await client.changeMemberBan(
    lookup.page,
    "0",
    null,
    "fictional lift",
    true,
  );
  check(
    "member unban is a distinct offered choice and omits expiry",
    [unoffered.kind, lift.kind, calls[2]],
    [
      "invalid-input",
      "acknowledged",
      trace(
        "POST",
        { action: "member", op: "ban", tsdmapp: "json", tsdmv: "4" },
        {
          formhash: "abcdef12",
          username: "",
          uid: "71",
          bannew: "0",
          banexpirynew: "",
          reason: "fictional lift",
          bansubmit: "true",
        },
      ),
    ],
  );
}
{
  const nativeEdit =
    '<form method="post" action="forum.php?mod=modcp&amp;action=member&amp;op=edit"><input type="hidden" name="formhash" value="abcdef12"><input type="hidden" name="uid" value="71"><input type="hidden" name="username" value=""><a href="home.php?mod=space&amp;uid=71">fictional_member</a><textarea name="bionew">Old</textarea><textarea name="signaturenew">[b]Signature[/b]</textarea><button name="editsubmit" value="true">Edit</button></form>';
  const { client, calls } = replay([
    oldMode,
    nativeEdit,
    result("", { alert: "info", message: "用户信息成功更新，请继续操作" }),
  ]);
  const shown = await client.lookupPanelMember("edit", { uid: "71" });
  const unoffered = await client.editPanelMember(
    shown.page,
    { bio: "New", signature: "[b]Signature[/b]", clearAvatar: true },
    true,
  );
  const saved = await client.editPanelMember(
    shown.page,
    { bio: "New", signature: "[b]Signature[/b]" },
    true,
  );
  check(
    "native member edit requires offered avatar clearing and recognizes only the known verdict",
    [unoffered.kind, saved, calls],
    [
      "invalid-input",
      {
        kind: "acknowledged",
        operation: "edit-member",
        code: "members_edit_succeed",
      },
      [
        status,
        trace("GET", { action: "member", op: "edit", uid: "71" }),
        trace(
          "POST",
          { action: "member", op: "edit", tsdmapp: "json" },
          {
            formhash: "abcdef12",
            username: "",
            uid: "71",
            bionew: "New",
            signaturenew: "[b]Signature[/b]",
            editsubmit: "true",
          },
        ),
      ],
    ],
  );
}
{
  const { client, calls, replace } = replay([
    capability,
    rulePage("Original"),
    () => {
      replace();
      return rulePage("Updated", 1, 1);
    },
  ]);
  const viewed = await client.readForumRules("10");
  const answer = await client.saveForumRules(viewed.page, "Updated", true);
  check(
    "a replaced panel login after dispatch leaves the original effect uncertain",
    [answer, calls.map(([method]) => method)],
    [{ kind: "uncertain", operation: "save-rules" }, ["GET", "GET", "POST"]],
  );
}
{
  const nativeEmpty =
    '<form method="post" action="forum.php?mod=modcp&amp;action=log"><input name="keyword" value=""></form>';
  const { client, calls } = replay([nativeEmpty]);
  const observed = await client.readPanelLog();
  check(
    "native panel can offer a log form without a log table",
    [observed, calls],
    [
      {
        kind: "panel-log",
        page: {
          page: 1,
          keyword: "",
          hasNext: false,
          enabled: null,
          entries: [],
        },
      },
      [trace("GET", { action: "log", ...json })],
    ],
  );
}
{
  const { client, calls } = replay([
    notes([note(90, "one"), note(91, "two")]),
    notes([note(91, "two")]),
  ]);
  const shown = await client.readManagementNotes();
  const effect = await client.deleteManagementNotes(
    shown.page,
    ["90", "91"],
    true,
  );
  check(
    "deleting multiple notes preserves confirmed and remaining IDs",
    [effect, calls.length],
    [
      {
        kind: "partial",
        operation: "delete-notes",
        confirmedIds: ["90"],
        remainingIds: ["91"],
        unknownIds: [],
      },
      2,
    ],
  );
}
{
  const empty =
    '<form method="post" action="forum.php?mod=modcp&amp;action=log"><input name="keyword"></form>';
  const { client, calls } = replay([
    { ok: 0, uid: 31, error: "modcp_log_storage", document: empty },
    empty,
  ]);
  const log = await client.readPanelLog("Fiction", 2);
  check(
    "legacy log storage selects one scoped native read",
    [log.kind, calls],
    [
      "panel-log",
      [
        trace("GET", { action: "log", keyword: "Fiction", page: "2", ...json }),
        trace("GET", { action: "log", keyword: "Fiction", page: "2" }),
      ],
    ],
  );
}
console.log(JSON.stringify({ results: out }));
