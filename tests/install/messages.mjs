import assert from "node:assert/strict";
import { createMessageClient } from "tsdm-sdk";

const origin = "https://forum.example.test";
const account = { memberId: "701", continuity: "session-a" };
const identity = { ok: 1, uid: 701, timeoffset: 8, formhash: "fakehash" };
const once = { confirm: true };
const responses = [];
const traces = [];
const results = {};
let session = account;
const sdk = createMessageClient({
  origin,
  session: () => session,
  transport: {
    async request(url, request) {
      assert.equal(new URL(url).origin, origin);
      assert.equal(request.fresh, true);
      assert.deepEqual(request.session, account);
      traces.push({ url, method: request.method, body: request.body });
      const next = responses.shift();
      assert.ok(next, `Unexpected dispatch ${url}`);
      if (next.drop) throw new Error("Controlled response loss after dispatch");
      if (next.switch) session = { ...account, continuity: "session-b" };
      return {
        url,
        status: next.status ?? 200,
        redirect: "none",
        contentType: next.contentType ?? "application/json",
        body:
          typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      };
    },
  },
});
const json = (body) => responses.push({ body });
const html = (body) => responses.push({ body, contentType: "text/html" });
const xml = (markup) =>
  responses.push({
    body: `<?xml version="1.0"?><root><![CDATA[${markup}]]></root>`,
    contentType: "text/xml",
  });
function expectRequest(path, query, fields) {
  const req = traces.at(-1);
  const u = new URL(req.url);
  assert.equal(u.pathname, path);
  assert.deepEqual(Object.fromEntries(u.searchParams), query);
  assert.equal(req.method, fields ? "POST" : "GET");
  if (fields)
    assert.deepEqual(Object.fromEntries(new URLSearchParams(req.body)), fields);
}

json({
  ...identity,
  closed: 0,
  pms: [
    {
      type: 1,
      plid: 812,
      touid: 702,
      tousername: "Fake Peer",
      lastauthorid: 702,
      lastdateline: 1700000001,
      new: 1,
      lastsummary_html: "Fake &amp; <b>private</b>",
    },
    { type: 2, plid: 813 },
  ],
});
const privateList = await sdk.listPrivateMessages();
expectRequest("/plugin.php", { id: "tsdmapp:api", action: "pmlist" });
assert.equal(privateList.kind, "private-list");
assert.deepEqual(
  privateList.rows.map(({ peerId, preview, unread }) => [
    peerId,
    preview,
    unread,
  ]),
  [["702", "Fake & private", true]],
);
assert.equal(privateList.omittedGroups, 1);
json({
  ...identity,
  filter: "announce",
  closed: 0,
  page: 1,
  count: 1,
  unread: 1,
  announces: [
    { id: 911, new: 1, dateline: 1700000002, text: "Fake broadcast" },
  ],
});
const broadcasts = await sdk.listBroadcastMessages();
expectRequest("/plugin.php", {
  id: "tsdmapp:api",
  action: "pmlist",
  filter: "announce",
});
assert.equal(broadcasts.kind, "broadcast-list");
assert.deepEqual(
  broadcasts.rows.map(({ id, preview, unread }) => [id, preview, unread]),
  [["911", "Fake broadcast", true]],
);
json({
  ...identity,
  filter: "announce",
  closed: 1,
  page: 1,
  count: 0,
  unread: 0,
  announces: [],
});
assert.equal((await sdk.listBroadcastMessages()).closed, true);
json({ ...identity, pms: [] });
const fallback = await sdk.listBroadcastMessages();
assert.equal(fallback.kind, "native-page");
assert.equal(new URL(fallback.url).searchParams.get("filter"), "announcepm");
assert.equal(traces.length, 4);
json({ ...identity, uid: 799, pms: [] });
assert.equal((await sdk.listPrivateMessages()).kind, "session-changed");
responses.push({ status: 429, body: "" });
assert.equal((await sdk.listPrivateMessages()).kind, "rate-limited");
results.lists = {
  expected:
    "private peers, distinct broadcasts, closed, no implicit native read, wrong UID and limit rejected",
  observed: [privateList, broadcasts, fallback],
  requests: traces.slice(),
};

const historyQuery = {
  mod: "space",
  do: "pm",
  subop: "view",
  touid: "702",
  page: "2",
  tsdmapp: "json",
  nodoc: "1",
};
const replyPath =
  "home.php?mod=spacecp&ac=pm&op=send&pmid=901&daterange=0&handlekey=pmsend&pmsubmit=yes";
const history = {
  ...identity,
  type: "pm",
  schema: 11,
  pmtype: 1,
  touid: 702,
  tousername: "Fake Peer",
  count: 12,
  page: 3,
  pages: 4,
  has_next: 1,
  messages: [
    {
      pmid: 901,
      fromuid: 702,
      from: "Fake Peer",
      dateline: 1700000000,
      message_html: "<b>Fake</b>",
    },
  ],
  reply: { action: replyPath, pmid: 901, topmuid: 702 },
};
const broadcastQuery = {
  mod: "space",
  do: "pm",
  subop: "viewg",
  pmid: "911",
  tsdmapp: "json",
  nodoc: "1",
  tsdmv: "4",
};
const broadcast = {
  ...identity,
  type: "announcepm",
  schema: 40,
  pmid: 911,
  announce: {
    id: 911,
    dateline: 1700000002,
    text: "Fake notice",
    message_html: "<b>Fake notice</b><script>ignore()</script>",
  },
};
const detailsAt = traces.length;
assert.equal(
  (await sdk.openBroadcastMessage("911", { confirm: false })).kind,
  "not-dispatched",
);
assert.equal(
  (await sdk.openPrivateConversation("702", { confirm: false })).kind,
  "not-dispatched",
);
assert.equal(traces.length, detailsAt);
json(history);
const conversation = await sdk.openPrivateConversation("702", {
  ...once,
  page: 2,
});
expectRequest("/home.php", historyQuery);
assert.equal(conversation.kind, "conversation");
assert.deepEqual(
  [
    conversation.peerId,
    conversation.page,
    conversation.pages,
    conversation.hasNext,
    conversation.messages[0].id,
  ],
  ["702", 3, 4, true, "901"],
);
json({
  ...history,
  count: 0,
  page: 1,
  pages: 1,
  has_next: 0,
  messages: [],
  reply: null,
});
assert.deepEqual((await sdk.openPrivateConversation("702", once)).messages, []);
json({ ...history, pmtype: 2, touid: 0 });
assert.equal(
  (await sdk.openPrivateConversation("702", once)).kind,
  "effect-unknown",
);
json(broadcast);
const opened = await sdk.openBroadcastMessage("911", once);
expectRequest("/home.php", broadcastQuery);
assert.equal(opened.kind, "broadcast");
assert.equal(opened.id, "911");
assert.doesNotMatch(JSON.stringify(opened.body), /ignore\(\)/);
json({ ok: 0, uid: 701, error: "message", message_key: "pm_status_off" });
assert.equal((await sdk.openBroadcastMessage("911", once)).kind, "refused");
json({ ...broadcast, announce: null });
assert.equal((await sdk.openBroadcastMessage("911", once)).kind, "refused");
responses.push({ drop: true });
assert.equal(
  (await sdk.openBroadcastMessage("911", once)).kind,
  "effect-unknown",
);
const nativeAccount =
  '<div id="um"><strong class="vwmy"><a href="home.php?mod=space&amp;uid=701">Fake Sender</a></strong></div>';
html(
  `${nativeAccount}<div id="pm_ul"><dl><dd class="ptm"><span class="xg1"><span title="2026-01-01 10:00">today</span></span><p class="pm_smry">Fake native broadcast</p></dd></dl></div>`,
);
assert.equal((await sdk.openBroadcastMessage("911", once)).kind, "broadcast");
results.details = {
  expected:
    "deliberate detail reads, returned page, empty history, refusal and lost response without fallback dispatch",
  observed: [conversation, opened],
  requests: traces.slice(detailsAt),
};
const dialogQuery = {
  mod: "spacecp",
  ac: "pm",
  op: "showmsg",
  handlekey: "showmsg_702",
  touid: "702",
  pmid: "0",
  daterange: "2",
  infloat: "yes",
  inajax: "1",
  ajaxtarget: "fwin_content_showMsgBox",
};
const recentQuery = {
  mod: "spacecp",
  ac: "pm",
  op: "showmsg",
  msgonly: "1",
  touid: "702",
  pmid: "0",
  inajax: "1",
  daterange: "2",
};
const recentMarkup =
  '<li><h4>2026-01-01</h4></li><li class="pmm"><div class="pmt">Fake Peer: </div><div class="pmd">Fake recent</div></li>';
const dialogMarkup = `<ul id="msglist">${recentMarkup}</ul><div class="pmfm"><form id="pmform_702" method="post" action="home.php?mod=spacecp&amp;ac=pm&amp;op=send&amp;touid=702">
<input type="hidden" name="pmsubmit" value="true"><input type="hidden" name="touid" value="702">
<input type="hidden" name="formhash" value="fakehash"><input type="hidden" name="handlekey" value="showmsg_702">
<textarea name="message"></textarea><input type="hidden" name="messageappend" value=""><button type="submit">Send</button></form></div>`;
const chatAt = traces.length;
assert.equal(
  (await sdk.openChatDialog("702", { confirm: false })).kind,
  "not-dispatched",
);
xml(dialogMarkup);
const dialog = await sdk.openChatDialog("702", once);
expectRequest("/home.php", dialogQuery);
assert.equal(dialog.kind, "chat-dialog");
assert.equal(dialog.send.peerId, "702");
assert.equal(dialog.messages[0].date, "2026-01-01");
xml(recentMarkup);
const recent = await sdk.openRecentMessages("702", once);
expectRequest("/home.php", recentQuery);
assert.deepEqual(recent.messages, dialog.messages);
assert.equal(recent.send, undefined);
xml(
  dialogMarkup.replace('name="touid" value="702"', 'name="touid" value="799"'),
);
assert.equal((await sdk.openChatDialog("702", once)).kind, "effect-unknown");
results.chat = {
  expected:
    "dialog with send form, recent XML without form, wrong recipient rejected",
  observed: [dialog, recent],
  requests: traces.slice(chatAt),
};

const sendsAt = traces.length;
assert.equal(
  (await sdk.sendPrivateMessage(dialog.send, "Hello", { confirm: false })).kind,
  "not-dispatched",
);
assert.equal(
  (await sdk.sendPrivateMessage({ ...dialog.send }, "Hello", once)).kind,
  "not-dispatched",
);
assert.equal(traces.length, sendsAt);
xml(
  `<script>if (typeof succeedhandle_showmsg_702 == 'function') {succeedhandle_showmsg_702('', 'OK', {'pmid':'902'});}</script>`,
);
const sent = await sdk.sendPrivateMessage(dialog.send, "Hello & + ✓", once);
expectRequest(
  "/home.php",
  { mod: "spacecp", ac: "pm", op: "send", touid: "702", inajax: "1" },
  {
    pmsubmit: "true",
    touid: "702",
    formhash: "fakehash",
    handlekey: "showmsg_702",
    messageappend: "",
    message: "Hello & + ✓",
  },
);
assert.deepEqual(sent, { kind: "accepted", messageId: "902" });
assert.equal(
  (await sdk.sendPrivateMessage(dialog.send, "Hello", once)).kind,
  "not-dispatched",
);
json(history);
const reply = (await sdk.openPrivateConversation("702", once)).send;
assert.equal(reply.peerId, "702");
json({
  ...identity,
  type: "result",
  schema: 13,
  kind: "handle",
  handlekey: "pmsend",
  message_key: "do_success",
  values: { pmid: "903" },
});
const replied = await sdk.sendPrivateMessage(reply, "Fake reply", once);
expectRequest(
  "/home.php",
  {
    mod: "spacecp",
    ac: "pm",
    op: "send",
    pmid: "901",
    daterange: "0",
    handlekey: "pmsend",
    pmsubmit: "yes",
    topmuid: "702",
  },
  { formhash: "fakehash", message: "Fake reply" },
);
assert.deepEqual(replied, { kind: "accepted", messageId: "903" });
xml(dialogMarkup);
const flooded = (await sdk.openChatDialog("702", once)).send;
json({
  ...identity,
  ok: 0,
  type: "result",
  schema: 13,
  kind: "handle",
  handlekey: "showmsg_702",
  message_key: "message_can_not_send_2",
});
assert.deepEqual(await sdk.sendPrivateMessage(flooded, "Fake message", once), {
  kind: "refused",
  code: "message_can_not_send_2",
});
xml(dialogMarkup);
const pending = (await sdk.openChatDialog("702", once)).send;
responses.push({ drop: true });
const attemptsAt = traces.length;
const attempts = await Promise.all([
  sdk.sendPrivateMessage(pending, "Retain me", once),
  sdk.sendPrivateMessage(pending, "Retain me", once),
]);
assert.deepEqual(
  attempts.map((result) => result.kind),
  ["uncertain", "not-dispatched"],
);
assert.equal(traces.length, attemptsAt + 1);
assert.equal(
  (await sdk.sendPrivateMessage(pending, "Retain me", once)).kind,
  "not-dispatched",
);
xml(recentMarkup.replace("Fake recent", "Retain me"));
const readback = await sdk.openRecentMessages("702", once);
assert.equal(readback.kind, "recent-messages");
assert.match(JSON.stringify(readback.messages), /Retain me/);
assert.equal(traces.length, attemptsAt + 2);
assert.equal(traces.at(-1).method, "GET");
json({
  ...history,
  reply: { ...history.reply, action: replyPath + "&topmuid=799" },
});
assert.equal((await sdk.openPrivateConversation("702", once)).send, null);
xml(dialogMarkup);
const drifted = (await sdk.openChatDialog("702", once)).send;
responses.push({
  switch: true,
  body: {
    ...identity,
    type: "result",
    schema: 13,
    kind: "handle",
    handlekey: "showmsg_702",
  },
});
assert.equal(
  (await sdk.sendPrivateMessage(drifted, "Fake draft", once)).kind,
  "uncertain",
);
session = account;
json(history);
const wrongDestination = (await sdk.openPrivateConversation("702", once)).send;
json({
  ...identity,
  type: "result",
  schema: 13,
  kind: "handle",
  handlekey: "pmsend",
  message_key: "do_success",
  url: "home.php?mod=space&do=pm&subop=view&touid=799",
  values: { pmid: "905" },
});
assert.equal(
  (await sdk.sendPrivateMessage(wrongDestination, "Fake reply", once)).kind,
  "uncertain",
);
results.sends = {
  expected:
    "exact form sends, explicit acceptance/refusal, dropped send once, and session drift uncertain",
  observed: [sent, replied, attempts, readback],
  requests: traces.slice(sendsAt),
};
const promptAt = traces.length;
const promptResponse = {
  ...identity,
  counts: { notice: 9, pm: 1 },
  time: 1700000003,
};
json(promptResponse);
const prompt = await sdk.preparePrivateMessageAcknowledgement();
expectRequest("/plugin.php", { id: "tsdmapp:api", action: "notify" });
assert.equal(prompt.kind, "private-prompt");
assert.equal(prompt.count, 1);
assert.equal(
  (await sdk.acknowledgePrivateMessagePrompt(prompt, { confirm: false })).kind,
  "not-dispatched",
);
assert.equal(traces.length, promptAt + 1);
json({ ok: 1, uid: 701, pm: 1, notice: 0 });
const cleared = await sdk.acknowledgePrivateMessagePrompt(prompt, once);
expectRequest(
  "/plugin.php",
  { id: "tsdmapp:api", action: "seen" },
  { formhash: "fakehash", pm: "1" },
);
assert.equal(cleared.kind, "cleared");
json(promptResponse);
const lostPrompt = await sdk.preparePrivateMessageAcknowledgement();
responses.push({ drop: true });
assert.equal(
  (await sdk.acknowledgePrivateMessagePrompt(lostPrompt, once)).kind,
  "uncertain",
);
assert.equal(
  (await sdk.acknowledgePrivateMessagePrompt(lostPrompt, once)).kind,
  "not-dispatched",
);
assert.equal(traces.length, promptAt + 4);
json(promptResponse);
const freshPrompt = await sdk.preparePrivateMessageAcknowledgement();
json({ ok: 1, uid: 701, notice: 1 });
assert.equal(
  (await sdk.acknowledgePrivateMessagePrompt(freshPrompt, once)).kind,
  "uncertain",
);
json(promptResponse);
const stalePrompt = await sdk.preparePrivateMessageAcknowledgement();
session = { ...account, continuity: "session-b" };
assert.equal(
  (await sdk.acknowledgePrivateMessagePrompt(stalePrompt, once)).kind,
  "not-dispatched",
);
session = account;
results.prompt = {
  expected:
    "fresh notify proof, deliberate PM-only seen, explicit confirmation, notice response and loss remain uncertain",
  observed: [prompt, cleared],
  requests: traces.slice(promptAt),
};

const homepageAt = traces.length;
const checkPath = "home.php?mod=spacecp&ac=pm&op=checknewpm&rand=1700000000";
json({ ...identity, checknewpm: checkPath });
const homepage = await sdk.prepareHomepageMessageCheck();
expectRequest("/forum.php", { mod: "index", tsdmapp: "json", nodoc: "1" });
assert.equal(homepage.effect, "may-credit-daily-login");
assert.equal(
  (await sdk.checkHomepageMessages(homepage, { confirm: false })).kind,
  "not-dispatched",
);
assert.equal(traces.length, homepageAt + 1);
responses.push({
  contentType: "application/javascript",
  body: "/* Controlled response; executing is unnecessary */",
});
const check = await sdk.checkHomepageMessages(homepage, once);
expectRequest("/home.php", {
  mod: "spacecp",
  ac: "pm",
  op: "checknewpm",
  rand: "1700000000",
});
assert.deepEqual(check, { kind: "loaded", credit: "unknown" });
assert.equal(
  (await sdk.checkHomepageMessages(homepage, once)).kind,
  "not-dispatched",
);
json({
  ...identity,
  checknewpm: "//other.example.test/home.php?mod=spacecp&ac=pm&op=checknewpm",
});
assert.equal((await sdk.prepareHomepageMessageCheck()).kind, "unsupported");
json({
  ...identity,
  document:
    '<script src="home.php?mod=spacecp&amp;ac=pm&amp;op=checknewpm"></script>',
  head: nativeAccount.replace("uid=701", "uid=799"),
});
assert.equal((await sdk.prepareHomepageMessageCheck()).kind, "session-changed");
html(
  `${nativeAccount}<script src="home.php?mod=spacecp&amp;ac=pm&amp;op=checknewpm&amp;rand=1"></script>`,
);
const legacyCheck = await sdk.prepareHomepageMessageCheck();
responses.push({ drop: true });
assert.equal(
  (await sdk.checkHomepageMessages(legacyCheck, once)).kind,
  "uncertain",
);
assert.equal(
  (await sdk.checkHomepageMessages(legacyCheck, once)).kind,
  "not-dispatched",
);
assert.equal(traces.length, homepageAt + 6);
results.homepage = {
  expected:
    "only advertised same-origin check runs deliberately, success gives no confirmed daily credit",
  observed: [homepage, check, legacyCheck],
  requests: traces.slice(homepageAt),
};
assert.equal(responses.length, 0);
const legacyAt = traces.length;
json({ ok: 0, error: "action" });
const nativeList = await sdk.listPrivateMessages();
assert.equal(nativeList.kind, "native-page");
assert.equal(nativeList.effect, "may-clear-private-prompt");
assert.equal(new URL(nativeList.url).searchParams.get("filter"), "privatepm");
assert.equal(
  new URL((await sdk.listBroadcastMessages(2)).url).searchParams.get("page"),
  "2",
);
assert.equal(traces.length, legacyAt + 1);
const nativeHistory = `<div id="ct"><div class="tbmu">With <a href="home.php?mod=space&amp;uid=702">Fake Peer</a><span id="membernum">1</span></div><div id="pm_ul">
<dl id="pmlist_901"><dd class="avt"><a href="home.php?mod=space&amp;uid=702">Avatar</a></dd><dd class="ptm">Fake Peer<br>Native reply<br><span class="xg1"><span title="2026-01-01 10:00">then</span></span></dd></dl></div>
<form id="pmform" method="post" action="${replyPath.replaceAll("&", "&amp;")}"><textarea name="message" maxlength="12"></textarea><input type="hidden" name="formhash" value="fakehash"><input type="hidden" name="topmuid" value="702"><button type="submit" name="pmsubmit" value="true">Send</button></form></div>`;
json({ uid: 701, head: nativeAccount, document: nativeHistory });
const legacyHistory = await sdk.openPrivateConversation("702", once);
assert.equal(legacyHistory.kind, "conversation");
assert.equal(legacyHistory.messages[0].id, "901");
assert.equal(legacyHistory.send.maxLength, 12);
assert.equal(
  (await sdk.sendPrivateMessage(legacyHistory.send, "x".repeat(13), once)).kind,
  "not-dispatched",
);
xml(
  `<script>if(typeof succeedhandle_pmsend=='function') {succeedhandle_pmsend('home.php?mod=space&do=pm&subop=view&touid=702', 'OK', {'pmid':'904'});}</script>`,
);
const nativeReply = await sdk.sendPrivateMessage(
  legacyHistory.send,
  "Native form",
  once,
);
assert.deepEqual(nativeReply, { kind: "accepted", messageId: "904" });
expectRequest(
  "/home.php",
  {
    mod: "spacecp",
    ac: "pm",
    op: "send",
    pmid: "901",
    daterange: "0",
    handlekey: "pmsend",
    pmsubmit: "yes",
    topmuid: "702",
  },
  { formhash: "fakehash", message: "Native form" },
);
results.legacy = {
  expected:
    "legacy list handoff and historical history markup with named submit button and length limit",
  observed: [nativeList, legacyHistory, nativeReply],
  requests: traces.slice(legacyAt),
};
assert.equal(responses.length, 0);
console.log(JSON.stringify(results));
