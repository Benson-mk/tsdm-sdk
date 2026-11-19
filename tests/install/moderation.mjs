import assert from "node:assert/strict";
import { createModerationClient } from "tsdm-sdk";

const origin = "https://moderation.example";
const session = { memberId: "31", continuity: "fictional-moderator-session" };
const results = [];
const json = (body) => ({
  body: JSON.stringify(body),
  contentType: "application/json",
});
const step = (query, body, request = {}, response = {}) => ({
  query,
  body,
  request,
  response,
});
async function scenario(name, steps, expected, run) {
  const requests = [];
  const options = {
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const expectedStep = steps[requests.length];
        requests.push({ url, ...request });
        assert.ok(expectedStep, "unexpected request");
        if (expectedStep.response.drop)
          throw new Error("Controlled response loss");
        return {
          url,
          redirect: "none",
          status: 200,
          ...expectedStep.body,
          ...expectedStep.response,
        };
      },
    },
  };
  const observed = await run(createModerationClient(options), options);
  const expectedRequests = steps.map(({ query, request }) => ({
    url: `${origin}/forum.php?${query}`,
    method: "GET",
    effect: false,
    fresh: true,
    session,
    ...request,
  }));
  assert.deepEqual(requests, expectedRequests, name);
  assert.deepEqual(observed, expected, name);
  results.push({ name, expected, observed, expectedRequests, requests });
}

const v4 = "tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1";
const threadTypes = `mod=ajax&action=getthreadtypes&fid=12&inajax=1&${v4}`;
const smallForm = (form, extra) =>
  json({ ok: 1, uid: 31, type: "form", schema: 17, form, ...extra });
await scenario(
  "reads destination types for this moderator and forum",
  [
    step(
      threadTypes,
      smallForm("threadtypes", {
        fid: 12,
        required: 1,
        submit: null,
        select: {
          name: "threadtypeid",
          choices: [{ value: "8", label: "Fictional type" }],
        },
      }),
    ),
  ],
  {
    kind: "thread-types",
    forumId: "12",
    required: true,
    choices: [{ value: "8", label: "Fictional type" }],
  },
  (client) => client.readDestinationTypes("12"),
);
await scenario(
  "does not substitute another destination forum’s types",
  [
    step(
      threadTypes,
      smallForm("threadtypes", {
        fid: 13,
        required: 0,
        submit: null,
        select: { name: "threadtypeid", choices: [{ value: "0", label: "" }] },
      }),
    ),
  ],
  { kind: "invalid-response" },
  (client) => client.readDestinationTypes("12"),
);

const viewerResult = (extra) =>
  json({ ok: 1, uid: 31, type: "result", schema: 13, ...extra });
const ack = viewerResult({
  kind: "handle",
  handlekey: "mods",
  alert: "right",
  message_key: "admin_succeed",
});
const batchTarget = {
  operation: "delete",
  forumId: "12",
  threadIds: ["80", "81"],
};
const batchQuery = `mod=topicadmin&action=moderate&fid=12&moderate%5B%5D=80&moderate%5B%5D=81&handlekey=mods&infloat=yes&nopost=yes&optgroup=3&operation=delete&inajax=1&${v4}`;
const batchAction =
  "mod=topicadmin&action=moderate&optgroup=3&modsubmit=yes&infloat=yes";
const batchForm = (ids) =>
  smallForm("moderate", {
    fid: 12,
    tid: 80,
    tids: ids.map(Number),
    optgroup: 3,
    operation: "delete",
    submit: {
      url: "forum.php?" + batchAction,
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      fields: {
        formhash: "controlled-form-token",
        fid: "12",
        handlekey: "mods",
        modsubmit: "确定",
      },
      lists: { "moderate[]": ids },
    },
    operations: [
      {
        name: "operations[]",
        value: "delete",
        type: "hidden",
        label: "Delete selected threads",
      },
    ],
    reason: { name: "reason", type: "textarea", value: "", required: 0 },
    banuser: [{ name: "banuser", type: "checkbox", checked: 0 }],
    hook_fields: [],
    unsupported: [],
  });
await scenario(
  "batch delete honors exactly the offered selection and never includes collateral user controls",
  [
    step(batchQuery, batchForm(["80", "81"])),
    step(batchAction + "&inajax=1&tsdmapp=json&tsdmv=4", ack, {
      method: "POST",
      effect: true,
      body: new URLSearchParams([
        ["formhash", "controlled-form-token"],
        ["fid", "12"],
        ["handlekey", "mods"],
        ["modsubmit", "确定"],
        ["moderate[]", "80"],
        ["moderate[]", "81"],
        ["operations[]", "delete"],
        ["reason", "Fictional reason"],
      ]).toString(),
    }),
  ],
  { kind: "acknowledged", target: batchTarget, code: "admin_succeed" },
  async (client) => {
    const form = await client.prepareModeration(batchTarget);
    assert.equal(form.kind, "moderation-form");
    assert.deepEqual(form.form.target, batchTarget);
    assert.deepEqual(await client.submitModeration(form.form, {}, false), {
      kind: "not-confirmed",
    });
    assert.deepEqual(
      await client.submitModeration(form.form, { banuser: "on" }, true),
      { kind: "invalid-input" },
    );
    const result = await client.submitModeration(
      form.form,
      { reason: "Fictional reason" },
      true,
    );
    assert.deepEqual(await client.submitModeration(form.form, {}, true), {
      kind: "invalid-input",
    });
    return result;
  },
);
await scenario(
  "the moderator must explicitly choose a new batch if the server drops a thread",
  [step(batchQuery, batchForm(["80"]))],
  { kind: "selection-changed", target: batchTarget, offeredThreadIds: ["80"] },
  (client) => client.prepareModeration(batchTarget),
);

const legacy = "tsdmapp=json";
const hidden = (name, value) =>
  `<input type="hidden" name="${name}" value="${value}">`;
const choice = (name, options) =>
  `<select name="${name}">${options.map((value) => `<option value="${value}">Fictitious ${value}</option>`).join("")}</select>`;
const nativeForm = (formId, action, fields) =>
  viewerResult({
    kind: "page",
    document: `<form id="${formId}" method="post" action="forum.php?${action.replaceAll("&", "&amp;")}">${fields}</form>`,
  });
const common = [
  ["formhash", "controlled-form-token"],
  ["fid", "12"],
  ["handlekey", "mods"],
];
const modsWindow = "handlekey=mods&infloat=yes&nopost=yes";
const nativeReason = '<textarea name="reason"></textarea>';
for (const [operation, group, asksOperation, controls, changes] of [
  [
    "stick",
    1,
    false,
    choice("sticklevel", ["0", "1"]) + '<input name="expirationstick">',
    { sticklevel: "1" },
  ],
  [
    "digest",
    1,
    false,
    choice("digestlevel", ["0", "1"]) + '<input name="expirationdigest">',
    { digestlevel: "1" },
  ],
  [
    "highlight",
    1,
    true,
    hidden("highlight_color", "0") +
      hidden("highlight_style[1]", "0") +
      hidden("highlight_style[2]", "0") +
      hidden("highlight_style[3]", "0") +
      hidden("highlight_bgcolor", "") +
      '<input name="expirationhighlight">',
    { highlight_color: "2", "highlight_style[1]": "1" },
  ],
  [
    "recommend",
    1,
    true,
    choice("isrecommend", ["0", "1"]) +
      '<input name="expirationrecommend"><input name="reducetitle">',
    { isrecommend: "1", reducetitle: "Fictional recommendation" },
  ],
  ["close", 4, false, '<input name="expirationclose">', {}],
  ["open", 4, false, '<input name="expirationclose">', {}],
  [
    "move",
    2,
    false,
    choice("moveto", ["12", "13"]) +
      choice("threadtypeid", ["0"]) +
      choice("type", ["normal", "redirect"]),
    { moveto: "13" },
  ],
  ["type", 2, true, choice("typeid", ["0", "8"]), { typeid: "8" }],
  ["delete", 3, true, "", {}],
  ["bump", 3, false, '<input name="expirationbump">', {}],
  ["down", 3, false, '<input name="expirationdown">', {}],
]) {
  for (const ids of [["80"], ["80", "81"]]) {
    const target = { operation, forumId: "12", threadIds: ids };
    const list = ids.map((tid) => "&moderate%5B%5D=" + tid).join("");
    const action = `mod=topicadmin&action=moderate&optgroup=${group}&modsubmit=yes&infloat=yes`;
    const ask = `mod=topicadmin&action=moderate&fid=12${list}&${modsWindow}&optgroup=${group}${asksOperation ? "&operation=" + operation : ""}&inajax=1&${v4}`;
    const fixed = [...common, ...ids.map((tid) => ["moderate[]", tid])];
    const fixture = nativeForm(
      "moderateform",
      action,
      fixed.map(([k, v]) => hidden(k, v)).join("") +
        hidden("operations[]", operation) +
        controls +
        nativeReason,
    );
    const defaults = {
      stick: { sticklevel: "0", expirationstick: "" },
      digest: { digestlevel: "0", expirationdigest: "" },
      highlight: {
        highlight_color: "0",
        "highlight_style[1]": "0",
        "highlight_style[2]": "0",
        "highlight_style[3]": "0",
        highlight_bgcolor: "",
        expirationhighlight: "",
      },
      recommend: { isrecommend: "0", expirationrecommend: "", reducetitle: "" },
      close: { expirationclose: "" },
      open: { expirationclose: "" },
      move: { moveto: "12", threadtypeid: "0", type: "normal" },
      type: { typeid: "0" },
      bump: { expirationbump: "" },
      down: { expirationdown: "" },
    }[operation];
    const fields = [
      ...fixed,
      ["operations[]", operation],
      ...Object.entries({ ...defaults, ...changes, reason: "" }),
    ];
    const steps = [step(ask, fixture)];
    if (operation === "move")
      steps.push(
        step(
          `mod=ajax&action=getthreadtypes&fid=13&inajax=1&${v4}`,
          smallForm("threadtypes", {
            fid: 13,
            required: 0,
            submit: null,
            select: {
              name: "threadtypeid",
              choices: [{ value: "0", label: "" }],
            },
          }),
        ),
      );
    steps.push(
      step(action + "&inajax=1&" + legacy, ack, {
        method: "POST",
        effect: true,
        body: new URLSearchParams(fields).toString(),
      }),
    );
    await scenario(
      (ids.length === 1 ? "individual " : "batch ") +
        "thread operation " +
        operation,
      steps,
      { kind: "acknowledged", target, code: "admin_succeed" },
      async (client) => {
        const opened = await client.prepareModeration(target);
        assert.equal(opened.kind, "moderation-form");
        return client.submitModeration(opened.form, changes, true);
      },
    );
  }
}
for (const [operation, controls, fields, values] of [
  ["stamp", choice("stamp", ["", "2"]), [["stamp", "2"]], { stamp: "2" }],
  [
    "stamplist",
    choice("stamplist", ["", "4"]),
    [["stamplist", "4"]],
    { stamplist: "4" },
  ],
  [
    "copy",
    choice("copyto", ["12", "13"]) + choice("threadtypeid", ["0"]),
    [
      ["copyto", "13"],
      ["threadtypeid", "8"],
    ],
    { copyto: "13", threadtypeid: "8" },
  ],
  [
    "merge",
    '<input name="othertid">',
    [["othertid", "85"]],
    { othertid: "85" },
  ],
  [
    "split",
    '<input name="subject"><textarea name="split"></textarea>',
    [
      ["subject", "Fictional split"],
      ["split", "2,3"],
    ],
    { subject: "Fictional split", split: "2,3" },
  ],
]) {
  const target = { operation, forumId: "12", threadIds: ["80"] };
  const action = `mod=topicadmin&action=${operation}&modsubmit=yes&infloat=yes&modclick=yes`;
  const fixed = [...common, ["tid", "80"]];
  const steps = [
    step(
      `mod=topicadmin&action=${operation}&fid=12&tid=80&${modsWindow}&inajax=1&${legacy}`,
      nativeForm(
        "topicadminform",
        action,
        fixed.map(([k, v]) => hidden(k, v)).join("") + controls + nativeReason,
      ),
    ),
  ];
  if (operation === "split")
    steps.push(
      step(
        `mod=viewthread&tid=80&${legacy}&nodoc=1`,
        json({
          ok: 1,
          uid: 31,
          type: "thread",
          schema: 21,
          page: 1,
          pages: 1,
          thread: { tid: 80, fid: 12 },
          perms: { allow_split: 1 },
          posts: [
            { pid: 89, position: 1 },
            { pid: 90, position: 2 },
            { pid: 91, position: 3 },
          ],
        }),
      ),
    );
  if (operation === "copy")
    steps.push(
      step(
        `mod=ajax&action=getthreadtypes&fid=13&inajax=1&${v4}`,
        smallForm("threadtypes", {
          fid: 13,
          required: 1,
          submit: null,
          select: {
            name: "threadtypeid",
            choices: [{ value: "8", label: "Fictional type" }],
          },
        }),
      ),
    );
  steps.push(
    step(action + "&inajax=1&" + legacy, ack, {
      method: "POST",
      effect: true,
      body: new URLSearchParams([
        ...fixed,
        ...fields,
        ["reason", ""],
      ]).toString(),
    }),
  );
  await scenario(
    "thread operation " + operation,
    steps,
    { kind: "acknowledged", target, code: "admin_succeed" },
    async (client) => {
      const opened = await client.prepareModeration(target);
      assert.equal(opened.kind, "moderation-form");
      return client.submitModeration(opened.form, values, true);
    },
  );
}

for (const [operation, fieldName, legacyOnly, undo, value] of [
  ["delpost", "", false, false, ""],
  ["warn", "warned", false, false, "1"],
  ["warn", "warned", false, false, "0"],
  ["banpost", "banned", false, false, "1"],
  ["banpost", "banned", false, false, "0"],
  ["stickreply", "stickreply", true, false, "1"],
  ["stickreply", "stickreply", true, true, "0"],
]) {
  const target = {
    operation,
    forumId: "12",
    threadIds: ["80"],
    postId: "90",
    ...(undo && { undo: true }),
  };
  const action = `mod=topicadmin&action=${operation}&modsubmit=yes&infloat=yes&modclick=yes`;
  const ask = `mod=topicadmin&action=${operation}&fid=12&tid=80&topiclist%5B%5D=90&${modsWindow}${undo ? "&undo=1" : ""}&inajax=1&${legacyOnly ? legacy : v4}`;
  const fixed = [...common, ["tid", "80"], ["topiclist[]", "90"]];
  const reply = legacyOnly
    ? nativeForm(
        "topicadminform",
        action,
        fixed.map(([k, v]) => hidden(k, v)).join("") +
          choice(fieldName, [value, value === "1" ? "0" : "1"]) +
          nativeReason,
      )
    : smallForm(operation, {
        fid: 12,
        tid: 80,
        pids: [90],
        submit: {
          url: "forum.php?" + action,
          method: "POST",
          enctype: "application/x-www-form-urlencoded",
          fields: Object.fromEntries(fixed.slice(0, -1)),
          lists: { "topiclist[]": ["90"] },
        },
        [fieldName]: fieldName
          ? {
              name: fieldName,
              type: "radio",
              value,
              choices: [
                { value: "1", label: "Apply" },
                { value: "0", label: "Remove" },
              ],
            }
          : undefined,
        reason: { name: "reason", type: "textarea", value: "", required: 0 },
      });
  const body = new URLSearchParams([
    ...fixed,
    ...(fieldName ? [[fieldName, value]] : []),
    ["reason", "Fictitious reason"],
  ]).toString();
  await scenario(
    `reply operation ${operation} ${value}`,
    [
      step(ask, reply),
      step(
        action + "&inajax=1&" + legacy + (legacyOnly ? "" : "&tsdmv=4"),
        ack,
        { method: "POST", effect: true, body },
      ),
    ],
    { kind: "acknowledged", target, code: "admin_succeed" },
    async (client) => {
      const opened = await client.prepareModeration(target);
      assert.equal(opened.kind, "moderation-form");
      return client.submitModeration(
        opened.form,
        {
          reason: "Fictitious reason",
          ...(fieldName && { [fieldName]: value }),
        },
        true,
      );
    },
  );
}
const refusedFirstFloor = {
  operation: "delpost",
  forumId: "12",
  threadIds: ["80"],
  postId: "90",
};
await scenario(
  "first-floor delete redirect cannot authorize a whole-thread deletion",
  [
    step(
      `mod=topicadmin&action=delpost&fid=12&tid=80&topiclist%5B%5D=90&${modsWindow}&inajax=1&${v4}`,
      viewerResult({
        kind: "redirect",
        url: "forum.php?mod=topicadmin&action=moderate&operation=delete&optgroup=3&fid=12&moderate[]=80",
      }),
    ),
  ],
  { kind: "refused", code: "thread-delete-requires-separate-intent" },
  (client) => client.prepareModeration(refusedFirstFloor),
);

for (const operation of ["removereward", "refund"]) {
  const target = { operation, forumId: "12", threadIds: ["80"] };
  const ask = `mod=topicadmin&action=${operation}&fid=12&tid=80&${legacy}&tsdmform=1&nodoc=1`;
  const action = `mod=topicadmin&action=${operation}&modsubmit=yes&infloat=yes&modclick=yes`;
  const fixed = [...common, ["tid", "80"], ["modsubmit", "ture"]];
  const form = smallForm(operation, {
    tid: 80,
    subject: "Fictitious thread",
    price: 5,
    credit: { title: "Fictitious coins" },
    ...(operation === "refund"
      ? { payers: 2, income: 8 }
      : { special: 3, solved: 0 }),
    submit: {
      url: "forum.php?" + action,
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      fields: Object.fromEntries(fixed),
    },
    reason: { name: "reason", type: "textarea", value: "", required: 0 },
  });
  const body = new URLSearchParams([...fixed, ["reason", ""]]).toString();
  await scenario(
    `separately confirms ${operation} and displays its terms`,
    [
      step(ask, form),
      step(action + "&inajax=1&" + legacy, ack, {
        method: "POST",
        effect: true,
        body,
      }),
    ],
    { kind: "acknowledged", target, code: "admin_succeed" },
    async (client) => {
      const opened = await client.prepareModeration(target);
      assert.equal(opened.kind, "moderation-form");
      assert.ok(opened.form.context.includes("Fictitious thread"));
      return client.submitModeration(opened.form, {}, true);
    },
  );
}
const comment = {
  operation: "delcomment",
  forumId: "12",
  threadIds: ["80"],
  postId: "90",
  commentId: "72",
};
const delCommentAction =
  "mod=topicadmin&action=delcomment&modsubmit=yes&infloat=yes&modclick=yes";
const commentFixed = [...common, ["tid", "80"], ["topiclist", "72"]];
await scenario(
  "deletes the exact comment through its own form",
  [
    step(
      `mod=topicadmin&action=delcomment&tid=80&${modsWindow}&topiclist%5B%5D=72&inajax=1&${v4}`,
      smallForm("delcomment", {
        fid: 12,
        tid: 80,
        pid: 90,
        id: 72,
        reason: { name: "reason", type: "textarea" },
        submit: {
          url: "forum.php?" + delCommentAction,
          method: "POST",
          enctype: "application/x-www-form-urlencoded",
          fields: Object.fromEntries(commentFixed),
        },
      }),
    ),
    step(delCommentAction + "&inajax=1&" + legacy + "&tsdmv=4", ack, {
      method: "POST",
      effect: true,
      body: new URLSearchParams([...commentFixed, ["reason", ""]]).toString(),
    }),
  ],
  { kind: "acknowledged", target: comment, code: "admin_succeed" },
  async (client) => {
    const form = await client.prepareModeration(comment);
    assert.equal(form.kind, "moderation-form");
    return client.submitModeration(form.form, {}, true);
  },
);
const removal = {
  operation: "removerate",
  forumId: "12",
  threadIds: ["80"],
  postId: "90",
};
const removeRateAction =
  "mod=misc&action=removerate&ratesubmit=yes&infloat=yes";
const rateFixed = [
  ["formhash", "controlled-form-token"],
  ["tid", "80"],
  ["pid", "90"],
  ["handlekey", "rate"],
];
const rateReceipt = viewerResult({
  kind: "handle",
  handlekey: "rate",
  alert: "right",
  message_key: "thread_rate_removesucceed",
});
await scenario(
  "removes only the selected rating rows of the exact post",
  [
    step(
      `mod=misc&action=removerate&tid=80&pid=90&infloat=yes&handlekey=rate&inajax=1&${v4}`,
      smallForm("removerate", {
        tid: 80,
        pid: 90,
        reason: { name: "reason", type: "text" },
        logid: { name: "logidarray[]", type: "checkbox" },
        logs: [
          { value: "55 1 1234567890", username: "Fictitious rater", score: 2 },
        ],
        submit: {
          url: "forum.php?" + removeRateAction,
          method: "POST",
          enctype: "application/x-www-form-urlencoded",
          fields: Object.fromEntries(rateFixed),
        },
      }),
    ),
    step(removeRateAction + "&inajax=1&" + legacy + "&tsdmv=4", rateReceipt, {
      method: "POST",
      effect: true,
      body: new URLSearchParams([
        ...rateFixed,
        ["logidarray[]", "55 1 1234567890"],
        ["reason", ""],
      ]).toString(),
    }),
  ],
  { kind: "acknowledged", target: removal, code: "thread_rate_removesucceed" },
  async (client) => {
    const form = await client.prepareModeration(removal);
    assert.equal(form.kind, "moderation-form");
    assert.deepEqual(
      await client.submitModeration(
        form.form,
        { "logidarray[]": ["98 1 1234567890"] },
        true,
      ),
      { kind: "invalid-input" },
    );
    return client.submitModeration(
      form.form,
      { "logidarray[]": ["55 1 1234567890"] },
      true,
    );
  },
);

const threadRead = `mod=viewthread&tid=80&${legacy}&nodoc=1`;
const threadPage = (perms, post = {}) =>
  json({
    ok: 1,
    uid: 31,
    type: "thread",
    schema: 21,
    thread: { fid: 12, tid: 80, subject: "Fictional thread" },
    perms,
    posts: [{ pid: 90, first: 0, authorid: 55, ...post }],
  });
const sourceTarget = { forumId: "12", threadId: "80", postId: "90" };
const ipURL = "mod=topicadmin&action=getip&pid=90";
const ipPage = (url) =>
  threadPage(
    { allow_viewip: 1 },
    { can: { viewip: 1 }, urls: { viewip: url } },
  );
await scenario(
  "reads only the offered poster IP and omits supplied administrator links",
  [
    step(threadRead, ipPage("forum.php?" + ipURL)),
    step(
      ipURL + "&" + legacy + "&tsdmform=1&nodoc=1",
      smallForm("getip", {
        tid: 80,
        pid: 90,
        authorid: 55,
        ip: "203.0.113.8",
        port: 1234,
        location: "Documentation network",
        submit: null,
        admincp: {
          ban_ip: "admin.php?action=members&operation=ipban&ip=203.0.113.8",
        },
      }),
    ),
  ],
  {
    kind: "poster-ip",
    forumId: "12",
    threadId: "80",
    postId: "90",
    ip: "203.0.113.8",
    port: 1234,
    location: "Documentation network",
  },
  (client) => client.readPosterIp(sourceTarget),
);
await scenario(
  "poster-IP authority cannot substitute another post",
  [step(threadRead, ipPage("forum.php?mod=topicadmin&action=getip&pid=92"))],
  { kind: "invalid-response" },
  (client) => client.readPosterIp(sourceTarget),
);
await scenario(
  "no poster-IP permission cannot open the private read",
  [
    step(
      threadRead,
      threadPage(
        { allow_viewip: 0 },
        { can: { viewip: 1 }, urls: { viewip: "forum.php?" + ipURL } },
      ),
    ),
  ],
  { kind: "refused", code: "permission-not-offered" },
  (client) => client.readPosterIp(sourceTarget),
);
const repair = { operation: "repair", forumId: "12", threadIds: ["80"] };
const repairURL = `mod=topicadmin&action=repair&fid=12&tid=80&${modsWindow}&inajax=1&${legacy}`;
const repairAck = viewerResult({
  kind: "handle",
  handlekey: "mods",
  alert: "right",
  message_key: "admin_repair_succeed",
});
await scenario(
  "repair opens no topicadmin preview and acts only on the approved request",
  [
    step(threadRead, threadPage({ allow_repair: 1 })),
    step(repairURL, repairAck, { method: "POST", effect: true, body: "" }),
  ],
  { kind: "acknowledged", target: repair, code: "admin_repair_succeed" },
  async (client) => {
    const result = await client.prepareModeration(repair);
    assert.equal(result.kind, "moderation-form");
    assert.deepEqual(await client.submitModeration(result.form, {}, false), {
      kind: "not-confirmed",
    });
    return client.submitModeration(result.form, {}, true);
  },
);
await scenario(
  "repair permission missing sends no repair request",
  [step(threadRead, threadPage({ allow_repair: 0 }))],
  { kind: "refused", code: "permission-not-offered" },
  (client) => client.prepareModeration(repair),
);
const attachment = {
  operation: "deleteattach",
  forumId: "12",
  threadIds: ["80"],
  postId: "90",
  attachmentId: "96",
};
const editURL = "mod=post&action=edit&fid=12&tid=80&pid=90&page=1";
const attachThread = threadPage(
  { allow_delattach: 1 },
  { can: { edit: 1 }, urls: { edit: "forum.php?" + editURL } },
);
const editForm = (aid) =>
  json({
    ok: 1,
    uid: 31,
    type: "post",
    schema: 16,
    action: "edit",
    fid: 12,
    tid: 80,
    pid: 90,
    formhash: "fictional-edit-form",
    attach: { used: [{ aid, filename: "fictional.zip" }], unused: [] },
  });
const attachmentRead = [
  step(threadRead, attachThread),
  step(editURL + "&" + legacy + "&nodoc=1", editForm(96)),
];
const deleteURL = `mod=ajax&action=deleteattach&inajax=yes&formhash=fictional-edit-form&tid=80&pid=90&aids%5B%5D=96&${legacy}`;
for (const [name, reply, response, result] of [
  [
    "one deleted",
    viewerResult({ kind: "page", document: "1" }),
    {},
    { kind: "acknowledged", target: attachment, code: "deleteattach_succeed" },
  ],
  [
    "zero deleted",
    viewerResult({ kind: "page", document: "0" }),
    {},
    { kind: "refused", code: "deleteattach_none" },
  ],
  [
    "response lost",
    json({}),
    { drop: true },
    { kind: "uncertain", target: attachment },
  ],
  [
    "expired hash or server error",
    json({}),
    { status: 503 },
    { kind: "uncertain", target: attachment },
  ],
]) {
  await scenario(
    "attachment effectful GET " + name,
    [...attachmentRead, step(deleteURL, reply, { effect: true }, response)],
    result,
    async (client) => {
      const ready = await client.prepareModeration(attachment);
      assert.equal(ready.kind, "moderation-form");
      assert.equal(ready.form.method, "GET");
      assert.ok(ready.form.context.includes("fictional.zip"));
      assert.deepEqual(await client.submitModeration(ready.form, {}, false), {
        kind: "not-confirmed",
      });
      const effect = await client.submitModeration(ready.form, {}, true);
      assert.deepEqual(await client.submitModeration(ready.form, {}, true), {
        kind: "invalid-input",
      });
      return effect;
    },
  );
}
await scenario(
  "unlisted attachment cannot become an effectful URL",
  [
    step(threadRead, attachThread),
    step(editURL + "&" + legacy + "&nodoc=1", editForm(97)),
  ],
  { kind: "refused", code: "attachment-not-offered" },
  (client) => client.prepareModeration(attachment),
);

const xml = (fragment) => ({
  body: `<?xml version="1.0"?><root><![CDATA[${fragment}]]></root>`,
  contentType: "application/xml",
});
const copy = { operation: "copy", forumId: "12", threadIds: ["80"] };
const copyAsk = `mod=topicadmin&action=copy&fid=12&tid=80&${modsWindow}&inajax=1&${legacy}`;
const copyAction =
  "mod=topicadmin&action=copy&modsubmit=yes&infloat=yes&modclick=yes";
const copyControls =
  [...common, ["tid", "80"]]
    .map(([name, value]) => hidden(name, value))
    .join("") +
  choice("copyto", ["13"]) +
  choice("threadtypeid", ["0"]) +
  nativeReason;
const copyForm = nativeForm("topicadminform", copyAction, copyControls);
const offeredType = smallForm("threadtypes", {
  fid: 13,
  required: 0,
  submit: null,
  select: { name: "threadtypeid", choices: [{ value: "0", label: "" }] },
});
const copyTypes = step(
  `mod=ajax&action=getthreadtypes&fid=13&inajax=1&${v4}`,
  offeredType,
);
const copyDispatch = {
  method: "POST",
  effect: true,
  body: new URLSearchParams([
    ...common,
    ["tid", "80"],
    ["copyto", "13"],
    ["threadtypeid", "0"],
    ["reason", ""],
  ]).toString(),
};
for (const [name, reply, response, verdict] of [
  [
    "recognized native handler",
    xml(
      `<script type="text/javascript" reload="1">if(typeof succeedhandle_mods=='function') {succeedhandle_mods('./', 'Fictional receipt', {});}</script>`,
    ),
    {},
    { kind: "acknowledged", target: copy, code: "admin_succeed" },
  ],
  [
    "server refusal",
    viewerResult({
      ok: 0,
      kind: "handle",
      handlekey: "mods",
      alert: "error",
      message_key: "admin_copy_invalid",
    }),
    {},
    { kind: "refused", code: "admin_copy_invalid" },
  ],
  ["the form was redrawn", copyForm, {}, { kind: "redrawn", target: copy }],
  [
    "unknown 503 after dispatch",
    json({}),
    { status: 503 },
    { kind: "uncertain", target: copy },
  ],
  [
    "redirect with unknown effect",
    viewerResult({ kind: "redirect", url: "https://offsite.example/" }),
    {},
    { kind: "uncertain", target: copy },
  ],
  [
    "success-shaped wrong account",
    viewerResult({
      uid: 33,
      kind: "handle",
      handlekey: "mods",
      message_key: "admin_succeed",
    }),
    {},
    { kind: "uncertain", target: copy },
  ],
  [
    "success-shaped different thread",
    viewerResult({
      kind: "handle",
      handlekey: "mods",
      message_key: "admin_succeed",
      values: { tid: 81 },
    }),
    {},
    { kind: "uncertain", target: copy },
  ],
]) {
  await scenario(
    "copy receipt " + name,
    [
      step(copyAsk, copyForm),
      copyTypes,
      step(copyAction + "&inajax=1&" + legacy, reply, copyDispatch, response),
    ],
    verdict,
    async (client) => {
      const preparation = await client.prepareModeration(copy);
      assert.equal(preparation.kind, "moderation-form");
      const effect = await client.submitModeration(
        preparation.form,
        { copyto: "13" },
        true,
      );
      assert.deepEqual(
        await client.submitModeration(preparation.form, { copyto: "13" }, true),
        { kind: "invalid-input" },
      );
      return effect;
    },
  );
}
await scenario(
  "changing session cannot dispatch an old form",
  [step(copyAsk, copyForm)],
  { kind: "session-changed" },
  async (client, options) => {
    const preparation = await client.prepareModeration(copy);
    options.session = () => ({
      memberId: "31",
      continuity: "replacement-controlled-session",
    });
    return client.submitModeration(preparation.form, { copyto: "13" }, true);
  },
);
await scenario(
  "an off-origin window action grants no moderation form",
  [
    step(
      copyAsk,
      viewerResult({
        kind: "page",
        document: `<form id="topicadminform" method="post" action="https://offsite.example/forum.php?${copyAction}">${copyControls}</form>`,
      }),
    ),
  ],
  { kind: "invalid-response" },
  (client) => client.prepareModeration(copy),
);
await scenario(
  "v4 destination lookup falls back only to a qualified native select",
  [
    step(threadTypes, json({ ok: 0, uid: 31, error: "action" })),
    step(
      `mod=ajax&action=getthreadtypes&fid=12&inajax=1&${legacy}`,
      xml(choice("threadtypeid", ["0", "8"])),
    ),
  ],
  {
    kind: "thread-types",
    forumId: "12",
    required: false,
    choices: [
      { value: "0", label: "Fictitious 0" },
      { value: "8", label: "Fictitious 8" },
    ],
  },
  (client) => client.readDestinationTypes("12"),
);

const { removeReply } = await import("./example.mjs");
await scenario(
  "packaged TypeScript asks before deleting the exact reply",
  [
    step(
      `mod=topicadmin&action=delpost&fid=12&tid=80&topiclist%5B%5D=90&${modsWindow}&inajax=1&${v4}`,
      smallForm("delpost", {
        fid: 12,
        tid: 80,
        pids: [90],
        submit: {
          url: "forum.php?mod=topicadmin&action=delpost&modsubmit=yes&infloat=yes&modclick=yes",
          method: "POST",
          enctype: "application/x-www-form-urlencoded",
          fields: Object.fromEntries([...common, ["tid", "80"]]),
          lists: { "topiclist[]": ["90"] },
        },
      }),
    ),
  ],
  { kind: "not-confirmed" },
  (_client, options) =>
    removeReply(options, "12", "80", "90", async (selection) => {
      assert.deepEqual(selection, {
        forumId: "12",
        threadId: "80",
        postId: "90",
      });
      return false;
    }),
);

const splitWhole = {
  operation: "split",
  forumId: "12",
  threadIds: ["80"],
  splitPages: [1, 2],
};
const splitAction =
  "mod=topicadmin&action=split&modsubmit=yes&infloat=yes&modclick=yes";
const offeredSplit = step(
  `mod=topicadmin&action=split&fid=12&tid=80&${modsWindow}&inajax=1&${legacy}`,
  nativeForm(
    "topicadminform",
    splitAction,
    [...common, ["tid", "80"]].map(([k, v]) => hidden(k, v)).join("") +
      '<input name="subject"><textarea name="split"></textarea>' +
      nativeReason,
  ),
);
const splitPage = (page, posts) =>
  json({
    ok: 1,
    uid: 31,
    type: "thread",
    schema: 21,
    page,
    pages: 2,
    thread: { tid: 80, fid: 12 },
    perms: { allow_split: 1 },
    posts,
  });
const splitSteps = [
  offeredSplit,
  step(
    threadRead,
    splitPage(1, [
      { pid: 89, position: 1 },
      { pid: 90, position: 2 },
    ]),
  ),
  step(
    `mod=viewthread&tid=80&page=2&${legacy}&nodoc=1`,
    splitPage(2, [{ pid: 92, position: 3 }]),
  ),
];
await scenario(
  "refuses to split away every observed floor across the selected pages",
  splitSteps,
  { kind: "refused", code: "split-requires-observed-retained-floor" },
  async (client) => {
    const opened = await client.prepareModeration(splitWhole);
    assert.equal(opened.kind, "moderation-form");
    return client.submitModeration(
      opened.form,
      { subject: "Fictional split", split: "1,2,3" },
      true,
    );
  },
);
await scenario(
  "allows an approved same-forum copy offered by the server",
  [
    step(
      copyAsk,
      nativeForm(
        "topicadminform",
        copyAction,
        copyControls.replace('value="13"', 'value="12"'),
      ),
    ),
    step(
      threadTypes,
      smallForm("threadtypes", {
        fid: 12,
        required: 0,
        submit: null,
        select: { name: "threadtypeid", choices: [{ value: "0", label: "" }] },
      }),
    ),
    step(copyAction + "&inajax=1&" + legacy, ack, {
      method: "POST",
      effect: true,
      body: new URLSearchParams([
        ...common,
        ["tid", "80"],
        ["copyto", "12"],
        ["threadtypeid", "0"],
        ["reason", ""],
      ]).toString(),
    }),
  ],
  { kind: "acknowledged", target: copy, code: "admin_succeed" },
  async (client) => {
    const opened = await client.prepareModeration(copy);
    assert.equal(opened.kind, "moderation-form");
    return client.submitModeration(opened.form, { copyto: "12" }, true);
  },
);

await scenario(
  "a replaced session cannot perform the old form’s destination preflight",
  [step(copyAsk, copyForm)],
  { kind: "session-changed" },
  async (client, options) => {
    const opened = await client.prepareModeration(copy);
    assert.equal(opened.kind, "moderation-form");
    const values = {
      get copyto() {
        options.session = () => ({
          memberId: "33",
          continuity: "replacement-fictional-moderator",
        });
        return "13";
      },
    };
    return client.submitModeration(opened.form, values, true);
  },
);

console.log(JSON.stringify(results));
