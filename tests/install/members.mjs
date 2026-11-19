import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as sdk from "tsdm-sdk";

const origin = "https://forum.test";
const response = (url, body, status = 200) => ({
  status,
  url,
  redirect: "none",
  contentType: typeof body === "string" ? "text/html" : "application/json",
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const tests = {};
async function check(expected, execute) {
  const observed = await execute();
  assert.deepEqual(observed, expected);
  return { expected, observed };
}
const profile = {
  ok: 1,
  type: "profile",
  schema: 4,
  uid: 101,
  user: { uid: 204, username: "Fictional Birch", online: 0 },
};
tests.lookup = async () => {
  const requests = [];
  const client = sdk.createForumClient({
    origin,
    transport: {
      async request(url, options) {
        assert.deepEqual(options, { fresh: true });
        const q = new URL(url).searchParams;
        requests.push(Object.fromEntries(q));
        if (q.get("uid") === "999")
          return response(url, {
            ok: 0,
            login: 0,
            error: "message",
            message: "Member not found",
          });
        return response(url, profile);
      },
    },
  });
  const exact = await client.lookupMember({ id: "204" });
  const byName = await client.lookupMember({ username: "Fictional Birch" });
  const wrong = await client.lookupMember({ id: "205" });
  const missing = await client.lookupMember({ id: "999" });
  return check(
    {
      exact: { id: "204", name: "Fictional Birch" },
      byName: "204",
      actor: "101",
      wrong: "invalid",
      missing: "missing",
      requests: [
        { mod: "space", uid: "204", tsdmapp: "json", nodoc: "1" },
        {
          mod: "space",
          username: "Fictional Birch",
          tsdmapp: "json",
          nodoc: "1",
        },
        { mod: "space", uid: "205", tsdmapp: "json", nodoc: "1" },
        { mod: "space", uid: "999", tsdmapp: "json", nodoc: "1" },
      ],
    },
    () => ({
      exact: exact.member,
      byName: byName.member?.id,
      actor: exact.account.id,
      wrong: wrong.kind,
      missing: missing.kind,
      requests,
    }),
  );
};

tests.lists = async () => {
  const requests = [];
  const client = sdk.createForumClient({
    origin,
    transport: {
      async request(url) {
        const q = new URL(url).searchParams;
        const type = q.get("type") ?? "";
        const view = q.get("view") ?? "me";
        const target = Number(q.get("uid") ?? 101);
        const group = Number(q.get("group") ?? -1);
        const page = Number(q.get("page") ?? 1);
        requests.push([q.get("do"), type, view, target, group, page]);
        if (target === 999)
          return response(
            url,
            "<div class=nfl><h2 class=xs2>隐私设置</h2></div>",
          );
        if (q.get("do") === "favorite")
          return response(url, {
            ok: 1,
            type: "favorite",
            schema: 8,
            uid: 101,
            kind: type,
            page,
            pages: 1,
            has_next: 0,
            count: 1,
            items: [
              {
                favid: type === "forum" ? 502 : 501,
                id: 44,
                idtype: type === "forum" ? "fid" : "tid",
                kind: type,
                title: "Fictional target",
              },
            ],
          });
        return response(url, {
          ok: 1,
          type: "friend",
          schema: 10,
          uid: 101,
          owner: { uid: target, username: "Fictional owner" },
          self: Number(target === 101),
          view,
          kind: type,
          group,
          page,
          pages: view === "me" && group === -1 ? 2 : 1,
          has_next: Number(view === "me" && group === -1 && page === 1),
          count: 2,
          groups:
            target === 101 && view === "me"
              ? [
                  { id: 0, name: "Other" },
                  { id: 1, name: "Study" },
                ]
              : [],
          friends: [
            { uid: 204, username: "Fictional Birch", gid: 1 },
            ...(view === "visitor"
              ? [{ uid: 0, username: "Anonymous", anonymous: 1 }]
              : []),
          ],
        });
      },
    },
  });
  const own = await client.readFriends({ scope: "own", accountId: "101" });
  const next = await client.readFriends({
    scope: "own",
    accountId: "101",
    page: 2,
  });
  const member = await client.readFriends({ scope: "member", memberId: "203" });
  const group = await client.readFriends({
    scope: "own",
    accountId: "101",
    groupId: "1",
  });
  const visitor = await client.readFriends({
    scope: "visitors",
    accountId: "101",
  });
  const online = await client.readFriends({ scope: "online" });
  const privateView = await client.readFriends({
    scope: "member",
    memberId: "999",
  });
  const switched = await client.readFriends({
    scope: "visitors",
    accountId: "102",
  });
  const forum = await client.readFavorites({ kind: "forum", accountId: "101" });
  const thread = await client.readFavorites({
    kind: "thread",
    accountId: "101",
  });
  return check(
    {
      own: ["204", 2],
      next: [2, null],
      member: "203",
      group: [
        { id: "0", name: "Other" },
        { id: "1", name: "Study" },
      ],
      visitors: ["204", null],
      online: "204",
      privateView: "permission",
      switched: "stale",
      forum: ["502", "44"],
      thread: ["501", "44"],
      requests: [
        ["friend", "", "me", 101, -1, 1],
        ["friend", "", "me", 101, -1, 2],
        ["friend", "", "me", 203, -1, 1],
        ["friend", "", "me", 101, 1, 1],
        ["friend", "", "visitor", 101, -1, 1],
        ["friend", "member", "online", 101, -1, 1],
        ["friend", "", "me", 999, -1, 1],
        ["friend", "", "visitor", 101, -1, 1],
        ["favorite", "forum", "me", 101, -1, 1],
        ["favorite", "thread", "me", 101, -1, 1],
      ],
    },
    () => ({
      own: [own.members?.[0]?.id, own.nextPage],
      next: [next.page, next.nextPage],
      member: member.ownerId,
      group: group.groups,
      visitors: visitor.members?.map((entry) => entry.id),
      online: online.members?.[0]?.id,
      privateView: privateView.kind,
      switched: switched.kind,
      forum: [forum.items?.[0]?.recordId, forum.items?.[0]?.targetId],
      thread: [thread.items?.[0]?.recordId, thread.items?.[0]?.targetId],
      requests,
    }),
  );
};

const status = (id = 101, forms = []) => ({
  ok: 1,
  api: 1,
  version: "4.0.0",
  uid: id,
  v4: 1,
  forms,
});
const xml = (body) => `<?xml version="1.0"?><root><![CDATA[${body}]]></root>`;

tests.mentions = async () => {
  const requests = [];
  let session = "alice-1";
  let mode = "supported";
  const client = sdk.createMemberClient({
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        assert.equal(request.fresh, true);
        assert.equal(request.session, "alice-1");
        const address = new URL(url);
        if (address.searchParams.get("action") === "status")
          return response(url, status());
        requests.push([
          address.pathname + address.search,
          request.method,
          request.effect,
          request.body ?? null,
        ]);
        if (address.pathname === "/misc.php")
          return response(
            url,
            xml("Fictional Elm,Fictional Birch,Fictional Elm"),
          );
        if (mode === "switch") session = "bob-1";
        if (mode === "absent") return response(url, "Unavailable", 404);
        const person = { uid: 204, username: "Fictional Birch" };
        return response(
          url,
          request.body === "op=init"
            ? { ok: 1, recent: [person], friends: [] }
            : { ok: 1, list: [person] },
        );
      },
    },
  });
  const recent = await client.loadMentionCandidates("101");
  const found = await client.searchMentionMembers("101", "Fictional Birch");
  const stock = await client.readNativeMentionNames("101");
  mode = "absent";
  const fallback = await client.loadMentionCandidates("101");
  mode = "switch";
  const switched = await client.searchMentionMembers("101", "204");
  return check(
    {
      recent: ["204"],
      found: ["204"],
      stock: ["Fictional Elm", "Fictional Birch"],
      fallback: ["Fictional Elm", "Fictional Birch"],
      switched: "stale",
      requests: [
        ["/plugin.php?id=atplus%3Asearch", "POST", false, "op=init"],
        [
          "/plugin.php?id=atplus%3Asearch",
          "POST",
          false,
          "op=search&q=Fictional+Birch",
        ],
        ["/misc.php?mod=getatuser&inajax=1", "GET", false, null],
        ["/plugin.php?id=atplus%3Asearch", "POST", false, "op=init"],
        ["/misc.php?mod=getatuser&inajax=1", "GET", false, null],
        ["/plugin.php?id=atplus%3Asearch", "POST", false, "op=search&q=204"],
      ],
    },
    () => ({
      recent: recent.recent?.map((member) => member.id),
      found: found.members?.map((member) => member.id),
      stock: stock.names,
      fallback: fallback.names,
      switched: switched.kind,
      requests,
    }),
  );
};

const approval = "/home.php?mod=spacecp&ac=friend&op=add&uid=204&from=notice";
const handle = (uid, message_key, values = {}, ok = 1) => ({
  ok,
  uid,
  type: "result",
  schema: 13,
  kind: "handle",
  message_key,
  values,
  login: 0,
});
const friendForm = (mode, actor = 101, target = 204) => ({
  ok: 1,
  uid: actor,
  type: "form",
  schema: 17,
  form: "friendadd",
  mode,
  touid: target,
  submit: {
    url: `home.php?mod=spacecp&ac=friend&op=add&uid=${target}`,
    method: "POST",
    enctype: "application/x-www-form-urlencoded",
    fields: {
      formhash: "fictional_token",
      handlekey: mode === "approve" ? `afr_${target}` : `addfriendhk_${target}`,
      ...(mode === "approve"
        ? { from: "notice", add2submit: "true" }
        : { addsubmit: "true" }),
    },
  },
  gid: {
    name: "gid",
    value: "1",
    choices: [
      { value: "0", label: "Other" },
      { value: "1", label: "Study" },
    ],
  },
  note: mode === "add" ? { name: "note", max: 30 } : null,
  hook_fields: [],
  unsupported: [],
});

tests.friendEffects = async () => {
  const writes = [];
  let mode = "send";
  let continuity = "alice-1";
  const client = sdk.createMemberClient({
    origin,
    session: () => continuity,
    transport: {
      async request(url, request) {
        assert.equal(request.fresh, true);
        assert.equal(request.session, "alice-1");
        const q = new URL(url).searchParams;
        if (q.get("action") === "status")
          return response(url, status(101, ["friendadd"]));
        if (request.method === "GET") {
          assert.equal(request.effect, false);
          assert.equal(q.get("formhash"), null);
          assert.equal(q.get("tsdmform"), "1");
          assert.equal(q.get("tsdmv"), "4");
          if (mode === "pending")
            return response(url, {
              ...handle(101, "waiting_for_the_other_test", {}, 0),
              message: "Pending",
            });
          return response(
            url,
            friendForm(
              q.get("from") === "notice" ? "approve" : "add",
              mode === "wrong-form" ? 102 : 101,
            ),
          );
        }
        assert.equal(request.effect, true);
        assert.equal(q.get("tsdmapp"), "json");
        assert.equal(q.get("tsdmv"), "4");
        assert.equal(q.get("tsdmform"), null);
        const fields = new URLSearchParams(request.body);
        assert.equal(fields.get("formhash"), "fictional_token");
        writes.push([
          mode,
          q.get("uid"),
          fields.get("addsubmit"),
          fields.get("add2submit"),
          fields.get("gid"),
          fields.get("note"),
          fields.get("from"),
        ]);
        if (mode === "drop") throw Error("Response lost after dispatch");
        if (mode === "switch") continuity = "other-session";
        if (mode === "approve" || mode === "wrong-result")
          return response(
            url,
            handle(101, "friends_add", {
              uid: mode === "approve" ? "204" : "205",
            }),
          );
        return response(url, handle(101, "request_has_been_sent"));
      },
    },
  });
  const sent = await client.sendFriendRequest({
    accountId: "101",
    memberId: "204",
    groupId: "0",
    note: "Hello",
  });
  mode = "approve";
  const approved = await client.approveFriendRequest({
    accountId: "101",
    noticeURL: approval,
  });
  const invalidLink = await client.approveFriendRequest({
    accountId: "101",
    noticeURL: "https://elsewhere.test" + approval,
  });
  mode = "wrong-result";
  const wrongResult = await client.approveFriendRequest({
    accountId: "101",
    noticeURL: approval,
  });
  mode = "pending";
  const pending = await client.sendFriendRequest({
    accountId: "101",
    memberId: "204",
  });
  const self = await client.sendFriendRequest({
    accountId: "101",
    memberId: "101",
  });
  mode = "wrong-form";
  const wrongForm = await client.sendFriendRequest({
    accountId: "101",
    memberId: "204",
  });
  mode = "drop";
  const dropped = await client.sendFriendRequest({
    accountId: "101",
    memberId: "204",
  });
  mode = "switch";
  const switched = await client.sendFriendRequest({
    accountId: "101",
    memberId: "204",
  });
  return check(
    {
      sent: "request-sent",
      approved: "approved",
      invalidLink: "invalid",
      wrongResult: "uncertain",
      pending: "pending",
      self: "invalid",
      wrongForm: "stale",
      dropped: "uncertain",
      switched: "uncertain",
      writes: [
        ["send", "204", "true", null, "0", "Hello", null],
        ["approve", "204", null, "true", "1", null, "notice"],
        ["wrong-result", "204", null, "true", "1", null, "notice"],
        ["drop", "204", "true", null, "1", "", null],
        ["switch", "204", "true", null, "1", "", null],
      ],
    },
    () => ({
      sent: sent.kind,
      approved: approved.kind,
      invalidLink: invalidLink.kind,
      wrongResult: wrongResult.kind,
      pending: pending.kind,
      self: self.kind,
      wrongForm: wrongForm.kind,
      dropped: dropped.kind,
      switched: switched.kind,
      writes,
    }),
  );
};

function favoriteDialog(url, kind, remove) {
  const id = kind === "forum" ? "502" : "501";
  const action = `home.php?mod=spacecp&ac=favorite&${remove ? `op=delete&favid=${id}` : "id=44&spaceuid=0"}&type=${kind}`;
  const button = remove ? "deletesubmit" : "favoritesubmit";
  const key = remove ? `a_delete_${id}` : "k_favorite";
  const markup = `<form method=post action="${action.replaceAll("&", "&amp;")}"><input type=hidden name=formhash value=fictional_token><input type=hidden name=handlekey value=${key}><input type=hidden name=${button} value=true>${remove ? "" : "<textarea name=description></textarea>"}</form>`;
  return response(url, {
    ok: 1,
    uid: 101,
    type: "result",
    schema: 13,
    kind: "page",
    document: xml(markup),
  });
}

tests.favoriteEffects = async () => {
  const writes = [];
  const reads = [];
  const saved = new Map();
  let mode = "normal";
  const client = sdk.createMemberClient({
    origin,
    session: () => "alice-1",
    transport: {
      async request(url, request) {
        assert.equal(request.session, "alice-1");
        assert.equal(request.fresh, true);
        const q = new URL(url).searchParams;
        const kind = q.get("type");
        if (q.get("action") === "status")
          return response(url, status(101, ["favorite"]));
        if (q.get("do") === "favorite") {
          const items = saved.has(kind)
            ? [
                {
                  favid: saved.get(kind),
                  id: 44,
                  idtype: kind === "forum" ? "fid" : "tid",
                  kind,
                  title: "Fictional target",
                },
              ]
            : [];
          reads.push([kind, items.map((entry) => String(entry.favid))]);
          return response(url, {
            ok: 1,
            type: "favorite",
            schema: 8,
            uid: 101,
            kind,
            page: 1,
            pages: 1,
            has_next: 0,
            count: items.length,
            items,
          });
        }
        const removes = q.get("op") === "delete";
        if (request.method === "GET") {
          assert.equal(request.effect, false);
          assert.equal(q.get("formhash"), null);
          if (mode === "repeat")
            return response(url, {
              ok: 0,
              uid: 101,
              form: "favorite",
              error: "message",
              message_key: "favorite_repeat",
            });
          if (mode === "disabled")
            return response(url, {
              ok: 0,
              uid: 101,
              form: "favorite",
              error: "message",
              message_key: "favorite_status_off",
            });
          if (kind === "forum" && !removes) {
            assert.equal(q.get("tsdmform"), "1");
            return response(url, {
              ok: 1,
              uid: 101,
              type: "form",
              schema: 17,
              form: "favorite",
              favtype: kind,
              id: 44,
              submit: {
                method: "POST",
                enctype: "application/x-www-form-urlencoded",
                url: "home.php?mod=spacecp&ac=favorite&type=forum&id=44&spaceuid=0",
                fields: {
                  formhash: "fictional_token",
                  handlekey: "favoriteforum",
                  favoritesubmit: "true",
                },
              },
              hook_fields: [],
              unsupported: [],
            });
          }
          return favoriteDialog(url, kind, removes);
        }
        assert.equal(request.effect, true);
        const fields = new URLSearchParams(request.body);
        assert.equal(fields.get("formhash"), "fictional_token");
        writes.push([
          kind,
          removes ? "remove" : "add",
          q.get("favid") ?? q.get("id"),
          fields.get("description"),
          q.get("tsdmv"),
        ]);
        if (removes) {
          saved.delete(kind);
          return kind === "forum"
            ? response(
                url,
                xml(
                  "<script>if(typeof succeedhandle_a_delete_502=='function') {succeedhandle_a_delete_502('home.php', '操作成功 ', {'favid':'502','id':'44'});}</script>",
                ),
              )
            : response(
                url,
                handle(101, "do_success", { favid: "501", id: "44" }),
              );
        }
        const id = kind === "forum" ? 502 : 501;
        if (mode !== "receipt-only") saved.set(kind, id);
        if (mode === "drop") throw Error("Response lost after dispatch");
        return response(
          url,
          handle(101, "favorite_do_success", { favid: String(id), id: "44" }),
        );
      },
    },
  });
  const intent = (kind) => ({ accountId: "101", kind, targetId: "44" });
  const board = await client.addFavorite({
    ...intent("forum"),
    description: "Board",
  });
  const thread = await client.addFavorite({
    ...intent("thread"),
    description: "Thread",
  });
  mode = "repeat";
  const repeat = await client.addFavorite(intent("forum"));
  mode = "normal";
  const mismatch = await client.removeFavorite({
    ...intent("forum"),
    recordId: "501",
  });
  const removeBoard = await client.removeFavorite({
    ...intent("forum"),
    recordId: "502",
  });
  const removeThread = await client.removeFavorite({
    ...intent("thread"),
    recordId: "501",
  });
  mode = "disabled";
  const refused = await client.addFavorite(intent("forum"));
  mode = "receipt-only";
  const unverified = await client.addFavorite(intent("forum"));
  mode = "drop";
  const dropped = await client.addFavorite(intent("thread"));
  return check(
    {
      board: ["added", "502"],
      thread: ["added", "501"],
      repeat: "already-saved",
      mismatch: "invalid",
      removeBoard: "removed",
      removeThread: "removed",
      refused: "refused",
      unverified: "uncertain",
      dropped: "uncertain",
      writes: [
        ["forum", "add", "44", "Board", "4"],
        ["thread", "add", "44", "Thread", null],
        ["forum", "remove", "502", null, null],
        ["thread", "remove", "501", null, null],
        ["forum", "add", "44", "", "4"],
        ["thread", "add", "44", "", null],
      ],
      reads: [
        ["forum", ["502"]],
        ["thread", ["501"]],
        ["forum", ["502"]],
        ["forum", ["502"]],
        ["forum", ["502"]],
        ["forum", []],
        ["thread", ["501"]],
        ["thread", []],
        ["forum", []],
      ],
    },
    () => ({
      board: [board.kind, board.recordId],
      thread: [thread.kind, thread.recordId],
      repeat: repeat.kind,
      mismatch: mismatch.kind,
      removeBoard: removeBoard.kind,
      removeThread: removeThread.kind,
      refused: refused.kind,
      unverified: unverified.kind,
      dropped: dropped.kind,
      writes,
      reads,
    }),
  );
};

tests.native = async () => {
  const shell =
    '<div id=um><strong><a href="home.php?mod=space&amp;uid=101">Fictional Alder</a></strong></div>';
  const calls = [];
  const transport = {
    async request(url, request) {
      const q = new URL(url).searchParams;
      const script = new URL(url).pathname;
      if (q.get("action") === "status")
        return response(url, "No status API", 404);
      if (script === "/forum.php") return response(url, shell);
      if (q.get("ac") === "friend") {
        const approval = q.get("from") === "notice";
        if (request.method === "POST") {
          const data = new URLSearchParams(request.body);
          const approve = data.has("add2submit");
          const handle = data.get("handlekey");
          calls.push([
            approve ? "approve" : "send",
            data.get("gid"),
            q.get("tsdmv"),
            request.effect,
          ]);
          return response(
            url,
            xml(
              `<script>if(typeof succeedhandle_${handle}=='function') {succeedhandle_${handle}('home.php', '${approve ? "您已和Birch成为好友" : "好友请求已发送，请等待对方验证"}', ${approve ? "{'uid':'204'}" : "{}"});}</script>`,
            ),
          );
        }
        assert.equal(q.get("tsdmform"), null);
        return response(
          url,
          xml(
            `<form method=post action="home.php?mod=spacecp&amp;ac=friend&amp;op=add&amp;uid=204"><input type=hidden name=formhash value=fictional_token><input type=hidden name=handlekey value="${approval ? "afr_204" : "addfriendhk_204"}"><input type=hidden name="${approval ? "add2submit" : "addsubmit"}" value=true><input type=radio name=gid value=1 checked>${approval ? "" : "<input name=note>"}</form>`,
          ),
        );
      }
      if (q.get("do") === "favorite") {
        const kind = q.get("type");
        return response(
          url,
          shell +
            `<div id=ct><ul id=favorite_ul><li id=fav_508><input name="favorite[]" value=508 vid=44><a href="forum.php?mod=${kind === "forum" ? "forumdisplay&amp;fid" : "viewthread&amp;tid"}=44">Fictional target</a></li></ul></div>`,
        );
      }
      if (q.get("do") === "friend") {
        const view = q.get("view") ?? "me";
        return response(
          url,
          shell +
            `<ul class=buddy><li id=friend_204_li><h4><a href="home.php?mod=space&amp;uid=204">Fictional Birch</a></h4>${view === "me" ? "" : '<a href="home.php?mod=spacecp&amp;ac=friend&amp;op=add&amp;uid=204">Add</a>'}</li></ul><ul class=buddy_group><li><a href="home.php?mod=space&amp;do=friend&amp;group=1">Study</a></li></ul>`,
        );
      }
      if (q.has("tsdmapp"))
        return response(url, { ok: 1, uid: 101, type: "profile", schema: 3 });
      return response(
        url,
        shell +
          '<div class="bm_c u_profile"><h2 class=mbn>Fictional Birch<span class=xw0>(UID: 204)</span></h2></div>',
      );
    },
  };
  const forum = sdk.createForumClient({ origin, transport });
  const member = sdk.createMemberClient({
    origin,
    transport,
    session: () => "native-session",
  });
  const profile = await forum.lookupMember({ username: "Fictional Birch" });
  const visitors = await forum.readFriends({
    scope: "visitors",
    accountId: "101",
  });
  const online = await forum.readFriends({ scope: "online" });
  const group = await forum.readFriends({
    scope: "own",
    accountId: "101",
    groupId: "1",
  });
  const board = await forum.readFavorites({ kind: "forum", accountId: "101" });
  const thread = await forum.readFavorites({
    kind: "thread",
    accountId: "101",
  });
  const sent = await member.sendFriendRequest({
    accountId: "101",
    memberId: "204",
  });
  const approved = await member.approveFriendRequest({
    accountId: "101",
    noticeURL: approval,
  });
  return check(
    {
      profile: "204",
      visitors: "204",
      online: "204",
      group: [{ id: "1", name: "Study" }],
      board: ["forum", "508"],
      thread: ["thread", "508"],
      sent: "request-sent",
      approved: "approved",
      calls: [
        ["send", "1", null, true],
        ["approve", "1", null, true],
      ],
    },
    () => ({
      profile: profile.member?.id,
      visitors: visitors.members?.[0]?.id,
      online: online.members?.[0]?.id,
      group: group.groups,
      board: [board.favoriteKind, board.items?.[0]?.recordId],
      thread: [thread.favoriteKind, thread.items?.[0]?.recordId],
      sent: sent.kind,
      approved: approved.kind,
      calls,
    }),
  );
};

tests.unprovenAbsence = async () => {
  const requests = [];
  const client = sdk.createMemberClient({
    origin,
    session: () => "alice-1",
    transport: {
      async request(url, request) {
        const q = new URL(url).searchParams;
        requests.push([q.get("do"), request.method, request.effect]);
        if (q.get("action") === "status") return response(url, status());
        assert.equal(q.get("do"), "favorite");
        return response(url, {
          ok: 1,
          type: "favorite",
          schema: 8,
          uid: 101,
          kind: "forum",
          page: 1,
          pages: 1,
          has_next: 0,
          count: 1,
          items: [],
        });
      },
    },
  });
  const result = await client.removeFavorite({
    accountId: "101",
    kind: "forum",
    targetId: "44",
    recordId: "502",
  });
  return check(
    {
      result: "unavailable",
      requests: [
        [null, "GET", false],
        ["favorite", "GET", false],
        ["favorite", "GET", false],
      ],
    },
    () => ({ result: result.kind, requests }),
  );
};

tests.redirectedScope = async () => {
  const client = sdk.createForumClient({
    origin,
    transport: {
      async request(url) {
        const destination = new URL(url);
        destination.searchParams.set("uid", "808");
        const payload = {
          ok: 1,
          uid: 101,
          type: "favorite",
          schema: 8,
          kind: "forum",
          page: 1,
          pages: 1,
          has_next: 0,
          count: 0,
          items: [],
        };
        return { ...response(destination.href, payload), redirect: "followed" };
      },
    },
  });
  const result = await client.readFavorites({
    accountId: "101",
    kind: "forum",
  });
  return check("invalid", () => result.kind);
};

const fullProfile = {
  ...profile,
  user: {
    ...profile.user,
    avatar: "/avatar.png",
    email_verified: 1,
    customstatus: "A &amp; B",
    signature_html: "<b>Hello</b><script>bad()</script>",
  },
  stats: {
    friends: 3,
    credits: 79,
    extcredits: [{ id: 2, title: "天使币", unit: "枚", value: 5 }],
  },
  profiles: [{ id: "bio", title: "自我介绍", value: "<i>About me</i>" }],
  medals: [
    { id: "90", name: "Helper", image: "medal.png", description: "Thanks" },
  ],
  manage_forums: [{ fid: 12, name: "Games" }],
  groups: {
    admin: null,
    member: { gid: 7, title: "Member", icon: "group.png" },
    ext: [],
  },
  activity: {
    oltime: 10,
    regdate: 1700000000,
    regip: "",
    timezone_text: "Default",
  },
  checkin: {
    days: 10,
    mdays: 2,
    last: 1700000000,
    reward: 180,
    lastreward: 18,
    level: {
      code: "LV.1",
      name: "New",
      next: "LV.2",
      next_name: "Regular",
      remain: 2,
    },
    today: 0,
  },
  unread: { notice: 2, pm: 1 },
  timeoffset: 8,
};
const nativeProfile = `<div id=um><strong><a href="home.php?mod=space&uid=101">Viewer</a></strong></div>
<div id=ct><div class="bm_c u_profile"><div class="pbm"><h2 class=mbn>Fictional Birch<span class=xw0>(UID: 204)</span></h2>
<ul><li><em>邮箱状态</em>已验证</li><li><em>个人签名</em><b>Hello</b></li>
<li><em>统计信息</em><a href="home.php?mod=space&uid=204&do=friend">好友数 3</a></li>
<li><em>自我介绍</em><i>About me</i></li></ul></div>
<div class=pbm><ul><li><em>用户组</em><a href="home.php?mod=spacecp&ac=usergroup&gid=7">Member</a></li></ul>
<ul id=pbbs><li><em>在线时间</em>10 小时</li><li><em>注册时间</em>2023-11-15 06:13</li></ul></div>
<div id=psts><ul><li><em>积分</em>79</li><li><em>天使币</em>5 枚</li></ul></div></div></div>`;
function profileReader(bodies) {
  const requests = [];
  const client = sdk.createForumClient({
    origin,
    transport: {
      async request(url, options) {
        assert.deepEqual(options, { fresh: true });
        requests.push(Object.fromEntries(new URL(url).searchParams));
        assert.ok(bodies.length);
        return response(url, bodies.shift());
      },
    },
  });
  return { client, requests };
}
tests.fullProfiles = async () => {
  const { client, requests } = profileReader([
    { ...fullProfile, document: "<h2>Wrong document</h2>" },
    { ok: 1, uid: 101, document: nativeProfile },
    profile,
    nativeProfile,
    fullProfile,
    { ok: 0, login: 1, error: "message", schema: 4, message: "Sign in" },
    profile,
    "<p>Unrecognized profile</p>",
  ]);
  const structured = await client.readMemberProfile({ id: "204" });
  const legacy = await client.readMemberProfile({
    username: "fictional birch",
  });
  const fallback = await client.readMemberProfile({ id: "204" });
  const wrong = await client.readMemberProfile({ id: "205" });
  const login = await client.readMemberProfile({ id: "204" });
  const incomplete = await client.readMemberProfile({ id: "204" });
  return check(
    {
      identity: [
        "member-profile",
        "structured",
        "101",
        "204",
        "Fictional Birch",
      ],
      structured: [
        "https://forum.test/avatar.png",
        true,
        "A & B",
        "About me",
        "Helper",
        "12",
        "7",
        1700000000,
        2,
        3,
        "5 枚",
        2,
      ],
      native: [
        "member-profile",
        "native",
        "204",
        true,
        "About me",
        "7",
        "2023-11-15 06:13",
        3,
        "5 枚",
      ],
      outcomes: ["member-profile", "invalid", "login", "incomplete"],
      routes: [
        "204/json",
        "fictional birch/json",
        "204/json",
        "204/native",
        "205/json",
        "204/json",
        "204/json",
        "204/native",
      ],
    },
    () => ({
      identity: [
        structured.kind,
        structured.representation,
        structured.account.id,
        structured.member.id,
        structured.member.name,
      ],
      structured: [
        structured.profile.avatarURL,
        structured.profile.emailVerified,
        structured.profile.customTitle,
        structured.profile.fields[0].text,
        structured.profile.medals[0].name,
        structured.profile.managedForums[0].id,
        structured.profile.groups.member.id,
        structured.profile.activity.registeredAt,
        structured.profile.checkin.level.remainingDays,
        structured.profile.stats.friends,
        structured.profile.stats.credits[0].text,
        structured.profile.unread.notices,
      ],
      native: [
        legacy.kind,
        legacy.representation,
        legacy.member.id,
        legacy.profile.emailVerified,
        legacy.profile.fields[0].text,
        legacy.profile.groups.member.id,
        legacy.profile.activity.registeredAt,
        legacy.profile.stats.friends,
        legacy.profile.stats.credits[0].text,
      ],
      outcomes: [fallback.kind, wrong.kind, login.kind, incomplete.kind],
      routes: requests.map(
        (q) => `${q.uid ?? q.username}/${q.tsdmapp ?? "native"}`,
      ),
    }),
  );
};

if (process.env.TSDM_MEMBERS_UPSTREAM) {
  tests.pinnedProfiles = async () => {
    const read = (name) =>
      readFileSync(
        join(process.env.TSDM_MEMBERS_UPSTREAM, "test/data", name),
        "utf8",
      );
    const bare = (name) => {
      const { profile_html, ...rest } = JSON.parse(
        read(`tsdmapp/${name}.json`),
      );
      return rest;
    };
    const { client } = profileReader([
      bare("profile_v4_other_admin"),
      bare("profile_v4_username"),
      read("profile_self_x5.html"),
    ]);
    const admin = await client.readMemberProfile({ id: "32" });
    const byName = await client.readMemberProfile({ username: "ag_mid" });
    const native = await client.readMemberProfile({ username: "Alice" });
    return check(
      {
        admin: ["structured", "35", "32", ["9", "10"], "1"],
        byName: ["structured", "33", 1809, 25, 1],
        native: ["native", "1000", "1000", 304, 1, "2013-4-25 09:59"],
      },
      () => ({
        admin: [
          admin.representation,
          admin.account.id,
          admin.member.id,
          admin.profile.managedForums.map(({ id }) => id),
          admin.profile.groups.admin.id,
        ],
        byName: [
          byName.representation,
          byName.member.id,
          byName.profile.stats.points,
          byName.profile.activity.onlineHours,
          byName.profile.checkin.days,
        ],
        native: [
          native.representation,
          native.account.id,
          native.member.id,
          native.profile.stats.points,
          native.profile.activity.onlineHours,
          native.profile.activity.registeredAt,
        ],
      }),
    );
  };
}

const selected = process.argv.slice(2);
const results = {};
for (const name of selected.length ? selected : Object.keys(tests))
  results[name] = await tests[name]();
if (!selected.length) {
  const { memberTools } = await import("./members-guide.js");
  const transport = {
    async request(url) {
      return response(url, profile);
    },
  };
  const tools = memberTools(
    origin,
    transport,
    transport,
    () => "doc-session",
    "101",
  );
  results.guide = await check({ kind: "member", id: "204" }, async () => {
    const result = await tools.byUID("204");
    return { kind: result.kind, id: result.member?.id };
  });
}
console.log(JSON.stringify(results));
