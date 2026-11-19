import assert from "node:assert/strict";
import { createTaskMagicClient } from "tsdm-sdk";

const origin = "https://tasks.example";
const session = { memberId: "31", continuity: "fictional-session" };
const home = `${origin}/home.php`;
const page = "&tsdmapp=json&tsdmv=4&nodoc=1";
const write = "&tsdmapp=json&tsdmv=4";
const get = (query, data, extra = {}) => ({ query, data, ...extra });
const effect = (query, data, extra = {}) =>
  get(query, data, { effect: true, ...extra });
const response = (type, schema, properties) => ({
  ok: 1,
  uid: 31,
  type,
  schema,
  ...properties,
});
const results = [];
async function scenario(name, steps, expected, exercise) {
  const requests = [];
  const options = {
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const step = steps[requests.length];
        assert.ok(step, `Unexpected request ${url}`);
        requests.push({
          url,
          method: request.method,
          effect: request.effect,
          ...(request.body === undefined ? {} : { body: request.body }),
        });
        assert.deepEqual(request.session, session);
        assert.equal(request.fresh, true);
        if (step.drop) throw new Error("Fictitious lost response");
        return {
          url,
          status: step.status ?? 200,
          redirect: step.redirect ?? "none",
          location: step.location,
          contentType: step.contentType ?? "application/json",
          body: step.body ?? JSON.stringify(step.data),
        };
      },
    },
  };
  const observed = await exercise(createTaskMagicClient(options), options);
  const expectedRequests = steps.map((step) => ({
    url: `${home}?${step.query}`,
    method: step.post === undefined ? "GET" : "POST",
    effect: step.effect ?? false,
    ...(step.post === undefined ? {} : { body: step.post }),
  }));
  assert.deepEqual(requests, expectedRequests, name);
  assert.deepEqual(observed, expected, name);
  results.push({ name, expected, observed, expectedRequests, requests });
}
const listURL = (tab) => `mod=task&item=${tab}${page}`;
const view = "home.php?mod=task&do=view&id=42";
const apply = "home.php?mod=task&do=apply&id=42";
const draw = "home.php?mod=task&do=draw&id=42";
const abandon = "home.php?mod=task&do=delete&id=42";
const credit = { id: 2, title: "Fictional credits", unit: "" };
const reward = { type: "credit", credit, amount: 5 };
const task = {
  taskid: 42,
  name: "Fictitious forum task",
  description: "Fictitious instruction",
  reward,
  url: view,
  applicants: 3,
};
const readNew = get(
  listURL("new"),
  response("task_list", 65, {
    item: "new",
    tasks: [{ ...task, noperm: 0, full: 0, apply_url: apply }],
  }),
);
const listed = {
  id: "42",
  name: task.name,
  description: task.description,
  reward,
  applicants: 3,
  progress: null,
  url: `${origin}/${view}`,
  actions: ["apply"],
};
await scenario(
  "new tasks expose their exact offer without visiting it",
  [readNew],
  { kind: "task-list", tab: "new", tasks: [listed] },
  (client) => client.readTasks("new"),
);

const detailURL = `mod=task&do=view&id=42${page}`;
const detail = {
  ...task,
  state: -1,
  csc: 34,
  condition_html: "Complete the <b>fictitious action</b>",
  conditions: [{ name: "Count", value: "3" }],
  period: { type: 2, value: 7 },
  endtime: 1700003600,
  timeoffset: 8,
  next: "Next fictitious period",
  apply_condition: { limit: 10 },
  parter_url: "home.php?mod=task&do=parter&id=42",
  draw_url: draw,
  delete_url: abandon,
};
const active = { ...listed, progress: 34, actions: ["claim"] };
const done = { ...listed, actions: [] };
const readDetail = get(detailURL, response("task", 66, detail));
const outcome = (message_key, fields = {}) =>
  response("result", 13, {
    kind: "message",
    message_key,
    url: view,
    ...fields,
  });
await scenario(
  "active tasks show progress and the claim action",
  [
    get(
      listURL("doing"),
      response("task_list", 65, {
        item: "doing",
        tasks: [{ ...task, csc: 34, draw_url: draw }],
      }),
    ),
  ],
  { kind: "task-list", tab: "doing", tasks: [active] },
  (client) => client.readTasks("doing"),
);
await scenario(
  "finished tasks do not imply a reward can be claimed again",
  [
    get(
      listURL("done"),
      response("task_list", 65, { item: "done", tasks: [task] }),
    ),
  ],
  { kind: "task-list", tab: "done", tasks: [done] },
  (client) => client.readTasks("done"),
);
await scenario(
  "wrong viewer cannot authorize an effect",
  [get(listURL("new"), { ...readNew.data, uid: 32 })],
  { kind: "session-changed" },
  (client) => client.readTasks("new"),
);
await scenario(
  "detail reports progress, condition and the participant route",
  [readDetail],
  {
    kind: "task-detail",
    task: { ...active, actions: ["claim", "abandon"] },
    state: -1,
    condition: "Complete the fictitious action",
    conditions: [{ name: "Count", value: "3" }],
    period: { type: 2, value: 7 },
    endTime: 1700003600,
    timeOffset: 8,
    next: "Next fictitious period",
    applyCondition: { limit: 10 },
    participantsURL: `${origin}/${detail.parter_url}`,
  },
  (client) => client.readTask("42"),
);
await scenario(
  "finished task detail cannot authorize an inconsistent effect link",
  [get(detailURL, { ...readDetail.data, state: -5, apply_url: apply })],
  { kind: "invalid-input" },
  async (client) => {
    const read = await client.readTask("42");
    assert.equal(read.kind, "task-detail");
    assert.deepEqual(read.task.actions, []);
    return client.prepareTaskAction(read.task, "abandon");
  },
);
const participant = {
  uid: 33,
  username: "Fictitious Participant",
  avatar: "/avatar.php?uid=33",
  csc: 100,
  status: 1,
};
await scenario(
  "task participants are linked to the exact task",
  [
    get(
      `mod=task&do=parter&id=42${page}`,
      response("task_parter", 67, { taskid: 42, list: [participant] }),
    ),
  ],
  {
    kind: "task-participants",
    taskId: "42",
    participants: [
      {
        memberId: "33",
        username: participant.username,
        avatarURL: `${origin}${participant.avatar}`,
        status: 1,
        progress: 100,
      },
    ],
  },
  (client) => client.readTaskParticipants("42"),
);
async function taskEffect(client, action, useDetail = false) {
  const preparedFrom = useDetail
    ? await client.readTask("42")
    : await client.readTasks("new");
  const item = useDetail ? preparedFrom.task : preparedFrom.tasks[0];
  assert.deepEqual(client.prepareTaskAction({ ...item }, action), {
    kind: "invalid-input",
  });
  const prepared = client.prepareTaskAction(item, action);
  assert.equal(prepared.kind, "task-action");
  assert.deepEqual(await client.confirmTaskAction(prepared.action, false), {
    kind: "not-confirmed",
  });
  const result = await client.confirmTaskAction(prepared.action, true);
  assert.deepEqual(await client.confirmTaskAction(prepared.action, true), {
    kind: "invalid-input",
  });
  return result;
}
const runTask = (action, payload, extra) =>
  effect(`${action.split("?")[1]}${write}`, payload, extra);
await scenario(
  "apply is an effectful GET and its claim redirect is held",
  [readNew, runTask(apply, outcome("", { kind: "redirect", url: draw }))],
  { kind: "applied", taskId: "42", claimAvailable: true },
  (client) => taskEffect(client, "apply"),
);
await scenario(
  "a manual native redirect does not claim twice",
  [
    readNew,
    runTask(apply, undefined, { status: 302, location: draw, body: "" }),
  ],
  { kind: "applied", taskId: "42", claimAvailable: true },
  (client) => taskEffect(client, "apply"),
);
await scenario(
  "application refusal can arrive as ok=1",
  [
    readNew,
    runTask(apply, outcome("task_duplicate", { message: "Already applied" })),
  ],
  { kind: "refused", code: "task_duplicate", message: "Already applied" },
  (client) => taskEffect(client, "apply"),
);
await scenario(
  "claim has its own success receipt",
  [readDetail, runTask(draw, outcome("task_reward_credit"))],
  { kind: "rewarded", taskId: "42" },
  (client) => taskEffect(client, "claim", true),
);
await scenario(
  "claim can return progress without paying a reward",
  [readDetail, runTask(draw, outcome("task_doing", { message: "34%" }))],
  { kind: "in-progress", taskId: "42", progress: 34, message: "34%" },
  (client) => taskEffect(client, "claim", true),
);
await scenario(
  "a legacy claim progress fragment stays distinct",
  [
    readDetail,
    runTask(
      draw,
      outcome("", {
        kind: "page",
        url: "",
        document: "38|Fictitious progress",
      }),
    ),
  ],
  {
    kind: "in-progress",
    taskId: "42",
    progress: 38,
    message: "Fictitious progress",
  },
  (client) => taskEffect(client, "claim", true),
);
await scenario(
  "abandon is independently confirmed and acknowledged",
  [readDetail, runTask(abandon, outcome("task_deleted"))],
  { kind: "abandoned", taskId: "42" },
  (client) => taskEffect(client, "abandon", true),
);
await scenario(
  "a lost abandon response is uncertain and is not resent",
  [readDetail, runTask(abandon, null, { drop: true })],
  { kind: "uncertain", taskId: "42" },
  (client) => taskEffect(client, "abandon", true),
);
await scenario(
  "another task’s redirect is uncertain",
  [
    readNew,
    runTask(
      apply,
      outcome("", { kind: "redirect", url: draw.replace("42", "43") }),
    ),
  ],
  { kind: "uncertain", taskId: "42" },
  (client) => taskEffect(client, "apply"),
);

const magicId = "34";
const identifier = "prankmagic:pkcat";
const buy =
  "home.php?mod=magic&action=shop&operation=buy&mid=prankmagic%3Apkcat";
const use = "home.php?mod=magic&action=mybox&operation=use&magicid=34";
const magic = {
  magicid: 34,
  identifier,
  name: "Fictitious Magic",
  description: "Fictitious effect",
  pic: "/magic.gif",
};
const capacity = { used: 20, max: 100 };
const balances = [{ ...credit, amount: 50 }];
const shopData = response("magic_shop", 69, {
  operation: "index",
  page: 1,
  pages: 2,
  capacity,
  balances,
  list: [{ ...magic, price: 5, credit, soldout: 0, buy_url: buy }],
});
const boxData = response("magic_mybox", 70, {
  page: 1,
  pages: 1,
  capacity,
  list: [{ ...magic, num: 2, weight: 10, use_url: use }],
});
const shopRead = get(`mod=magic&action=shop${page}`, shopData);
const boxRead = get(`mod=magic&action=mybox${page}`, boxData);
const magicBase = {
  id: magicId,
  identifier,
  name: magic.name,
  description: magic.description,
  imageURL: `${origin}/magic.gif`,
};
await scenario(
  "shop reads credits, capacity, prices and an available item",
  [shopRead],
  {
    kind: "magic-shop",
    page: 1,
    pages: 2,
    capacity,
    balances,
    items: [{ ...magicBase, price: 5, credit, available: true }],
  },
  (client) => client.readMagicShop(),
);
await scenario(
  "inventory reads counts and weight separately",
  [boxRead],
  {
    kind: "magic-inventory",
    page: 1,
    pages: 1,
    capacity,
    items: [{ ...magicBase, count: 2, weight: 10, available: true }],
  },
  (client) => client.readMagicInventory(),
);
const logBase = { magicid: 34, name: "Fictitious Magic", dateline: 1700000000 };
const logExpected = { magicId, name: logBase.name, time: 1700000000 };
const counterparty = { uid: 33, username: "Fictitious Counterparty" };
for (const [direction, operation, data, expected] of [
  [
    "usage",
    "uselog",
    { target: { type: "tid", id: 42, url: "forum.php?mod=viewthread&tid=42" } },
    {
      target: {
        type: "tid",
        id: "42",
        url: `${origin}/forum.php?mod=viewthread&tid=42`,
      },
    },
  ],
  [
    "purchase",
    "buylog",
    { amount: 2, price: 10, credit },
    { amount: 2, price: 10, credit },
  ],
  [
    "gift",
    "givelog",
    { amount: 2, user: counterparty },
    { amount: 2, member: { id: "33", username: counterparty.username } },
  ],
  [
    "receipt",
    "receivelog",
    { amount: 1, user: counterparty },
    { amount: 1, member: { id: "33", username: counterparty.username } },
  ],
]) {
  const log = response("magic_log", 71, {
    operation,
    page: 2,
    pages: 3,
    timeoffset: 8,
    list: [{ ...logBase, ...data }],
  });
  await scenario(
    `separate ${direction} log preserves its direction and entries`,
    [get(`mod=magic&action=log&operation=${operation}&page=2${page}`, log)],
    {
      kind: "magic-log",
      direction,
      page: 2,
      pages: 3,
      timeOffset: 8,
      entries: [{ ...logExpected, ...expected }],
    },
    (client) => client.readMagicLog(direction, 2),
  );
}
await scenario(
  "empty gift log is an observed empty page",
  [
    get(
      `mod=magic&action=log&operation=givelog${page}`,
      response("magic_log", 71, {
        operation: "givelog",
        page: 1,
        pages: 0,
        timeoffset: 8,
        list: [],
      }),
    ),
  ],
  {
    kind: "magic-log",
    direction: "gift",
    page: 1,
    pages: 1,
    timeOffset: 8,
    entries: [],
  },
  (client) => client.readMagicLog("gift"),
);
await scenario(
  "another log direction cannot answer the selected read",
  [
    get(
      `mod=magic&action=log&operation=receivelog${page}`,
      response("magic_log", 71, {
        operation: "givelog",
        page: 1,
        pages: 0,
        list: [],
      }),
    ),
  ],
  { kind: "invalid-response" },
  (client) => client.readMagicLog("receipt"),
);

const formWindow = "&infloat=yes&handlekey=magics&inajax=1";
const format = "&tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1";
const buyQuery = buy.split("?")[1] + formWindow;
const useQuery = use.split("?")[1] + formWindow;
const buyTarget = "home.php?mod=magic&action=shop&infloat=yes";
const useTarget = "home.php?mod=magic&action=mybox&infloat=yes";
const buyFields = {
  formhash: "fictitious-buy-hash",
  handlekey: "magics",
  operation: "buy",
  mid: identifier,
  operatesubmit: "yes",
};
const useFields = {
  formhash: "fictitious-use-hash",
  handlekey: "magics",
  operation: "use",
  magicid: magicId,
  usesubmit: "yes",
};
const formPayload = (form, url, fields, additions) =>
  response("form", 17, {
    form,
    magic,
    submit: {
      url,
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      fields,
    },
    unsupported: [],
    hook_fields: [],
    ...additions,
  });
const buyOffer = get(
  buyQuery + format,
  formPayload("magicbuy", buyTarget, buyFields, {
    price: 5,
    discountprice: 4,
    credit,
    balance: 50,
    weight: 10,
    free_weight: 20,
    stock: 4,
    num: { name: "magicnum", type: "text", value: "1" },
  }),
);
const settings =
  '<p>Choose a fictitious member</p><input type="text" name="username" value="" maxlength="20">';
const useOffer = get(
  useQuery + format,
  formPayload("magicuse", useTarget, useFields, {
    controls: [{ name: "username", type: "text", value: "" }],
    show_html: settings,
  }),
);
const postMagic = (url, fields, data, extra = {}, flags = write) =>
  get(url.split("?")[1] + flags, data, {
    effect: true,
    post: new URLSearchParams(fields).toString(),
    ...extra,
  });
const bought = outcome("magics_buy_succeed", {
  kind: "handle",
  handlekey: "magics",
  url: "home.php?mod=magic&action=mybox",
});
const used = outcome("", {
  kind: "handle",
  handlekey: "magics",
  url: "home.php?mod=magic&action=mybox",
  message: "Fictitious effect took place",
});
async function magicForm(client, operation) {
  const list =
    operation === "buy"
      ? await client.readMagicShop()
      : await client.readMagicInventory();
  assert.ok(list.items);
  return operation === "buy"
    ? client.prepareMagicPurchase(list.items[0])
    : client.prepareMagicUse(list.items[0]);
}
async function writeMagic(client, operation, values) {
  const offer = await magicForm(client, operation);
  assert.equal(offer.kind, "magic-form");
  assert.equal(offer.form.operation, operation);
  assert.deepEqual(await client.confirmMagic(offer.form, values, false), {
    kind: "not-confirmed",
  });
  if (operation === "buy") {
    assert.deepEqual(offer.form.purchase, {
      price: 5,
      unitPrice: 4,
      balance: 50,
      unitWeight: 10,
      freeWeight: 20,
      stock: 4,
      credit,
    });
    assert.deepEqual(
      await client.confirmMagic(offer.form, { magicnum: "3" }, true),
      { kind: "invalid-input" },
    );
  }
  assert.deepEqual(
    await client.confirmMagic(
      offer.form,
      { ...values, injected: "never sent" },
      true,
    ),
    { kind: "invalid-input" },
  );
  const result = await client.confirmMagic(offer.form, values, true);
  assert.deepEqual(await client.confirmMagic(offer.form, values, true), {
    kind: "invalid-input",
  });
  return result;
}
const buyInput = { magicnum: "2" };
const useInput = { username: "Fictitious Member" };
await scenario(
  "inspect purchase terms and send one approved purchase",
  [
    shopRead,
    buyOffer,
    postMagic(buyTarget, { ...buyFields, ...buyInput }, bought),
  ],
  { kind: "purchased", magicId, identifier },
  (client) => writeMagic(client, "buy", buyInput),
);
await scenario(
  "purchase without a purchase receipt remains uncertain",
  [
    shopRead,
    buyOffer,
    postMagic(
      buyTarget,
      { ...buyFields, ...buyInput },
      { ...bought, message_key: "" },
    ),
  ],
  { kind: "uncertain", magicId, identifier },
  (client) => writeMagic(client, "buy", buyInput),
);
await scenario(
  "magic purchase can be refused on final balance check",
  [
    shopRead,
    buyOffer,
    postMagic(
      buyTarget,
      { ...buyFields, ...buyInput },
      {
        ...bought,
        ok: 0,
        message_key: "magics_credits_no_enough",
        message: "Fictitious balance declined",
      },
    ),
  ],
  {
    kind: "refused",
    code: "magics_credits_no_enough",
    message: "Fictitious balance declined",
  },
  (client) => writeMagic(client, "buy", buyInput),
);
await scenario(
  "inspect the exact native target control and consume one magic on explicit use",
  [
    boxRead,
    useOffer,
    postMagic(useTarget, { ...useFields, ...useInput }, used),
  ],
  { kind: "used", magicId, identifier },
  async (client) => {
    const prepared = await magicForm(client, "use");
    assert.equal(prepared.kind, "magic-form");
    assert.deepEqual(prepared.form.fields, [
      {
        name: "username",
        label: "username",
        type: "text",
        value: "",
        maxLength: 20,
        choices: [],
        required: true,
      },
    ]);
    assert.deepEqual(
      await client.confirmMagic(prepared.form, { username: "" }, true),
      { kind: "invalid-input" },
    );
    return client.confirmMagic(prepared.form, useInput, true);
  },
);
await scenario(
  "a plugin use control mismatch hands off without dispatch",
  [
    boxRead,
    {
      ...useOffer,
      data: {
        ...useOffer.data,
        controls: [...useOffer.data.controls, { name: "tid", type: "text" }],
      },
    },
  ],
  { kind: "browser-handoff", destination: `${origin}/${use}` },
  (client) => magicForm(client, "use"),
);
await scenario(
  "a hostile form action cannot authorize a purchase",
  [
    shopRead,
    {
      ...buyOffer,
      data: {
        ...buyOffer.data,
        submit: {
          ...buyOffer.data.submit,
          url: `https://wrong.example/${buyTarget}`,
        },
      },
    },
  ],
  { kind: "invalid-response" },
  (client) => magicForm(client, "buy"),
);
await scenario(
  "lost magic use does not automatically consume another",
  [
    boxRead,
    useOffer,
    postMagic(useTarget, { ...useFields, ...useInput }, null, { drop: true }),
  ],
  { kind: "uncertain", magicId, identifier },
  (client) => writeMagic(client, "use", useInput),
);
const xml = (fragment) =>
  `<?xml version="1.0"?><root><![CDATA[${fragment}]]></root>`;
const legacyFlag = "&tsdmapp=json";
const hidden = (fields) =>
  Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${value}">`,
    )
    .join("");
const legacyUse = `<form id="magicform" method="post" action="${useTarget.replaceAll("&", "&amp;")}">
  ${hidden(useFields)}${hidden({ operation: "use", magicid: magicId })}
  <dl class="xld"><dt>Fictitious Magic<div class="pns"><p class="mtm mbn">Thread ID</p><input name="tid" type="text" value=""></div></dt></dl>
  <div class="o pns"><button type="submit" name="usesubmit" value="true">Use</button></div></form>`;
await scenario(
  "legacy use can open an AJAX form and post a qualified exact thread ID",
  [
    boxRead,
    get(useQuery + format, {
      ok: 0,
      uid: 31,
      error: "unknown",
      form: "magicuse",
    }),
    get(useQuery + legacyFlag, null, {
      body: xml(legacyUse),
      contentType: "text/xml",
    }),
    postMagic(
      useTarget,
      { ...useFields, tid: "42" },
      null,
      {
        body: xml(
          "<script>succeedhandle_magics('forum.php?mod=viewthread&tid=42','Fictitious success',{});</script>",
        ),
        contentType: "text/xml",
      },
      legacyFlag,
    ),
  ],
  { kind: "used", magicId, identifier },
  (client) => writeMagic(client, "use", { tid: "42" }),
);

const html = (fragment) => ({
  body: `<html><head><script>var discuz_uid = '31', STYLEID = '2';</script></head><body>${fragment}</body></html>`,
  contentType: "text/html",
});
const nativeTask =
  html(`<div id="ct"><table><tr><td><a href="${view}">Fictitious forum task</a><p class="xg2">Fictitious instruction</p></td>
<td class="xi1">5 fictional credits</td><td><a href="${apply}">Apply</a></td></tr></table><ul><li class="a"><a href="home.php?mod=task&amp;item=new">New</a></li></ul></div>`);
await scenario(
  "a recognized legacy task list authorizes only its native apply route",
  [
    get(listURL("new"), null, nativeTask),
    effect(`mod=task&do=apply&id=42&inajax=1${legacyFlag}`, null, {
      contentType: "text/xml",
      body: xml(
        `<div class="alert_info"><script>succeedhandle_('${view}','Fictitious applied',{});</script></div>`,
      ),
    }),
  ],
  { kind: "applied", taskId: "42", claimAvailable: false },
  (client) => taskEffect(client, "apply"),
);
await scenario(
  "unsupported participants are a safe browser read handoff",
  [
    get(
      `mod=task&do=parter&id=42${page}`,
      null,
      html("<p>Legacy participant read</p>"),
    ),
  ],
  { kind: "browser-handoff", destination: `${home}?mod=task&do=parter&id=42` },
  (client) => client.readTaskParticipants("42"),
);
const nativeGrid = (row, mode) =>
  html(`<div id="ct"><div class="mn"><div class="bm"><p class="tbmu">20/100</p><ul class="mgcl"><li>
<div id="magic_${identifier}" class="mg_img"><img src="/magic.gif"></div><div class="tip_c">${magic.description}</div><p><strong>${magic.name}</strong></p>
${row}</li></ul></div></div><ul><li class="a"><a href="home.php?mod=magic&amp;action=${mode}">${mode}</a></li></ul></div>`);
const nativeBox = nativeGrid(
  `<p>数量: <font>2</font> 总重量: <font>10</font></p><p class="mtn"><a href="${use}">Use</a></p>`,
  "mybox",
);
await scenario(
  "native inventory reads exact counts and use availability",
  [get(`mod=magic&action=mybox${page}`, null, nativeBox)],
  {
    kind: "magic-inventory",
    capacity,
    page: 1,
    pages: 1,
    items: [{ ...magicBase, count: 2, weight: 10, available: true }],
  },
  (client) => client.readMagicInventory(),
);
const nativeShop = nativeGrid(
  `<p>5 Fictional credits <strong class="xs2">5</strong></p><p class="mtn"><a href="${buy}">Buy</a></p>`,
  "shop",
);
const nativeBuy = `<form id="magicform" method="post" action="${buyTarget.replaceAll("&", "&amp;")}">
  ${hidden(buyFields)}<dl><dt><p>Fictitious description</p><p>售价: <span id="magicprice">5</span></p>
  <p>重量: <span id="magicweight">10</span></p><p>库存: <span>4</span></p><input id="magicnum" name="magicnum" value="1"></dt></dl>
  <button name="operatesubmit" value="true">Buy</button></form><script>var totalcredit = 50; var totalweight = 20;</script>`;
await scenario(
  "legacy shop and purchase form retain limits and qualified success",
  [
    get(`mod=magic&action=shop${page}`, null, nativeShop),
    get(buyQuery + legacyFlag, null, {
      body: xml(nativeBuy),
      contentType: "text/xml",
    }),
    postMagic(
      buyTarget,
      { ...buyFields, ...buyInput },
      null,
      {
        body: xml(
          "<script>succeedhandle_magics('home.php?mod=magic&action=mybox','Fictitious success',{});</script>",
        ),
        contentType: "text/xml",
      },
      legacyFlag,
    ),
  ],
  { kind: "purchased", magicId: null, identifier },
  async (client) => {
    const prepared = await magicForm(client, "buy");
    assert.equal(prepared.kind, "magic-form");
    assert.deepEqual(prepared.form.purchase, {
      price: 5,
      unitPrice: 5,
      balance: 50,
      unitWeight: 10,
      freeWeight: 20,
      stock: 4,
      credit: null,
    });
    return client.confirmMagic(prepared.form, buyInput, true);
  },
);
await scenario(
  "a session change before approval prevents effectful GET",
  [readDetail],
  { kind: "session-changed" },
  async (client, options) => {
    const read = await client.readTask("42");
    const prepared = client.prepareTaskAction(read.task, "abandon");
    options.session = () => ({
      ...session,
      continuity: "fictional-replacement",
    });
    return client.confirmTaskAction(prepared.action, true);
  },
);
await scenario(
  "an older plugin without the structured task page is retried only as a read",
  [
    get(listURL("new"), { ok: 0, error: "unknown" }),
    get(`mod=task&item=new${legacyFlag}`, null, nativeTask),
  ],
  {
    kind: "task-list",
    tab: "new",
    tasks: [
      { ...listed, applicants: null, reward: { text: "5 fictional credits" } },
    ],
  },
  (client) => client.readTasks("new"),
);
await scenario(
  "a structured shop unavailable on v4 is read on its legacy route",
  [
    get(`mod=magic&action=shop${page}`, { ok: 0, error: "unknown" }),
    get(`mod=magic&action=shop${legacyFlag}`, null, nativeShop),
  ],
  {
    kind: "magic-shop",
    page: 1,
    pages: 1,
    capacity,
    balances: [],
    items: [
      { ...magicBase, id: null, price: 5, credit: null, available: true },
    ],
  },
  (client) => client.readMagicShop(),
);
await scenario(
  "a differently typed structured control cannot prepare magic use",
  [
    boxRead,
    {
      ...useOffer,
      data: {
        ...useOffer.data,
        controls: [{ name: "username", type: "number", value: "" }],
      },
    },
  ],
  { kind: "browser-handoff", destination: `${origin}/${use}` },
  (client) => magicForm(client, "use"),
);
await scenario(
  "redisplayed magic form leaves the write uncertain",
  [
    boxRead,
    useOffer,
    postMagic(useTarget, { ...useFields, ...useInput }, useOffer.data),
  ],
  { kind: "uncertain", magicId, identifier },
  (client) => writeMagic(client, "use", useInput),
);
await scenario(
  "a failed task claim is separate from refusal and success",
  [
    readDetail,
    runTask(
      draw,
      outcome("task_failed", { ok: 0, message: "Fictitious task failed" }),
    ),
  ],
  { kind: "failed", taskId: "42" },
  (client) => taskEffect(client, "claim", true),
);
await scenario(
  "native claimed-reward fragment verifies its own claim",
  [
    readDetail,
    runTask(
      draw,
      outcome("", {
        kind: "page",
        url: "",
        document: "100|task_reward_credit",
      }),
    ),
  ],
  { kind: "rewarded", taskId: "42" },
  (client) => taskEffect(client, "claim", true),
);
await scenario(
  "already-finished task may expose an explicit reapply action",
  [
    get(
      listURL("done"),
      response("task_list", 65, {
        item: "done",
        tasks: [{ ...task, reapply: 1, reapply_url: apply }],
      }),
    ),
  ],
  { kind: "task-list", tab: "done", tasks: [listed] },
  (client) => client.readTasks("done"),
);
const { applyExample } = await import("./example.mjs");
await scenario(
  "the packed TypeScript guide respects the declined application",
  [readNew],
  { kind: "not-confirmed" },
  (_client, options) => applyExample(options, "42", async () => false),
);
console.log(JSON.stringify(results));
