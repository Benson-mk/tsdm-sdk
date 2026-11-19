import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createBatchRatingClient } from "tsdm-sdk";
const origin = "https://ratings.example";
const plugin = `${origin}/plugin.php`;
const session = { memberId: "31", continuity: "fictional-rating-session" };
const statusURL = "id=tsdmapp%3Aapi&action=status";
const capabilityURL = "id=tsdmapp%3Aapi&action=batchrate&fid=2&tid=42";
const json = "&tsdmapp=json";
const formhash = "fictitious-formhash";
const get = (url, data, extras = {}) => ({ url, data, ...extras });
const post = (url, data, fields, effect = true, extras = {}) => ({
  url,
  data,
  fields,
  effect,
  ...extras,
});
const envelope = (type, schema, data) => ({
  ok: 1,
  uid: 31,
  type,
  schema,
  ...data,
});
const results = [];
async function scenario(name, steps, expected, run) {
  const requests = [];
  const options = {
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const step = steps[requests.length];
        const actual = {
          url,
          method: request.method,
          effect: request.effect,
          ...(request.body === undefined
            ? {}
            : { fields: [...new URLSearchParams(request.body)] }),
        };
        requests.push(actual);
        assert.ok(step, `Unexpected request ${url}`);
        assert.equal(request.fresh, true);
        assert.deepEqual(request.session, session);
        if (step.drop) throw new Error("Controlled loss");
        return {
          url,
          status: step.status ?? 200,
          redirect: step.redirect ?? "none",
          contentType: "application/json",
          body: JSON.stringify(step.data),
          location: step.location,
        };
      },
    },
  };
  const observed = await run(createBatchRatingClient(options), options);
  const expectedRequests = steps.map((step) => ({
    url: `${plugin}?${step.url}`,
    method: step.fields ? "POST" : "GET",
    effect: step.effect ?? false,
    ...(step.fields ? { fields: Object.entries(step.fields) } : {}),
  }));
  assert.deepEqual(requests, expectedRequests, name);
  assert.deepEqual(observed, expected, name);
  results.push({ name, expected, observed, expectedRequests, requests });
}
const status = get(statusURL, { ok: 1, uid: 31, batchrate: 1 });
const offered = (url, fields = { formhash }, extra = {}) => ({
  url: `plugin.php?${url}`,
  method: "POST",
  fields,
  ...extra,
});
const confirmForm = offered("id=batchrate:rate");
const listRoute = "plugin.php?id=batchrate:list";
const detailTemplate = `${listRoute}&bract=detail&batchid={batchid}`;
const capForms = {
  confirm: confirmForm,
  list_url: listRoute,
  detail_url: detailTemplate,
};
const credits = [
  {
    id: 6,
    title: "Fictional credit",
    unit: "",
    min: -10,
    max: 10,
    left: 25,
    daily: 30,
  },
];
const capability = envelope("batchrate", 32, {
  fid: 2,
  installed: 1,
  supported: 1,
  can: 1,
  can_list: 1,
  version: "1.3.2",
  limits: { max_total: 20, chunk: 2, mult_max: 3, floor_segments: 4 },
  forms: capForms,
  thread: { tid: 42, subject: "Fictitious topic" },
  credits,
  entry: { list: 1, thread: 1 },
  reason: { required: 1 },
  antispam: { rated: 1, same: 1, locked: 0 },
});
const discovery = [status, get(capabilityURL, capability)];
const scope = { forumId: "2", threadId: "42" };
const accessFrom = async (client) => {
  const result = await client.discoverBatchRating(scope);
  assert.equal(result.kind, "batch-rating-access");
  return result.access;
};
await scenario(
  "discover same-account capability and offered modes and limits",
  discovery,
  {
    kind: "batch-rating-access",
    access: {
      forumId: "2",
      threadId: "42",
      version: "1.3.2",
      modes: ["threads", "posts", "floors"],
      canList: true,
      why: "",
      limits: { maxTotal: 20, chunk: 2, maxMultiplier: 3, floorSegments: 4 },
      credits: [
        {
          id: "6",
          name: "Fictional credit",
          unit: "",
          min: -10,
          max: 10,
          left: 25,
          score: 0,
          condition: "",
        },
      ],
      reasonRequired: true,
      notifyForced: false,
      reasonChoices: [],
      antispam: { rated: true, same: true, locked: false },
    },
  },
  (client) => client.discoverBatchRating(scope),
);
await scenario(
  "disabled plugin stops before the capability probe",
  [get(statusURL, { ok: 1, uid: 31, batchrate: 0 })],
  { kind: "unavailable" },
  (client) => client.discoverBatchRating(scope),
);
await scenario(
  "wrong viewer cannot authorize batch operations",
  [get(statusURL, { ok: 1, uid: 32, batchrate: 1 })],
  { kind: "session-changed" },
  (client) => client.discoverBatchRating(scope),
);

const selection = { mode: "floors", floors: "4 2 ～ 3" };
const fixed = {
  formhash,
  brmode: "3",
  fid: "2",
  tid: "42",
  tids: "",
  pids: "",
  floors: "2~3 4",
};
const chooseFields = {
  formhash,
  brmode: "3",
  fid: "2",
  tid: "42",
  floors: "2~3 4",
};
const rate = "id=batchrate%3Arate";
const submitAt = `${rate}&brmode=3`;
const ratingItems = [2, 3, 4].map((position, index) => ({
  itemid: 0,
  tid: 42,
  pid: 101 + index,
  position,
  authorid: 41 + index,
  author: `Fictitious Member ${index}`,
  status: index === 1 ? "skip_same" : "pending",
  status_text: "Fictitious state",
  mult: 1,
  url: `forum.php?mod=redirect&goto=findpost&ptid=42&pid=${101 + index}`,
}));
const previewData = envelope("batchrate_confirm", 33, {
  mode: 3,
  fid: 2,
  tid: 42,
  floors: fixed.floors,
  total: 3,
  apply: 2,
  multsum: 2,
  chunks: 1,
  credits: [{ ...credits[0], score: 0 }],
  quota: [],
  reason: { value: "", required: 1 },
  notify: { checked: 0, forced: 0 },
  antispam: { rated: 1, same: 1, locked: 0 },
  exclude: "",
  errors: [],
  blocked: 0,
  items: ratingItems,
  cond_credits: [{ id: 1, title: "Fictitious threshold", cond: "" }],
  precheck: {
    ok: 0,
    errors: [{ code: "no_score", id: 0, message: "Enter a score" }],
  },
  submit: offered("id=batchrate:rate&brmode=3", fixed),
});
const previewPost = post(rate + json, previewData, chooseFields, false);
const draft = async (client) => {
  const prepared = await client.previewBatchRating(
    await accessFrom(client),
    selection,
  );
  assert.equal(prepared.kind, "batch-rating-preview");
  return prepared.preview;
};
await scenario(
  "floor selection opens a preview through the offered POST without an effect",
  [...discovery, previewPost],
  {
    mode: "floors",
    floors: "2~3 4",
    total: 3,
    eligible: 2,
    canCreate: false,
    skipped: "skip_same",
    errors: ["no_score"],
  },
  async (client) => {
    const preview = await draft(client);
    return {
      mode: preview.selection.mode,
      floors: preview.selection.floors,
      total: preview.total,
      eligible: preview.eligible,
      canCreate: preview.canCreate,
      skipped: preview.items[1].status,
      errors: preview.issues.map((issue) => issue.code),
    };
  },
);
await scenario(
  "selected thread first posts and exact post IDs use separate selection fields",
  [
    ...discovery,
    post(
      rate + json,
      {
        ...previewData,
        mode: 1,
        tid: 0,
        floors: "",
        total: 1,
        apply: 1,
        items: [{ ...ratingItems[0], position: 1 }],
        submit: offered("id=batchrate:rate", {
          formhash,
          brmode: "1",
          fid: "2",
          tid: "0",
          tids: "42",
          pids: "",
          floors: "",
        }),
      },
      { formhash, brmode: "1", fid: "2", tids: "42" },
      false,
    ),
    post(
      rate + json,
      {
        ...previewData,
        mode: 2,
        floors: "",
        total: 1,
        apply: 1,
        items: [ratingItems[0]],
        submit: offered("id=batchrate:rate", {
          formhash,
          brmode: "2",
          fid: "2",
          tid: "42",
          tids: "",
          pids: "101",
          floors: "",
        }),
      },
      { formhash, brmode: "2", fid: "2", tid: "42", pids: "101" },
      false,
    ),
  ],
  ["threads", "posts"],
  async (client) => {
    const access = await accessFrom(client);
    const a = await client.previewBatchRating(access, {
      mode: "threads",
      threadIds: ["42"],
    });
    const b = await client.previewBatchRating(access, {
      mode: "posts",
      postIds: ["101"],
    });
    return [a.preview?.selection.mode, b.preview?.selection.mode];
  },
);
await scenario(
  "malformed floor spans cannot reach the selection form",
  discovery,
  { kind: "invalid-input" },
  async (client) => {
    return client.previewBatchRating(await accessFrom(client), {
      mode: "floors",
      floors: "8~2",
    });
  },
);
await scenario(
  "a preview cannot substitute an out-of-range post",
  [
    ...discovery,
    {
      ...previewPost,
      data: {
        ...previewData,
        items: [{ ...ratingItems[0], position: 5 }, ...ratingItems.slice(1)],
      },
    },
  ],
  { kind: "invalid-response" },
  async (client) =>
    client.previewBatchRating(await accessFrom(client), selection),
);
const settings = {
  scores: { 6: 4 },
  conditions: { 1: ">= 2" },
  multipliers: { 103: 2 },
  reason: "Fictitious reward",
  notify: true,
  exclude: "Fictitious Excluded",
  rated: true,
  same: true,
};
const computed = {
  ...fixed,
  recalc: "1",
  score6: "4",
  reason: settings.reason,
  sendreasonpm: "1",
  exclude: settings.exclude,
  as_rated: "1",
  as_same: "1",
  "cond[1]": ">= 2",
  "mult[103]": "2",
};
const recalculated = {
  ...previewData,
  credits: [{ ...credits[0], score: 4 }],
  reason: { value: settings.reason, required: 1 },
  notify: { checked: 1, forced: 0 },
  exclude: settings.exclude,
  items: ratingItems.map((item) =>
    item.pid === 103 ? { ...item, mult: 2 } : item,
  ),
  multsum: 3,
  quota: [{ id: 6, title: credits[0].title, need: 12, left: 25, ok: 1 }],
  cond_credits: [{ id: 1, title: "Fictitious threshold", cond: ">= 2" }],
  precheck: { ok: 1, errors: [] },
};
const recalcPost = post(submitAt + json, recalculated, computed, false);
const recalc = async (client) => {
  const result = await client.recalculateBatchRating(
    await draft(client),
    settings,
  );
  assert.equal(result.kind, "batch-rating-preview");
  return result.preview;
};
await scenario(
  "recalculate uses returned destination and exposes quota and configured values",
  [...discovery, previewPost, recalcPost],
  {
    canCreate: true,
    quota: [{ id: "6", need: 12, left: 25, ok: true }],
    settings,
  },
  async (client) => {
    const preview = await recalc(client);
    assert.equal(preview.items[2].multiplier, 2);
    return {
      canCreate: preview.canCreate,
      quota: preview.quota,
      settings: {
        ...preview.settings,
        multipliers: { 103: preview.settings.multipliers["103"] },
      },
    };
  },
);
await scenario(
  "recalculation accepts the requested floor edit and preserves a quota block",
  [
    ...discovery,
    previewPost,
    post(
      submitAt + json,
      {
        ...recalculated,
        floors: "2~4",
        submit: offered("id=batchrate:rate&brmode=3", {
          ...fixed,
          floors: "2~4",
        }),
        quota: [{ id: 6, need: 12, left: 2, ok: 0 }],
        precheck: {
          ok: 0,
          errors: [
            { code: "quota", id: 6, message: "Fictitious quota exhausted" },
          ],
        },
      },
      { ...computed, floors: "2~4" },
      false,
    ),
  ],
  { canCreate: false, floors: "2~4", code: "quota" },
  async (client) => {
    const next = await client.recalculateBatchRating(await draft(client), {
      ...settings,
      floors: "2-4",
    });
    return {
      canCreate: next.preview?.canCreate,
      floors: next.preview?.selection.floors,
      code: next.preview?.issues[0].code,
    };
  },
);
await scenario(
  "effect flags hidden in a preview form cannot be replayed during recalculation",
  [
    ...discovery,
    {
      ...previewPost,
      data: {
        ...previewData,
        submit: offered("id=batchrate:rate", { ...fixed, ratesubmit: "1" }),
      },
    },
  ],
  { kind: "invalid-response" },
  async (client) =>
    client.previewBatchRating(await accessFrom(client), selection),
);

const batchId = "52";
const runForm = offered(
  "id=batchrate:run",
  { formhash },
  { batch_field: "batchid" },
);
const itemForm = offered(
  "id=batchrate:list&bract=undo_item",
  { formhash },
  { item_field: "itemid" },
);
const undoForm = offered(
  "id=batchrate:list&bract=undo_batch",
  { formhash },
  { batch_field: "batchid" },
);
const resultRoute = `plugin.php?id=batchrate:rate&brmode=result&batchid=${batchId}`;
const batchForms = {
  run: runForm,
  undo_item: itemForm,
  undo_batch: undoForm,
  result_url: resultRoute,
};
const batchRow = {
  batchid: 52,
  uid: 31,
  username: "Fictitious Moderator",
  fid: 2,
  tid: 42,
  forum: "Fictitious board",
  mode: 3,
  floors: fixed.floors,
  scores: [{ id: 6, title: credits[0].title, score: 4 }],
  reason: settings.reason,
  total: 3,
  applied: 0,
  skipped: 1,
  pending: null,
  status: 0,
  status_text: "Running",
  can_continue: 1,
  can_undo: 0,
  can_undo_item: 1,
};
const batchMade = envelope("batchrate_batch", 34, {
  batch: batchRow,
  items: null,
  run: 1,
  chunk: 2,
  forms: batchForms,
});
const { recalc: _omit, ...computation } = computed;
const submission = {
  ...fixed,
  ratesubmit: "1",
  ...Object.fromEntries(
    Object.entries(computation).filter(([key]) => !(key in fixed)),
  ),
};
const createPost = post(submitAt + json, batchMade, submission);
const create = async (client) => {
  const preview = await recalc(client);
  assert.deepEqual(await client.createBatchRating({ ...preview }, true), {
    kind: "invalid-input",
  });
  assert.deepEqual(await client.createBatchRating(preview, false), {
    kind: "not-confirmed",
  });
  const result = await client.createBatchRating(preview, true);
  assert.deepEqual(await client.createBatchRating(preview, true), {
    kind: "invalid-input",
  });
  return result;
};
await scenario(
  "create exactly the reviewed batch at its supplied destination without running a chunk",
  [...discovery, previewPost, recalcPost, createPost],
  {
    kind: "batch-rating-created",
    id: batchId,
    run: true,
    resultURL: `${origin}/${resultRoute}`,
  },
  async (client) => {
    const result = await create(client);
    return {
      kind: result.kind,
      id: result.batch?.record.id,
      run: result.batch?.canRun,
      resultURL: result.batch?.resultURL,
    };
  },
);
await scenario(
  "a zero-score preview cannot create a batch",
  [...discovery, previewPost],
  { kind: "refused", code: "preview-blocked" },
  async (client) => client.createBatchRating(await draft(client), true),
);
await scenario(
  "changed quota returns a new preview that still cannot create",
  [
    ...discovery,
    previewPost,
    recalcPost,
    {
      ...createPost,
      data: {
        ...recalculated,
        quota: [{ id: 6, need: 12, left: 2, ok: 0 }],
        precheck: {
          ok: 0,
          errors: [
            { code: "quota", id: 6, message: "Fictitious changed quota" },
          ],
        },
      },
    },
  ],
  { kind: "batch-rating-preview", canCreate: false, code: "quota" },
  async (client) => {
    const result = await create(client);
    return {
      kind: result.kind,
      canCreate: result.preview?.canCreate,
      code: result.preview?.issues[0].code,
    };
  },
);
await scenario(
  "creation transport loss is uncertain and cannot replay that preview",
  [...discovery, previewPost, recalcPost, { ...createPost, drop: true }],
  { kind: "uncertain", operation: "create" },
  create,
);
await scenario(
  "a creation receipt with a mismatched subject scope is uncertain",
  [
    ...discovery,
    previewPost,
    recalcPost,
    { ...createPost, data: { ...batchMade, batch: { ...batchRow, tid: 43 } } },
  ],
  { kind: "uncertain", operation: "create" },
  create,
);

const readMode = json + "&nodoc=1";
const list = "id=batchrate%3Alist";
const detail = `${list}&bract=detail&batchid=${batchId}`;
const resume = `${list}&bract=continue&batchid=${batchId}`;
const resultPage = `${rate}&brmode=result&batchid=${batchId}`;
const running = envelope("batchrate_batch", 34, {
  ...batchMade,
  run: 0,
  batch: { ...batchRow, uid: 37, pending: 2 },
  items: ratingItems.map((item, i) => ({
    ...item,
    itemid: 70 + i,
    can_undo: 0,
  })),
});
const finished = {
  ...running,
  batch: {
    ...running.batch,
    pending: 0,
    status: 1,
    status_text: "Complete",
    applied: 2,
    can_continue: 0,
    can_undo: 1,
  },
  items: running.items.map((item) => ({
    ...item,
    status: item.status === "pending" ? "applied" : item.status,
    can_undo: item.status === "pending" ? 1 : 0,
  })),
};
const readyToResume = { ...running, run: 1, items: null };
const listed = envelope("batchrate_list", 35, {
  page: 2,
  pages: 2,
  count: 8,
  batches: [running.batch],
  forms: { detail_url: detailTemplate },
});
const runURL = "id=batchrate%3Arun";
const itemUndoURL = `${list}&bract=undo_item`;
const batchUndoURL = `${list}&bract=undo_batch`;
const effectReceipt = (handlekey, values, extras = {}) =>
  envelope("result", 13, { kind: "handle", handlekey, values, ...extras });
const runStep = post(
  runURL + json,
  effectReceipt("batchrate_run", {
    done: "1",
    total: "2",
    remaining: "1",
    finished: "0",
  }),
  { formhash, batchid: batchId },
);
const runDone = post(
  runURL + json,
  effectReceipt("batchrate_run", {
    done: "2",
    total: "2",
    remaining: "0",
    finished: "1",
  }),
  { formhash, batchid: batchId },
);
const undoItem = post(
  itemUndoURL + json,
  effectReceipt("batchrate_undo_item", {}),
  { formhash, itemid: "70" },
);
const undoStep = post(
  batchUndoURL + json,
  effectReceipt("batchrate_undo_batch", {
    done: "1",
    remaining: "1",
    finished: "0",
  }),
  { formhash, batchid: batchId },
);
const undoDone = post(
  batchUndoURL + json,
  effectReceipt("batchrate_undo_batch", {
    done: "1",
    remaining: "0",
    finished: "1",
  }),
  { formhash, batchid: batchId },
);
const proceed = {
  kind: "advanced",
  operation: "run",
  batchId,
  done: 1,
  total: 2,
  remaining: 1,
};
const complete = {
  kind: "finished",
  operation: "run",
  batchId,
  done: 2,
  total: 2,
  remaining: 0,
};
const uncertainRun = { kind: "uncertain", operation: "run", batchId };
await scenario(
  "batch list is read by page and shows the owner separately from the current viewer",
  [...discovery, get(`${list}&page=2${readMode}`, listed)],
  {
    kind: "batch-rating-list",
    page: 2,
    pages: 2,
    count: 8,
    owner: "37",
    id: batchId,
  },
  async (client) => {
    const result = await client.listBatchRatings(await accessFrom(client), 2);
    return {
      kind: result.kind,
      page: result.page,
      pages: result.pages,
      count: result.count,
      owner: result.batches?.[0].ownerId,
      id: result.batches?.[0].id,
    };
  },
);
await scenario(
  "batch detail reads exact items and the same moderator can have permission for a different owner’s batch",
  [...discovery, get(detail + readMode, running)],
  {
    kind: "batch-rating-page",
    id: batchId,
    itemIds: ["70", "71", "72"],
    run: false,
  },
  async (client) => {
    const result = await client.readBatchRatingDetail(
      await accessFrom(client),
      batchId,
    );
    return {
      kind: result.kind,
      id: result.batch?.record.id,
      itemIds: result.batch?.items.map((item) => item.itemId),
      run: result.batch?.canRun,
    };
  },
);
await scenario(
  "resume is a read and does not run a batch by itself",
  [...discovery, get(resume + readMode, readyToResume)],
  { kind: "batch-rating-page", run: true, owner: "37" },
  async (client) => {
    const result = await client.resumeBatchRating(
      await accessFrom(client),
      batchId,
    );
    return {
      kind: result.kind,
      run: result.batch?.canRun,
      owner: result.batch?.record.ownerId,
    };
  },
);
await scenario(
  "completed resume may redirect to the same exact read-only result",
  [
    ...discovery,
    get(resume + readMode, null, { status: 302, location: resultRoute }),
    get(resultPage + readMode, finished),
  ],
  { kind: "batch-rating-page", run: false, status: 1 },
  async (client) => {
    const result = await client.resumeBatchRating(
      await accessFrom(client),
      batchId,
    );
    return {
      kind: result.kind,
      run: result.batch?.canRun,
      status: result.batch?.record.status,
    };
  },
);
await scenario(
  "qualified run sends one approved chunk per call and reads the returned result separately",
  [
    ...discovery,
    previewPost,
    recalcPost,
    createPost,
    runStep,
    runDone,
    get(resultPage + readMode, finished),
  ],
  { steps: [proceed, complete], result: "batch-rating-page" },
  async (client) => {
    const { batch } = await create(client);
    assert.deepEqual(await client.runBatchRatingStep({ ...batch }, true), {
      kind: "invalid-input",
    });
    assert.deepEqual(await client.runBatchRatingStep(batch, false), {
      kind: "not-confirmed",
    });
    const a = await client.runBatchRatingStep(batch, true);
    const b = await client.runBatchRatingStep(batch, true);
    assert.deepEqual(await client.runBatchRatingStep(batch, true), {
      kind: "invalid-input",
    });
    return {
      steps: [a, b],
      result: (await client.readBatchRatingResult(batch)).kind,
    };
  },
);
const fromResume = async (client) =>
  (await client.resumeBatchRating(await accessFrom(client), batchId)).batch;
await scenario(
  "a resumed batch stops on a non-advancing receipt",
  [...discovery, get(resume + readMode, readyToResume), runStep, runStep],
  { ...proceed, kind: "no-progress" },
  async (client) => {
    const batch = await fromResume(client);
    assert.deepEqual(await client.runBatchRatingStep(batch, true), proceed);
    const result = await client.runBatchRatingStep(batch, true);
    assert.deepEqual(await client.runBatchRatingStep(batch, true), {
      kind: "invalid-input",
    });
    return result;
  },
);
await scenario(
  "a lost run receipt needs a fresh resume before any more steps",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    { ...runStep, drop: true },
  ],
  uncertainRun,
  async (client) => {
    const batch = await fromResume(client);
    const result = await client.runBatchRatingStep(batch, true);
    assert.deepEqual(await client.runBatchRatingStep(batch, true), {
      kind: "invalid-input",
    });
    return result;
  },
);
await scenario(
  "run refuses a server rejection as a distinct outcome",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    {
      ...runStep,
      data: effectReceipt(
        "batchrate_run",
        {},
        { ok: 0, message: "Fictitious run refusal" },
      ),
    },
  ],
  { kind: "refused", message: "Fictitious run refusal" },
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
await scenario(
  "a resume redirect to a different batch is not followed",
  [
    ...discovery,
    get(resume + readMode, null, {
      status: 302,
      location: resultRoute.replace("52", "53"),
    }),
  ],
  { kind: "invalid-response" },
  async (client) => client.resumeBatchRating(await accessFrom(client), batchId),
);
await scenario(
  "a resume payload for another batch cannot establish authority",
  [
    ...discovery,
    get(resume + readMode, {
      ...readyToResume,
      batch: { ...readyToResume.batch, batchid: 53 },
    }),
  ],
  { kind: "invalid-response" },
  async (client) => client.resumeBatchRating(await accessFrom(client), batchId),
);
await scenario(
  "an original raw plugin run reply is accepted with explicit counters",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    {
      ...runDone,
      data: { ok: true, done: 2, total: 2, remaining: 0, finished: true },
    },
  ],
  complete,
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
const readFinished = async (client) =>
  (await client.readBatchRatingDetail(await accessFrom(client), batchId)).batch;
await scenario(
  "single revocation sends item ID rather than post or batch ID",
  [...discovery, get(detail + readMode, finished), undoItem],
  { kind: "revoked", operation: "revoke-item", batchId, itemId: "70" },
  async (client) => {
    const batch = await readFinished(client);
    assert.deepEqual(await client.revokeBatchRatingItem(batch, "101", true), {
      kind: "invalid-input",
    });
    assert.deepEqual(await client.revokeBatchRatingItem(batch, "70", false), {
      kind: "not-confirmed",
    });
    const result = await client.revokeBatchRatingItem(batch, "70", true);
    assert.deepEqual(await client.revokeBatchRatingItem(batch, "70", true), {
      kind: "invalid-input",
    });
    return result;
  },
);
await scenario(
  "batch revocation uses its own form and counts down independently",
  [...discovery, get(detail + readMode, finished), undoStep, undoDone],
  [
    {
      kind: "advanced",
      operation: "revoke-batch",
      batchId,
      done: 1,
      total: null,
      remaining: 1,
    },
    {
      kind: "finished",
      operation: "revoke-batch",
      batchId,
      done: 1,
      total: null,
      remaining: 0,
    },
  ],
  async (client) => {
    const batch = await readFinished(client);
    assert.deepEqual(await client.revokeBatchRatingStep(batch, false), {
      kind: "not-confirmed",
    });
    const result = [
      await client.revokeBatchRatingStep(batch, true),
      await client.revokeBatchRatingStep(batch, true),
    ];
    assert.deepEqual(await client.revokeBatchRatingStep(batch, true), {
      kind: "invalid-input",
    });
    return result;
  },
);
await scenario(
  "single revocation rejects a batch undo acknowledgement",
  [
    ...discovery,
    get(detail + readMode, finished),
    { ...undoItem, data: undoDone.data },
  ],
  { kind: "uncertain", operation: "revoke-item", batchId, itemId: "70" },
  async (client) =>
    client.revokeBatchRatingItem(await readFinished(client), "70", true),
);
await scenario(
  "a session switch before dispatch prevents a resumed step",
  [...discovery, get(resume + readMode, readyToResume)],
  { kind: "session-changed" },
  async (client, options) => {
    const batch = await fromResume(client);
    options.session = () => ({
      ...session,
      continuity: "fictional-replacement",
    });
    return client.runBatchRatingStep(batch, true);
  },
);

await scenario(
  "legacy string true is a qualified finished flag",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    {
      ...runDone,
      data: {
        ...runDone.data,
        values: { ...runDone.data.values, finished: "true" },
      },
    },
  ],
  complete,
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
await scenario(
  "reconcile lost step through fresh detail and resume before another deliberate chunk",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    { ...runStep, drop: true },
    get(detail + readMode, {
      ...running,
      batch: { ...running.batch, pending: 1, applied: 1 },
    }),
    get(resume + readMode, {
      ...readyToResume,
      batch: { ...readyToResume.batch, pending: 1, applied: 1 },
    }),
    runDone,
  ],
  { before: uncertainRun, observedApplied: 1, after: complete },
  async (client) => {
    const access = await accessFrom(client);
    const first = await client.resumeBatchRating(access, batchId);
    const before = await client.runBatchRatingStep(first.batch, true);
    const detail = await client.readBatchRatingDetail(access, batchId);
    assert.deepEqual(await client.runBatchRatingStep(detail.batch, true), {
      kind: "invalid-input",
    });
    const second = await client.resumeBatchRating(access, batchId);
    return {
      before,
      observedApplied: detail.batch.record.applied,
      after: await client.runBatchRatingStep(second.batch, true),
    };
  },
);
await scenario(
  "an offered run URL fixed to another batch cannot dispatch",
  [
    ...discovery,
    get(resume + readMode, {
      ...readyToResume,
      forms: { ...batchForms, run: offered("id=batchrate:run&batchid=53") },
    }),
  ],
  { kind: "invalid-response" },
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
await scenario(
  "contradictory step counters cannot finish a batch",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    {
      ...runDone,
      data: {
        ...runDone.data,
        values: { ...runDone.data.values, remaining: "1" },
      },
    },
  ],
  uncertainRun,
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
await scenario(
  "an effect acknowledgement from another member stays uncertain",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    { ...runDone, data: { ...runDone.data, uid: 35 } },
  ],
  uncertainRun,
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
await scenario(
  "a recalc alias cannot bind to the creation field",
  [
    ...discovery,
    {
      ...previewPost,
      data: {
        ...previewData,
        submit: { ...previewData.submit, recalc_field: "ratesubmit" },
      },
    },
  ],
  { kind: "invalid-response" },
  async (client) =>
    client.previewBatchRating(await accessFrom(client), selection),
);
await scenario(
  "a resumed run with the same observed pending count stops after its first receipt",
  [
    ...discovery,
    get(resume + readMode, readyToResume),
    {
      ...runStep,
      data: effectReceipt("batchrate_run", {
        done: "1",
        total: "3",
        remaining: "2",
        finished: "0",
      }),
    },
  ],
  {
    kind: "no-progress",
    operation: "run",
    batchId,
    done: 1,
    total: 3,
    remaining: 2,
  },
  async (client) => client.runBatchRatingStep(await fromResume(client), true),
);
const probes = JSON.parse(
  readFileSync(new URL("./pinned.json", import.meta.url), "utf8"),
);
if (probes) {
  const archivedSelection = { mode: "floors", floors: "2~4 7 9~" };
  await scenario(
    "projected pinned schema 33 keeps eligibility, quota and skipped statuses",
    [
      ...discovery,
      post(
        rate + json,
        probes.preview,
        { ...chooseFields, floors: "2~4 7 9~" },
        false,
      ),
    ],
    {
      canCreate: true,
      total: 5,
      eligible: 2,
      need: 20,
      lastMultiplier: 3,
      excluded: "skip_excluded",
    },
    async (client) => {
      const { preview } = await client.previewBatchRating(
        await accessFrom(client),
        archivedSelection,
      );
      return {
        canCreate: preview?.canCreate,
        total: preview?.total,
        eligible: preview?.eligible,
        need: preview?.quota[0].need,
        lastMultiplier: preview?.items[4].multiplier,
        excluded: preview?.items[2].status,
      };
    },
  );
  await scenario(
    "pinned spec-shaped run receipts advance and finish with their exact counters",
    [
      ...discovery,
      get(resume + readMode, {
        ...readyToResume,
        batch: { ...readyToResume.batch, pending: null },
      }),
      { ...runStep, data: probes.run[0] },
      { ...runDone, data: probes.run[1] },
    ],
    [
      { ...proceed, done: 2, total: 4, remaining: 2 },
      { ...complete, done: 4, total: 4 },
    ],
    async (client) => {
      const batch = await fromResume(client);
      return [
        await client.runBatchRatingStep(batch, true),
        await client.runBatchRatingStep(batch, true),
      ];
    },
  );
  await scenario(
    "pinned spec-shaped single undo is reconciled by a fresh detail read",
    [
      ...discovery,
      get(detail + readMode, finished),
      { ...undoItem, data: probes.undoItem },
      get(detail + readMode, {
        ...finished,
        batch: { ...finished.batch, status: 3, applied: 1 },
        items: finished.items.map((item) =>
          item.itemid === 70
            ? { ...item, status: "undone", can_undo: 0 }
            : item,
        ),
      }),
    ],
    {
      result: {
        kind: "revoked",
        operation: "revoke-item",
        batchId,
        itemId: "70",
      },
      reconciled: "undone",
    },
    async (client) => {
      const access = await accessFrom(client);
      const { batch } = await client.readBatchRatingDetail(access, batchId);
      const result = await client.revokeBatchRatingItem(batch, "70", true);
      const read = await client.readBatchRatingDetail(access, batchId);
      return { result, reconciled: read.batch?.items[0].status };
    },
  );
  await scenario(
    "pinned spec-shaped batch undo keeps per-chunk done distinct from remaining",
    [
      ...discovery,
      get(detail + readMode, finished),
      { ...undoStep, data: probes.undoBatch[0] },
      { ...undoDone, data: probes.undoBatch[1] },
    ],
    [
      {
        kind: "advanced",
        operation: "revoke-batch",
        batchId,
        done: 2,
        total: null,
        remaining: 2,
      },
      {
        kind: "finished",
        operation: "revoke-batch",
        batchId,
        done: 2,
        total: null,
        remaining: 0,
      },
    ],
    async (client) => {
      const batch = await readFinished(client);
      return [
        await client.revokeBatchRatingStep(batch, true),
        await client.revokeBatchRatingStep(batch, true),
      ];
    },
  );
}
const { batchRatingExample } = await import("./example.mjs");
await scenario(
  "the packed TypeScript walkthrough stops when creation is declined",
  [...discovery, previewPost, recalcPost],
  { kind: "not-confirmed" },
  (_client, options) =>
    batchRatingExample(options, scope, selection, settings, async () => false),
);
console.log(JSON.stringify(results));
