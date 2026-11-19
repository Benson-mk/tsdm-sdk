import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createReplyClient } from "tsdm-sdk";

const origin = "https://forum.invalid";
const page = `${origin}/forum.php?mod=post&action=reply&fid=2&tid=90`;
const exact = `${origin}/forum.php?mod=redirect&goto=findpost&ptid=90&pid=303`;
const message = "An ordinary [b]fixture[/b] reply.";
const supplied =
  "forum.php?mod=post&action=reply&fid=2&tid=90&extra=forum-value&replysubmit=yes";
const trace = [];
let memberId = "31",
  continuity = "alice-1",
  receive;
const client = createReplyClient({
  origin,
  session: () => ({ memberId, continuity }),
  transport: {
    async request(url, request) {
      assert.equal(new URL(url).origin, origin);
      assert.equal(request.fresh, true);
      assert.deepEqual(request.session, { memberId, continuity });
      trace.push({ url, request });
      return receive(url, request);
    },
  },
});
const json = (url, value) => ({
  url,
  status: 200,
  redirect: "none",
  contentType: "application/json",
  body: JSON.stringify(value),
});
const option = (name, checked = 0) => ({
  name,
  type: "checkbox",
  value: "1",
  checked,
  disabled: 0,
  label: name,
});
const form = () => ({
  ok: 1,
  type: "post",
  schema: 16,
  uid: 31,
  action: "reply",
  fid: 2,
  tid: 90,
  pid: 0,
  thread: { tid: 90, special: 0 },
  submit: {
    method: "POST",
    url: supplied,
    fields: {
      formhash: "fixture1",
      posttime: "1700000000",
      wysiwyg: "1",
      noticeauthor: "",
      noticetrimstr: "",
      noticeauthormsg: "",
      replysubmit: "true",
      save: "",
    },
  },
  subject: { shown: 1, value: "" },
  message: { value: "", json: 0 },
  options: [option("usesig", 1), option("bbcodeoff")],
  seccheck: null,
  unsupported: [],
  hook_fields: [],
});
const acknowledgement = () => ({
  type: "result",
  schema: 13,
  uid: 31,
  ok: 1,
  kind: "handle",
  message_key: "post_reply_succeed",
  message: "Reply posted",
  login: 0,
  url: "forum.php?mod=viewthread&tid=90&pid=303&page=6#pid303",
  values: { fid: "2", tid: "90", pid: "303" },
});
async function prepare(destination = page, data = form()) {
  receive = (url, request) => {
    assert.equal(request.method, "GET");
    assert.equal(new URL(url).searchParams.get("tsdmapp"), "json");
    return json(url, data);
  };
  return client.prepareReply(destination);
}
const results = [];
const plain = await prepare();
assert.equal(plain.kind, "prepared");
receive = (url, request) => {
  assert.equal(request.method, "POST");
  assert.equal(url, `${origin}/${supplied}&inajax=1&tsdmapp=json`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    ...form().submit.fields,
    subject: "",
    message,
    usesig: "1",
  });
  return json(url, acknowledgement());
};
const sent = await client.publishReply(plain.form, { message });
assert.equal(sent.kind, "published");
assert.equal(sent.postURL, exact);
assert.equal(
  trace.filter(({ request }) => request.method === "POST").length,
  1,
);
results.push({
  expected: "published with exact PID 303 and one POST",
  observed: sent.kind,
  postURL: sent.postURL,
});
const quotedPage = `${page}&reppost=302`;
const quote = "[quote]A previous post[/quote]";
const quotedForm = () => {
  const data = form();
  Object.assign(data.submit.fields, {
    reppid: "302",
    reppost: "302",
    noticeauthor: "fixture-token",
    noticeauthormsg: "A previous post",
    noticetrimstr: quote,
  });
  return data;
};
for (const [expected, change] of [
  ["published", { kind: "redirect", values: {} }],
  [
    "moderation",
    {
      message_key: "post_reply_mod_succeed",
      url: "forum.php?mod=viewthread&tid=90",
      values: { reply_mod: "1" },
    },
  ],
  ["refused", { ok: 0, message_key: "post_flood_ctrl", url: "", values: {} }],
  [
    "redisplayed",
    {
      kind: "page",
      message_key: "",
      document: "<form id=postform></form>",
      url: "",
    },
  ],
]) {
  const prepared = await prepare(quotedPage, quotedForm());
  assert.equal(prepared.kind, "prepared");
  assert.equal(prepared.form.quote, quote);
  receive = (url, request) => {
    assert.equal(request.method, "POST");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
      ...quotedForm().submit.fields,
      subject: "Fixture subject",
      message,
      bbcodeoff: "1",
    });
    return json(url, { ...acknowledgement(), ...change });
  };
  const publication = await client.publishReply(prepared.form, {
    message,
    subject: "Fixture subject",
    options: { usesig: false, bbcodeoff: true },
  });
  assert.equal(publication.kind, expected);
  if (expected === "published") assert.equal(publication.postURL, exact);
  const blocked = await client.publishReply(prepared.form, { message });
  assert.equal(blocked.kind, "unavailable");
  results.push({
    expected: `${expected} for quote with forum fields and single-use form`,
    observed: publication.kind,
    reuse: blocked.kind,
  });
}
const challengedForm = form();
challengedForm.seccheck = {
  seccode: 1,
  secqaa: 1,
  seccode_hash: "cFixture",
  secqaa_hash: "qFixture",
  modid: "forum::post",
};
const challenged = await prepare(page, challengedForm);
assert.equal(challenged.kind, "prepared");
assert.deepEqual(challenged.form.verification, ["image", "question"]);
const absent = await client.publishReply(challenged.form, { message });
assert.equal(absent.kind, "verification-required");
const imageDestination = `${origin}/misc.php?mod=seccode&action=image&idhash=cFixture&update=opaque`;
receive = (url, request) => {
  assert.equal(request.method, "GET");
  assert.equal(request.referer, page);
  const query = new URL(url).searchParams;
  const image = query.get("mod") === "seccode";
  assert.equal(query.get("idhash"), image ? "cFixture" : "qFixture");
  assert.equal(
    query.get("action"),
    query.has("secverify") ? "check" : "update",
  );
  if (image) assert.equal(query.get("modid"), "forum::post");
  const body = query.has("secverify")
    ? `<root><![CDATA[${query.get("secverify") === "human text" ? "succeed" : "invalid"}]]></root>`
    : image
      ? `fixture setter: <img src="${imageDestination.replace(origin + "/", "").replaceAll("&", "&amp;")}">`
      : "<root><![CDATA[<b>Fixture question?</b>]]></root>";
  return {
    url,
    status: 200,
    redirect: "none",
    contentType: "text/plain",
    body,
  };
};
const image = await client.refreshReplyVerification(challenged.form, "image");
assert.deepEqual(image, {
  kind: "image",
  destination: imageDestination,
  referer: page,
  session: { memberId, continuity },
});
assert.deepEqual(
  await client.refreshReplyVerification(challenged.form, "question"),
  { kind: "question", text: "Fixture question?" },
);
assert.equal(
  (await client.checkReplyVerification(challenged.form, "image", "human text"))
    .kind,
  "accepted",
);
assert.equal(
  (
    await client.checkReplyVerification(
      challenged.form,
      "question",
      "human text",
    )
  ).kind,
  "accepted",
);
assert.equal(
  (
    await client.checkReplyVerification(
      challenged.form,
      "question",
      "rejected human text",
    )
  ).kind,
  "rejected",
);
receive = (url, request) => {
  assert.equal(request.method, "POST");
  const body = new URLSearchParams(request.body);
  assert.equal(body.get("seccodehash"), "cFixture");
  assert.equal(body.get("secqaahash"), "qFixture");
  assert.equal(body.get("seccodemodid"), "forum::post");
  assert.equal(body.get("seccodeverify"), "human text");
  assert.equal(body.get("secanswer"), "human text");
  return json(url, acknowledgement());
};
assert.equal(
  (
    await client.publishReply(challenged.form, {
      message,
      answers: { image: "human text", question: "human text" },
    })
  ).kind,
  "published",
);
const unnamed = await prepare(page, {
  ...challengedForm,
  seccheck: { seccode: 1 },
});
assert.equal(unnamed.kind, "browser-handoff");
assert.equal(unnamed.destination, page);
results.push({
  expected:
    "human image and question refresh/check with no auto-submit, unnamed verification to browser",
  observed: [
    image.kind,
    "question",
    "accepted",
    "rejected",
    "published",
    unnamed.kind,
  ],
});
const nativeStart = trace.length;
receive = (url, request) => {
  assert.equal(request.method, "GET");
  if (new URL(url).searchParams.has("tsdmapp"))
    return json(url, { ok: 1, uid: 31 });
  assert.equal(url, page);
  return {
    url,
    status: 200,
    redirect: "none",
    contentType: "text/html",
    body: `
    <div id="um"><strong><a href="home.php?mod=space&amp;uid=31">Alice</a></strong></div>
    <form id="postform" method="post" action="${supplied.replaceAll("&", "&amp;")}">
      <input type="hidden" name="formhash" value="native-token">
      <input type="hidden" name="handlekey" value="reply">
      <input name="subject"><textarea name="message"></textarea>
      <input type="checkbox" name="usesig" value="1" checked>
      <button type="submit" name="replysubmit" value="true">Reply</button>
    </form>`,
  };
};
const native = await client.prepareReply(page);
assert.equal(native.kind, "prepared");
receive = (url, request) => {
  assert.equal(request.method, "POST");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    formhash: "native-token",
    handlekey: "reply",
    replysubmit: "true",
    subject: "",
    message,
    usesig: "1",
  });
  return {
    url,
    status: 200,
    redirect: "none",
    contentType: "text/xml",
    body: `<root><![CDATA[<script type="text/javascript">if(typeof succeedhandle_reply=='function'){succeedhandle_reply('forum.php?mod=viewthread&tid=90&pid=303#pid303','Reply posted',{'tid':'90','pid':'303'});}</script>]]></root>`,
  };
};
const nativeSent = await client.publishReply(native.form, { message });
assert.deepEqual(nativeSent, { kind: "published", postURL: exact });
assert.deepEqual(
  trace.slice(nativeStart).map(({ request }) => request.method),
  ["GET", "GET", "POST"],
);
results.push({
  expected: "native form fallback and literal AJAX acknowledgement",
  observed: nativeSent.kind,
  postURL: nativeSent.postURL,
});
const recoveryStart = trace.length;
const threadPage = `${origin}/forum.php?mod=viewthread&tid=90`;
const publications = [];
for (let i = 0; i < 2; i++) {
  const prepared = await prepare();
  receive = (_url, request) => {
    assert.equal(request.method, "POST");
    if (i === 0) {
      memberId = "44";
      continuity = "bob-1";
    }
    throw new Error("fixture lost the response after storing the reply");
  };
  const publication = await client.publishReply(prepared.form, { message });
  assert.equal(publication.kind, "uncertain");
  assert.equal(
    (await client.publishReply(prepared.form, { message })).kind,
    "unavailable",
  );
  publications.push(JSON.parse(JSON.stringify(publication.attempt)));
  if (i === 0) {
    assert.deepEqual(await client.checkUncertainReply(publications[0], exact), {
      kind: "inconclusive",
      reason: "account",
    });
    memberId = "31";
    continuity = "alice-2";
    assert.deepEqual(
      await client.checkUncertainReply(publications[0], threadPage),
      { kind: "inconclusive", reason: "exact-post" },
    );
  }
}
function readback({
  authorid = 31,
  pid = 303,
  editUid = 31,
  stored = message,
  usesig = 1,
  renderedOnly = false,
  switchOnEdit = false,
} = {}) {
  receive = (url, request) => {
    assert.equal(request.method, "GET");
    const { searchParams: query } = new URL(url);
    if (query.get("mod") === "redirect") {
      assert.equal(query.get("pid"), "303");
      assert.equal(query.get("ptid"), "90");
      assert.equal(query.get("nodoc"), "1");
      assert.equal(query.get("tsdmapp"), "json");
      return {
        ...json(url, {
          ok: 1,
          type: "thread",
          schema: 15,
          uid: 31,
          thread: { tid: 90, subject: "A thread" },
          forum: { fid: 2 },
          posts: [
            {
              pid,
              authorid,
              author: "Fixture member",
              body_html: "<b>Rendered reply</b>",
            },
          ],
        }),
        url: `${threadPage}&page=6&tsdmapp=json&nodoc=1`,
        redirect: "followed",
      };
    }
    assert.equal(query.get("action"), "edit");
    assert.equal(query.get("pid"), "303");
    assert.equal(query.get("tid"), "90");
    assert.equal(query.get("fid"), "2");
    assert.equal(query.has("editsubmit"), false);
    if (switchOnEdit) continuity = "alice-3";
    return json(
      url,
      renderedOnly
        ? { uid: 31, document: "<b>Rendered reply</b>" }
        : {
            ok: 1,
            type: "post",
            schema: 16,
            uid: editUid,
            action: "edit",
            fid: 2,
            tid: 90,
            pid: 303,
            first: 0,
            subject: { shown: 1, value: "" },
            message: { json: 0, value: stored },
            options: [option("usesig", usesig), option("bbcodeoff")],
          },
    );
  };
}
for (const [fixture, reason] of [
  [{ authorid: 44 }, "author"],
  [{ pid: 304 }, "exact-post"],
  [{ editUid: 44 }, "account"],
  [{ renderedOnly: true }, "stored-evidence"],
  [{ stored: "A different source" }, "content"],
  [{ usesig: 0 }, "options"],
  [{ switchOnEdit: true }, "account"],
]) {
  readback(fixture);
  assert.deepEqual(await client.checkUncertainReply(publications[0], exact), {
    kind: "inconclusive",
    reason,
  });
  results.push({
    expected: `inconclusive (${reason})`,
    observed: "inconclusive",
    fixture,
  });
}
readback();
for (const publication of publications) {
  assert.deepEqual(await client.checkUncertainReply(publication, exact), {
    kind: "confirmed",
    postURL: exact,
    attribution: "unresolved",
  });
}
assert.equal(
  trace.slice(recoveryStart).filter(({ request }) => request.method === "POST")
    .length,
  2,
);
results.push({
  expected:
    "two separate lost sends, independent matches, attribution unresolved and only two POSTs",
  observed: "confirmed",
  attribution: "unresolved",
  writes: 2,
  postURL: exact,
});
const guardStart = trace.length;
const foreign = form();
foreign.submit.url = "https://elsewhere.invalid/submit";
assert.equal((await prepare(page, foreign)).kind, "browser-handoff");
const wrongQuote = quotedForm();
wrongQuote.submit.fields.reppost = "990";
assert.equal((await prepare(quotedPage, wrongQuote)).kind, "browser-handoff");
const oldForm = await prepare();
continuity = "alice-4";
assert.equal(
  (await client.publishReply(oldForm.form, { message })).kind,
  "unavailable",
);
const ambiguous = await prepare();
receive = (url, request) => {
  assert.equal(request.method, "POST");
  return json(url, { ...acknowledgement(), message_key: "", kind: "redirect" });
};
const redirected = await client.publishReply(ambiguous.form, { message });
assert.equal(redirected.kind, "uncertain");
assert.equal(redirected.postURL, exact);
const beforeInvalidCheck = trace.length;
assert.deepEqual(await client.checkUncertainReply(redirected.attempt), {
  kind: "inconclusive",
  reason: "exact-post",
});
assert.deepEqual(
  await client.checkUncertainReply(redirected.attempt, exact + "#pid433"),
  { kind: "inconclusive", reason: "exact-post" },
);
assert.equal(trace.length, beforeInvalidCheck);
assert.equal(
  trace.slice(guardStart).filter(({ request }) => request.method === "POST")
    .length,
  1,
);
results.push({
  expected:
    "no write for foreign action, wrong quote or replaced session; generic redirect is only a candidate",
  observed: redirected.kind,
  candidate: redirected.postURL,
});
const lostQuote = await prepare(quotedPage, quotedForm());
receive = () => {
  throw new Error("lost quote fixture");
};
const unsureQuote = await client.publishReply(lostQuote.form, { message });
assert.equal(unsureQuote.kind, "uncertain");
readback({ stored: message });
assert.deepEqual(await client.checkUncertainReply(unsureQuote.attempt, exact), {
  kind: "inconclusive",
  reason: "content",
});
readback({
  stored: "[quote]A previous post[/quote]\nAn ordinary [b]fixture[/b] reply.",
});
const quoteCheck = await client.checkUncertainReply(unsureQuote.attempt, exact);
assert.deepEqual(quoteCheck, {
  kind: "confirmed",
  postURL: exact,
  attribution: "unresolved",
});
results.push({
  expected:
    "quoted stored source includes the forum quote, loss still one dispatch",
  observed: quoteCheck.kind,
});
const upstream = process.env.TSDM_REPLIES_UPSTREAM;
if (upstream) {
  const fixture = (name) =>
    JSON.parse(readFileSync(join(upstream, "test/data/tsdmapp", name), "utf8"));
  for (const [name, suffix, expectedQuote] of [
    ["reply", "", false],
    ["reply_quote", "&reppost=9700002", true],
    ["reply_float", "&reppost=9700002", true],
  ]) {
    const pinnedForm = fixture(`post_v16_${name}.json`);
    memberId = String(pinnedForm.uid);
    const start = trace.length;
    const prepared = await prepare(
      `${origin}/forum.php?mod=post&action=reply&fid=2&tid=9600001${suffix}`,
      pinnedForm,
    );
    assert.equal(prepared.kind, "prepared", name);
    assert.equal(Boolean(prepared.form.quote), expectedQuote);
    receive = (url, request) => {
      assert.equal(request.method, "POST");
      assert.equal(
        url,
        `${origin}/${pinnedForm.submit.url}&inajax=1&tsdmapp=json`,
      );
      assert.equal(new URLSearchParams(request.body).get("message"), message);
      assert.equal(
        new URLSearchParams(request.body).get("noticetrimstr"),
        pinnedForm.submit.fields.noticetrimstr,
      );
      return json(url, {
        ...fixture("write_by_key/reply_flood.json"),
        uid: pinnedForm.uid,
      });
    };
    const publication = await client.publishReply(prepared.form, { message });
    assert.equal(publication.kind, "refused");
    assert.deepEqual(
      trace.slice(start).map(({ request }) => request.method),
      ["GET", "POST"],
    );
    results.push({
      expected: "pinned schema 16 form, supplied destination and flood refusal",
      observed: publication.kind,
      fixture: name,
    });
  }
}
console.log(
  JSON.stringify({
    results,
    requests: trace.map(({ url, request }) => {
      const target = new URL(url);
      for (const key of target.searchParams.keys()) {
        if (/^\d+$/.test(key)) {
          target.searchParams.delete(key);
          target.searchParams.set("fixture-clock", "");
          break;
        }
      }
      target.searchParams.delete("secverify");
      return {
        method: request.method,
        url: target.href,
        member: request.session.memberId,
        fresh: request.fresh,
      };
    }),
  }),
);
