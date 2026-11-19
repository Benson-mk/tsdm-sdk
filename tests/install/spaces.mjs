import assert from "node:assert/strict";
import * as sdk from "tsdm-sdk";

const origin = "https://forum.example";
const member = { uid: 502, username: "Fictional Cedar" };
const viewer = { uid: 501, username: "Fictional Elm" };
const common = {
  ok: 1,
  uid: 501,
  formhash: "0123abcd",
  page: 1,
  pages: 2,
  owner: member,
};
const anchor = (query) => "/home.php?" + query;
const space = (query) => anchor("mod=space&uid=502&" + query);
const cp = (query) => anchor("mod=spacecp&ac=" + query);
const follow = (query) => anchor("mod=follow&" + query);
const fragments = cp("follow&op=getfeed&archiver=0&page=2&viewtype=other");
const archive = cp("follow&op=getfeed&archiver=1&page=1&viewtype=other");
let continuity = "offline-session";
let calls = [];
let pending = [];
const results = [];
const client = sdk.createSpaceClient({
  origin,
  session: () => continuity,
  transport: {
    async request(url, request) {
      calls.push({ url, ...request });
      const next = pending.shift();
      assert.ok(next, `unexpected dispatch ${url}`);
      if (next.changeSession) continuity = "offline-other";
      if (next.drop) throw new Error("controlled response loss");
      return {
        status: next.status ?? 200,
        url: next.url ?? url,
        redirect: next.redirect ?? "none",
        contentType:
          typeof next.body === "string" ? "text/html" : "application/json",
        body:
          typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      };
    },
  },
});
function expect(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, observed: actual, requests: calls });
  assert.equal(pending.length, 0, name);
  calls = [];
}
const envelope = (type, schema, fields) => ({
  ...common,
  type,
  schema,
  ...fields,
});
const doing = envelope("space_doing", 57, {
  view: "me",
  hidden: 1,
  doings: [
    {
      ...member,
      doid: 71,
      message: "A fictional status",
      comments_url: cp("doing&op=getcomment&doid=71"),
    },
  ],
});
const replies = envelope("space_docomment", 58, {
  owner: undefined,
  doid: 71,
  page: 2,
  comments: [{ ...viewer, id: 72, upid: 70, message: "A nested reply" }],
});
const feed = (view, fields = {}) =>
  envelope("space_feed", 59, {
    view,
    feeds: [
      {
        ...member,
        feedid: 81,
        note: "Relay note",
        thread: {
          tid: 82,
          subject: "Fictional thread",
          restricted: "Members only",
          relay_url: cp("follow&op=relay&feedid=81&tid=82"),
        },
      },
    ],
    ...fields,
  });
const readCases = [
  [
    "member statuses preserve owner, privacy and next page",
    space("do=doing&view=me"),
    doing,
    ["statuses", "502", "71", "A fictional status", 1, "2"],
  ],
  [
    "nested status replies preserve parent",
    cp("doing&op=getcomment&doid=71&page_c=2"),
    replies,
    ["status-replies", null, "72", "A nested reply", null, null, "70"],
  ],
  [
    "public timeline",
    follow("view=other"),
    feed("other", { next: fragments }),
    ["timeline", "502", "81", "Relay note", null, "2", null, "Members only"],
  ],
  [
    "member timeline",
    follow("uid=502&do=view"),
    feed("we"),
    ["timeline", "502", "81", "Relay note", null, null, null, "Members only"],
  ],
  [
    "following feed",
    follow("view=follow"),
    feed("follow", { owner: viewer }),
    ["timeline", "501", "81", "Relay note", null, null, null, "Members only"],
  ],
  [
    "following list",
    follow("do=following&uid=502"),
    envelope("space_follow", 60, {
      list: "following",
      users: [{ ...viewer, note: "A nickname" }],
    }),
    ["following", "502", "501", "A nickname", null, "2"],
  ],
  [
    "followers list",
    follow("do=follower&uid=502"),
    envelope("space_follow", 60, { list: "follower", users: [viewer] }),
    ["followers", "502", "501", null, null, "2"],
  ],
  [
    "blogs",
    space("do=blog&view=me"),
    envelope("space_blog", 61, {
      view: "me",
      blogs: [
        {
          ...member,
          blogid: 91,
          subject: "An example",
          summary: "Blog summary",
          friend: 2,
        },
      ],
    }),
    ["blogs", "502", "91", "Blog summary", null, "2", null, "2"],
  ],
  [
    "albums",
    space("do=album&view=me"),
    envelope("space_album", 62, {
      mode: "albums",
      view: "me",
      albums: [
        { ...member, albumid: 93, albumname: "An album", need_password: 1 },
      ],
      default_album_url: space("do=album&id=-1"),
    }),
    ["albums", "502", "93", null, null, "2", null, "password"],
  ],
  [
    "wall",
    space("do=wall"),
    envelope("space_wall", 63, {
      cid: 0,
      comments: [
        {
          cid: 94,
          authorid: 501,
          author: viewer.username,
          message: "Wall note",
        },
      ],
    }),
    ["wall", "502", "94", "Wall note", null, "2"],
  ],
  [
    "received greetings",
    cp("poke"),
    envelope("space_poke", 64, {
      owner: undefined,
      pokes: [{ ...member, note: "Hello" }],
    }),
    ["greetings", "501", "502", "Hello", null, "2"],
  ],
];
for (const [name, path, body, expected] of readCases) {
  pending = [{ body }];
  const result = await client.read(path);
  assert.equal(result.kind, "page");
  assert.ok(
    calls.every(
      (item) =>
        item.method === "GET" &&
        item.effect === false &&
        item.fresh &&
        item.session === continuity,
    ),
  );
  const [item] = result.entries;
  const observed = [
    result.view,
    result.owner?.id ?? null,
    item.id,
    item.text,
    result.hidden,
    result.next
      ? (new URL(result.next).searchParams.get("page") ??
        new URL(result.next).searchParams.get("page_c"))
      : null,
    item.parentId,
    item.privacy,
  ];
  expect(name, observed.slice(0, expected.length), expected);
}
for (const [name, body, expectedNext] of [
  [
    "XML switches to archive on explicit false",
    "<root><![CDATA[false]]></root>",
    archive,
  ],
  [
    "XML archive false establishes exhaustion",
    "<root><![CDATA[false]]></root>",
    null,
  ],
  [
    "result document preserves older feed entry",
    {
      type: "result",
      schema: 13,
      kind: "page",
      uid: 501,
      document:
        '<li id="feed_li_81"><div class="flw_author"><a href="home.php?mod=space&uid=502">Fictional Cedar</a></div><h2><a href="forum.php?mod=viewthread&tid=82">Older thread</a></h2><div class="flw_quotenote">Older note</div></li>',
    },
    fragments.replace("page=2", "page=3"),
  ],
]) {
  pending = [{ body }];
  const result = await client.read(
    name.includes("exhaustion") ? archive : fragments,
  );
  const observed = result.next ? new URL(result.next) : null;
  observed?.searchParams.delete("inajax");
  expect(
    name,
    [result.kind, result.entries?.[0]?.text ?? null, observed?.href ?? null],
    [
      "page",
      name.startsWith("result") ? "Older note" : null,
      expectedNext && origin + expectedNext,
    ],
  );
}
const photoMarkup =
  '<div id="ct"><ul class="mlp"><li><a href="home.php?mod=space&uid=502&do=album&picid=95"><img src="data/attachment/album/photo.jpg.thumb.jpg" alt="Photo"></a></li></ul></div>';
const blogMarkup =
  '<div id="ct"><div class="vw"><h1>Fictional title</h1><div id="blog_article">Fictional article</div></div><div id="div_main_content"><div id="comment_ul"><dl id="comment_96_li"><dt><a id="author_96" href="home.php?mod=space&uid=501">Fictional Elm</a></dt><dd id="comment_96">Blog comment</dd></dl></div></div></div>';
for (const [name, path, body, expected] of [
  [
    "native album thumbnails",
    space("do=album&id=93"),
    photoMarkup,
    ["page", "photos", "95", null],
  ],
  [
    "legacy blog article and comments",
    space("do=blog&id=91"),
    { uid: 0, document: blogMarkup },
    ["page", "blog", "91", "Fictional article", "96"],
  ],
  [
    "photo viewer handoff",
    space("do=album&picid=95"),
    null,
    ["document-navigation", origin + space("do=album&picid=95")],
  ],
  [
    "protected blog handoff",
    space("do=blog&id=91"),
    '<form id="invalueform"><h1>Password required</h1></form>',
    ["document-navigation", origin + space("do=blog&id=91")],
  ],
  [
    "wall privacy ends the read",
    space("do=wall"),
    '<div class="nfl"><h2 class="xs2">Private wall</h2></div>',
    ["permission"],
  ],
  [
    "guest cannot view received greetings",
    cp("poke"),
    { ok: 0, uid: 0, login: 1, message_key: "to_login" },
    ["login"],
  ],
  [
    "missing member space",
    space("do=wall"),
    { ok: 0, uid: 501, message_key: "space_does_not_exist" },
    ["missing"],
  ],
  [
    "rate-limited continuation",
    fragments,
    { status: 429, body: "" },
    ["limited"],
  ],
  [
    "foreign destination never reaches host",
    "https://outside.example/home.php?mod=space&do=wall",
    null,
    ["invalid"],
  ],
  [
    "wrong wall owner is rejected",
    space("do=wall"),
    envelope("space_wall", 63, { owner: viewer, cid: 0, comments: [] }),
    ["invalid"],
  ],
]) {
  pending =
    body == null ? [] : [typeof body.status === "number" ? body : { body }];
  const result = await client.read(path);
  const observed =
    result.kind === "page"
      ? [
          result.kind,
          result.view,
          result.entries[0].id,
          result.entries[0].text,
          result.entries[1]?.id,
        ]
      : [result.kind, result.destination];
  expect(name, observed.slice(0, expected.length), expected);
}
pending = [
  { body: { type: "obsolete", schema: 1 } },
  {
    body: '<root><![CDATA[<div class="doing_form" id="abc12345_form_71_0"></div><div class="doing_empty">No replies</div>]]></root>',
  },
];
const emptyReplies = await client.read(cp("doing&op=getcomment&doid=71"));
assert.equal(calls.length, 2);
assert.equal(new URL(calls[1].url).searchParams.get("inajax"), "1");
expect(
  "unsupported schema falls back once to explicit native empty reply list",
  [emptyReplies.kind, emptyReplies.entries?.length],
  ["page", 0],
);
pending = [
  {
    body: '<div id="ct"><ul id="followlist"><li id="feed_li_81"><div class="flw_author"><a href="home.php?mod=space&uid=502">Fictional Cedar</a></div><h2><a href="forum.php?mod=viewthread&tid=82">Recent thread</a></h2></li></ul><script>var feedInfo = {archiver: 1, primary: 1, query: true};</script></div>',
  },
];
const recent = await client.read(follow("view=other"));
expect(
  "native timeline uses recent pagination when advertised",
  recent.next,
  origin + fragments,
);
pending = [{ body: feed("other", { next: fragments }) }];
const firstFeed = await client.read(follow("view=other"));
expect(
  "first feed page offers a same-scope continuation",
  firstFeed.next,
  origin + fragments,
);
pending = [
  { body: feed("other", { more: 1, page: 2, archiver: 0, uid: 999 }) },
];
expect(
  "returned account change discards a structured continuation",
  (await client.readNext(firstFeed)).kind,
  "session-changed",
);
continuity = "changed-before-next";
expect(
  "session change before continuation sends nothing",
  (await client.readNext(firstFeed)).kind,
  "session-changed",
);
continuity = "offline-session";
pending = [
  {
    body: '<div id="ct"><div class="xld"><dl><dt><a href="home.php?mod=space&uid=502&do=blog&id=91">Example blog</a></dt><dd><span class="y">Friends only</span><a href="home.php?mod=space&uid=502">Fictional Cedar</a></dd><dd id="blog_article_91">A visible summary</dd></dl></div></div>',
  },
];
const nativeBlogs = await client.read(space("do=blog&view=me"));
expect(
  "native blog list preserves visible privacy",
  [
    nativeBlogs.kind,
    nativeBlogs.entries?.[0]?.privacy,
    nativeBlogs.entries?.[0]?.author?.name,
  ],
  ["page", "Friends only", "Fictional Cedar"],
);
const profile = await client.read(anchor("mod=space&uid=502"));
expect(
  "member-space handoff gives the native target and performs no read",
  [profile.kind, profile.destination],
  ["document-navigation", origin + anchor("mod=space&uid=502")],
);
pending = [
  {
    body: envelope("space_wall", 63, {
      cid: 0,
      comments: [
        {
          cid: 98,
          anonymous: 1,
          authorid: 503,
          author: "Anonymous",
          message: "Anonymous note",
        },
      ],
    }),
  },
];
const anonymous = await client.read(space("do=wall"));
expect(
  "anonymous wall entry does not expose a supplied author ID",
  [anonymous.kind, anonymous.entries?.[0]?.author],
  ["page", null],
);
if (process.argv[2] === "reads") console.log(JSON.stringify(results));

if (process.argv[2] !== "reads") {
  const ownWall = space("do=wall").replace("502", "501");
  const author = { uid: 503, username: "Fictional Ash" };
  const myWall = envelope("space_wall", 63, {
    owner: viewer,
    cid: 0,
    comments: [
      {
        cid: 94,
        authorid: 503,
        author: author.username,
        message: "Wall note",
        can_delete: 1,
        reply: { url: cp("comment"), fields: { id: "503", cid: "94" } },
      },
    ],
  });
  const wall = envelope("space_wall", 63, {
    cid: 0,
    comments: [],
    post: { url: cp("comment"), fields: { id: "502" } },
  });
  const statuses = envelope("space_doing", 57, {
    view: "all",
    doings: [{ ...viewer, doid: 71, message: "A status", can_delete: 1 }],
    post: { url: cp("doing") },
  });
  const statusReplies = {
    ...replies,
    page: 1,
    reply: { url: cp("doing&op=comment&doid=71&docid=0") },
    comments: [
      {
        ...replies.comments[0],
        can_delete: 1,
        reply: { url: cp("doing&op=comment&doid=71&docid=72") },
      },
    ],
  };
  const follows = envelope("space_follow", 60, {
    owner: viewer,
    list: "following",
    users: [
      {
        ...member,
        note: "Old name",
        unfollow_url: cp("follow&op=del&fuid=502"),
        note_url: cp("follow&op=bkname&fuid=502"),
      },
    ],
  });
  const relation = envelope("space_follow", 60, {
    list: "following",
    users: [],
  });
  const greetings = envelope("space_poke", 64, {
    owner: undefined,
    pokes: [
      {
        ...member,
        note: "Hello",
        ignore: { url: cp("poke&op=ignore&uid=502") },
      },
    ],
    ignore_all: { url: cp("poke&op=ignore") },
  });
  const ownFeed = feed("we", {
    owner: viewer,
    feeds: [
      {
        ...viewer,
        feedid: 81,
        note: "A relay",
        thread: { tid: 82, subject: "Fictional thread" },
        delete: { url: cp("follow&op=delete&feedid=81") },
      },
    ],
  });
  const nativeViewer = `<script>var STYLEID = '2', discuz_uid = '501', cookiepre = 'fixture_';</script>`;
  const form = (action, name, extra) =>
    nativeViewer +
    `<form method="post" action="${action.replaceAll("&", "&amp;")}"><input type="hidden" name="formhash" value="0123abcd"><input type="hidden" name="${name}" value="true">${extra}</form>`;
  const blogForm = form(
    cp("blog&blogid="),
    "blogsubmit",
    '<input name="subject"><textarea name="message"></textarea><select name="friend"><option value="0">Public</option><option value="4">Password</option></select><select name="classid"><option value="0">Default</option></select>',
  );
  const pokeInputs =
    '<input type="radio" name="iconid" value="3"><input name="note">';
  const cases = [
    [
      { action: "post-status", message: "New status" },
      anchor("mod=space&do=doing&view=all"),
      statuses,
      "doing",
      "do_success",
      { addsubmit: "true", message: "New status", handlekey: "doing" },
    ],
    [
      { action: "reply-status", statusId: "71", message: "New reply" },
      cp("doing&op=getcomment&doid=71"),
      statusReplies,
      "doing",
      "do_success",
      { commentsubmit: "true", message: "New reply", handlekey: "doing_71" },
      { doid: "71", docid: "0" },
    ],
    [
      {
        action: "reply-status",
        statusId: "71",
        replyId: "72",
        message: "Nested",
      },
      cp("doing&op=getcomment&doid=71"),
      statusReplies,
      "doing",
      "do_success",
      { commentsubmit: "true", message: "Nested" },
      { docid: "72" },
    ],
    [
      { action: "delete-status", statusId: "71" },
      anchor("mod=space&do=doing&view=all"),
      statuses,
      "doing",
      "do_success",
      { deletesubmit: "true" },
      { doid: "71" },
    ],
    [
      { action: "delete-status", statusId: "71", replyId: "72" },
      cp("doing&op=getcomment&doid=71"),
      statusReplies,
      "doing",
      "do_success",
      { deletesubmit: "true" },
      { docid: "72" },
    ],
    [
      {
        action: "publish-blog",
        subject: "A blog",
        message: "A <draft> & note",
        privacy: "4",
        password: "fictitious-passphrase",
      },
      null,
      blogForm,
      "blog",
      "do_success",
      {
        blogsubmit: "true",
        plaintext: "1",
        subject: "A blog",
        message: "A &lt;draft&gt; &amp; note",
        friend: "4",
        password: "fictitious-passphrase",
      },
    ],
    [
      { action: "post-wall", memberId: "502", message: "A wall note" },
      space("do=wall"),
      wall,
      "comment",
      "do_success",
      { id: "502", idtype: "uid", quickcomment: "true" },
    ],
    [
      { action: "reply-wall", commentId: "94", message: "A wall reply" },
      ownWall,
      myWall,
      "comment",
      "note_wall_reply_success",
      { id: "503", cid: "94", message: "A wall reply" },
    ],
    [
      { action: "delete-wall", commentId: "94" },
      ownWall,
      myWall,
      "comment",
      "do_success",
      { deletesubmit: "true" },
      { cid: "94" },
    ],
    [
      {
        action: "send-greeting",
        memberId: "502",
        iconId: "3",
        note: "Greetings",
      },
      null,
      form(cp("poke&op=send&uid=502"), "pokesubmit", pokeInputs),
      "poke",
      "poke_success",
      { pokesubmit: "true", iconid: "3", note: "Greetings" },
      { uid: "502", op: "send" },
    ],
    [
      {
        action: "reply-greeting",
        memberId: "502",
        iconId: "3",
        note: "Hello back",
      },
      null,
      form(cp("poke&op=reply&uid=502"), "pokesubmit", pokeInputs),
      "poke",
      "poke_success",
      { pokesubmit: "true", iconid: "3", note: "Hello back" },
      { uid: "502", op: "reply" },
    ],
    [
      { action: "ignore-greeting", memberId: "502" },
      cp("poke"),
      greetings,
      "poke",
      "has_been_hailed_overlooked",
      { ignoresubmit: "true", handlekey: "pokeignore" },
      { uid: "502" },
    ],
    [
      { action: "ignore-all-greetings" },
      cp("poke"),
      greetings,
      "poke",
      "has_been_hailed_overlooked",
      { ignoresubmit: "true", handlekey: "allignore" },
    ],
    [
      { action: "follow", memberId: "502" },
      follow("do=following&uid=502"),
      relation,
      "follow",
      "follow_add_succeed",
      { hash: "0123abcd", handlekey: "followmod" },
      { fuid: "502", op: "add" },
    ],
    [
      { action: "unfollow", memberId: "502" },
      follow("do=following&uid=501"),
      follows,
      "follow",
      "follow_cancel_succeed",
      { formhash: "0123abcd" },
      { fuid: "502", op: "del" },
    ],
    [
      { action: "rename-follow", memberId: "502", name: "New name" },
      follow("do=following&uid=501"),
      follows,
      "follow",
      "follow_remark_succeed",
      { editbkname: "true", bkname: "New name" },
      { fuid: "502", op: "bkname" },
    ],
    [
      { action: "relay", feedId: "81", note: "Interesting", reply: true },
      follow("view=other"),
      feed("other"),
      "follow",
      "relay_feed_success",
      { relaysubmit: "true", addnewreply: "1", tid: "82", note: "Interesting" },
      { tid: "82", op: "relay" },
    ],
    [
      { action: "delete-feed", feedId: "81" },
      follow("uid=501&do=view"),
      ownFeed,
      "follow",
      "do_success",
      { deletesubmit: "true" },
      { feedid: "81", op: "delete" },
    ],
  ];
  const acknowledgement = (key, fields = {}) => ({
    type: "result",
    schema: 13,
    uid: 501,
    ok: 1,
    kind: "message",
    message_key: key,
    ...fields,
  });
  for (const [
    command,
    source,
    body,
    ac,
    key,
    formFields,
    query = {},
  ] of cases) {
    pending = [{ body }];
    const opened = await client.prepare({ accountId: "501", source, command });
    assert.equal(opened.kind, "prepared", command.action);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].effect, false);
    const response = acknowledgement(
      key,
      command.action === "rename-follow"
        ? { values: { bkname: "Kept name" } }
        : command.action === "publish-blog"
          ? {
              kind: "redirect",
              url: space("do=blog&quickforward=1&id=110").replace("502", "501"),
            }
          : {},
    );
    pending = [{ body: response }];
    const result = await client.submit(opened, { deliberate: true });
    assert.equal(calls.length, 2, command.action);
    const [read, write] = calls;
    if (source)
      assert.equal(
        new URL(read.url).pathname +
          "?" +
          [...new URL(read.url).searchParams]
            .filter(
              ([key]) => !["tsdmv", "nodoc", "tsdmapp", "inajax"].includes(key),
            )
            .map(([key, value]) => `${key}=${value}`)
            .join("&"),
        source,
      );
    assert.equal(write.session, continuity);
    assert.equal(write.method, "POST");
    assert.equal(write.effect, true);
    assert.equal(write.fresh, true);
    const actualQuery = new URL(write.url).searchParams;
    assert.equal(actualQuery.get("ac"), ac);
    for (const [key, value] of Object.entries(query))
      assert.equal(actualQuery.get(key), value);
    for (const [key, value] of Object.entries(formFields))
      assert.equal(new URLSearchParams(write.body).get(key), value);
    expect(
      command.action,
      [
        result.kind,
        result.messageKey,
        result.savedName ?? null,
        result.destination ?? null,
      ],
      [
        "confirmed",
        key,
        command.action === "rename-follow" ? "Kept name" : null,
        command.action === "publish-blog"
          ? origin + response.url.replace("&quickforward=1", "")
          : null,
      ],
    );
    assert.equal(
      (await client.submit(opened, { deliberate: true })).kind,
      "stale",
    );
  }
  for (const [name, answer, expectedKind] of [
    ["lost effect response stays uncertain", { drop: true }, "uncertain"],
    [
      "foreign effect response stays uncertain",
      {
        url: "https://outside.example/",
        redirect: "followed",
        body: acknowledgement("do_success"),
      },
      "uncertain",
    ],
    [
      "generic ok cannot confirm a write",
      { body: acknowledgement("unrelated_key") },
      "uncertain",
    ],
    [
      "operation-specific refusal",
      {
        body: acknowledgement("operating_too_fast", { ok: 0, alert: "error" }),
      },
      "refused",
    ],
    [
      "another account cannot confirm a write",
      { body: acknowledgement("do_success", { uid: 999 }) },
      "uncertain",
    ],
    [
      "session switch during effect",
      { body: acknowledgement("do_success"), changeSession: true },
      "uncertain",
    ],
    [
      "native XML AJAX confirms matching wall handler",
      {
        body: "<root><![CDATA[<script>succeedhandle_qcwall_502('./', '操作成功', {});</script>]]></root>",
      },
      "confirmed",
    ],
    [
      "native AJAX handler from another operation is uncertain",
      {
        body: "<script>succeedhandle_qcwall_503('./', '操作成功', {});</script>",
      },
      "uncertain",
    ],
  ]) {
    continuity = "offline-session";
    pending = [{ body: wall }];
    const opened = await client.prepare({
      accountId: "501",
      source: space("do=wall"),
      command: { action: "post-wall", memberId: "502", message: "A note" },
    });
    pending = [answer];
    const result = await client.submit(opened, { deliberate: true });
    assert.equal(calls.length, 2);
    expect(name, result.kind, expectedKind);
  }
  pending = [{ body: wall }];
  const prepared = await client.prepare({
    accountId: "501",
    source: space("do=wall"),
    command: { action: "post-wall", memberId: "502", message: "A note" },
  });
  expect(
    "effect requires explicit deliberate intent",
    (await client.submit(prepared, { deliberate: false })).kind,
    "invalid",
  );
  continuity = "switched-before-send";
  expect(
    "session change before dispatch sends nothing",
    (await client.submit(prepared, { deliberate: true })).kind,
    "stale",
  );
  pending = [{ body: wall }];
  expect(
    "wrong account cannot prepare an effect",
    (
      await client.prepare({
        accountId: "999",
        source: space("do=wall"),
        command: { action: "post-wall", memberId: "502", message: "A note" },
      })
    ).kind,
    "stale",
  );
  expect(
    "a different wall cannot supply the post target",
    (
      await client.prepare({
        accountId: "501",
        source: space("do=wall"),
        command: { action: "post-wall", memberId: "503", message: "A note" },
      })
    ).kind,
    "invalid",
  );
  pending = [
    { body: { ...wall, post: { url: cp("comment"), fields: { id: "503" } } } },
  ];
  const wrongForm = await client.prepare({
    accountId: "501",
    source: space("do=wall"),
    command: { action: "post-wall", memberId: "502", message: "A note" },
  });
  expect(
    "wall form with a conflicting target is refused before dispatch",
    wrongForm.kind,
    "incomplete",
  );
  pending = [
    {
      body: '<root><![CDATA[<div class="doing_empty">No replies</div>]]></root>',
    },
  ];
  const legacyReply = await client.prepare({
    accountId: "501",
    source: cp("doing&op=getcomment&doid=71"),
    command: {
      action: "reply-status",
      statusId: "71",
      message: "Reply on the web",
    },
  });
  expect(
    "legacy reply without viewer evidence hands off the full status",
    [legacyReply.kind, legacyReply.destination],
    ["document-navigation", origin + anchor("mod=space&do=doing&doid=71")],
  );
  pending = [{ body: statuses }];
  const statusDelete = await client.prepare({
    accountId: "501",
    source: anchor("mod=space&do=doing&view=all"),
    command: { action: "delete-status", statusId: "71" },
  });
  pending = [{ body: acknowledgement("", { kind: "redirect", url: "./" }) }];
  const ambiguousDelete = await client.submit(statusDelete, {
    deliberate: true,
  });
  assert.equal(calls.filter((request) => request.effect).length, 1);
  expect(
    "unlabelled status redirect leaves deletion uncertain",
    ambiguousDelete.kind,
    "uncertain",
  );
  const readbacks = [
    [
      "follow independent membership read",
      follow("do=following&uid=501"),
      follows,
      ["502", "Old name"],
    ],
    [
      "unfollow independent terminal list",
      follow("do=following&uid=501"),
      { ...follows, pages: 1, users: [] },
      [null, null],
    ],
    [
      "rename independent stored name",
      follow("do=following&uid=501"),
      { ...follows, users: [{ ...follows.users[0], note: "Kept name" }] },
      ["502", "Kept name"],
    ],
    [
      "relay independent member timeline",
      follow("uid=501&do=view"),
      ownFeed,
      ["81", "A relay"],
    ],
    [
      "delete independent terminal timeline",
      follow("uid=501&do=view"),
      { ...ownFeed, feeds: [] },
      [null, null],
    ],
  ];
  for (const [name, route, body, expected] of readbacks) {
    pending = [{ body }];
    const result = await client.read(route);
    assert.equal(result.kind, "page");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].effect, false);
    if (!expected[0]) assert.equal(result.next, null);
    expect(
      name,
      [result.entries[0]?.id ?? null, result.entries[0]?.text ?? null],
      expected,
    );
  }
  pending = [{ body: '<form id="challenge-form"></form>' }];
  const handoff = await client.prepare({
    accountId: "501",
    source: null,
    command: {
      action: "publish-blog",
      subject: "Title",
      message: "Draft",
      privacy: "0",
    },
  });
  expect(
    "challenge hands the original form to the host",
    [handoff.kind, handoff.destination, calls[0].effect],
    ["document-navigation", origin + cp("blog"), false],
  );
  const { browseWall, postWall } = await import("./spaces-guide.js");
  const guideHost = {
    origin,
    session: () => continuity,
    transport: {
      request: async (url, request) => {
        calls.push({ url, ...request });
        const next = pending.shift();
        assert.ok(next);
        return {
          url,
          status: 200,
          redirect: "none",
          contentType: "application/json",
          body: JSON.stringify(next.body),
        };
      },
    },
  };
  pending = [{ body: wall }, { body: { ...wall, page: 2 } }];
  const guideRead = await browseWall(guideHost, "502");
  assert.ok(calls.every((request) => request.effect === false));
  expect(
    "packaged TypeScript read opens two pages",
    [
      guideRead.page.owner.id,
      new URL(guideRead.next.url).searchParams.get("page"),
    ],
    ["502", "2"],
  );
  pending = [{ body: wall }, { body: acknowledgement("do_success") }];
  const guideWrite = await postWall(
    guideHost,
    "501",
    "502",
    "Fixture guide note",
    true,
  );
  expect(
    "packaged TypeScript example submits one deliberate fixture effect",
    [guideWrite.kind, calls.filter((request) => request.effect).length],
    ["confirmed", 1],
  );
  console.log(JSON.stringify(results));
}
