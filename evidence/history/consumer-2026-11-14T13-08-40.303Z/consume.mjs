import assert from 'node:assert/strict';
import { createForumClient, FORUM_CLIENT_VERSION, unresolvedWritingAttachments } from '@tsdm/forum-client';
assert.equal(FORUM_CLIENT_VERSION, '0.26.0');
const origin = 'https://fixture.example';
const threadURL = origin + '/forum.php?mod=viewthread&tid=42';
const attachmentURL = origin + '/forum.php?mod=attachment&aid=authored-token';
const searchURL = origin + '/search.php?mod=forum&searchid=581';
const thread = '<div id="postlist"><h1 id="thread_subject">External reader</h1><div id="post_101"><div class="authi">Author</div><div class="pcb"><p>Portable populated content</p><ignore_js_op><span id="attach_51"><a href="' + attachmentURL + '">portable.bin</a></span><div id="attach_51_menu">4 Bytes</div></ignore_js_op></div></div></div>';
const form = '<form method="post" action="search.php?mod=forum"><input type="hidden" name="formhash" value="current-token"><input type="hidden" name="searchsubmit" value="yes"><input name="srchtxt" type="text"><input name="srchuname" type="text"></form>';
const results = '<div class="sttl"><h2>One authored result</h2><a href="search.php?mod=forum&adv=yes&searchid=581">Advanced search</a></div><div id="threadlist" class="slst"><ul><li class="pbw"><h3><a href="forum.php?mod=viewthread&tid=42">External result</a></h3><p class="xg1">1 reply · 4 views</p><p>Authored snippet</p><p><span>2026-10-19</span><span><a href="home.php?mod=space&uid=9">Authored reader</a></span><span><a href="forum.php?mod=forumdisplay&fid=5">Listening</a></span></p></li></ul></div><div class="pg"><strong>1</strong><a href="' + searchURL + '&page=2">2</a></div>';
const requests = [];
const fileRequests = [];
const client = createForumClient({ origin, transport: {
  async request(url, options) {
    requests.push({ url, options });
    const isSearch = new URL(url).pathname === '/search.php';
    const document = isSearch ? options?.method === 'POST' || new URL(url).searchParams.has('searchid') ? results : form : thread;
    return { status: 200, url, contentType: 'application/json', body: JSON.stringify({ uid: 7, document }) };
  },
  async requestFile(url) {
    fileRequests.push(url);
    return { status: 200, url, contentType: 'application/octet-stream', contentLength: '4', contentEncoding: '', disposition: 'attachment; filename="portable.bin"', redirected: false, bytes: new Uint8Array([1, 2, 3, 4]) };
  }
} });
const read = await client.readThread(threadURL);
assert.equal(read.kind, 'thread');
assert.equal(read.thread.id, '42');
assert.equal(read.thread.posts[0].id, '101');
assert.equal(read.thread.posts[0].attachments[0].id, '51');
assert.equal(read.account.kind, 'member');
assert.deepEqual(JSON.parse(JSON.stringify(read)), read);
const overview = await client.readPage(origin + '/search.php?mod=forum&adv=yes');
assert.equal(overview.kind, 'search');
assert.equal(overview.search.results, null);
const searched = await client.search({ ...overview.search.edited, srchtxt: ['autumn'] }, overview.search.form, overview.account);
assert.equal(searched.kind, 'search');
assert.equal(searched.search.results.id, '581');
assert.equal(searched.search.results.rows[0].label, 'External result');
assert.deepEqual(JSON.parse(JSON.stringify(searched)), searched);
assert.equal(JSON.stringify(searched).includes('current-token'), false);
const second = await client.readSearchPage(searched.search.results.pages.links[0].url, searched.search, searched.account);
assert.equal(second.kind, 'search');
assert.equal(second.search.results.id, '581');
const download = await client.downloadAttachment({ threadURL, postId: '101', attachmentId: '51', account: read.account });
assert.equal(download.kind, 'file');
assert.equal(download.name, 'portable.bin');
assert.deepEqual([...download.bytes], [1, 2, 3, 4]);
assert.deepEqual(fileRequests, [attachmentURL]);
assert.equal(requests.filter((r) => r.options?.method === 'POST').length, 1);
assert.deepEqual(requests.at(-1).options, { fresh: true });
assert.equal(typeof globalThis.document, 'undefined');
assert.equal(typeof globalThis.GM, 'undefined');
const preparationRequests=[];
const writer=createForumClient({origin:'https://fixture.example',transport:{async request(url){
 preparationRequests.push(url);
 return {status:200,url,contentType:'text/html',body:'<div id="um"><strong><a href="home.php?mod=space&uid=7">Writer Seven</a></strong></div><form id="postform" method="post" action="forum.php?mod=post&action=newthread&fid=5&topicsubmit=yes"><input name="formhash" value="NEVER-EXPORT"><input name="subject" value="Portable writing"><textarea name="message">[unknown]complete source[/unknown]</textarea><label><input type="checkbox" name="usesig" checked value="1">Signature</label></form>'};
}}});
const prepared=await writer.prepareNewThread('5');
assert.equal(prepared.kind,'prepared');
assert.equal(prepared.prepared.board.id,'5');
assert.equal(prepared.prepared.account.id,'7');
assert.equal(prepared.prepared.source,'[unknown]complete source[/unknown]');
assert.equal(prepared.prepared.options[0].checked,true);
assert.deepEqual(JSON.parse(JSON.stringify(prepared)),prepared);
assert.equal(JSON.stringify(prepared).includes('NEVER-EXPORT'),false);
assert.equal(preparationRequests.length,1);
const referenceSource = '[unknown]literal[/unknown][attach]51[/attach][ATTACHIMG] 52 [/ATTACHIMG][attach]51[/attach][attach]0[/attach][attach]external[/attach]';
const referenceWriting = { ...prepared.prepared, source: referenceSource, uploadedReferences: ['52'] };
const beforeReferences = JSON.stringify(referenceWriting);
assert.deepEqual(unresolvedWritingAttachments(referenceWriting), ['51']);
assert.equal(JSON.stringify(referenceWriting), beforeReferences);
assert.deepEqual(unresolvedWritingAttachments({ ...referenceWriting, uploadedReferences: [] }), ['51', '52']);
assert.deepEqual(unresolvedWritingAttachments({ source: '[unknown]literal[/unknown]', uploadedReferences: [] }), []);

const noticeURL = origin + '/home.php?mod=space&do=notice';
const nativeNextNoticePage = noticeURL + '&view=all&type=&isread=1&page=2';
const noticeRequests = [];
let noticeActor = 7;
let noticeNetworkFailure = false;
const noticeClient = createForumClient({ origin, transport: { async request(url, options) {
  noticeRequests.push({ url, options });
  if (noticeNetworkFailure) throw Error('Authored network failure');
  const selected = new URL(url);
  const page = selected.searchParams.get('page') ?? '1';
  const category = selected.searchParams.get('view') === 'system' ? '&view=system' : '';
  const next = category ? noticeURL + category + '&page=2' : nativeNextNoticePage;
  const document = '<div id="um"><strong><a href="home.php?mod=space&uid=' + noticeActor + '">Authored member</a></strong><a id="myprompt">提醒(0)</a></div><div id="ct"><div class="tbn"><a href="' + noticeURL + '">All notices</a><a href="' + noticeURL + '&view=system">System notices</a></div><div class="nts"><dl notice="73" id="pendingFriend_19"><dt><span title="2026-10-20 21:40:00">just now</span></dt><dd class="ntc_body"><p>Complete portable notice body.</p><a href="forum.php?mod=redirect&goto=findpost&ptid=42&pid=202">Exact portable target</a><a href="home.php?mod=spacecp&ac=friend&formhash=NEVER-EXPORT-NOTICE">Native action</a></dd></dl></div><div class="pg"><strong>' + page + '</strong><a href="' + next + '">2</a></div></div>';
  return { status: 200, url, contentType: 'application/json', body: JSON.stringify({ uid: noticeActor, document }) };
} } });
assert.equal((await noticeClient.readPage(noticeURL)).kind, 'invalid');
assert.equal(noticeRequests.length, 0);
const loadedNotices = await noticeClient.readNotices(noticeURL);
assert.equal(loadedNotices.kind, 'notices');
assert.equal(loadedNotices.notices.entries[0].id, '73');
assert.equal(loadedNotices.notices.entries[0].time, '2026-10-20 21:40:00');
assert.deepEqual(loadedNotices.notices.unread, { kind: 'observed', count: 0 });
assert.deepEqual(loadedNotices.notices.entries[0].body[0].children, [{ kind: 'text', text: 'Complete portable notice body.' }]);
assert.equal(loadedNotices.notices.entries[0].body[1].attributes.href, origin + '/forum.php?mod=redirect&goto=findpost&ptid=42&pid=202');
assert.deepEqual(JSON.parse(JSON.stringify(loadedNotices)), loadedNotices);
assert.equal(JSON.stringify(loadedNotices).includes('NEVER-EXPORT-NOTICE'), false);
assert.equal((await noticeClient.readNotices(noticeURL + '&page=99', loadedNotices.notices, loadedNotices.account)).kind, 'invalid');
assert.equal(noticeRequests.length, 1);
assert.equal(loadedNotices.notices.pages.links[0].url, nativeNextNoticePage);
assert.equal((await noticeClient.readNotices(noticeURL + '&view=all&type=&isread=0&page=2', loadedNotices.notices, loadedNotices.account)).kind, 'invalid');
assert.equal(noticeRequests.length, 1);
const nextAllNotices = await noticeClient.readNotices(nativeNextNoticePage, loadedNotices.notices, loadedNotices.account);
assert.equal(nextAllNotices.kind, 'notices');
assert.equal(nextAllNotices.notices.pages.current, '2');
assert.equal(nextAllNotices.notices.url, nativeNextNoticePage);
assert.equal(noticeRequests[1].url, nativeNextNoticePage + '&tsdmapp=json');
const systemNotices = await noticeClient.readNotices(loadedNotices.notices.categories[1].url, loadedNotices.notices, loadedNotices.account);
assert.equal(systemNotices.kind, 'notices');
const nextNotices = await noticeClient.readNotices(systemNotices.notices.pages.links[0].url, systemNotices.notices, systemNotices.account);
assert.equal(nextNotices.kind, 'notices');
assert.equal(nextNotices.notices.pages.current, '2');
assert.equal(nextNotices.notices.url, noticeURL + '&view=system&page=2');
assert.equal(noticeRequests.length, 4);
assert.equal(noticeRequests.every((request) => request.options.fresh === true && new URL(request.url).searchParams.get('tsdmapp') === 'json'), true);
noticeActor = 8;
const changedNotices = await noticeClient.readNotices(nextNotices.notices.url, nextNotices.notices, nextNotices.account);
assert.equal(changedNotices.kind, 'invalid');
assert.equal(changedNotices.account.id, '8');
assert.ok(changedNotices.generation > nextNotices.generation);
noticeNetworkFailure = true;
const failedNotices = await noticeClient.readNotices(noticeURL);
assert.equal(failedNotices.kind, 'network');
assert.match(failedNotices.message, /may still have marked notices read/);
assert.equal(noticeRequests.length, 6);

import boundaryAssert from "node:assert/strict";
import { createForumClient as createBoardClient } from "@tsdm/forum-client";
const boundaryCases = [];
// The public artifact must hide implementation paths even when their files ship.
for (const specifier of [
  "@tsdm/forum-client/index.js",
  "@tsdm/forum-client/types",
  "@tsdm/forum-client/prepare-writing",
  "@tsdm/forum-client/package.json",
]) {
  await boundaryAssert.rejects(import(specifier), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
}
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "DOMParser",
  "GM",
  "Vue",
]) {
  boundaryAssert.equal(
    typeof globalThis[name],
    "undefined",
    name + " must not be supplied by the consumer",
  );
}

boundaryCases.push({
  name: "public package hides private exports and needs no browser globals",
  status: "passed",
});

// Source-menu metadata stays portable through both supported response envelopes.
for (const representation of ["html", "json"]) {
  const boardURL = "https://fixture.example/forum.php?mod=forumdisplay&fid=5";
  const categoryURL = boardURL + "&typeid=3&orderby=dateline";
  const html =
    '<div id="ct"><h1>Portable board</h1></div><div id="filter_dateline_menu"><a href="' +
    boardURL +
    '&dateline=604800">Recent</a></div><div id="thread_types"><a href="' +
    categoryURL +
    '">Misleading time label</a></div><div id="dhnav"><a href="' +
    boardURL +
    '&authorid=9">Newest threads</a></div><table id="threadlisttableid"><tr><td class="emp">No threads</td></tr></table>';
  const portable = createBoardClient({
    origin: "https://fixture.example",
    transport: {
      async request(url) {
        return {
          status: 200,
          url,
          contentType:
            representation === "html" ? "text/html" : "application/json",
          body:
            representation === "html"
              ? html
              : JSON.stringify({ document: html }),
        };
      },
    },
  });
  const result = await portable.readPage(boardURL);
  boundaryAssert.equal(result.kind, "board");
  boundaryAssert.deepEqual(
    result.board.filterGroups.map(({ kind, sourceId }) => ({ kind, sourceId })),
    [
      { kind: "time", sourceId: "filter_dateline_menu" },
      { kind: "category", sourceId: "thread_types" },
      { kind: "unclassified", sourceId: "dhnav" },
    ],
  );
  boundaryAssert.equal(result.board.filterGroups[1].links[0].url, categoryURL);
  boundaryAssert.deepEqual(JSON.parse(JSON.stringify(result)), result);
}
boundaryCases.push({
  name: "HTML and JSON source filter groups are portable with exact destinations",
  status: "passed",
});

const mixedURL = "https://fixture.example/forum.php?mod=forumdisplay&fid=5";
const mixedHTML =
  '<div id="ct"><h1>Mixed native menu</h1></div><div id="filter_dateline_menu"><ul class="pop_moremenu"><li>排序: <a href="' +
  mixedURL +
  '&filter=reply&orderby=replies&dateline=604800">Replies</a></li><li>时间: <a href="' +
  mixedURL +
  '&orderby=lastpost&filter=dateline&dateline=604800">Week</a></li></ul></div><table id="threadlisttableid"><tr><td class="emp">No threads</td></tr></table>';
const mixedClient = createBoardClient({
  origin: "https://fixture.example",
  transport: {
    async request(url) {
      return {
        status: 200,
        url,
        contentType: "application/json",
        body: JSON.stringify({ document: mixedHTML }),
      };
    },
  },
});
const mixedRead = await mixedClient.readPage(mixedURL);
boundaryAssert.equal(mixedRead.kind, "board");
boundaryAssert.deepEqual(
  mixedRead.board.filterGroups.map(({ kind, sourceId, sourceLabel }) => ({
    kind,
    sourceId,
    sourceLabel,
  })),
  [
    {
      kind: "unclassified",
      sourceId: "filter_dateline_menu",
      sourceLabel: "排序:",
    },
    {
      kind: "unclassified",
      sourceId: "filter_dateline_menu",
      sourceLabel: "时间:",
    },
  ],
);
boundaryCases.push({
  name: "mixed native menu preserves source subgroup labels without guessed semantic kinds",
  status: "passed",
});

const mixedWeek = await mixedClient.readPage(
  mixedURL + "&orderby=lastpost&filter=dateline&dateline=604800",
);
boundaryAssert.equal(mixedWeek.kind, "board");
boundaryAssert.equal(
  mixedWeek.board.criteria.find((item) => item.label.startsWith("Sort:")).label,
  "Sort: lastpost",
);

boundaryAssert.equal(
  mixedWeek.board.criteria.find((item) => item.label.startsWith("Time:")).label,
  "Time: Week",
);
import publicationAssert from "node:assert/strict";
import { URL, URLSearchParams } from "node:url";
import { setTimeout } from "node:timers";
import { createForumClient as createPublicationClient } from "@tsdm/forum-client";
const publicationOrigin = "https://fixture.example";
const publicationThreadURL =
  publicationOrigin + "/forum.php?mod=viewthread&tid=42";
// Failure inventory: stale/superseded preparation, cross-client identity reuse,
// mutated revision, duplicate pending activation, failed preflight, changed actor
// before/during preparation, send and independent readback, explicit restored
// attempt checking, incomplete source/options and unsupported response grammar.
// Current ordinary submitter literals must survive the successful-control body.
// The installed public package is the whole system; only external HTTP is replaced.
const publicationCases = [];
const publicationFailures = [];
const publicationSource =
  "[unknown]完整來源 & <tag>[/unknown]\n[table][tr][td]portable[/td][/tr][/table]";
const escapePublication = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
function publicationFixture() {
  const state = {
    actor: "7",
    posts: [],
    requests: [],
    gate: null,
    postGate: null,
    failure: false,
    response: null,
    sourceChange: (body) => body,
    submitterValue: null,
    formChange: (body) => body,
  };
  const memberHTML = (id) =>
    '<div id="um"><strong><a href="home.php?mod=space&uid=' +
    id +
    '">Writer ' +
    id +
    "</a></strong></div>";
  const writingForm = (id, saved) => {
    const get = (name, fallback = "") =>
      escapePublication(saved?.get(name) ?? fallback);
    return state.formChange(
      memberHTML(id) +
        '<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div><form id="postform" method="post" action="forum.php?mod=post&action=' +
        (saved ? "edit&tid=42&pid=101" : "newthread") +
        '&fid=5&topicsubmit=yes"><input type="hidden" name="formhash" value="PRIVATE-PUBLICATION-TOKEN"><input name="subject" value="' +
        get("subject", "Portable publication") +
        '"><textarea name="message">' +
        get("message", publicationSource) +
        '</textarea><input name="price" value="' +
        get("price", "2") +
        '"><label><input type="checkbox" name="usesig" value="1"' +
        (!saved || saved.has("usesig") ? " checked" : "") +
        ">Signature</label>" +
        (state.submitterValue === null
          ? ""
          : '<button name="topicsubmit" value="' +
            state.submitterValue +
            '">Publish</button>') +
        "</form>",
      saved,
    );
  };
  const publicationClient = createPublicationClient({
    origin: publicationOrigin,
    transport: {
      async request(url, options) {
        state.requests.push({ url, options });
        const selected = new URL(url),
          id = state.actor;
        if (options?.method === "POST") {
          state.posts.push(new URLSearchParams(options.body));
          if (state.postGate) await state.postGate;
          if (state.response === "lost") throw Error("Authored lost response");
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body:
              state.response ??
              "<root><![CDATA[<script>succeedhandle_post('forum.php?mod=viewthread&tid=42', 'Published', {'fid':'5','tid':'42','pid':'101'});</script>]]></root>",
          };
        }
        let body;
        if (selected.searchParams.get("action") === "newthread")
          body = writingForm(id);
        else if (selected.searchParams.get("action") === "edit")
          body = state.sourceChange(writingForm(id, state.posts.at(-1)));
        else
          body =
            memberHTML(id) +
            '<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div><div id="postlist"><h1 id="thread_subject">' +
            escapePublication(
              state.posts.at(-1)?.get("subject") ?? "Portable publication",
            ) +
            '</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum101"><em>1</em>#</a><div class="pcb"><p>Independent rendered post</p></div></div></div>';
        if (state.gate?.matches(url)) await state.gate.promise;
        if (state.failure) throw Error("Authored preflight failure");
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const submission = async () => {
    const prepared = await publicationClient.prepareNewThread("5");
    publicationAssert.equal(prepared.kind, "prepared");
    return {
      contextId: "external-context",
      revision: 3,
      writing: prepared.prepared,
    };
  };
  const attempt = (publication) => ({
    id: "external-attempt-" + publication.id,
    publication,
    status: "pending",
    message: "",
    checked: false,
    candidateURL: null,
    result: null,
  });
  const gate = (matches) => {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    state.gate = { matches, promise };
    return () => {
      state.gate = null;
      release();
    };
  };
  return { state, client: publicationClient, submission, attempt, gate };
}
async function publicationCase(name, run) {
  try {
    await run();
    publicationCases.push({ name, status: "passed" });
  } catch (error) {
    publicationCases.push({ name, status: "failed", message: error.message });
    publicationFailures.push(name + ": " + error.message);
  }
}
await publicationCase(
  "literal native true submitter preserves ordinary action and exact body",
  async () => {
    const f = publicationFixture();
    f.state.submitterValue = "true";
    const submission = await f.submission();
    const ready = await f.client.prepareThreadPublication(submission);
    publicationAssert.equal(ready.kind, "ready");
    const result = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(result.status, "confirmed");
    publicationAssert.equal(f.state.posts.length, 1);
    publicationAssert.deepEqual(f.state.posts[0].getAll("topicsubmit"), [
      "true",
    ]);
    publicationAssert.equal(f.state.posts[0].get("message"), publicationSource);
    const post = f.state.requests.filter((r) => r.options?.method === "POST");
    publicationAssert.equal(post.length, 1);
    publicationAssert.deepEqual(
      new URL(post[0].url).searchParams.getAll("topicsubmit"),
      ["yes"],
    );
  },
);
await publicationCase(
  "complete immutable source/options and independent confirmation",
  async () => {
    const f = publicationFixture(),
      submission = await f.submission();
    const ready = await f.client.prepareThreadPublication(submission);
    publicationAssert.equal(ready.kind, "ready");
    submission.writing.source = "Later caller edit";
    const result = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(result.status, "confirmed");
    publicationAssert.equal(result.publication.submission.revision, 3);
    publicationAssert.equal(
      result.publication.submission.writing.source,
      publicationSource,
    );
    publicationAssert.equal(f.state.posts[0].get("message"), publicationSource);
    publicationAssert.equal(f.state.posts[0].get("price"), "2");
    publicationAssert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    publicationAssert.equal(
      JSON.stringify(result).includes("PRIVATE-PUBLICATION-TOKEN"),
      false,
    );
    publicationAssert.equal(
      f.state.requests.filter(
        (r) => new URL(r.url).searchParams.get("action") === "edit",
      ).length,
      1,
    );
    const restored = {
      ...result,
      status: "uncertain",
      checked: false,
      result: null,
    };
    const fresh = publicationFixture();
    fresh.state.posts = f.state.posts;
    const checked = await fresh.client.checkThreadResult(
      JSON.parse(JSON.stringify(restored)),
      publicationThreadURL,
    );
    publicationAssert.equal(checked.status, "confirmed");
    publicationAssert.equal(checked.id, result.id);
    publicationAssert.deepEqual(checked.publication, result.publication);
    publicationAssert.equal(
      fresh.state.requests.some((r) => r.options?.method === "POST"),
      false,
    );
  },
);
await publicationCase(
  "superseded same-context preparation cannot send",
  async () => {
    const f = publicationFixture(),
      submission = await f.submission();
    const older = await f.client.prepareThreadPublication(submission);
    const newer = await f.client.prepareThreadPublication({
      ...submission,
      revision: 4,
    });
    publicationAssert.equal(newer.kind, "ready");
    const result = await f.client.publishThread(f.attempt(older.publication));
    publicationAssert.equal(result.status, "not-sent");
    publicationAssert.equal(f.state.posts.length, 0);
  },
);
await publicationCase(
  "fresh clients never reuse serializable preparation identity",
  async () => {
    const a = publicationFixture(),
      b = publicationFixture();
    const first = await a.client.prepareThreadPublication(await a.submission());
    const second = await b.client.prepareThreadPublication(
      await b.submission(),
    );
    publicationAssert.notEqual(first.publication.id, second.publication.id);
  },
);
await publicationCase(
  "caller edits while preparation waits cannot change submitted snapshot",
  async () => {
    const f = publicationFixture(),
      submission = await f.submission();
    const release = f.gate(
      (url) => new URL(url).searchParams.get("action") === "newthread",
    );
    const pending = f.client.prepareThreadPublication(submission);
    submission.writing.source = "Unreviewed later edit";
    submission.revision = 4;
    release();
    const ready = await pending;
    publicationAssert.equal(ready.kind, "ready");
    publicationAssert.equal(ready.publication.submission.revision, 3);
    publicationAssert.equal(
      ready.publication.submission.writing.source,
      publicationSource,
    );
  },
);
await publicationCase(
  "caller edits while publication waits cannot change original attempt",
  async () => {
    const f = publicationFixture(),
      ready = await f.client.prepareThreadPublication(await f.submission());
    const attempt = f.attempt(ready.publication),
      original = JSON.parse(JSON.stringify(attempt));
    const release = f.gate(
      (url) => new URL(url).searchParams.get("action") === "newthread",
    );
    const pending = f.client.publishThread(attempt);
    attempt.id = "later-mutated-id";
    attempt.publication.submission.writing.source = "Later caller content";
    release();
    const result = await pending;
    publicationAssert.equal(result.status, "confirmed");
    publicationAssert.equal(result.id, original.id);
    publicationAssert.deepEqual(result.publication, original.publication);
    publicationAssert.equal(f.state.posts[0].get("message"), publicationSource);
  },
);
await publicationCase(
  "fresh preparation after recovery establishes same actor immediately",
  async () => {
    const old = publicationFixture(),
      submission = await old.submission(),
      recovered = publicationFixture();
    publicationAssert.equal(
      (await recovered.client.prepareThreadPublication(submission)).kind,
      "ready",
    );
  },
);
await publicationCase(
  "mutated public submission refuses without POST",
  async () => {
    const f = publicationFixture(),
      ready = await f.client.prepareThreadPublication(await f.submission());
    const changed = JSON.parse(JSON.stringify(ready.publication));
    changed.submission.revision++;
    publicationAssert.equal(
      (await f.client.publishThread(f.attempt(changed))).status,
      "not-sent",
    );
    publicationAssert.equal(f.state.posts.length, 0);
  },
);
await publicationCase(
  "duplicate pending activation has one effectful request",
  async () => {
    const f = publicationFixture(),
      ready = await f.client.prepareThreadPublication(await f.submission());
    let release;
    f.state.postGate = new Promise((resolve) => {
      release = resolve;
    });
    const attempt = f.attempt(ready.publication),
      first = f.client.publishThread(attempt);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await f.client.publishThread(attempt);
    publicationAssert.equal(second.status, "not-sent");
    publicationAssert.equal(f.state.posts.length, 1);
    release();
    publicationAssert.equal((await first).status, "confirmed");
  },
);
await publicationCase(
  "preflight transport failure is known not sent",
  async () => {
    const f = publicationFixture(),
      ready = await f.client.prepareThreadPublication(await f.submission());
    f.state.failure = true;
    publicationAssert.equal(
      (await f.client.publishThread(f.attempt(ready.publication))).status,
      "not-sent",
    );
    publicationAssert.equal(f.state.posts.length, 0);
  },
);
for (const phase of ["prepare", "preflight", "result", "source"])
  await publicationCase(
    `delayed ${phase} cannot overwrite a newer actor observation`,
    async () => {
      const f = publicationFixture(),
        submission = await f.submission();
      const ready =
        phase === "prepare"
          ? null
          : await f.client.prepareThreadPublication(submission);
      if (["result", "source"].includes(phase))
        f.state.posts.push(
          new URLSearchParams({
            subject: submission.writing.title,
            message: submission.writing.source,
            price: "2",
            usesig: "1",
          }),
        );
      const release = f.gate(
        (url) =>
          new URL(url).searchParams.get("action") ===
            (phase === "source" ? "edit" : "newthread") ||
          (phase === "result" &&
            new URL(url).searchParams.get("mod") === "viewthread"),
      );
      const pending =
        phase === "prepare"
          ? f.client.prepareThreadPublication(submission)
          : phase === "preflight"
            ? f.client.publishThread(f.attempt(ready.publication))
            : f.client.checkThreadResult(
                { ...f.attempt(ready.publication), status: "uncertain" },
                publicationThreadURL,
              );
      await new Promise((resolve) => setTimeout(resolve, 0));
      f.state.actor = "8";
      // Observe the new account through a distinct current read that is not gated.
      const savedGate = f.state.gate;
      f.state.gate = null;
      await f.client.readThread(publicationThreadURL);
      f.state.gate = savedGate;
      publicationAssert.equal(f.client.account.id, "8");
      const observedGeneration = f.client.generation;
      release();
      const result = await pending;
      publicationAssert.equal(f.client.account.id, "8");
      publicationAssert.equal(f.client.generation, observedGeneration);
      if (phase === "result")
        publicationAssert.equal(
          f.state.requests.some(
            (r) => new URL(r.url).searchParams.get("action") === "edit",
          ),
          false,
        );
      publicationAssert.equal(
        phase === "prepare" ? result.kind : result.status,
        phase === "prepare"
          ? "stale"
          : phase === "preflight"
            ? "not-sent"
            : "uncertain",
      );
      if (phase === "preflight")
        publicationAssert.equal(f.state.posts.length, 0);
    },
  );
await publicationCase(
  "changed actor while POST pending retains uncertainty",
  async () => {
    const f = publicationFixture(),
      ready = await f.client.prepareThreadPublication(await f.submission());
    let release;
    f.state.postGate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = f.client.publishThread(f.attempt(ready.publication));
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.state.actor = "8";
    await f.client.readThread(publicationThreadURL);
    release();
    publicationAssert.equal((await pending).status, "uncertain");
    publicationAssert.equal(f.state.posts.length, 1);
    publicationAssert.equal(f.client.account.id, "8");
  },
);
// Authored before the stored-publication/effect distinction: the independently
// installed package is exercised without DOM, Vue, GM or browser globals.
const nativePublicationCallback =
  "<root><![CDATA[<script>if(typeof succeedhandle_=='function'){succeedhandle_('forum.php?mod=viewthread&tid=42', 'Stored', {'fid':'5','tid':'42','pid':'101','feedid':'77'});}</script>]]></root>";
const nativePublicationEffects = [
  { name: "addfeed", requested: true, included: true, outcome: "unknown" },
  { name: "adddynamic", requested: true, included: true, outcome: "unknown" },
  {
    name: "adddynamic_doing",
    requested: false,
    included: false,
    outcome: "not-requested",
  },
];
// Before repair: omission cannot qualify submitted-blank normalization, while
// an unchanged disabled blank still permits independently matching persistence.
for (const [storedPrice, status] of [
  ["0", "uncertain"],
  ["", "confirmed"],
])
  await publicationCase(
    `disabled blank price omitted from command with stored ${JSON.stringify(storedPrice)}`,
    async () => {
      const f = publicationFixture();
      f.state.formChange = (body, saved) =>
        body.replace(
          /name="price" value="[^"]*"/,
          'name="price" value="' + (saved ? storedPrice : "") + '" disabled',
        );
      const ready = await f.client.prepareThreadPublication(
        await f.submission(),
      );
      publicationAssert.equal(ready.kind, "ready");
      const before = JSON.stringify(ready.publication);
      const result = await f.client.publishThread(f.attempt(ready.publication));
      publicationAssert.equal(f.state.posts.length, 1);
      publicationAssert.equal(f.state.posts[0].has("price"), false);
      publicationAssert.equal(JSON.stringify(result.publication), before);
      publicationAssert.deepEqual(
        result.publication.submission.writing.options.find(
          (o) => o.name === "price",
        ),
        ready.publication.submission.writing.options.find(
          (o) => o.name === "price",
        ),
      );
      publicationAssert.equal(result.status, status);
      if (status === "uncertain") publicationAssert.equal(result.result, null);
      else
        publicationAssert.deepEqual(
          result.result.verification.normalizations,
          [],
        );
    },
  );
function nativePublicationFixture(disabled = false) {
  const f = publicationFixture();
  f.state.formChange = (body, saved) =>
    body
      .replace(
        "</form>",
        '<select name="typeid"><option value="0" selected>No category</option><option value="3">Listening</option></select><select name="readperm"><option value="0">Everyone</option></select><label><input type="checkbox" name="bbcodeoff" value="1">Disable BBCode</label></form>',
      )
      .replace(
        /name="price" value="[^"]*"/,
        'name="price" value="' + (saved ? "0" : "") + '"',
      )
      .replace(
        "</form>",
        (saved
          ? ""
          : '<label><input type="checkbox" name="addfeed" value="1" checked' +
            (disabled ? " disabled" : "") +
            '>Publish activity</label><label><input type="checkbox" name="adddynamic" value="true" checked>Share with followers</label><label><input type="checkbox" name="adddynamic_doing" value="true">Ask followers to share</label>') +
          "</form>",
      );
  f.state.response = nativePublicationCallback;
  return f;
}
await publicationCase(
  "qualified stored proof preserves normalization and independent unknown effects",
  async () => {
    const f = nativePublicationFixture();
    const submitted = await f.submission();
    const ready = await f.client.prepareThreadPublication(submitted);
    publicationAssert.equal(ready.kind, "ready");
    const before = JSON.stringify(ready.publication);
    const result = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(result.status, "confirmed");
    publicationAssert.deepEqual(result.result.verification, {
      stored: "verified",
      normalizations: [{ name: "price", submitted: "", stored: "0" }],
      creationEffects: nativePublicationEffects,
    });
    publicationAssert.equal(JSON.stringify(result.publication), before);
    publicationAssert.equal(f.state.posts[0].get("price"), "");
    publicationAssert.equal(f.state.posts[0].get("addfeed"), "1");
    publicationAssert.equal(f.state.posts[0].has("adddynamic_doing"), false);
    publicationAssert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    publicationAssert.equal(JSON.stringify(result).includes('"feedid"'), false);
  },
);
await publicationCase(
  "checked disabled creation instruction is requested but not included or verified",
  async () => {
    const f = nativePublicationFixture(true);
    const ready = await f.client.prepareThreadPublication(await f.submission());
    publicationAssert.equal(ready.kind, "ready");
    const result = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(result.status, "confirmed");
    publicationAssert.deepEqual(result.result.verification.creationEffects[0], {
      name: "addfeed",
      requested: true,
      included: false,
      outcome: "unknown",
    });
    publicationAssert.equal(f.state.posts[0].has("addfeed"), false);
  },
);
await publicationCase(
  "legacy uncertain original upgrades by GET-only check and failed recheck retains prior proof",
  async () => {
    const f = nativePublicationFixture();
    f.state.response = "lost";
    const ready = await f.client.prepareThreadPublication(await f.submission());
    const original = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(original.status, "uncertain");
    publicationAssert.equal(original.result, null);
    const checked = await f.client.checkThreadResult(
      JSON.parse(JSON.stringify(original)),
      publicationThreadURL,
    );
    publicationAssert.equal(checked.status, "confirmed");
    publicationAssert.equal(checked.id, original.id);
    publicationAssert.deepEqual(checked.publication, original.publication);
    f.state.failure = true;
    const rechecked = await f.client.checkThreadResult(
      JSON.parse(JSON.stringify(checked)),
    );
    publicationAssert.equal(rechecked.status, "confirmed");
    publicationAssert.deepEqual(rechecked.result, checked.result);
    publicationAssert.match(
      rechecked.message,
      /Previous stored confirmation retained/,
    );
    publicationAssert.equal(f.state.posts.length, 1);
    publicationAssert.equal(
      f.state.requests.filter((r) => r.options?.method === "POST").length,
      1,
    );
  },
);
for (const [name, change] of [
  ["missing price", (body) => body.replace(/<input name="price"[^>]*>/, "")],
  [
    "unexplained price",
    (body) => body.replace('name="price" value="0"', 'name="price" value="2"'),
  ],
  [
    "missing signature",
    (body) =>
      body.replace(
        /<label><input type="checkbox" name="usesig"[\s\S]*?<\/label>/,
        "",
      ),
  ],
  [
    "changed source",
    (body) =>
      body.replace(
        /<textarea name="message">[\s\S]*?<\/textarea>/,
        '<textarea name="message">Different</textarea>',
      ),
  ],
  [
    "missing permission",
    (body) => body.replace(/<select name="readperm">[\s\S]*?<\/select>/, ""),
  ],
  [
    "changed category",
    (body) =>
      body
        .replace('value="0" selected', 'value="0"')
        .replace('value="3"', 'value="3" selected'),
  ],
  [
    "changed parsing",
    (body) =>
      body.replace(
        'name="bbcodeoff" value="1"',
        'name="bbcodeoff" value="1" checked',
      ),
  ],
])
  await publicationCase(
    `stored normalization cannot hide ${name}`,
    async () => {
      const f = nativePublicationFixture();
      f.state.sourceChange = change;
      const ready = await f.client.prepareThreadPublication(
        await f.submission(),
      );
      const result = await f.client.publishThread(f.attempt(ready.publication));
      publicationAssert.equal(result.status, "uncertain");
      publicationAssert.equal(result.result, null);
      publicationAssert.match(
        result.message,
        /Complete stored source or offered options did not match/,
      );
    },
  );
for (const [name, response] of [
  [
    "unguarded empty suffix",
    nativePublicationCallback
      .replace("if(typeof succeedhandle_=='function'){", "")
      .replace(";}", ";"),
  ],
  [
    "mismatched guard",
    nativePublicationCallback.replace(
      "typeof succeedhandle_",
      "typeof succeedhandle_post",
    ),
  ],
  [
    "arbitrary suffix",
    nativePublicationCallback.replaceAll(
      "succeedhandle_",
      "succeedhandle_other",
    ),
  ],
  [
    "extra script",
    nativePublicationCallback.replace(
      "</script>",
      "</script><script>extra()</script>",
    ),
  ],
  [
    "dynamic argument",
    nativePublicationCallback.replace(
      "'forum.php?mod=viewthread&tid=42'",
      "destination",
    ),
  ],
])
  await publicationCase(`callback refuses ${name}`, async () => {
    const f = nativePublicationFixture();
    f.state.response = response;
    const ready = await f.client.prepareThreadPublication(await f.submission());
    const result = await f.client.publishThread(f.attempt(ready.publication));
    publicationAssert.equal(result.status, "uncertain");
    publicationAssert.equal(
      f.state.requests.some(
        (r) => new URL(r.url).searchParams.get("action") === "edit",
      ),
      false,
    );
  });
await publicationCase("UX60 local refusal is serializable and invalidates older same-context send approval without HTTP", async () => {
  const f = publicationFixture(), submission = await f.submission();
  const ready = await f.client.prepareThreadPublication(submission);
  publicationAssert.equal(ready.kind, "ready");
  const requests = f.state.requests.length;
  const invalid = await f.client.prepareThreadPublication({ ...submission, revision: 4, writing: { ...submission.writing, title: "  ", source: "\n " } });
  publicationAssert.equal(invalid.kind, "validation");
  publicationAssert.deepEqual(invalid.validation, { source: "local", issues: [{ field: "title", code: "required" }, { field: "source", code: "required" }] });
  publicationAssert.deepEqual(JSON.parse(JSON.stringify(invalid)), invalid);
  publicationAssert.equal(f.state.requests.length, requests);
  const refused = await f.client.publishThread(f.attempt(ready.publication));
  publicationAssert.equal(refused.status, "not-sent");
  publicationAssert.equal(f.state.posts.length, 0);
  publicationAssert.equal(f.state.requests.length, requests);
});
await publicationCase("UX60 multiline title is a local field refusal rather than account expiry", async () => {
  const f = publicationFixture(), submission = await f.submission(), requests = f.state.requests.length;
  const invalid = await f.client.prepareThreadPublication({ ...submission, writing: { ...submission.writing, title: "line one\nline two" } });
  publicationAssert.equal(invalid.kind, "validation");
  publicationAssert.deepEqual(invalid.validation, { source: "local", issues: [{ field: "title", code: "single-line" }] });
  publicationAssert.equal(f.state.requests.length, requests);
  publicationAssert.equal(f.state.posts.length, 0);
});
if (publicationFailures.length)
  throw Error(JSON.stringify({ publicationCases }, null, 2));

import frontierAssert from "node:assert/strict";
import {
  URL as FrontierURL,
  URLSearchParams as FrontierParams,
} from "node:url";
import { createForumClient as createFrontierClient } from "@tsdm/forum-client";

// Pre-code failure inventory: docs/implementation/21-native-comparison.md.
// Public package only. Authored forum transport; no private parser/UI imports.
const replyCases = [];
const frontierOrigin = "https://fixture.example";
const frontierActor =
  '<div id="um"><strong><a href="home.php?mod=space&uid=7">Writer 7</a></strong></div>';
const frontierBoard =
  '<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div>';
const frontierEscape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const frontierAttempt = (publication, id) => ({
  id,
  publication,
  status: "pending",
  checked: false,
  message: "",
  candidateURL: null,
  result: null,
});
const frontierRoundTrip = (value) =>
  frontierAssert.deepEqual(JSON.parse(JSON.stringify(value)), value);

{
  const source =
    "[unknown]完整回覆 & literal <tag>[/unknown]\n[quote]Complete source quote[/quote]";
  const state = { posts: [], requests: [] };
  const form = (saved) =>
    frontierActor +
    frontierBoard +
    `<form id="postform" method="post" action="forum.php?mod=post&action=${saved ? "edit&pid=303" : "reply"}&fid=5&tid=42&replysubmit=yes"><input type="hidden" name="formhash" value="AUTHORED-REPLY-SECRET"><input name="subject" value=""><textarea name="message">${frontierEscape(saved?.get("message") ?? "")}</textarea><label><input name="usesig" type="checkbox" value="1" checked>Signature</label><button type="submit" name="replysubmit" value="yes">Reply</button></form>`;
  const client = createFrontierClient({
    origin: frontierOrigin,
    transport: {
      async request(url, request) {
        const target = new FrontierURL(url);
        state.requests.push({ url, method: request?.method ?? "GET" });
        if (request?.method === "POST") {
          state.posts.push(new FrontierParams(request.body));
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body: "<root><![CDATA[<script>succeedhandle_post('forum.php?mod=viewthread&tid=42&pid=303&page=1#pid303','Reply accepted',{});</script>]]></root>",
          };
        }
        const body =
          target.searchParams.get("mod") === "post"
            ? form(
                target.searchParams.get("action") === "edit"
                  ? state.posts.at(-1)
                  : undefined,
              )
            : frontierActor +
              frontierBoard +
              '<div id="postlist"><h1 id="thread_subject">Existing thread</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=8">Other author</a></div><a id="postnum101">1#</a><div class="pcb"><p>Existing body</p></div></div>' +
              (state.posts.length
                ? '<div id="post_303"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum303">2#</a><div class="pcb"><p>Stored reply</p></div></div>'
                : "") +
              "</div>";
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const prepared = await client.prepareReply("5", {
    threadId: "42",
    postId: null,
    author: "",
    authorId: null,
  });
  frontierAssert.equal(prepared.kind, "prepared");
  frontierRoundTrip(prepared);
  const ready = await client.prepareThreadPublication({
    contextId: "portable-reply",
    revision: 1,
    writing: { ...prepared.prepared, source },
  });
  frontierAssert.equal(ready.kind, "ready");
  const saved = await client.publishThread(
    frontierAttempt(ready.publication, "portable-reply-attempt"),
  );
  frontierAssert.equal(saved.status, "confirmed");
  frontierAssert.equal(saved.result.postId, "303");
  frontierAssert.equal(state.posts.length, 1);
  frontierAssert.equal(state.posts[0].get("message"), source);
  frontierAssert.equal(state.posts[0].get("replysubmit"), "yes");
  frontierAssert.equal(state.posts[0].has("topicsubmit"), false);
  frontierAssert.equal(
    state.requests.some(
      ({ url }) =>
        new FrontierURL(url).searchParams.get("action") === "edit" &&
        new FrontierURL(url).searchParams.get("pid") === "303",
    ),
    true,
  );
  const checked = await client.checkThreadResult(
    JSON.parse(JSON.stringify(saved)),
  );
  frontierAssert.equal(checked.status, "confirmed");
  frontierAssert.equal(checked.id, saved.id);
  frontierAssert.equal(state.posts.length, 1);
  frontierRoundTrip(checked);
  frontierAssert.equal(
    JSON.stringify(checked).includes("AUTHORED-REPLY-SECRET"),
    false,
  );
  const readback = await client.readThread(saved.result.url);
  frontierAssert.equal(readback.kind, "thread");
  frontierAssert.equal(
    readback.thread.posts.find((post) => post.id === "303").authorId,
    "7",
  );
  frontierRoundTrip(readback);
  replyCases.push({
    name: "reply-public-prepare-send-source-readback-and-check",
    status: "passed",
    posts: state.posts.length,
    postId: checked.result.postId,
  });
}

{
  const source =
    "[unknown]完整回覆 & literal <tag>[/unknown]\n[quote]Complete source quote[/quote]";
  const state = { posts: [], requests: [], qualify: false };
  const prior = "Complete prior source";
  const merged =
    "Complete prior source\n\n[hr]\n[b]Writer 7 补充了以下内容 (2026-10-22 10:26)[/b]\n" +
    source;
  const form = (saved) =>
    frontierActor +
    frontierBoard +
    `<form id="postform" method="post" action="forum.php?mod=post&action=${saved ? "edit&pid=303" : "reply"}&fid=5&tid=42&replysubmit=yes"><input type="hidden" name="formhash" value="AUTHORED-REPLY-SECRET"><input name="subject" value=""><textarea name="message">${frontierEscape(saved?.get("message") ?? "")}</textarea><label><input name="usesig" type="checkbox" value="1" checked>Signature</label><button type="submit" name="replysubmit" value="yes">Reply</button></form>`;
  const client = createFrontierClient({
    origin: frontierOrigin,
    transport: {
      async request(url, request) {
        const target = new FrontierURL(url);
        state.requests.push({ url, method: request?.method ?? "GET" });
        if (request?.method === "POST") {
          state.posts.push(new FrontierParams(request.body));
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body: "<root><![CDATA[<script>succeedhandle_post('forum.php?mod=viewthread&tid=42&pid=303&page=1#pid303','Reply accepted',{});</script>]]></root>",
          };
        }
        const body =
          target.searchParams.get("mod") === "post"
            ? form(
                target.searchParams.get("action") === "edit"
                  ? new FrontierParams({
                      message: state.posts.length
                        ? state.qualify
                          ? merged
                          : "Unknown merge spelling"
                        : prior,
                    })
                  : undefined,
              )
            : frontierActor +
              frontierBoard +
              '<div id="postlist"><h1 id="thread_subject">Existing thread</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=8">Other author</a></div><a id="postnum101">1#</a><div class="pcb"><p>Existing body</p></div></div>' +
              (prior
                ? '<div id="post_303"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum303">2#</a><div class="pcb"><p>Stored reply</p></div></div>'
                : "") +
              "</div>";
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const prepared = await client.prepareReply("5", {
    threadId: "42",
    postId: null,
    author: "",
    authorId: null,
  });
  frontierAssert.equal(prepared.kind, "prepared");
  frontierRoundTrip(prepared);
  const ready = await client.prepareThreadPublication({
    contextId: "portable-reply",
    revision: 1,
    writing: { ...prepared.prepared, source },
  });
  frontierAssert.equal(ready.kind, "ready");
  const saved = await client.publishThread(
    frontierAttempt(ready.publication, "portable-reply-attempt"),
  );
  frontierAssert.equal(saved.status, "uncertain");
  const immutable = JSON.stringify(saved.publication);
  state.qualify = true;
  frontierAssert.equal(state.posts.length, 1);
  frontierAssert.equal(state.posts[0].get("message"), source);
  frontierAssert.equal(state.posts[0].get("replysubmit"), "yes");
  frontierAssert.equal(state.posts[0].has("topicsubmit"), false);
  frontierAssert.equal(
    state.requests.some(
      ({ url }) =>
        new FrontierURL(url).searchParams.get("action") === "edit" &&
        new FrontierURL(url).searchParams.get("pid") === "303",
    ),
    true,
  );
  const requestStart = state.requests.length;
  const checked = await client.checkThreadResult(
    JSON.parse(JSON.stringify(saved)),
  );
  frontierAssert.equal(checked.status, "confirmed");
  frontierAssert.equal(checked.id, saved.id);
  frontierAssert.equal(JSON.stringify(checked.publication), immutable);
  frontierAssert.equal(checked.replyComparison.before.source, prior);
  frontierAssert.equal(checked.replyComparison.observed.source, merged);
  frontierAssert.equal(
    state.requests.slice(requestStart).every((r) => r.method === "GET"),
    true,
  );
  frontierAssert.equal(state.posts.length, 1);
  frontierRoundTrip(checked);
  frontierAssert.equal(
    JSON.stringify(checked).includes("AUTHORED-REPLY-SECRET"),
    false,
  );
  const readback = await client.readThread(checked.result.url);
  frontierAssert.equal(readback.kind, "thread");
  frontierAssert.equal(
    readback.thread.posts.find((post) => post.id === "303").authorId,
    "7",
  );
  frontierRoundTrip(readback);
  replyCases.push({
    name: "reply-public-native-supplement-read-only-check",
    status: "passed",
    posts: state.posts.length,
    postId: checked.result.postId,
  });
}

import editingAssert from "node:assert/strict";
import { URL as EditingURL, URLSearchParams as EditingParams } from "node:url";
import {
  createForumClient as createEditingClient,
  editBaseline as publicEditBaseline,
} from "@tsdm/forum-client";
const editingOrigin = "https://fixture.example";
const editingThreadURL = editingOrigin + "/forum.php?mod=viewthread&tid=42";
// Public clean-consumer acceptance seam, no private implementation imports.
// Failure inventory before contract update: a stale action union/missing edit
// methods could pass runtime packaging; source/metadata loss, wrong saved actor,
// missed conflicts or a repeated original attempt must not be accepted.
const editingCases = [];
{
  const state = {
    source: "[unknown]Complete editable source[/unknown] [attach]77[/attach]",
    description: "Existing reference",
    posts: [],
    reads: [],
  };
  const initial = state.source;
  const actor =
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Writer 7</a></strong></div>';
  const board =
    '<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div>';
  const escaped = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  const client = createEditingClient({
    origin: editingOrigin,
    transport: {
      async request(url, options) {
        const target = new EditingURL(url);
        if (options?.method === "POST") {
          const form = new EditingParams(options.body);
          state.posts.push(form);
          state.source = form.get("message");
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body: "<root><![CDATA[<script>succeedhandle_post('forum.php?mod=viewthread&tid=42&pid=101','Saved',{});</script>]]></root>",
          };
        }
        state.reads.push(url);
        const body =
          actor +
          board +
          (target.searchParams.get("action") === "edit"
            ? `<form id="postform" method="post" action="forum.php?mod=post&action=edit&fid=5&tid=42&pid=101&editsubmit=yes"><input type="hidden" name="formhash" value="AUTHORED-EDIT-SECRET"><input name="subject" value="Owned thread"><textarea name="message">${escaped(state.source)}</textarea><input name="price" value="3" disabled><select name="readperm" disabled><option value="10" selected>Members</option></select><input type="hidden" name="attachnew[77][description]" value="${escaped(state.description)}"><button type="submit" name="editsubmit" value="yes">Save</button></form>`
            : '<div id="postlist"><h1 id="thread_subject">Owned thread</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum101"><em>1</em>#</a><div class="pcb">Rendered body differs from complete source</div></div></div>');
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const prepared = await client.preparePostEdit(editingThreadURL, "101");
  editingAssert.equal(prepared.kind, "prepared");
  editingAssert.equal(prepared.prepared.source, initial);
  editingAssert.equal(prepared.prepared.action, "edit-post");
  const snapshot = publicEditBaseline(prepared.prepared);
  editingAssert.deepEqual(snapshot, prepared.prepared.editTarget.baseline);
  snapshot.source = "mutated consumer copy";
  editingAssert.equal(prepared.prepared.source, initial);
  editingAssert.equal(prepared.prepared.editTarget.postId, "101");
  editingAssert.deepEqual(prepared.prepared.uploadedReferences, ["77"]);
  const submission = {
    contextId: "portable-edit",
    revision: 2,
    writing: { ...prepared.prepared, source: initial + " local" },
  };
  state.source = initial + " server";
  const conflict = await client.prepareEditPublication(submission);
  editingAssert.equal(conflict.kind, "conflict");
  editingAssert.equal(conflict.latest.source, state.source);
  editingAssert.equal(state.posts.length, 0);
  submission.writing.editTarget = conflict.latest.editTarget;
  const ready = await client.prepareEditPublication(submission);
  editingAssert.equal(ready.kind, "ready");
  const attempt = {
    id: "portable-edit-attempt",
    publication: ready.publication,
    status: "pending",
    checked: false,
    message: "",
    candidateURL: null,
    result: null,
  };
  const saved = await client.savePostEdit(attempt);
  editingAssert.equal(saved.status, "confirmed");
  editingAssert.equal(saved.result.postId, "101");
  editingAssert.equal(saved.result.verification.stored, "verified");
  editingAssert.equal(state.posts.length, 1);
  editingAssert.equal(state.posts[0].get("message"), initial + " local");
  editingAssert.equal(state.posts[0].get("editsubmit"), "yes");
  editingAssert.equal(state.posts[0].has("topicsubmit"), false);
  editingAssert.equal(state.posts[0].has("price"), false);
  editingAssert.equal(
    state.posts[0].get("attachnew[77][description]"),
    "Existing reference",
  );
  const checked = await client.checkEditResult(
    JSON.parse(JSON.stringify(saved)),
  );
  editingAssert.equal(checked.status, "confirmed");
  editingAssert.equal(state.posts.length, 1);
  editingAssert.equal(
    JSON.stringify(checked).includes("AUTHORED-EDIT-SECRET"),
    false,
  );
  state.description = "Changed after save";
  const changed = await client.checkEditResult(saved);
  editingAssert.equal(changed.status, "confirmed");
  editingAssert.deepEqual(changed.result, saved.result);
  editingAssert.deepEqual(changed.publication, saved.publication);
  editingAssert.match(changed.message, /Previous stored confirmation retained/);
  editingAssert.match(changed.message, /unavailable or differ/);
  editingAssert.equal(state.posts.length, 1);
  editingCases.push({
    name: "owned-edit-complete-source-conflict-save-independent-readback-and-reference-change",
    status: "passed",
    posts: 1,
    postId: "101",
  });
}

import draftAssert from "node:assert/strict";
import { URL as DraftURL, URLSearchParams as DraftParams } from "node:url";
import { createForumClient as createDraftClient } from "@tsdm/forum-client";
const escapeDraft = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
// Clean packaged-client E2E. Failures: browser-only import, crossed operation,
// wrong actor, duplicate save, source mismatch and false publication while listed.
// Only the external forum transport is substituted; calls use public exports.
const draftCases = [];
for (const funded of [false, true]) {
  const draftOrigin = "https://fixture.example";
  const draftList =
    draftOrigin +
    "/home.php?mod=space&do=thread&view=me&type=thread&filter=save";
  const draftState = {
    saved: null,
    published: false,
    posts: [],
    requests: [],
    uploads: [],
  };
  const draftActor =
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Writer 7</a></strong></div>';
  const packetFields =
    '<div class="hb-postbox"><div class="hb-row"><label>總金額</label><input type="number" name="hb_total" min="1" step="1" value="20"></div><div class="hb-row"><label>份數</label><input type="number" name="hb_shares" min="1" max="100" step="1" value="2"><span class="hb-hint">最多 100 份;每份至少 10</span></div><label><input type="radio" name="hb_split" value="1" checked>拼手氣</label><label><input type="radio" name="hb_split" value="2">均分</label><label><input type="checkbox" name="hb_cond" value="1">必須回帖後才能搶</label><input name="hb_password" type="text" maxlength="64"><input name="hb_appoint" type="text" placeholder="會員名,可多個(逗號分隔)"><select name="hb_expire"><option value="6" selected>6 小時</option></select><input type="text" name="hb_blessing" maxlength="50" value="Authored greeting"><div class="hb-hint">紅包金額在扣款成功後才鎖定;發表後不可補塞、不可加碼。</div></div>';
  const draftForm = (edit) =>
    `${draftActor}<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div><form id="postform" method="post" action="forum.php?mod=post&action=${edit ? "edit&tid=42&pid=101&editsubmit=yes" : "newthread&topicsubmit=yes"}&fid=5"><input type="hidden" name="formhash" value="AUTHORED-TOKEN"><input type="hidden" name="save" id="postsave" value=""><input name="subject" value="${escapeDraft(edit ? (draftState.saved?.get("subject") ?? "") : "Portable draft")}"><textarea name="message">${escapeDraft(edit ? (draftState.saved?.get("message") ?? "") : "Complete portable source")}</textarea>${funded && !edit ? packetFields : ""}<input name="price" value="0"><button name="${edit ? "editsubmit" : "topicsubmit"}" value="true">Publish</button><button type="button" onclick="$('postsave').value=1;$('postsubmit').click();">Save</button></form>`;
  const draftClient = createDraftClient({
    origin: draftOrigin,
    transport: {
      async upload(url, fields, file) {
        draftState.uploads.push({ url, fields, name: file.name });
        throw new Error("This fixture supplies no native upload policy");
      },
      async request(url, request) {
        draftState.requests.push({ url, method: request?.method ?? "GET" });
        const target = new DraftURL(url);
        let body;
        if (request?.method === "POST") {
          const saved = new DraftParams(request.body);
          draftState.posts.push(saved);
          draftState.saved = saved;
          draftState.published = saved.get("save") !== "1";
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body: "<root><![CDATA[<script>succeedhandle_post('forum.php?mod=viewthread&tid=42','Stored',{});</script>]]></root>",
          };
        }
        if (target.pathname === "/plugin.php")
          return {
            status: 200,
            url,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              tid: 42,
              state: "open",
              cond: 0,
              haspw: 0,
              appoint: 0,
              splitmode: 1,
            }),
          };
        if (target.searchParams.get("ac") === "credit")
          return {
            status: 503,
            url,
            contentType: "text/plain",
            body: "Unavailable",
          };
        if (target.pathname === "/home.php")
          body = `${draftActor}<a class="a" href="${draftList}">草稿箱</a><form id="delform"><table><tbody>${draftState.saved && !draftState.published ? '<tr><th><a href="forum.php?mod=viewthread&tid=42">Portable draft</a></th><td><a href="forum.php?mod=forumdisplay&fid=5">Music</a></td></tr>' : '<tr><td><p class="emp">还没有相关的帖子</p></td></tr>'}</tbody></table></form>`;
        else if (target.searchParams.get("mod") === "post")
          body = draftForm(target.searchParams.get("action") === "edit");
        else
          body = `${draftActor}<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div><div id="postlist"><h1><span id="thread_subject">Portable draft</span>${draftState.published ? "" : '<span class="xg1">(草稿)</span>'}</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum101">1#</a><div class="pcb"><p>Stored portable body</p>${funded ? '<div class="hb-entry" data-tid="42">Packet</div>' : ""}</div><div class="po"><div class="pob">${draftState.published ? "" : '<a class="psave" href="forum.php?mod=misc&action=pubsave&tid=42">Publish</a>'}</div></div></div></div>`;
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const preparedDraft = await draftClient.prepareNewThread("5", funded);
  draftAssert.equal(preparedDraft.kind, "prepared");
  const draftAttempt = {
    id: "portable-save",
    generation: draftClient.generation,
    submission: {
      contextId: "portable-draft-context",
      revision: 1,
      writing: preparedDraft.prepared,
    },
    fundingReviewed: funded,
    status: "pending",
    message: "",
    result: null,
  };
  if (funded) {
    draftAssert.ok(preparedDraft.prepared.redPacket);
    const refused = await draftClient.prepareDraftSave({
      ...draftAttempt,
      fundingReviewed: false,
    });
    draftAssert.equal(refused.status, "not-sent");
    draftAssert.equal(draftState.posts.length, 0);
    draftAssert.equal(
      (await draftClient.saveDraft(refused)).status,
      "not-sent",
    );
    draftAssert.equal(draftState.posts.length, 0);
  }
  const supersededSave = await draftClient.prepareDraftSave({
    ...draftAttempt,
    id: "superseded-draft-save",
  });
  const preparedSave = await draftClient.prepareDraftSave(draftAttempt);
  draftAssert.equal(
    (await draftClient.saveDraft(supersededSave)).status,
    "not-sent",
    "A newer preparation invalidates the older same-context command",
  );
  draftAssert.equal(draftState.posts.length, 0);
  const savedDraft = await draftClient.saveDraft(preparedSave);
  draftAssert.equal(savedDraft.status, "confirmed");
  draftAssert.equal(savedDraft.result.threadId, "42");
  draftAssert.equal(draftState.published, false);
  draftAssert.equal(
    (await draftClient.saveDraft(draftAttempt)).status,
    "not-sent",
  );
  draftAssert.equal(draftState.posts.length, 1);
  const draftListing = await draftClient.readDrafts();
  draftAssert.equal(draftListing.kind, "drafts");
  const resumedDraft = await draftClient.resumeDraft(
    draftListing.drafts.rows[0],
    draftListing.account,
  );
  draftAssert.equal(resumedDraft.kind, "prepared");
  draftAssert.equal(resumedDraft.prepared.source, "Complete portable source");
  const beforeDraftAttachmentCalls = draftState.requests.length;
  const draftUpload = await draftClient.uploadAttachment(
    resumedDraft.prepared,
    { name: "note.txt", type: "text/plain", bytes: new Uint8Array([65]) },
    () => {},
    { aborted: false, addEventListener() {}, removeEventListener() {} },
  );
  draftAssert.equal(draftUpload.kind, "not-sent");
  draftAssert.equal(
    draftState.requests.length,
    beforeDraftAttachmentCalls + 1,
    "Draft upload reads the owned native draft form before refusing absent policy",
  );
  const uploadForm = new DraftURL(draftState.requests.at(-1).url);
  draftAssert.equal(uploadForm.searchParams.get("action"), "edit");
  draftAssert.equal(uploadForm.searchParams.get("tid"), "42");
  draftAssert.equal(uploadForm.searchParams.get("pid"), "101");
  draftAssert.equal(uploadForm.searchParams.has("tsdmapp"), false);
  const draftRemoval = await draftClient.removeUploadedAttachment(
    {
      ...resumedDraft.prepared,
      uploads: [
        {
          key: "existing:88",
          name: "Attachment 88",
          type: "",
          size: 0,
          loaded: 0,
          status: "associated",
          serverId: "88",
          message: "",
        },
      ],
    },
    "88",
  );
  draftAssert.equal(draftRemoval.kind, "not-sent");
  draftAssert.ok(
    draftState.requests.slice(beforeDraftAttachmentCalls).every(({ url }) => {
      const target = new DraftURL(url);
      return (
        target.searchParams.get("action") === "attachlist" ||
        (target.searchParams.get("action") === "edit" &&
          target.searchParams.get("tid") === "42" &&
          target.searchParams.get("pid") === "101")
      );
    }),
    "Missing file evidence permits only owned draft form and attachment-list reads, never deletion",
  );
  draftAssert.deepEqual(draftState.uploads, []);

  const invalidCreation = await draftClient.prepareThreadPublication({
    contextId: "portable-draft-context",
    revision: 2,
    writing: resumedDraft.prepared,
  });
  draftAssert.equal(
    invalidCreation.kind,
    "validation",
    "Known draft must not be submitted as a new thread",
  );
  const publicationDraft = {
    ...draftAttempt,
    id: "portable-publish",
    operation: "publish",
    generation: draftClient.generation,
    submission: {
      ...draftAttempt.submission,
      revision: 2,
      writing: resumedDraft.prepared,
    },
  };
  draftAssert.equal(
    (await draftClient.saveDraft(publicationDraft)).status,
    "not-sent",
    "Publication command cannot be repurposed into save",
  );
  const publishedDraft = await draftClient.publishDraft(publicationDraft);
  draftAssert.equal(publishedDraft.status, "published");
  draftAssert.equal(
    publishedDraft.publishedURL,
    draftOrigin + "/forum.php?mod=viewthread&tid=42#pid101",
  );
  draftAssert.equal(draftState.posts.length, 2);
  draftAssert.equal(draftState.posts[1].get("save"), "");
  draftAssert.equal((await draftClient.readDrafts()).drafts.rows.length, 0);
  draftAssert.equal(
    JSON.parse(JSON.stringify(publishedDraft)).submission.writing.source,
    "Complete portable source",
  );
  // A retained or external caller-supplied URL must not redirect readback
  // away from the configured forum or contaminate the confirmed result URL.
  const requestsBeforeCheck = draftState.requests.length;
  const alteredURLAttempt = JSON.parse(JSON.stringify(publicationDraft));
  alteredURLAttempt.submission.writing.draft.url =
    "https://untrusted.example/forum.php?mod=viewthread&tid=42";
  const checkedURL = await draftClient.checkDraft(alteredURLAttempt);
  draftAssert.equal(checkedURL.status, "published");
  draftAssert.equal(
    checkedURL.publishedURL,
    draftOrigin + "/forum.php?mod=viewthread&tid=42#pid101",
    "Publication checks derive their result from the configured forum and numeric identity",
  );
  draftAssert.ok(
    draftState.requests
      .slice(requestsBeforeCheck)
      .every(({ url }) => new DraftURL(url).origin === draftOrigin),
    "Publication checks never request an external retained URL",
  );
  if (funded) {
    draftAssert.equal(
      draftState.posts.filter((p) => p.has("hb_total")).length,
      1,
    );
    draftAssert.equal(draftState.posts[0].get("hb_total"), "20");
    draftAssert.equal(draftState.posts[1].has("hb_total"), false);
    draftAssert.equal(savedDraft.redPacket.credit, "unknown");
  }
  draftCases.push({
    name: `packaged-client ${funded ? "funded" : "ordinary"} same-record save/resume/publication and operation isolation`,
    status: "passed",
    requests: draftState.requests,
    posts: draftState.posts.length,
  });
}

import favoriteAssert from "node:assert/strict";
import { URL as FavoriteURL } from "node:url";
import { randomUUID as favoriteAttemptId } from "node:crypto";
import { createForumClient as createFavoriteClient } from "@tsdm/forum-client";
const favoriteCases = [];
{
  const favoriteOrigin = "https://fixture.example";
  const favoriteTarget = favoriteOrigin + "/forum.php?mod=viewthread&tid=42";
  const favoriteAccount =
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Reader</a></strong></div>';
  const favoriteThread =
    favoriteAccount +
    '<div id="postlist"><h1 id="thread_subject">Portable favorite target</h1><div id="post_101"><div class="authi">Writer</div><a id="postnum101" href="' +
    favoriteTarget +
    '#pid101">1</a><div class="pcb"><p>Retained target.</p></div><div id="p_btn"><a id="k_favorite" href="home.php?mod=spacecp&ac=favorite&type=thread&id=42&formhash=SYNTHETIC_PUBLIC_FORM_TOKEN">收藏</a></div></div></div>';
  let present = false,
    writes = 0,
    lost = false;
  const transport = {
    async request(url) {
      const parsed = new FavoriteURL(url);
      if (parsed.searchParams.get("ac") === "favorite") {
        writes++;
        present = true;
        if (lost) throw new TypeError("Synthetic lost response");
        return {
          url,
          status: 200,
          contentType: "text/xml",
          body: "<root><![CDATA[untrusted acknowledgement]]></root>",
        };
      }
      const document =
        parsed.searchParams.get("do") === "favorite"
          ? favoriteAccount +
            '<div id="ct">' +
            (present
              ? '<ul id="favorite_ul"><li id="fav_942"><a href="home.php?mod=spacecp&ac=favorite&op=delete&favid=942">删除</a><input name="favorite[]" type="checkbox" value="942" vid="42"><a href="forum.php?mod=viewthread&tid=42">Portable favorite target</a><span class="xg1">2026-10-22</span></li></ul>'
              : '<p class="emp">您还没有添加任何收藏</p>') +
            "</div>"
          : favoriteThread;
      return {
        url,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ uid: 7, document }),
      };
    },
  };
  const favoriteClient = createFavoriteClient({
    origin: favoriteOrigin,
    transport,
  });
  await favoriteClient.readPage(favoriteTarget);
  const intent = {
    action: "add",
    kind: "thread",
    targetId: "42",
    recordId: null,
    accountId: "7",
  };
  const prepared = await favoriteClient.prepareFavorite(intent);
  favoriteAssert.equal(prepared.kind, "ready");
  favoriteAssert.equal(writes, 0);
  favoriteAssert.equal(
    JSON.stringify(prepared).includes("SYNTHETIC_PUBLIC_FORM_TOKEN"),
    false,
  );
  const attempt = {
    id: favoriteAttemptId(),
    command: prepared.command,
    status: "pending",
    checked: false,
    message: "",
    pages: null,
  };
  const altered = JSON.parse(JSON.stringify(attempt));
  altered.command.intent.targetId = "43";
  favoriteAssert.equal(
    (await favoriteClient.changeFavorite(altered)).status,
    "not-sent",
  );
  favoriteAssert.equal(writes, 0);
  favoriteCases.push("altered-preparation-refused");
  const confirmed = await favoriteClient.changeFavorite(attempt);
  favoriteAssert.equal(confirmed.status, "confirmed");
  favoriteAssert.equal(confirmed.pages[0].records[0].id, "942");
  favoriteAssert.equal(confirmed.pages[0].records[0].targetId, "42");
  favoriteAssert.equal(writes, 1);
  favoriteAssert.deepEqual(JSON.parse(JSON.stringify(confirmed)), confirmed);
  favoriteAssert.equal(
    JSON.stringify(confirmed).includes("SYNTHETIC_PUBLIC_FORM_TOKEN"),
    false,
  );
  favoriteCases.push("native-add-independent-presence");
  favoriteAssert.equal(
    (await favoriteClient.changeFavorite(attempt)).status,
    "not-sent",
  );
  favoriteAssert.equal(writes, 1);
  favoriteCases.push("used-attempt-refused");
  present = false;
  lost = true;
  const next = await favoriteClient.prepareFavorite(intent);
  favoriteAssert.equal(next.kind, "ready");
  const unknown = await favoriteClient.changeFavorite({
    ...attempt,
    id: favoriteAttemptId(),
    command: next.command,
  });
  favoriteAssert.equal(unknown.status, "uncertain");
  favoriteAssert.equal(writes, 2);
  favoriteAssert.equal(
    (await favoriteClient.prepareFavorite(intent)).kind,
    "unavailable",
  );
  favoriteCases.push("uncertain-attempt-blocks-unwarned-resend");
  const freshClient = createFavoriteClient({
    origin: favoriteOrigin,
    transport,
  });
  const checked = await freshClient.checkFavoriteResult(
    JSON.parse(JSON.stringify(unknown)),
  );
  favoriteAssert.equal(checked.status, "confirmed");
  favoriteAssert.equal(checked.id, unknown.id);
  favoriteAssert.equal(writes, 2);
  favoriteAssert.equal(typeof globalThis.document, "undefined");
  favoriteAssert.equal(typeof globalThis.GM, "undefined");
  favoriteCases.push("fresh-client-check-no-replay");
}

// Public preparation authority must survive concurrent reads and later uncertainty.
// Failure inventory: repair30-failure-inventory.md in the retained task evidence.
async function favoriteRaceFixture() {
  const origin = "https://fixture.example";
  const member =
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Reader</a></strong></div>';
  const state = { writes: [], present: new Set(), lost: true, hold: null };
  const transport = {
    async request(url) {
      const parsed = new FavoriteURL(url);
      const targetId = parsed.searchParams.get("tid") ?? "42";
      if (parsed.searchParams.get("ac") === "favorite") {
        const target = parsed.searchParams.get("id");
        state.writes.push(target);
        if (state.lost) throw new TypeError("Synthetic unestablished effect");
        state.present.add(target);
        return {
          url,
          status: 200,
          contentType: "text/xml",
          body: "<root><![CDATA[acknowledgement]]></root>",
        };
      }
      const list = parsed.searchParams.get("do") === "favorite";
      if (state.hold?.kind === (list ? "list" : "target")) {
        const hold = state.hold;
        state.hold = null;
        hold.enter();
        await hold.promise;
      }
      const rows = [...state.present]
        .map(
          (id) =>
            `<li id="fav_9${id}"><a href="home.php?mod=spacecp&ac=favorite&op=delete&favid=9${id}">删除</a><input name="favorite[]" type="checkbox" value="9${id}" vid="${id}"><a href="forum.php?mod=viewthread&tid=${id}">Target ${id}</a><span class="xg1">2026-10-24</span></li>`,
        )
        .join("");
      const document =
        member +
        (list
          ? `<div id="ct">${rows ? `<ul id="favorite_ul">${rows}</ul>` : '<p class="emp">您还没有添加任何收藏</p>'}</div>`
          : `<div id="postlist"><h1 id="thread_subject">Target ${targetId}</h1><div id="post_101"><div class="authi">Writer</div><a id="postnum101" href="forum.php?mod=viewthread&tid=${targetId}#pid101">1</a><div class="pcb"><p>Retained target.</p></div><div id="p_btn"><a id="k_favorite" href="home.php?mod=spacecp&ac=favorite&type=thread&id=${targetId}&formhash=SYNTHETIC_PUBLIC_FORM_TOKEN">收藏</a></div></div></div>`);
      return {
        url,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ uid: 7, document }),
      };
    },
  };
  const client = createFavoriteClient({ origin, transport });
  await client.readPage(`${origin}/forum.php?mod=viewthread&tid=42`);
  const intent = {
    action: "add",
    kind: "thread",
    targetId: "42",
    recordId: null,
    accountId: "7",
  };
  const attempt = (prepared) => ({
    id: favoriteAttemptId(),
    command: prepared.command,
    status: "pending",
    checked: false,
    message: "",
    pages: null,
  });
  function hold(kind) {
    let release, enter;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    state.hold = { kind, promise, enter };
    return { entered, release };
  }
  return { client, origin, transport, state, intent, attempt, hold };
}
const favoriteRaceFailures = [];
async function favoriteRaceCase(name, run) {
  try {
    await run();
    favoriteCases.push(name);
  } catch (error) {
    favoriteRaceFailures.push({ name, message: error.message });
  }
}
await favoriteRaceCase(
  "stale-preparation-cannot-bypass-uncertainty",
  async () => {
    const f = await favoriteRaceFixture();
    const first = await f.client.prepareFavorite(f.intent);
    const second = await f.client.prepareFavorite(f.intent);
    favoriteAssert.equal(first.kind, "ready");
    favoriteAssert.equal(second.kind, "ready");
    const unknown = await f.client.changeFavorite(f.attempt(first));
    favoriteAssert.equal(unknown.status, "uncertain");
    favoriteAssert.equal(unknown.checked, false);
    const stale = await f.client.changeFavorite(f.attempt(second));
    favoriteAssert.equal(stale.status, "not-sent");
    favoriteAssert.deepEqual(f.state.writes, ["42"]);
  },
);
await favoriteRaceCase(
  "retry-authority-excludes-newer-uncertainty",
  async () => {
    const f = await favoriteRaceFixture();
    const first = await f.client.changeFavorite(
      f.attempt(await f.client.prepareFavorite(f.intent)),
    );
    const original = JSON.stringify(first);
    const checked = await f.client.checkFavoriteResult(first);
    favoriteAssert.equal(checked.status, "uncertain");
    favoriteAssert.equal(checked.checked, true);
    const next = await f.client.prepareFavorite(f.intent, first.id);
    const stale = await f.client.prepareFavorite(f.intent, first.id);
    favoriteAssert.equal(next.kind, "ready");
    favoriteAssert.equal(stale.kind, "ready");
    const newer = await f.client.changeFavorite(f.attempt(next));
    favoriteAssert.equal(newer.status, "uncertain");
    favoriteAssert.equal(newer.checked, false);
    favoriteAssert.equal(
      (await f.client.prepareFavorite(f.intent, first.id)).kind,
      "unavailable",
    );
    await f.client.checkFavoriteResult(newer);
    favoriteAssert.equal(
      (await f.client.changeFavorite(f.attempt(stale))).status,
      "not-sent",
    );
    favoriteAssert.deepEqual(f.state.writes, ["42", "42"]);
    const fresh = await f.client.prepareFavorite(f.intent, newer.id);
    favoriteAssert.equal(fresh.kind, "ready");
    favoriteAssert.deepEqual(Object.keys(fresh.command).sort(), [
      "generation",
      "id",
      "intent",
    ]);
    f.state.lost = false;
    favoriteAssert.equal(
      (await f.client.changeFavorite(f.attempt(fresh))).status,
      "confirmed",
    );
    favoriteAssert.deepEqual(f.state.writes, ["42", "42", "42"]);
    favoriteAssert.equal(JSON.stringify(first), original);
    favoriteAssert.equal(first.status, "uncertain");
    favoriteAssert.equal(newer.status, "uncertain");
  },
);
await favoriteRaceCase(
  "preparation-await-does-not-import-resend-authority",
  async () => {
    const f = await favoriteRaceFixture();
    const first = await f.client.prepareFavorite(f.intent);
    const hold = f.hold("list");
    const preparing = f.client.prepareFavorite(f.intent);
    await hold.entered;
    const unknown = await f.client.changeFavorite(f.attempt(first));
    favoriteAssert.equal(unknown.status, "uncertain");
    hold.release();
    const late = await preparing;
    favoriteAssert.equal(late.kind, "unavailable");
    favoriteAssert.deepEqual(f.state.writes, ["42"]);
  },
);
await favoriteRaceCase(
  "execution-await-rechecks-imported-uncertainty",
  async () => {
    const f = await favoriteRaceFixture();
    const ready = await f.client.prepareFavorite(f.intent);
    const other = createFavoriteClient({
      origin: f.origin,
      transport: f.transport,
    });
    await other.readPage(`${f.origin}/forum.php?mod=viewthread&tid=42`);
    const unknown = await other.changeFavorite(
      f.attempt(await other.prepareFavorite(f.intent)),
    );
    const hold = f.hold("target");
    const sending = f.client.changeFavorite(f.attempt(ready));
    await hold.entered;
    const recovered = await f.client.checkFavoriteResult(unknown);
    favoriteAssert.equal(recovered.status, "uncertain");
    favoriteAssert.equal(recovered.checked, true);
    hold.release();
    favoriteAssert.equal((await sending).status, "not-sent");
    favoriteAssert.deepEqual(f.state.writes, ["42"]);
  },
);
await favoriteRaceCase(
  "unrelated-target-retains-preparation-authority",
  async () => {
    const f = await favoriteRaceFixture();
    const unknown = await f.client.changeFavorite(
      f.attempt(await f.client.prepareFavorite(f.intent)),
    );
    favoriteAssert.equal(unknown.status, "uncertain");
    const unrelated = await f.client.prepareFavorite({
      ...f.intent,
      targetId: "43",
    });
    favoriteAssert.equal(unrelated.kind, "ready");
    f.state.lost = false;
    const result = await f.client.changeFavorite(f.attempt(unrelated));
    favoriteAssert.equal(result.status, "confirmed");
    favoriteAssert.deepEqual(f.state.writes, ["42", "43"]);
  },
);
favoriteAssert.deepEqual(
  favoriteRaceFailures,
  [],
  JSON.stringify(favoriteRaceFailures),
);

import packetAssert from "node:assert/strict";
import { URL as PacketURL, URLSearchParams as PacketParams } from "node:url";
import { createForumClient as createPacketClient } from "@tsdm/forum-client";
// Failure inventory: docs/implementation/34-consumer.md. Only authored external
// transport is substituted. Package consent and outcome contracts, not UI state.
const packetCases = [];
const packetRoundTrip = (value) =>
  packetAssert.deepEqual(JSON.parse(JSON.stringify(value)), value);
for (const mode of ["direct", "funded-draft"]) {
  const packetOrigin = "https://fixture.example";
  const packetThread = packetOrigin + "/forum.php?mod=viewthread&tid=42";
  const packetList =
    packetOrigin +
    "/home.php?mod=space&do=thread&view=me&type=thread&filter=save";
  const state = {
    saved: null,
    funded: false,
    published: false,
    posts: [],
    reads: [],
  };
  const actor =
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Writer 7</a></strong></div>';
  const board =
    '<div id="pt"><a href="forum.php?mod=forumdisplay&fid=5">Music</a></div>';
  const escape = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  const controls = `<div class="hb-postbox">
<div class="hb-row"><label>總金額</label><input type="number" name="hb_total" min="1" step="1"></div>
<div class="hb-row"><label>份數</label><input type="number" name="hb_shares" min="1" max="100" step="1" value="1"><span class="hb-hint">最多 100 份;每份至少 10</span></div>
<label><input type="radio" name="hb_split" value="1" checked>拼手氣</label><label><input type="radio" name="hb_split" value="2">均分</label>
<label><input type="checkbox" name="hb_cond" value="1">必須回帖後才能搶</label>
<input name="hb_password" type="text" maxlength="64"><input name="hb_appoint" type="text" placeholder="會員名,可多個(逗號分隔)">
<select name="hb_expire"><option value="1">1 小時</option><option value="6">6 小時</option><option value="24" selected>1 天</option><option value="0">不自動到期</option></select>
<input type="text" name="hb_blessing" maxlength="50" value="恭喜發財,大吉大利">
<div class="hb-hint">紅包金額在扣款成功後才鎖定;發表後不可補塞、不可加碼。</div></div>`;
  const form = (edit) =>
    `${actor}${board}<form id="postform" method="post" action="forum.php?mod=post&action=${edit ? "edit&tid=42&pid=101&editsubmit=yes" : "newthread&topicsubmit=yes"}&fid=5"><input type="hidden" name="formhash" value="AUTHORED-PACKET-SECRET"><input type="hidden" name="save" id="postsave" value=""><input name="subject" value="Portable packet"><textarea name="message">${escape(edit ? state.saved.get("message") : "")}</textarea><input name="price" value="0">${edit ? "" : controls}<button name="${edit ? "editsubmit" : "topicsubmit"}" type="submit" value="yes">Publish</button><button type="button" onclick="$('postsave').value=1;$('postsubmit').click();">Save</button></form>`;
  const client = createPacketClient({
    origin: packetOrigin,
    transport: {
      async request(url, options) {
        const target = new PacketURL(url);
        if (options?.method === "POST") {
          const submitted = new PacketParams(options.body);
          state.posts.push(submitted);
          if (submitted.has("hb_total")) state.funded = true;
          state.saved = submitted;
          state.published = submitted.get("save") !== "1";
          return {
            status: 200,
            url,
            contentType: "text/xml",
            body: `<root><![CDATA[<script>succeedhandle_post('${packetThread}','Stored',{});</script>]]></root>`,
          };
        }
        state.reads.push(url);
        if (target.pathname === "/plugin.php")
          return {
            status: 200,
            url,
            contentType: "application/json",
            body: JSON.stringify(
              state.funded
                ? {
                    ok: true,
                    tid: 42,
                    state: "open",
                    cond: 0,
                    haspw: 0,
                    appoint: 0,
                    splitmode: 1,
                    bless: "Portable wishes",
                  }
                : { ok: false, error: "這裡沒有紅包" },
            ),
          };
        if (target.searchParams.get("ac") === "credit")
          return {
            status: 200,
            url,
            contentType: "text/html",
            body: `${actor}<table class="dt"><tr><th>操作</th><th>积分变更</th><th>变更后</th><th>详情</th><th>变更时间</th></tr>${state.funded ? '<tr><td><a href="home.php?mod=spacecp&ac=credit&op=log&optype=HBS">HBS</a></td><td>天使币 -20</td><td>Unattributed</td><td>Synthetic funding</td><td>2026-10-24 12:00</td></tr>' : ""}</table>`,
          };
        let body;
        if (target.pathname === "/home.php")
          body = `${actor}<a class="a" href="${packetList}">草稿箱</a><form id="delform"><table><tbody>${state.saved && !state.published ? '<tr><th><a href="forum.php?mod=viewthread&tid=42">Portable packet</a></th><td><a href="forum.php?mod=forumdisplay&fid=5">Music</a></td></tr>' : '<tr><td><p class="emp">还没有相关的帖子</p></td></tr>'}</tbody></table></form>`;
        else if (target.searchParams.get("mod") === "post")
          body = form(target.searchParams.get("action") === "edit");
        else
          body = `${actor}${board}<div id="postlist"><h1><span id="thread_subject">Portable packet</span>${state.published ? "" : '<span class="xg1">(草稿)</span>'}</h1><div id="post_101"><div class="authi"><a href="home.php?mod=space&uid=7">Writer 7</a></div><a id="postnum101">1#</a><div class="pcb">Stored body<div class="hb-entry" data-tid="42">Packet</div></div><div class="po"><div class="pob">${state.published ? "" : '<a class="psave" href="forum.php?mod=misc&action=pubsave&tid=42">Publish</a>'}</div></div></div></div>`;
        return { status: 200, url, contentType: "text/html", body };
      },
    },
  });
  const prepared = await client.prepareNewThread("5", true);
  packetAssert.equal(prepared.kind, "prepared");
  packetAssert.ok(prepared.prepared.redPacket);
  const rawSource = "[unknown]完整 raw packet source & <literal>[/unknown]";
  const values = {
    hb_total: "20",
    hb_shares: "1",
    hb_blessing: "Portable wishes",
  };
  const writing = {
    ...prepared.prepared,
    title: "Portable packet",
    source: rawSource,
    options: prepared.prepared.options.map((option) => ({
      ...option,
      value: values[option.name] ?? option.value,
    })),
  };
  packetRoundTrip(writing);
  let final;
  if (mode === "direct") {
    const reviewed = await client.prepareThreadPublication({
      contextId: "portable-packet-direct",
      revision: 1,
      writing,
    });
    packetAssert.equal(reviewed.kind, "ready");
    final = await client.publishThread({
      id: "portable-packet-direct-attempt",
      publication: reviewed.publication,
      status: "pending",
      checked: false,
      message: "",
      candidateURL: null,
      result: null,
    });
    packetAssert.equal(final.status, "confirmed");
    const before = state.posts.length;
    const checked = await client.checkThreadResult(
      JSON.parse(JSON.stringify(final)),
    );
    packetAssert.equal(checked.status, "confirmed");
    packetAssert.equal(state.posts.length, before);
    packetRoundTrip(checked);
  } else {
    const initial = {
      id: "portable-funded-save",
      generation: client.generation,
      submission: {
        contextId: "portable-funded-context",
        revision: 1,
        writing,
      },
      status: "pending",
      message: "",
      result: null,
    };
    const refused = await client.prepareDraftSave(initial);
    packetAssert.equal(
      refused.status,
      "not-sent",
      "Headless funded Save requires explicit immediate-funding consent",
    );
    packetAssert.equal(state.posts.length, 0);
    const ready = await client.prepareDraftSave({
      ...initial,
      fundingReviewed: true,
    });
    const saved = await client.saveDraft(ready);
    packetAssert.equal(saved.status, "confirmed");
    packetAssert.equal(saved.result.threadId, "42");
    packetAssert.equal(saved.observation.packetMarker, true);
    packetAssert.equal(saved.redPacket.state, "open");
    packetAssert.equal(saved.redPacket.credit, "unknown");
    packetAssert.equal(state.published, false);
    packetRoundTrip(saved);
    const listing = await client.readDrafts();
    packetAssert.equal(listing.kind, "drafts");
    const resumed = await client.resumeDraft(
      listing.drafts.rows[0],
      listing.account,
    );
    packetAssert.equal(resumed.kind, "prepared");
    packetAssert.equal(resumed.prepared.source, rawSource);
    packetAssert.equal(resumed.prepared.existingRedPacket, true);
    packetAssert.equal(resumed.prepared.redPacket, undefined);
    packetAssert.equal(
      resumed.prepared.options.some((option) => option.name.startsWith("hb_")),
      false,
    );
    const publication = {
      ...initial,
      id: "portable-funded-publish",
      operation: "publish",
      generation: client.generation,
      submission: {
        ...initial.submission,
        revision: 2,
        writing: resumed.prepared,
      },
    };
    final = await client.publishDraft(publication);
    packetAssert.equal(final.status, "published");
    packetAssert.equal(final.observation.state, "published");
    const publishedRead = await client.readThread(packetThread);
    packetAssert.equal(publishedRead.kind, "thread");
    packetAssert.equal(publishedRead.thread.posts[0].redPacketThreadId, "42");
    packetRoundTrip(publishedRead);
    const checked = await client.checkDraft(JSON.parse(JSON.stringify(final)));
    packetAssert.equal(checked.status, "published");
    packetAssert.equal(state.posts.length, 2);
    packetAssert.equal(state.posts[1].has("hb_total"), false);
    packetRoundTrip(checked);
  }
  packetAssert.equal(final.redPacket.state, "open");
  packetAssert.equal(
    final.redPacket.credit,
    "unknown",
    "Ledger observation must not claim specific debit attribution",
  );
  packetAssert.equal(final.redPacket.ledger.state, "observed");
  packetAssert.equal(final.redPacket.ledger.rows[0].operation, "HBS");
  packetAssert.equal(
    state.posts.filter((post) => post.has("hb_total")).length,
    1,
  );
  packetAssert.ok(
    state.posts.every((post) => post.get("message") === rawSource),
  );
  packetAssert.equal(
    JSON.stringify(final).includes("AUTHORED-PACKET-SECRET"),
    false,
  );
  packetRoundTrip(final);
  packetCases.push({
    name: `packet-${mode}-public-consent-and-independent-observations`,
    status: "passed",
    posts: state.posts.length,
    fundingCommands: 1,
    credit: final.redPacket.credit,
  });
}
import privateAssert from "node:assert/strict";
import { URLSearchParams as PrivateParams } from "node:url";
import { createForumClient as createPrivateClient } from "@tsdm/forum-client";
const privateClone = (value) => JSON.parse(JSON.stringify(value));

const privateWritingCases = [];
{
  const pmOrigin = "https://fixture.example";
  const pmURL = pmOrigin + "/home.php?mod=space&do=pm&subop=view&touid=9";
  const composed = "Portable private 中文\nSecond line https://example.test/";
  const stored = [{ id: "101", sender: "7", source: composed }];
  const commands = [],
    acknowledgements = [];
  let readbackUnavailable = false;
  let beforeRead = null;
  const quote = (value) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const response = () =>
    '<div id="um"><strong><a href="home.php?mod=space&uid=7">Portable sender</a></strong></div><div id="ct"><div class="tbmu">With <a href="home.php?mod=space&uid=9">Portable recipient</a> <span id="membernum">' +
    stored.length +
    '</span></div><div id="pm_ul">' +
    stored
      .map(
        (m) =>
          '<dl id="pmlist_' +
          m.id +
          '"><dd class="avt"><a href="home.php?mod=space&uid=' +
          m.sender +
          '">Avatar</a></dd><dd class="ptm">Sender<br>\n' +
          quote(m.source).replaceAll("\n", "<br>\n") +
          '<br>\n<span class="xg1"><span title="2026-11-04 20:00">now</span></span></dd></dl>',
      )
      .join("") +
    '</div><form id="pmform" method="post" action="home.php?mod=spacecp&ac=pm&op=send&pmid=101&daterange=0&handlekey=pmsend&pmsubmit=yes"><textarea name="message"></textarea><input type="hidden" name="formhash" value="PORTABLE_PRIVATE_TOKEN"><input type="hidden" name="topmuid" value="9"><button name="pmsubmit" type="submit" value="true">Send</button></form></div>';
  const transport = {
    async request(url, options) {
      if (options?.method === "POST") {
        const fields = new PrivateParams(options.body);
        commands.push([...fields]);
        stored.push({
          id: String(203 + commands.length - 1),
          sender: "7",
          source: fields.get("message").replaceAll("\r\n", "\n"),
        });
        return {
          url,
          status: 200,
          contentType: "text/html",
          body: "Callback cannot confirm storage",
        };
      }
      if (beforeRead) await beforeRead();
      if (readbackUnavailable && commands.length)
        throw new Error("Authored independent read failure");
      return {
        url,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ uid: 7, document: response() }),
      };
    },
  };
  const pmClient = createPrivateClient({ origin: pmOrigin, transport });
  const prepared = await pmClient.preparePrivateWriting(pmURL, {
    kind: "member",
    id: "7",
    name: "Portable sender",
  });
  privateAssert.equal(prepared.kind, "prepared");
  const submission = {
    contextId: "portable-context",
    revision: 1,
    writing: { ...prepared.prepared, source: composed },
  };
  const ready = await pmClient.preparePrivateReview(submission);
  privateAssert.equal(ready.kind, "ready");
  privateAssert.equal(
    JSON.stringify(ready).includes("PORTABLE_PRIVATE_TOKEN"),
    false,
  );
  const pending = {
    id: "portable-attempt",
    submission: ready.review.submission,
    before: [],
    status: "pending",
    checked: false,
    message: "Pending",
    result: null,
  };
  const retain = async (value) => {
    acknowledgements.push(privateClone(value));
    return true;
  };
  const outcomes = await Promise.all([
    pmClient.sendPrivateMessage(ready.review, pending, retain),
    pmClient.sendPrivateMessage(ready.review, pending, retain),
  ]);
  privateAssert.deepEqual(
    outcomes.map((x) => x.status),
    ["confirmed", "not-sent"],
  );
  privateAssert.equal(commands.length, 1);
  privateAssert.deepEqual(commands[0], [
    ["message", "Portable private 中文\r\nSecond line https://example.test/"],
    ["formhash", "PORTABLE_PRIVATE_TOKEN"],
    ["topmuid", "9"],
  ]);
  privateAssert.deepEqual(acknowledgements[0].before, ["101"]);
  privateAssert.equal(
    JSON.stringify(acknowledgements).includes("PORTABLE_PRIVATE_TOKEN"),
    false,
  );
  privateAssert.equal(
    JSON.stringify(acknowledgements).includes('"review"'),
    false,
  );
  privateAssert.equal(outcomes[0].result.messageId, "203");
  privateAssert.equal(outcomes[0].result.source, composed);
  privateAssert.equal(outcomes[0].result.recipientId, "9");
  privateWritingCases.push(
    "one-use approval, acknowledged original attempt, prior identical message excluded and exact independent readback",
  );

  const next = {
    ...submission,
    revision: 2,
    writing: { ...submission.writing, source: "Later private text" },
  };
  const nextReview = await pmClient.preparePrivateReview(next);
  privateAssert.equal(nextReview.kind, "ready");
  const nextAttempt = { ...pending, id: "refused-storage", submission: next };
  const refused = await pmClient.sendPrivateMessage(
    nextReview.review,
    nextAttempt,
    async () => false,
  );
  privateAssert.equal(refused.status, "not-sent");
  privateAssert.deepEqual(await pmClient.checkPrivateMessage(refused), refused);
  privateAssert.equal(commands.length, 1);
  const reused = await pmClient.sendPrivateMessage(
    nextReview.review,
    nextAttempt,
    retain,
  );
  privateAssert.equal(reused.status, "not-sent");
  privateWritingCases.push(
    "storage refusal consumes approval and cannot replay",
  );

  const finalReview = await pmClient.preparePrivateReview(next);
  privateAssert.equal(finalReview.kind, "ready");
  const finalAttempt = {
    ...pending,
    id: "uncertain-portable",
    submission: next,
  };
  const uncertain = await pmClient.sendPrivateMessage(
    finalReview.review,
    finalAttempt,
    async (value) => {
      acknowledgements.push(privateClone(value));
      readbackUnavailable = true;
      return true;
    },
  );
  privateAssert.equal(uncertain.status, "uncertain");
  const recovered = JSON.parse(JSON.stringify(uncertain));
  readbackUnavailable = false;
  const restarted = createPrivateClient({ origin: pmOrigin, transport });
  const checked = await restarted.checkPrivateMessage(recovered);
  privateAssert.equal(checked.status, "confirmed");
  privateAssert.deepEqual(checked.submission, next);
  privateAssert.equal(checked.id, "uncertain-portable");
  privateAssert.equal(commands.length, 2);
  const stale = await restarted.sendPrivateMessage(
    finalReview.review,
    { ...recovered, status: "pending" },
    retain,
  );
  privateAssert.equal(stale.status, "not-sent");
  privateAssert.equal(commands.length, 2);
  privateWritingCases.push(
    "serialized uncertain attempt independently checked after restart, with no command replay",
  );
  const priorReview = await pmClient.preparePrivateReview({
    ...next,
    revision: 3,
  });
  privateAssert.equal(priorReview.kind, "ready");
  const invalidReview = await pmClient.preparePrivateReview({
    ...next,
    revision: 4,
    writing: { ...next.writing, source: "" },
  });
  privateAssert.equal(invalidReview.kind, "refused");
  const staleAfterRefusal = await pmClient.sendPrivateMessage(
    priorReview.review,
    {
      ...pending,
      id: "invalidated-review",
      submission: priorReview.review.submission,
    },
    retain,
  );
  privateAssert.equal(staleAfterRefusal.status, "not-sent");
  privateAssert.equal(commands.length, 2);
  privateWritingCases.push(
    "new refused preparation invalidates the older private approval",
  );
  let releaseRead;
  let observeRead;
  const enteredRead = new Promise((resolve) => {
    observeRead = resolve;
  });
  const blockedRead = new Promise((resolve) => {
    releaseRead = resolve;
  });
  beforeRead = async () => {
    beforeRead = null;
    observeRead();
    await blockedRead;
  };
  const delayedReview = pmClient.preparePrivateReview({ ...next, revision: 5 });
  await enteredRead;
  const newerRefusal = await pmClient.preparePrivateReview({
    ...next,
    revision: 6,
    writing: { ...next.writing, source: "" },
  });
  privateAssert.equal(newerRefusal.kind, "refused");
  releaseRead();
  privateAssert.equal((await delayedReview).kind, "refused");
  privateWritingCases.push(
    "a delayed older preparation cannot revive approval after a newer refusal",
  );

  const sendingReview = await pmClient.preparePrivateReview(next);
  privateAssert.equal(sendingReview.kind, "ready");
  const replacedDuringRetention = await pmClient.sendPrivateMessage(
    sendingReview.review,
    {
      ...pending,
      id: "replaced-during-retention",
      submission: sendingReview.review.submission,
    },
    async () => {
      const replacement = await pmClient.preparePrivateWriting(
        pmURL,
        next.writing.account,
      );
      privateAssert.equal(replacement.kind, "prepared");
      return true;
    },
  );
  privateAssert.equal(replacedDuringRetention.status, "not-sent");
  privateAssert.equal(commands.length, 2);
  privateWritingCases.push(
    "a new private context preparation invalidates a send still awaiting recovery",
  );
  let releaseMutation, observeMutation;
  const mutationEntered = new Promise((resolve) => {
    observeMutation = resolve;
  });
  const mutationBlocked = new Promise((resolve) => {
    releaseMutation = resolve;
  });
  beforeRead = async () => {
    beforeRead = null;
    observeMutation();
    await mutationBlocked;
  };
  const mutable = {
    ...next,
    revision: 7,
    writing: { ...next.writing, source: "Initial plain source" },
  };
  const mutatingReview = pmClient.preparePrivateReview(mutable);
  await mutationEntered;
  mutable.writing.source = "[b]Unqualified private formatting[/b]";
  releaseMutation();
  const mutationResult = await mutatingReview;
  privateAssert.equal(mutationResult.kind, "ready");
  privateAssert.equal(
    mutationResult.review.submission.writing.source,
    "Initial plain source",
  );
  privateWritingCases.push(
    "mutable caller input cannot change the private snapshot after validation begins",
  );
}
/* global createForumClient, origin, assert */
// Directory provenance is optional for legacy models and serializes without DOM.
const groupProvenanceClient = createForumClient({
  origin,
  transport: {
    async request(url) {
      return {
        status: 200,
        url,
        contentType: "text/html",
        body: '<div class="bm"><div class="bm_h"><span><a href="home.php?mod=space&uid=99">Moderator</a></span><h2><a href="forum.php?gid=11">Community</a></h2></div><div id="category_11"><table><tr><td><h2><a href="forum.php?mod=forumdisplay&fid=5">Board Five</a></h2></td></tr></table></div></div><div class="bm"><div class="bm_h"><h2><a href="home.php?mod=space&do=favorite&type=forum">My boards</a></h2></div><div id="category_0"><table><tr><td><h2><a href="forum.php?mod=forumdisplay&fid=5">Board Five</a></h2></td></tr></table></div></div>',
      };
    },
  },
});
const groupProvenance = await groupProvenanceClient.readPage(
  origin + "/forum.php",
);
assert.equal(groupProvenance.kind, "directory");
assert.equal(groupProvenance.directory.groups[0].sourceId, "category_11");
assert.equal(
  groupProvenance.directory.groups[0].sourceURL,
  origin + "/forum.php?gid=11",
);
assert.equal(groupProvenance.directory.groups[1].sourceId, "category_0");
assert.equal(
  groupProvenance.directory.groups[1].sourceURL,
  origin + "/home.php?mod=space&do=favorite&type=forum",
);
assert.deepEqual(JSON.parse(JSON.stringify(groupProvenance)), groupProvenance);

console.log(JSON.stringify({ status: 'passed', version: FORUM_CLIENT_VERSION, threadId: read.thread.id, searchId: searched.search.results.id, resultTitle: searched.search.results.rows[0].label, downloadName: download.name, downloadBytes: [...download.bytes], requests, fileRequests, preparedBoard: prepared.prepared.board.id, preparationRequests, noticeRequests, noticeId: loadedNotices.notices.entries[0].id, noticePage: nextNotices.notices.pages.current, publicationCases, replyCases, editingCases, draftCases, favoriteCases, packetCases, boundaryCases, privateWritingCases }));
