import assert from "node:assert/strict";
import { createPostClient } from "tsdm-sdk";
import { submitReviewedPost } from "./posts-guide.js";

const origin = "https://posts.example";
const source = "Fictitious body for a controlled post.";
const subject = "Fictitious subject";
const session = { memberId: "31", continuity: "fixture-session" };
const target = { kind: "new-thread", boardId: "7" };
const jsonMode = new URLSearchParams({ tsdmapp: "json" }).toString();
const editorURL = `${origin}/forum.php?mod=post&action=newthread&fid=7&${jsonMode}&nodoc=1`;
const submitURL = `${origin}/forum.php?mod=post&action=newthread&fid=7&topicsubmit=yes&fixture=destination&${jsonMode}`;
const threadURL = `${origin}/forum.php?mod=viewthread&tid=42`;
const permalink = `${origin}/forum.php?mod=redirect&goto=findpost&ptid=42&pid=101`;
const form = {
  ok: 1,
  type: "post",
  schema: 16,
  uid: 31,
  formhash: "fakehash",
  action: "newthread",
  fid: 7,
  tid: 0,
  pid: 0,
  first: 1,
  subject: { shown: 1, value: "", min: 1, max: 80, unit: "dstrlen" },
  message: { value: "", min: 10, max: 10000, unit: "bytes" },
  submit: {
    method: "POST",
    url: submitURL.replace(`&${jsonMode}`, ""),
    fields: {
      formhash: "fakehash",
      posttime: "1700000000",
      wysiwyg: "1",
      topicsubmit: "true",
      save: "",
    },
  },
  options: [
    { name: "usesig", type: "checkbox", value: "1", checked: 1, disabled: 0 },
    { name: "htmlon", type: "checkbox", value: "0", checked: 1, disabled: 1 },
  ],
  draft: { field: 1, can_save: 1, publish: 0 },
};
const writeResult = {
  ok: 1,
  type: "result",
  schema: 13,
  uid: 31,
  kind: "redirect",
  login: 0,
  url: threadURL,
};
const visible = {
  ok: 1,
  type: "thread",
  schema: 15,
  uid: 31,
  thread: { fid: 7, tid: 42, subject, authorid: 31, draft: 0, displayorder: 0 },
  posts: [{ pid: 101, first: 1, authorid: 31, message: source, invisible: 0 }],
};
const json = (url, value) => ({
  status: 200,
  url,
  contentType: "application/json",
  redirect: "none",
  body: JSON.stringify(value),
});
const results = [];
async function exercise({ name, steps, run, expected }) {
  const requests = [];
  let current = session;
  const host = {
    origin,
    session: () => current,
    transport: {
      async request(url, request) {
        assert.deepEqual(request.session, session);
        assert.equal(request.fresh, true);
        const parsedURL = new URL(url);
        const stamp = [...parsedURL.searchParams.keys()].find((key) =>
          /^\d{13}$/.test(key),
        );
        if (stamp) parsedURL.searchParams.delete(stamp);
        const actual = {
          url: stamp ? parsedURL.href : url,
          method: request.method,
          ...(request.body
            ? { fields: [...new URLSearchParams(request.body)] }
            : {}),
          ...(request.referer ? { referer: request.referer } : {}),
        };
        const step = steps[requests.length];
        requests.push(actual);
        assert.ok(step, `Unexpected transport request ${url}`);
        if (step.switchSession)
          current = { memberId: "31", continuity: "new-fixture-session" };
        if (step.drop) throw new Error("Controlled response loss");
        return step.response
          ? stamp
            ? { ...step.response, url }
            : step.response
          : json(url, step.value);
      },
    },
  };
  const observed = await run(createPostClient(host), host);
  assert.deepEqual(
    requests,
    steps.map((step) => step.request),
  );
  assert.deepEqual(observed, expected, name);
  assert.equal(requests.length, steps.length);
  results.push({ name, expected, observed, requests });
}
const get = (url, value, rest) => ({
  request: { url, method: "GET" },
  value,
  ...rest,
});
const post = (url, fields, value, rest) => ({
  request: { url, method: "POST", fields: Object.entries(fields) },
  value,
  ...rest,
});
const submitFields = {
  ...form.submit.fields,
  usesig: "1",
  subject,
  message: source,
};
const read = (value = visible) =>
  get(`${threadURL}&${jsonMode}&nodoc=1`, value);
async function openAndSubmit(
  client,
  selection = target,
  input = { subject, message: source },
) {
  const prepared = await client.openPost(selection);
  assert.equal(prepared.kind, "post-form");
  return client.submitPost(prepared.form, input);
}
const located = { threadId: "42", postId: "101", url: permalink };
for (const schema of [15, 23]) {
  await exercise({
    name: `ordinary new thread with exact stored text on schema ${schema}`,
    steps: [
      get(editorURL, form),
      post(submitURL, submitFields, writeResult),
      read({ ...visible, schema }),
    ],
    run: (client) => openAndSubmit(client),
    expected: { kind: "published", post: located },
  });
}
const editURL = (pid) =>
  `${origin}/forum.php?mod=post&action=edit&fid=7&tid=42&pid=${pid}&${jsonMode}&nodoc=1`;
const editSubmit = `${origin}/forum.php?mod=post&action=edit&extra=&editsubmit=yes&${jsonMode}`;
const edit = (pid, first, content = "Fictitious original content.") => ({
  ...form,
  action: "edit",
  tid: 42,
  pid,
  first: Number(first),
  thread: { tid: 42, draft: 0, special: 0 },
  subject: {
    ...form.subject,
    shown: 1,
    value: first ? subject : "Fictitious reply subject",
  },
  message: { ...form.message, value: content },
  submit: {
    method: "POST",
    url: editSubmit.replace(`&${jsonMode}`, ""),
    fields: {
      formhash: "fakehash",
      fid: "7",
      tid: "42",
      pid: String(pid),
      page: first ? "1" : "2",
      editsubmit: "true",
      save: "",
    },
  },
  options: form.options,
  attach: {
    fields: { "attachnew[301][description]": "Fictitious attachment label" },
  },
  draft: { field: 1, can_save: 0, publish: 0 },
});
const rendered = {
  pid: 101,
  first: 1,
  authorid: 31,
  invisible: 0,
  deleted: 0,
  message_reason: "",
  body_html: `<p>${source}</p>`,
};
const readonly = (posts = [rendered], changes = {}) => ({
  ...visible,
  schema: 23,
  posts,
  ...changes,
});
const exactEditor = {
  ...edit(101, true, source),
  message: { ...form.message, value: source, json: 0 },
};
const editRead = (value = exactEditor, rest) => get(editURL(101), value, rest);
for (const { name, page = readonly(), result = writeResult, extra = [], exact } of [
  {
    name: "reads the exact editor for absent stored source",
    extra: [editRead()],
    exact: true,
  },
  {
    name: "reads the exact editor for an unrestricted source omission",
    page: readonly([{ ...rendered, message: null, message_reason: "bbcodeoff" }]),
    extra: [editRead()],
    exact: true,
  },
  {
    name: "does not use rendered HTML when the editor is unavailable",
    extra: [editRead({ ok: 0, error: "message" })],
  },
  {
    name: "does not accept different stored editor source",
    extra: [
      editRead({
        ...exactEditor,
        message: { ...exactEditor.message, value: `${source}\n` },
      }),
    ],
  },
  {
    name: "does not accept a different editor subject",
    extra: [
      editRead({
        ...exactEditor,
        subject: { ...exactEditor.subject, value: `${subject}!` },
      }),
    ],
  },
  {
    name: "does not accept an unproven editor account",
    extra: [editRead({ ...exactEditor, uid: undefined })],
  },
  {
    name: "does not accept another editor account",
    extra: [editRead({ ...exactEditor, uid: 32 })],
  },
  {
    name: "does not accept a different editor post",
    extra: [editRead({ ...exactEditor, pid: 102 })],
  },
  {
    name: "does not accept another session's same-account editor",
    extra: [editRead(exactEditor, { switchSession: true })],
  },
  {
    name: "does not ask the editor for a different thread",
    page: readonly([rendered], { thread: { ...visible.thread, tid: 99 } }),
  },
  {
    name: "does not ask the editor for another viewer",
    page: readonly([rendered], { uid: 32 }),
  },
  {
    name: "does not ask the editor about another author",
    page: readonly([{ ...rendered, authorid: 32 }]),
  },
  {
    name: "does not ask the editor for a deleted post",
    page: readonly([{ ...rendered, deleted: 1 }]),
  },
  {
    name: "does not ask the editor for a restricted post",
    page: readonly([{ ...rendered, message_reason: "password" }]),
  },
  {
    name: "does not ask the editor when the thread disallows editing the post",
    page: readonly([{ ...rendered, can: { edit: 0 } }]),
  },
  {
    name: "does not ask the editor for a duplicated post identity",
    page: readonly([rendered, { ...rendered, first: 0 }]),
  },
  {
    name: "does not override a conflicting receipt post with an editor read",
    result: { ...writeResult, url: `${threadURL}&pid=999#pid999` },
  },
  {
    name: "does not override mismatching stored thread source with an editor read",
    page: readonly([{ ...rendered, message: `${source}\n` }]),
  },
]) {
  await exercise({
    name: `schema 23: ${name}`,
    steps: [
      get(editorURL, form),
      post(submitURL, submitFields, result),
      read(page),
      ...extra,
    ],
    run: (client) => openAndSubmit(client),
    expected: exact ? { kind: "published", post: located } : { kind: "uncertain" },
  });
}
for (const [pid, isFirst] of [
  [101, true],
  [102, false],
]) {
  const page = isFirst
    ? visible
    : {
        ...visible,
        posts: [{ pid, first: 0, authorid: 31, message: source, invisible: 0 }],
      };
  const editor = edit(pid, isFirst);
  const selected = {
    kind: isFirst ? "edit-first" : "edit-reply",
    boardId: "7",
    threadId: "42",
    postId: String(pid),
  };
  await exercise({
    name: isFirst ? "edit first post" : "edit existing reply on page two",
    steps: [
      get(editURL(pid), editor),
      get(editURL(pid), editor),
      post(
        editSubmit,
        {
          ...editor.submit.fields,
          usesig: "1",
          ...editor.attach.fields,
          subject: isFirst ? subject : "Fictitious reply subject",
          message: source,
        },
        writeResult,
      ),
      get(`${threadURL}${isFirst ? "" : "&page=2"}&${jsonMode}&nodoc=1`, page),
    ],
    run: (client) => openAndSubmit(client, selected, { message: source }),
    expected: {
      kind: "edited",
      post: {
        ...located,
        postId: String(pid),
        url: permalink.replace("pid=101", `pid=${pid}`),
      },
    },
  });
}
await exercise({
  name: "concurrent edit leaves current form untouched",
  steps: [
    get(editURL(101), edit(101, true)),
    get(editURL(101), edit(101, true, "Another fictitious revision.")),
  ],
  run: (client) =>
    openAndSubmit(
      client,
      { kind: "edit-first", boardId: "7", threadId: "42", postId: "101" },
      { message: source },
    ),
  expected: { kind: "conflict" },
});
const draftPage = {
  ...visible,
  thread: { ...visible.thread, draft: 1, displayorder: -4 },
};
const draftForm = {
  ...edit(101, true, source),
  thread: { tid: 42, draft: 1, special: 0 },
  draft: { field: 1, can_save: 1, publish: 1 },
};
const existingDraft = {
  kind: "draft",
  boardId: "7",
  threadId: "42",
  postId: "101",
};
const date = "2099-04-03 14:05";
const cron = (checked, value) => ({
  inputs: [
    {
      name: "cronpublish",
      type: "checkbox",
      value: "true",
      checked,
      disabled: 0,
    },
    { name: "cronpublishdate", type: "text", value },
  ],
});
await exercise({
  name: "save a new draft",
  steps: [
    get(editorURL, form),
    post(submitURL, { ...submitFields, save: "1" }, writeResult),
    read(draftPage),
  ],
  run: (client) =>
    openAndSubmit(client, target, {
      subject,
      message: source,
      intent: "save-draft",
    }),
  expected: { kind: "draft-saved", post: located },
});
await exercise({
  name: "publish an existing draft",
  steps: [
    get(editURL(101), draftForm),
    get(editURL(101), draftForm),
    post(
      editSubmit,
      {
        ...draftForm.submit.fields,
        usesig: "1",
        ...draftForm.attach.fields,
        subject,
        message: source,
      },
      writeResult,
    ),
    read(),
  ],
  run: (client) =>
    openAndSubmit(client, existingDraft, {
      message: source,
      intent: "publish",
    }),
  expected: { kind: "published", post: located },
});
for (const [name, page] of [
  ["schedule a new thread", draftPage],
  [
    "schedule with one editor read for both source and date",
    readonly([{ ...rendered, message: null }], { thread: draftPage.thread }),
  ],
]) {
  await exercise({
    name,
    steps: [
      get(editorURL, { ...form, cronpublish: cron(0, "") }),
      post(
        submitURL,
        {
          ...form.submit.fields,
          usesig: "1",
          cronpublishdate: date,
          subject,
          message: source,
          cronpublish: "true",
        },
        writeResult,
      ),
      read(page),
      get(editURL(101), {
        ...draftForm,
        message: exactEditor.message,
        cronpublish: cron(1, date),
      }),
    ],
    run: (client) =>
      openAndSubmit(client, target, {
        subject,
        message: source,
        intent: "schedule",
        forumDate: date,
      }),
    expected: { kind: "scheduled", post: located, forumDate: date },
  });
}
await exercise({
  name: "scheduling expired before dispatch and the forum published immediately",
  steps: [
    get(editorURL, { ...form, cronpublish: cron(0, "") }),
    post(
      submitURL,
      {
        ...form.submit.fields,
        usesig: "1",
        cronpublishdate: date,
        subject,
        message: source,
        cronpublish: "true",
      },
      writeResult,
    ),
    read(),
  ],
  run: (client) =>
    openAndSubmit(client, target, {
      subject,
      message: source,
      intent: "schedule",
      forumDate: date,
    }),
  expected: { kind: "published", post: located },
});
await exercise({
  name: "impossible calendar time never dispatches",
  steps: [get(editorURL, { ...form, cronpublish: cron(0, "") })],
  run: (client) =>
    openAndSubmit(client, target, {
      subject,
      message: source,
      intent: "schedule",
      forumDate: "2099-02-29 14:05",
    }),
  expected: { kind: "invalid-input" },
});
const nativeOpen = editorURL.split(`&${jsonMode}`)[0];
const nativeSubmit = submitURL.split(`&${jsonMode}`)[0];
const html = (url, body, status = 200, extra = {}) => ({
  status,
  url,
  body,
  contentType: "text/html",
  redirect: "none",
  ...extra,
});
const member =
  '<div id="um"><strong><a href="home.php?mod=space&amp;uid=31">Fictitious Author</a></strong></div>';
const nativeFields = (
  extra = "",
) => `${member}<form id="postform" action="${nativeSubmit}" method="post">
<input name="formhash" value="fakehash" type="hidden"><input name="subject"><textarea name="message"></textarea>
<input name="save" type="hidden"><input name="usesig" value="1" checked type="checkbox">
<select name="topiclabel"><option value="other">Other</option><option value="fixture" selected>Fictitious label</option></select>
<button type="submit" name="topicsubmit" value="true">Submit</button>${extra}</form>`;
const nativePost = {
  formhash: "fakehash",
  subject,
  message: source,
  save: "",
  usesig: "1",
  topiclabel: "fixture",
  topicsubmit: "true",
};
const readNative = get(threadURL, undefined, {
  response: html(
    threadURL,
    `<link rel="canonical" href="${threadURL}">${member}<div id="postlist"><h1 class="ts"><span id="thread_subject">${subject}</span></h1>
  <div id="post_101"><div class="pi"><strong><a href="${threadURL}"><em>1</em></a></strong></div><div class="authi"><a class="xw1" href="home.php?mod=space&amp;uid=31">Fictitious Author</a></div></div></div>`,
  ),
});
const storedEditURL = editURL(101).split(`&${jsonMode}`)[0];
const storedEditor = `${member}<form id="postform" action="${editSubmit.split(`&${jsonMode}`)[0]}" method="post">
<input name="formhash" value="fakehash" type="hidden"><input name="fid" value="7"><input name="tid" value="42"><input name="pid" value="101">
<input name="subject" value="${subject}"><textarea name="message">${source}</textarea><button type="submit" name="editsubmit" value="true">Submit</button></form>`;
await exercise({
  name: "native form and manual HTTP redirect with native stored readback",
  steps: [
    get(editorURL, undefined, { response: html(editorURL, nativeFields()) }),
    post(nativeSubmit, nativePost, undefined, {
      response: html(nativeSubmit, "", 302, { location: threadURL }),
    }),
    get(`${threadURL}&${jsonMode}&nodoc=1`, { ok: 0, error: "off", uid: 31 }),
    readNative,
    get(storedEditURL, undefined, {
      response: html(storedEditURL, storedEditor),
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "published", post: located },
});
await exercise({
  name: "native draft save recognizes the embedded publish action without requesting it",
  steps: [
    get(editorURL, undefined, {
      response: html(
        editorURL,
        nativeFields(
          `<button type="button" onclick="$('postsave').value=1;">Save draft</button>`,
        ),
      ),
    }),
    post(nativeSubmit, { ...nativePost, save: "1" }, undefined, {
      response: html(nativeSubmit, "", 302, { location: threadURL }),
    }),
    get(`${threadURL}&${jsonMode}&nodoc=1`, undefined, {
      response: html(
        `${threadURL}&${jsonMode}&nodoc=1`,
        readNative.response.body.replace(
          "</h1>",
          '<span class="xg1">(草稿)<a class="psave" href="forum.php?mod=misc&amp;action=pubsave&amp;tid=42">Publish</a></span></h1>',
        ),
      ),
    }),
    get(storedEditURL, undefined, {
      response: html(storedEditURL, storedEditor),
    }),
  ],
  run: (client) =>
    openAndSubmit(client, target, {
      subject,
      message: source,
      intent: "save-draft",
    }),
  expected: { kind: "draft-saved", post: located },
});
const hooked = {
  ...form,
  hook_fields: [{ hook: "post_top", names: ["fpbt_book", "fpbt_author"] }],
};
await exercise({
  name: "native hook inputs carried to structured destination",
  steps: [
    get(editorURL, hooked),
    get(nativeOpen, undefined, {
      response: html(
        nativeOpen,
        nativeFields(
          '<input name="fpbt_book" value="Fictitious Book"><input name="fpbt_author" value="Fictitious Author">',
        ),
      ),
    }),
    post(
      submitURL,
      {
        ...form.submit.fields,
        usesig: "1",
        fpbt_book: "Fictitious Book",
        fpbt_author: "Fictitious Author",
        subject,
        message: source,
      },
      writeResult,
    ),
    read(),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "published", post: located },
});
await exercise({
  name: "schema 13 redisplays the same editor after validation",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, {
      ...writeResult,
      kind: "page",
      url: "",
      document: nativeFields(),
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "redisplayed", destination: nativeOpen },
});
await exercise({
  name: "explicit moderation remains pending",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, {
      ...writeResult,
      kind: "message",
      alert: "right",
      message_key: "post_newthread_mod_succeed",
      message: "Your fictitious post requires moderation.",
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "moderation" },
});
await exercise({
  name: "explicit forum refusal",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, {
      ...writeResult,
      ok: 0,
      kind: "message",
      alert: "error",
      message_key: "post_flood_ctrl",
      url: "",
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "refused" },
});
await exercise({
  name: "lost response retains uncertainty and consumes the form",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, undefined, { drop: true }),
  ],
  run: async (client) => {
    const { form: prepared } = await client.openPost(target);
    const result = await client.submitPost(prepared, {
      subject,
      message: source,
    });
    assert.deepEqual(
      await client.submitPost(prepared, { subject, message: source }),
      { kind: "invalid-input" },
    );
    return result;
  },
  expected: { kind: "uncertain" },
});
await exercise({
  name: "host switched session during dispatch",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, writeResult, { switchSession: true }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "uncertain" },
});
await exercise({
  name: "a redirect and readonly visible page with different content remain uncertain",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, writeResult),
    read({
      ...visible,
      posts: [{ ...visible.posts[0], message: "Other fictitious source." }],
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "uncertain" },
});
const protectedForm = {
  ...form,
  unsupported: ["seccheck"],
  seccheck: {
    seccode: 1,
    secqaa: 1,
    seccode_hash: "fakeImage",
    secqaa_hash: "fakeQuestion",
    modid: "forum::post",
  },
};
const challengeURL = (kind, action, answer) => {
  const url = new URL("/misc.php", origin);
  url.search = new URLSearchParams({
    mod: kind === "image" ? "seccode" : "secqaa",
    action,
    idhash: kind === "image" ? "fakeImage" : "fakeQuestion",
    ...(kind === "image" ? { modid: "forum::post" } : {}),
    ...(kind === "question" || action === "check" ? { inajax: "1" } : {}),
    ...(answer ? { secverify: answer } : {}),
  });
  return url.href;
};
const prompt = (kind, action, text, answer) => {
  const url = challengeURL(kind, action, answer);
  return {
    request: { url, method: "GET", referer: nativeOpen },
    response: html(url, text),
  };
};
const imageURL = `${origin}/misc.php?mod=seccode&idhash=fakeImage&update=fixture`;
await exercise({
  name: "image and question handoffs and same-session human checks",
  steps: [
    get(editorURL, protectedForm),
    prompt(
      "image",
      "update",
      `show('<img src="${imageURL.slice(origin.length + 1).replaceAll("&", "&amp;")}">')`,
    ),
    prompt(
      "question",
      "update",
      "<root><![CDATA[<strong>Fictitious question?</strong>]]></root>",
    ),
    prompt("question", "check", "<root><![CDATA[invalid]]></root>", "wrong"),
    prompt("question", "check", "<root><![CDATA[succeed]]></root>", "fiction"),
    post(
      submitURL,
      {
        ...submitFields,
        seccodehash: "fakeImage",
        seccodemodid: "forum::post",
        seccodeverify: "faux",
        secqaahash: "fakeQuestion",
        secanswer: "fiction",
      },
      writeResult,
    ),
    read(),
  ],
  run: async (client) => {
    const { form: prepared } = await client.openPost(target);
    assert.deepEqual(prepared.verification, ["image", "question"]);
    assert.deepEqual(
      await client.submitPost(prepared, { subject, message: source }),
      { kind: "verification-required", verification: ["image", "question"] },
    );
    assert.deepEqual(await client.refreshPostVerification(prepared, "image"), {
      kind: "image",
      destination: imageURL,
      referer: nativeOpen,
      session,
    });
    assert.deepEqual(
      await client.refreshPostVerification(prepared, "question"),
      { kind: "question", text: "Fictitious question?" },
    );
    assert.deepEqual(
      await client.checkPostVerification(prepared, "question", "wrong"),
      { kind: "rejected" },
    );
    assert.deepEqual(
      await client.checkPostVerification(prepared, "question", "fiction"),
      { kind: "accepted" },
    );
    return client.submitPost(prepared, {
      subject,
      message: source,
      answers: { image: "faux", question: "fiction" },
    });
  },
  expected: { kind: "published", post: located },
});
await exercise({
  name: "dynamic challenge refusal never resubmits",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, {
      ...writeResult,
      ok: 0,
      kind: "message",
      message_key: "submit_seccode_invalid",
    }),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "challenge-refused" },
});
await exercise({
  name: "unidentified challenge hands off the editor",
  steps: [get(editorURL, { ...protectedForm, seccheck: null })],
  run: (client) => client.openPost(target),
  expected: { kind: "browser-handoff", destination: nativeOpen },
});
const categorized = {
  ...form,
  types: {
    required: 1,
    locked: 0,
    input: {
      name: "typeid",
      type: "select",
      value: "0",
      choices: [
        { value: "0", label: "Choose" },
        { value: "9", label: "Fiction" },
      ],
    },
  },
};
await exercise({
  name: "required category validates against served choices",
  steps: [
    get(editorURL, categorized),
    post(
      submitURL,
      {
        ...form.submit.fields,
        typeid: "9",
        usesig: "1",
        subject,
        message: source,
      },
      writeResult,
    ),
    read(),
  ],
  run: async (client) => {
    const { form: prepared } = await client.openPost(target);
    assert.deepEqual(prepared.categories, [{ id: "9", label: "Fiction" }]);
    assert.deepEqual(
      await client.submitPost(prepared, { subject, message: source }),
      { kind: "invalid-input" },
    );
    assert.deepEqual(
      await client.submitPost(prepared, {
        subject,
        message: source,
        categoryId: "99",
      }),
      { kind: "invalid-input" },
    );
    return client.submitPost(prepared, {
      subject,
      message: source,
      categoryId: "9",
    });
  },
  expected: { kind: "published", post: located },
});
await exercise({
  name: "unsupported challenge image hands off without following its destination",
  steps: [
    get(editorURL, protectedForm),
    prompt(
      "image",
      "update",
      `show('<img src="misc.php?mod=seccode&amp;idhash=other&amp;update=fixture">')`,
    ),
  ],
  run: async (client) => {
    const { form: prepared } = await client.openPost(target);
    return client.refreshPostVerification(prepared, "image");
  },
  expected: {
    kind: "browser-handoff",
    destination: nativeOpen,
    message: "Complete verification in the forum editor.",
  },
});
await exercise({
  name: "native saved draft continues in the browser",
  steps: [
    get(editURL(101), undefined, {
      response: html(editURL(101), storedEditor),
    }),
  ],
  run: (client) => client.openPost(existingDraft),
  expected: { kind: "browser-handoff", destination: storedEditURL },
});
await exercise({
  name: "editing a scheduled draft continues in the browser",
  steps: [get(editURL(101), { ...draftForm, cronpublish: cron(1, date) })],
  run: (client) => client.openPost(existingDraft),
  expected: { kind: "browser-handoff", destination: storedEditURL },
});
await exercise({
  name: "save changes to an existing draft",
  steps: [
    get(editURL(101), draftForm),
    get(editURL(101), draftForm),
    post(
      editSubmit,
      {
        ...draftForm.submit.fields,
        usesig: "1",
        ...draftForm.attach.fields,
        save: "1",
        subject,
        message: source,
      },
      writeResult,
    ),
    read(draftPage),
  ],
  run: (client) =>
    openAndSubmit(client, existingDraft, {
      message: source,
      intent: "save-draft",
    }),
  expected: { kind: "draft-saved", post: located },
});
await exercise({
  name: "wrong exact post in the creation acknowledgement leaves uncertainty",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, {
      ...writeResult,
      url: `${threadURL}&pid=999#pid999`,
    }),
    read(),
  ],
  run: (client) => openAndSubmit(client),
  expected: { kind: "uncertain" },
});
await exercise({
  name: "wrong account on the editor never dispatches",
  steps: [get(editorURL, { ...form, uid: 32 })],
  run: (client) => client.openPost(target),
  expected: { kind: "session-changed" },
});
await exercise({
  name: "unexpected target hidden in a supplied control never dispatches",
  steps: [
    get(editorURL, {
      ...form,
      options: [...form.options, { name: "fid", type: "hidden", value: "99" }],
    }),
  ],
  run: (client) => client.openPost(target),
  expected: { kind: "invalid-response" },
});
await exercise({
  name: "packaged guide leaves unapproved form undispatched",
  steps: [get(editorURL, form)],
  run: async (_, host) => ({
    kind: (
      await submitReviewedPost(
        host,
        target,
        { subject, message: source },
        false,
      )
    ).kind,
  }),
  expected: { kind: "post-form" },
});
await exercise({
  name: "packaged guide submits after deliberate approval",
  steps: [
    get(editorURL, form),
    post(submitURL, submitFields, writeResult),
    read(),
  ],
  run: (_, host) =>
    submitReviewedPost(host, target, { subject, message: source }, true),
  expected: { kind: "published", post: located },
});
console.log(JSON.stringify(results));
