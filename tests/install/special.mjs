import assert from "node:assert/strict";
import { createSpecialThreadClient } from "tsdm-sdk";
import { voteForSide } from "./special-guide.js";

const origin = "https://special.example";
const session = { memberId: "31", continuity: "fixture-session" };
const forum = origin + "/forum.php";
const mode = new URLSearchParams({ tsdmapp: "json" }).toString();
const subject = "A fictitious discussion";
const message = "Fictitious content for this controlled replay.";
const baseEditor = `${forum}?mod=post&action=newthread&fid=7`;
const submit = `${baseEditor}&extra=&topicsubmit=yes&fixture=sent`;
const view = `${forum}?mod=viewthread&tid=42`;
const located = {
  threadId: "42",
  postId: "101",
  url: `${forum}?mod=redirect&goto=findpost&ptid=42&pid=101`,
};
const field = (name, value = "", type = "text", more = {}) => ({
  name,
  value,
  type,
  ...more,
});
const defaults = {
  formhash: "fakehash",
  posttime: "1700000000",
  wysiwyg: "1",
  topicsubmit: "true",
  save: "",
};
const form = (number, block, content, extras = {}) => ({
  ok: 1,
  type: "post",
  schema: 16,
  uid: 31,
  action: "newthread",
  fid: 7,
  tid: 0,
  pid: 0,
  first: 1,
  submit: {
    url: submit,
    method: "POST",
    fields: {
      ...defaults,
      special: String(number),
      ...(number === 127 ? { specialextra: "hongbao" } : {}),
    },
  },
  subject: { value: "", shown: 1, min: 1, max: 80, unit: "dstrlen" },
  message: { value: "", min: 10, max: 10000, unit: "bytes" },
  special: {
    current: number,
    specialextra: number === 127 ? "hongbao" : "",
    sortid: 0,
  },
  options: [field("usesig", "1", "checkbox", { checked: 1, disabled: 0 })],
  [block]: content,
  ...extras,
});
const poll = form(1, "poll", {
  image: 0,
  max_options: 20,
  inputs: [
    field("polls", "yes", "hidden"),
    field("fid", "7", "hidden"),
    field("tpolloption", "1", "hidden"),
    field("polloptions", "", "textarea"),
    field("maxchoices", "1"),
    field("expiration"),
    field("visibilitypoll", "1", "checkbox", { checked: 0 }),
    field("overt", "1", "checkbox", { checked: 0 }),
  ],
});
const write = {
  ok: 1,
  uid: 31,
  type: "result",
  schema: 13,
  kind: "redirect",
  login: 0,
  url: view,
};
const page = (special, value) => ({
  ok: 1,
  type: "thread",
  schema: 15,
  uid: 31,
  thread: {
    tid: 42,
    fid: 7,
    special,
    draft: 0,
    displayorder: 0,
    subject,
    closed: 0,
    authorid: 31,
  },
  formhash: "fakehash",
  posts: [{ pid: 101, first: 1, authorid: 31, message, invisible: 0 }],
  special: value,
});
const get = (url, value, extra = {}) => ({
  method: "GET",
  url,
  value,
  ...extra,
});
const post = (url, fields, value, extra = {}) => ({
  method: "POST",
  url,
  fields,
  value,
  ...extra,
});
const results = [];
async function scenario(name, steps, expected, operation) {
  let active = session;
  const observedRequests = [];
  const host = {
    origin,
    session: () => active,
    transport: {
      async request(url, req) {
        const step = steps[observedRequests.length];
        observedRequests.push({
          url,
          method: req.method,
          effect: req.effect,
          ...(req.body !== undefined && {
            fields: Object.fromEntries(new URLSearchParams(req.body)),
          }),
        });
        assert.deepEqual(req.session, session);
        assert.equal(req.fresh, true);
        assert.ok(step);
        if (step.switchSession)
          active = { ...session, continuity: "different" };
        if (step.drop) throw new Error("controlled loss");
        return {
          url,
          redirect: "none",
          status: 200,
          contentType: step.html ? "text/html" : "application/json",
          body: step.html ?? JSON.stringify(step.value),
        };
      },
    },
  };
  const observed = await operation(createSpecialThreadClient(host), host);
  const expectedRequests = steps.map(
    ({ method, url, fields, effect = method === "POST" }) => ({
      url,
      method,
      effect,
      ...(fields && { fields }),
    }),
  );
  assert.deepEqual(observedRequests, expectedRequests, name);
  assert.deepEqual(observed, expected, name);
  results.push({ name, expected, observed, requests: observedRequests });
}
async function create(client, threadType, settings) {
  const prepared = await client.openSpecialThread("7", threadType);
  assert.equal(prepared.kind, "post-form");
  return client.createSpecialThread(prepared.form, {
    subject,
    message,
    settings,
  });
}
const opening = `${baseEditor}&special=1`;
const pollFields = {
  ...defaults,
  special: "1",
  usesig: "1",
  polls: "yes",
  fid: "7",
  tpolloption: "1",
  polloptions: "Amber\nViolet",
  maxchoices: "1",
  expiration: "",
  subject,
  message,
};
await scenario(
  "create a poll and observe its choices",
  [
    get(`${opening}&${mode}&nodoc=1`, poll),
    post(`${submit}&${mode}`, pollFields, write),
    get(
      `${view}&${mode}&nodoc=1`,
      page(1, {
        type: "poll",
        choices: [{ text: "Amber" }, { text: "Violet" }],
      }),
    ),
  ],
  { kind: "created", threadType: "poll", post: located },
  (client) =>
    create(client, "poll", { kind: "poll", choices: ["Amber", "Violet"] }),
);
const bounty = form(3, "reward", {
  state: "new",
  min: 1,
  max: 50,
  have: 48,
  tax: 0.2,
  inputs: [field("rewardprice", "1")],
});
const rewardOpen = get(`${baseEditor}&special=3&${mode}&nodoc=1`, bounty);
await scenario(
  "create a bounty and observe its offered reward",
  [
    rewardOpen,
    post(
      `${submit}&${mode}`,
      {
        ...defaults,
        special: "3",
        usesig: "1",
        rewardprice: "10",
        subject,
        message,
      },
      write,
    ),
    get(
      `${view}&${mode}&nodoc=1`,
      page(3, { type: "reward", price: 10, resolved: 0 }),
    ),
  ],
  { kind: "created", threadType: "bounty", post: located },
  (client) => create(client, "bounty", { kind: "bounty", price: 10 }),
);
await scenario(
  "bounty tax and balance reject an unaffordable price before dispatch",
  [rewardOpen],
  { kind: "invalid-input" },
  (client) => create(client, "bounty", { kind: "bounty", price: 45 }),
);
const activity = form(4, "activity", {
  extnum: 0,
  inputs: [
    field("starttimefrom[0]"),
    field("starttimefrom[1]"),
    field("starttimeto"),
    field("activitytime", "1", "checkbox", { checked: 0 }),
    field("activityplace"),
    field("activitycity"),
    field("activityclass"),
    field("activitynumber"),
    field("gender", "0", "select", { choices: [{ value: "0" }] }),
    field("userfield[]", "mobile", "checkbox", { checked: 0 }),
    field("activitycredit"),
    field("cost"),
    field("activityexpiration"),
    field("activityaid", "", "hidden"),
    field("activityaid_url", "", "hidden"),
  ],
});
const activityOpen = get(`${baseEditor}&special=4&${mode}&nodoc=1`, activity);
const startsAt = "2099-05-16 15:30";
const endsAt = "2099-05-16 17:30";
await scenario(
  "create an activity with a range and one requested profile field",
  [
    activityOpen,
    post(
      `${submit}&${mode}`,
      {
        ...defaults,
        special: "4",
        usesig: "1",
        "starttimefrom[0]": "",
        "starttimefrom[1]": startsAt,
        starttimeto: endsAt,
        activitytime: "1",
        activityplace: "Fictional room",
        activitycity: "",
        activityclass: "Workshop",
        activitynumber: "8",
        gender: "0",
        "userfield[0]": "mobile",
        activitycredit: "",
        cost: "",
        activityexpiration: "",
        activityaid: "",
        activityaid_url: "",
        subject,
        message,
      },
      write,
    ),
    get(
      `${view}&${mode}&nodoc=1`,
      page(4, {
        type: "activity",
        class: "Workshop",
        place: "Fictional room",
        number: 8,
      }),
    ),
  ],
  { kind: "created", threadType: "activity", post: located },
  (client) =>
    create(client, "activity", {
      kind: "activity",
      startsAt,
      endsAt,
      place: "Fictional room",
      category: "Workshop",
      capacity: 8,
      requiredProfileFields: ["mobile"],
    }),
);
await scenario(
  "an activity end earlier than its start is invalid",
  [activityOpen],
  { kind: "invalid-input" },
  (client) =>
    create(client, "activity", {
      kind: "activity",
      startsAt: endsAt,
      endsAt: startsAt,
      place: "Fictional room",
      category: "Workshop",
    }),
);
const debate = form(5, "debate", {
  inputs: [
    field("affirmpoint", "", "textarea"),
    field("negapoint", "", "textarea"),
    field("endtime"),
    field("umpire"),
  ],
});
const debateOpen = get(`${baseEditor}&special=5&${mode}&nodoc=1`, debate);
await scenario(
  "create a debate and observe both positions",
  [
    debateOpen,
    post(
      `${submit}&${mode}`,
      {
        ...defaults,
        special: "5",
        usesig: "1",
        affirmpoint: "Fictional affirmative",
        negapoint: "Fictional negative",
        endtime: endsAt,
        umpire: "Fictitious Referee",
        subject,
        message,
      },
      write,
    ),
    get(
      `${view}&${mode}&nodoc=1`,
      page(5, {
        type: "debate",
        affirmpoint: "Fictional affirmative",
        negapoint: "Fictional negative",
      }),
    ),
  ],
  { kind: "created", threadType: "debate", post: located },
  (client) =>
    create(client, "debate", {
      kind: "debate",
      affirmative: "Fictional affirmative",
      negative: "Fictional negative",
      endsAt,
      umpire: "Fictitious Referee",
    }),
);
const packetForm = form(127, "hongbao", null, {
  unsupported: ["threadplugin"],
});
const packetURL = `${baseEditor}&specialextra=hongbao`;
const packetBox = `<html><head><script>var discuz_uid = '31';</script></head><body>
<form method="post" id="postform" action="${submit.replaceAll("&", "&amp;")}">
<input type="hidden" name="formhash" value="fakehash"><input type="hidden" name="special" value="127"><input type="hidden" name="specialextra" value="hongbao">
<div class="hb-postbox"><input name="hb_total" type="number"><span class="hb-bal">90</span>
<input name="hb_shares" type="number" max="10"><label>每份至少 2</label>
<input name="hb_split" type="radio" value="1" checked><input name="hb_split" type="radio" value="2">
<input name="hb_cond" type="checkbox" value="1"><input name="hb_password" maxlength="64"><input name="hb_appoint">
<select name="hb_expire"><option value="6">6 hours</option><option value="24" selected>1 day</option></select>
<input name="hb_blessing" maxlength="50" value="Fictional blessing"></div></form></body></html>`;
const packetSettings = {
  kind: "red-packet",
  total: 20,
  shares: 4,
  split: "even",
  requireReply: true,
  expiresAfterHours: "6",
};
const packetOpen = [
  get(`${packetURL}&${mode}&nodoc=1`, packetForm),
  get(packetURL, undefined, { html: packetBox }),
];
const packetFields = {
  ...defaults,
  special: "127",
  specialextra: "hongbao",
  usesig: "1",
  hb_total: "20",
  hb_shares: "4",
  hb_split: "2",
  hb_cond: "1",
  hb_password: "",
  hb_appoint: "",
  hb_expire: "6",
  hb_blessing: "Fictional blessing",
  subject,
  message,
};
await scenario(
  "create a red packet and observe the sender and share count",
  [
    ...packetOpen,
    post(`${submit}&${mode}`, packetFields, write),
    get(
      `${view}&${mode}&nodoc=1`,
      page(127, {
        type: "hongbao",
        packetid: 77,
        is_sender: 1,
        sender: { uid: "31" },
        shares: 4,
        split: "even",
        need_reply: 1,
      }),
    ),
  ],
  { kind: "created", threadType: "red-packet", post: located },
  (client) => create(client, "red-packet", packetSettings),
);
await scenario(
  "red packet forum notice without a packet identity remains uncertain",
  [
    ...packetOpen,
    post(`${submit}&${mode}`, packetFields, {
      ...write,
      kind: "message",
      alert: "info",
      url: "",
      message: "Fictitious packet notice",
    }),
  ],
  { kind: "uncertain" },
  (client) => create(client, "red-packet", packetSettings),
);
await scenario(
  "red packet share minimum and divisibility prevent invalid spending",
  packetOpen,
  { kind: "invalid-input" },
  (client) => create(client, "red-packet", { ...packetSettings, total: 17 }),
);
const viewStructured = `${view}&${mode}&nodoc=1`;
const pollAction = `${forum}?mod=misc&action=votepoll&fid=7&tid=42&pollsubmit=yes&quickforward=yes`;
const pollVote = {
  type: "poll",
  can_vote: 1,
  voted: 0,
  maxchoices: 2,
  multiple: 1,
  choices: [
    { id: 201, text: "Amber" },
    { id: 202, text: "Violet" },
  ],
  form: {
    action: pollAction,
    method: "POST",
    choice: "pollanswers[]",
    fields: {},
  },
};
const pollTarget = { operation: "poll-vote", boardId: "7", threadId: "42" };
const pollPost = {
  formhash: "fakehash",
  pollsubmit: "true",
  "pollanswers[0]": "201",
  "pollanswers[1]": "202",
};
async function participate(client, target, input) {
  const prepared = await client.prepareSpecialAction(target);
  assert.equal(prepared.kind, "action-form");
  return client.submitSpecialAction(prepared.form, input);
}
await scenario(
  "vote on a poll with an offered multiple choice",
  [
    get(viewStructured, page(1, pollVote)),
    post(`${pollAction}&${mode}`, pollPost, {
      ...write,
      message_key: "thread_poll_succeed",
      message: "",
    }),
  ],
  { kind: "poll-voted", message: "" },
  async (client) => {
    const prepared = await client.prepareSpecialAction(pollTarget);
    assert.deepEqual(prepared.form.choices, [
      { id: "201", label: "Amber" },
      { id: "202", label: "Violet" },
    ]);
    assert.deepEqual(
      await client.submitSpecialAction(prepared.form, { choices: ["999"] }),
      { kind: "invalid-input" },
    );
    const result = await client.submitSpecialAction(prepared.form, {
      choices: ["201", "202"],
    });
    assert.deepEqual(
      await client.submitSpecialAction(prepared.form, {
        choices: ["201", "202"],
      }),
      { kind: "invalid-input" },
    );
    return result;
  },
);
await scenario(
  "a lost poll vote response sends just once",
  [
    get(viewStructured, page(1, pollVote)),
    post(`${pollAction}&${mode}`, pollPost, undefined, { drop: true }),
  ],
  { kind: "uncertain" },
  (client) => participate(client, pollTarget, { choices: ["201", "202"] }),
);
await scenario(
  "poll form targeting a different thread is invalid",
  [
    get(
      viewStructured,
      page(1, {
        ...pollVote,
        form: {
          ...pollVote.form,
          action: pollAction.replace("tid=42", "tid=43"),
        },
      }),
    ),
  ],
  { kind: "invalid-response" },
  (client) => client.prepareSpecialAction(pollTarget),
);
const activityAction = `${forum}?mod=misc&action=activityapplies&fid=7&tid=42&pid=101`;
const selectControl = (name, type, value, required, choices = []) => ({
  name,
  title: name,
  type,
  value,
  required,
  choices,
});
const apply = {
  type: "activity",
  can_apply: 1,
  can_cancel: 0,
  applied: 0,
  apply: {
    action: activityAction,
    method: "POST",
    fields: { handlekey: "activityapplies", activitysubmit: "true" },
    inputs: [
      selectControl("payment", "radio", "0", 1, [
        { value: "0", label: "Own expenses" },
      ]),
      selectControl("field-size", "select", "small", 1, [
        { value: "small", label: "Small" },
        { value: "large", label: "Large" },
      ]),
      selectControl("message", "textarea", "", 1),
      selectControl("date-choice", "checkbox", "", 0, [
        { value: "day", label: "Day" },
      ]),
    ],
  },
};
const applyTarget = {
  operation: "activity-apply",
  boardId: "7",
  threadId: "42",
};
await scenario(
  "apply for an activity using the served questions",
  [
    get(viewStructured, page(4, apply)),
    post(
      `${activityAction}&inajax=1&${mode}`,
      {
        formhash: "fakehash",
        handlekey: "activityapplies",
        activitysubmit: "true",
        payment: "0",
        "field-size": "large",
        message: "Fictitious application",
        "date-choice[0]": "day",
      },
      {
        ...write,
        kind: "handle",
        message_key: "activity_completion",
        message: "Application received",
      },
    ),
  ],
  { kind: "activity-applied", message: "Application received" },
  async (client) => {
    const prepared = await client.prepareSpecialAction(applyTarget);
    assert.equal(prepared.form.inputs[1].choices[1].value, "large");
    assert.deepEqual(
      await client.submitSpecialAction(prepared.form, {
        fields: { "field-size": "foreign" },
      }),
      { kind: "invalid-input" },
    );
    return client.submitSpecialAction(prepared.form, {
      fields: {
        "field-size": "large",
        message: "Fictitious application",
        "date-choice": ["day"],
      },
    });
  },
);
const cancel = {
  type: "activity",
  can_apply: 0,
  can_cancel: 1,
  applied: 1,
  cancel: {
    action: activityAction,
    method: "POST",
    fields: { activitycancel: "true" },
    inputs: [selectControl("message", "text", "", 0)],
  },
};
await scenario(
  "cancel activity participation with a message",
  [
    get(viewStructured, page(4, cancel)),
    post(
      `${activityAction}&${mode}`,
      {
        formhash: "fakehash",
        activitycancel: "true",
        message: "Fictitious cancellation",
      },
      {
        ...write,
        kind: "message",
        message_key: "activity_cancel_success",
        alert: "right",
        url: `${view}&do=viewapplylist`,
        message: "Cancelled",
      },
    ),
  ],
  { kind: "activity-cancelled", message: "Cancelled" },
  (client) =>
    participate(
      client,
      { ...applyTarget, operation: "activity-cancel" },
      { fields: { message: "Fictitious cancellation" } },
    ),
);
await scenario(
  "an activity form with a native-only field hands off",
  [
    get(
      viewStructured,
      page(4, {
        ...apply,
        apply: {
          ...apply.apply,
          inputs: [selectControl("upload", "file", "", 1)],
        },
      }),
    ),
  ],
  { kind: "browser-handoff", destination: view },
  (client) => client.prepareSpecialAction(applyTarget),
);
const debates = {
  type: "debate",
  ended: 0,
  can_vote: 1,
  reply_stand: 0,
  voted: 0,
  vote: {
    action_template: `${forum}?mod=misc&action=debatevote&tid=42&stand={stand}`,
    method: "GET",
    fields: { inajax: "1" },
  },
  vote_post: {
    action_template: `${forum}?mod=misc&action=debatevote&tid=42&pid={pid}`,
    method: "GET",
    fields: { inajax: "1" },
  },
  join_template: `${baseEditor.replace("newthread", "reply")}&tid=42&stand={stand}`,
};
const opinion = { pid: 102, first: 0, stand: 1, authorid: 32, invisible: 0 };
const debatePage = page(5, debates);
debatePage.posts.push(opinion);
const debateTarget = { boardId: "7", threadId: "42" };
const debateWrite = {
  ...write,
  kind: "handle",
  message_key: "debate_poll_succeed",
  alert: "right",
  message: "Voted",
};
const effectGet = (url, value, extra = {}) =>
  get(url, value, { effect: true, ...extra });
const voteBase = `${forum}?mod=misc&action=debatevote&tid=42`;
await scenario(
  "vote for the negative debate position with an effectful GET",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&stand=2&inajax=1&${mode}`, debateWrite),
  ],
  { kind: "debate-position-voted", message: "Voted" },
  (client) =>
    participate(client, {
      ...debateTarget,
      operation: "debate-position",
      stand: 2,
    }),
);
await scenario(
  "vote for the other member's specific debate post with an effectful GET",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&pid=102&inajax=1&${mode}`, debateWrite),
  ],
  { kind: "debater-voted", message: "Voted" },
  (client) =>
    participate(client, {
      ...debateTarget,
      operation: "debater-vote",
      postId: "102",
    }),
);
await scenario(
  "a repeated debater vote receives the forum's already-voted result",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&pid=102&inajax=1&${mode}`, {
      ...debateWrite,
      message_key: "debate_poll_voted",
      alert: "info",
      message: "Already voted",
    }),
  ],
  { kind: "already-voted", message: "Already voted" },
  (client) =>
    participate(client, {
      ...debateTarget,
      operation: "debater-vote",
      postId: "102",
    }),
);
await scenario(
  "voting for one's own debate post is refused before dispatch",
  [
    get(viewStructured, {
      ...debatePage,
      posts: [debatePage.posts[0], { ...opinion, authorid: 31 }],
    }),
  ],
  { kind: "refused" },
  (client) =>
    client.prepareSpecialAction({
      ...debateTarget,
      operation: "debater-vote",
      postId: "102",
    }),
);
await scenario(
  "joining a debate hands off to the supplied editor with the chosen position",
  [get(viewStructured, debatePage)],
  {
    kind: "browser-handoff",
    destination: debates.join_template.replace("{stand}", "1"),
  },
  (client) =>
    client.prepareSpecialAction({
      ...debateTarget,
      operation: "debate-join",
      stand: 1,
    }),
);
await scenario(
  "lost effectful debate GET stays uncertain after one dispatch",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&pid=102&inajax=1&${mode}`, undefined, {
      drop: true,
    }),
  ],
  { kind: "uncertain" },
  (client) =>
    participate(client, {
      ...debateTarget,
      operation: "debater-vote",
      postId: "102",
    }),
);
const bestURL = `${forum}?mod=misc&action=bestanswer&tid=42&pid=102&from=&bestanswersubmit=yes`;
const bestFields = {
  optgroup: "",
  operation: "",
  listextra: "page%3D1",
  page: "1",
};
const bestPage = page(3, {
  type: "reward",
  resolved: 0,
  can_set_best: 1,
  set_best: {
    action_template: bestURL.replace("pid=102", "pid={pid}"),
    method: "POST",
    fields: bestFields,
    pids: [102],
  },
});
bestPage.posts.push(opinion);
const bountyTarget = {
  ...debateTarget,
  operation: "bounty-answer",
  postId: "102",
};
await scenario(
  "select a bounty answer with the forum's success key even when its alert is info",
  [
    get(viewStructured, bestPage),
    post(
      `${bestURL}&${mode}`,
      { formhash: "fakehash", ...bestFields },
      {
        ...write,
        kind: "message",
        message_key: "reward_completion",
        alert: "info",
        message: "Best answer selected",
      },
    ),
  ],
  { kind: "bounty-answer-selected", message: "Best answer selected" },
  (client) => participate(client, bountyTarget),
);
await scenario(
  "the forum expressly refuses the bounty selection",
  [
    get(viewStructured, bestPage),
    post(
      `${bestURL}&${mode}`,
      { formhash: "fakehash", ...bestFields },
      {
        ...write,
        ok: 0,
        kind: "message",
        message_key: "reward_cant_operate",
        alert: "error",
        message: "Selection refused",
        url: "",
      },
    ),
  ],
  {
    kind: "refused",
    code: "reward_cant_operate",
    message: "Selection refused",
  },
  (client) => participate(client, bountyTarget),
);
await scenario(
  "bounty answer must be an advertised reply",
  [get(viewStructured, bestPage)],
  { kind: "refused" },
  (client) => client.prepareSpecialAction({ ...bountyTarget, postId: "101" }),
);
await scenario(
  "poll requires moderation and the thread is still pending",
  [
    get(`${opening}&${mode}&nodoc=1`, poll),
    post(`${submit}&${mode}`, pollFields, {
      ...write,
      kind: "message",
      alert: "right",
      message_key: "post_newthread_mod_succeed",
      message: "Pending review",
    }),
  ],
  { kind: "moderation" },
  (client) =>
    create(client, "poll", { kind: "poll", choices: ["Amber", "Violet"] }),
);
await scenario(
  "native special editor is a browser handoff without submission",
  [
    get(`${opening}&${mode}&nodoc=1`, undefined, {
      html: "<html><form id=postform></form></html>",
    }),
  ],
  { kind: "browser-handoff", destination: opening },
  (client) => client.openSpecialThread("7", "poll"),
);
await scenario(
  "a published ordinary thread does not qualify a claimed poll",
  [
    get(`${opening}&${mode}&nodoc=1`, poll),
    post(`${submit}&${mode}`, pollFields, write),
    get(viewStructured, page(0, null)),
  ],
  { kind: "uncertain" },
  (client) =>
    create(client, "poll", { kind: "poll", choices: ["Amber", "Violet"] }),
);
await scenario(
  "poll writes cannot override the special selector through supplied controls",
  [
    get(`${opening}&${mode}&nodoc=1`, {
      ...poll,
      poll: {
        ...poll.poll,
        inputs: [...poll.poll.inputs, field("special", "3", "hidden")],
      },
    }),
  ],
  { kind: "browser-handoff", destination: opening },
  (client) => client.openSpecialThread("7", "poll"),
);
await scenario(
  "a session change during a debate effect leaves uncertainty",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&stand=2&inajax=1&${mode}`, debateWrite, {
      switchSession: true,
    }),
  ],
  { kind: "uncertain" },
  (client) =>
    participate(client, {
      ...debateTarget,
      operation: "debate-position",
      stand: 2,
    }),
);
await scenario(
  "generic success text after a vote does not identify the effect",
  [
    get(viewStructured, page(1, pollVote)),
    post(`${pollAction}&${mode}`, pollPost, {
      ...write,
      kind: "message",
      alert: "right",
      message_key: "",
      message: "Generic result",
    }),
  ],
  { kind: "uncertain" },
  (client) => participate(client, pollTarget, { choices: ["201", "202"] }),
);
await scenario(
  "packaged TypeScript guide stops after the read when unapproved",
  [get(viewStructured, debatePage)],
  { kind: "action-form" },
  async (_, host) => ({
    kind: (await voteForSide(host, "7", "42", 2, false)).kind,
  }),
);
await scenario(
  "packaged TypeScript guide executes one approved effectful GET",
  [
    get(viewStructured, debatePage),
    effectGet(`${voteBase}&stand=2&inajax=1&${mode}`, debateWrite),
  ],
  { kind: "debate-position-voted", message: "Voted" },
  (_, host) => voteForSide(host, "7", "42", 2, true),
);
await scenario(
  "an activity editor cannot supply a different board in a special field",
  [
    get(activityOpen.url, {
      ...activity,
      activity: {
        ...activity.activity,
        inputs: [...activity.activity.inputs, field("fid", "8", "hidden")],
      },
    }),
  ],
  { kind: "browser-handoff", destination: `${baseEditor}&special=4` },
  (client) => client.openSpecialThread("7", "activity"),
);
console.log(JSON.stringify(results));
