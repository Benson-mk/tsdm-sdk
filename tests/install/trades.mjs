import assert from "node:assert/strict";
import { createForumClient, createTradeClient } from "tsdm-sdk";

const origin = "https://trades.example";
const forum = origin + "/forum.php";
const thread = forum + "?mod=viewthread&tid=42";
const session = { memberId: "31", continuity: "fictional-session" };
const mode = new URLSearchParams({ tsdmapp: "json" }).toString();
const view = thread + `&${mode}&nodoc=1`;
const title = "Fictitious paid discussion";
const locked = {
  ok: 1,
  uid: 31,
  type: "thread",
  schema: 15,
  thread: {
    tid: 42,
    fid: 7,
    subject: title,
    price: 5,
    pay: { price: 5, need_pay: 1, payers: 2 },
  },
  posts: [{ pid: 101, first: 1, message_reason: "pay" }],
};
const paid = {
  ...locked,
  thread: { ...locked.thread, pay: { price: 5, need_pay: 0, payers: 3 } },
  posts: [
    {
      pid: 101,
      first: 1,
      message_reason: "",
      message: "Fictitious unlocked content.",
    },
  ],
};
const paidThread = {
  threadId: "42",
  postId: "101",
  title,
  price: 5,
  payers: 2,
  access: "requires-purchase",
  url: thread,
};
const get = (url, data, extra = {}) => ({ url, method: "GET", data, ...extra });
const post = (url, fields, data, extra = {}) => ({
  url,
  method: "POST",
  data,
  fields,
  ...extra,
});
const results = [];
async function scenario(name, expectedRequests, expected, exercise) {
  const requests = [];
  let active = session;
  const options = {
    origin,
    session: () => active,
    transport: {
      async request(url, request) {
        const step = expectedRequests[requests.length];
        requests.push({
          url,
          method: request.method,
          ...(request.body === undefined
            ? {}
            : {
                fields: Object.fromEntries(new URLSearchParams(request.body)),
              }),
        });
        assert.deepEqual(request.session, session);
        assert.equal(request.fresh, true);
        assert.ok(step, `Unexpected request ${url}`);
        if (step.switchSession)
          active = { ...session, continuity: "another-fictional-session" };
        if (step.drop) throw new Error("Controlled response loss");
        return {
          url,
          status: step.status ?? 200,
          redirect: step.redirect ?? "none",
          contentType:
            step.contentType ??
            (step.html === undefined ? "application/json" : "text/html"),
          body: step.html ?? JSON.stringify(step.data),
          ...(step.location && { location: step.location }),
        };
      },
    },
  };
  const observed = await exercise(createTradeClient(options), options);
  assert.deepEqual(
    requests,
    expectedRequests.map(({ url, method, fields }) => ({
      url,
      method,
      ...(fields && { fields }),
    })),
    name,
  );
  assert.deepEqual(observed, expected, name);
  results.push({
    name,
    expected,
    observed,
    requests: requests.map((request) =>
      request.fields?.password === undefined
        ? request
        : {
            ...request,
            fields: {
              ...request.fields,
              password: "[fictitious password supplied]",
            },
          },
    ),
  });
}
await scenario(
  "read the locked paid thread and its exact opening post",
  [get(view, locked)],
  { kind: "paid-thread", thread: paidThread },
  (client) => client.readPaidThread("42"),
);
const dialog = `${forum}?mod=misc&action=pay&tid=42&pid=101&infloat=yes&handlekey=pay&inajax=1&ajaxtarget=fwin_content_pay`;
const purchaseURL = `${forum}?mod=misc&action=pay&paysubmit=yes&infloat=yes&extra=offer`;
const purchasePOST = `${purchaseURL}&inajax=1&${mode}`;
const purchaseFields = {
  formhash: "fictional-hash",
  referer: thread,
  tid: "42",
  handlekey: "pay",
  paysubmit: "true",
  preserved: "form-field",
};
const offer = {
  ok: 1,
  uid: 31,
  type: "form",
  schema: 17,
  form: "buy",
  tid: 42,
  pid: null,
  formhash: "fictional-hash",
  author: { uid: 33, name: "Fictitious Author" },
  price: 5,
  net: 4,
  balance: 95,
  credit: { id: 2, title: "Fictional credits", unit: "" },
  submit: {
    method: "POST",
    enctype: "application/x-www-form-urlencoded",
    url: purchaseURL,
    fields: purchaseFields,
  },
  hook_fields: [],
  unsupported: [],
};
const offerRead = (value = offer) => get(`${dialog}&${mode}&tsdmform=1`, value);
const preparePurchase = [get(view, locked), offerRead()];
const acknowledgement = {
  type: "result",
  schema: 13,
  ok: 1,
  uid: 31,
  kind: "handle",
  handlekey: "pay",
  login: 0,
  message_key: "thread_pay_succeed",
  url: thread,
  message: "Fictitious purchase recorded",
};
const purchased = { ...paidThread, access: "accessible", payers: 3 };
await scenario(
  "schema 23: review the schema 17 form, decline, then submit once and verify the unlock",
  [
    get(view, { ...locked, schema: 23 }),
    offerRead(),
    post(purchasePOST, purchaseFields, acknowledgement),
    get(view, { ...paid, schema: 23 }),
  ],
  { kind: "purchased", thread: purchased },
  async (client) => {
    const result = await client.preparePaidThread("42");
    assert.equal(result.kind, "purchase-form");
    assert.deepEqual(result.form.terms, {
      author: { id: "33", name: "Fictitious Author" },
      price: 5,
      authorReceives: 4,
      balanceAfterPurchase: 95,
      credit: { id: "2", name: "Fictional credits", unit: "" },
    });
    assert.deepEqual(await client.confirmPaidThread(result.form, false), {
      kind: "not-confirmed",
    });
    const done = await client.confirmPaidThread(result.form, true);
    assert.deepEqual(await client.confirmPaidThread(result.form, true), {
      kind: "invalid-input",
    });
    return done;
  },
);
await scenario(
  "poor balance response is a refusal before any debit",
  [
    get(view, locked),
    get(`${dialog}&${mode}&tsdmform=1`, {
      ok: 0,
      uid: 31,
      error: "message",
      form: "buy",
      login: 0,
      message_key: "credits_balance_insufficient_and_charge",
      message: "Fictitious insufficient balance",
    }),
  ],
  {
    kind: "refused",
    code: "credits_balance_insufficient_and_charge",
    message: "Fictitious insufficient balance",
  },
  (client) => client.preparePaidThread("42"),
);
async function confirm(client) {
  const result = await client.preparePaidThread("42");
  assert.equal(result.kind, "purchase-form");
  return client.confirmPaidThread(result.form, true);
}
for (const schema of [14, 15, 78]) {
  await scenario(
    `schema ${schema}: prepare and confirm the purchase with a fresh readback`,
    [
      get(view, { ...locked, schema }),
      offerRead(),
      post(purchasePOST, purchaseFields, acknowledgement),
      get(view, { ...paid, schema }),
    ],
    { kind: "purchased", thread: purchased },
    confirm,
  );
}
{
  const requests = [];
  const client = createForumClient({
    origin,
    transport: {
      async request(url, { fresh }) {
        assert.equal(fresh, true);
        requests.push(url);
        return {
          url,
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: 1,
            uid: 31,
            type: "thread",
            schema: 78,
            page: 1,
            pages: 1,
            thread: { tid: 42, subject: "Fictitious thread", price: 0, pay: null },
            posts: [{
              pid: 101,
              first: 1,
              position: 1,
              background: 1,
              message_reason: "",
              message: "Fictitious opening post.",
              body_html: "<p>Fictitious opening post.</p>",
            }],
          }),
        };
      },
    },
  });
  const observed = await client.readThread(thread, {
    representation: "structured",
  });
  assert.equal(observed.kind, "thread");
  assert.equal(observed.thread.id, "42");
  assert.equal(observed.thread.posts[0].id, "101");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).searchParams.get("nodoc"), "1");
  results.push({
    name: "schema 78: ordinary structured thread read and exact post",
    observed: { thread: observed.thread.id, post: observed.thread.posts[0].id },
    requests,
  });
}
for (const [name, owner] of [
  ["no member session", null],
  ["only a member ID", { memberId: session.memberId }],
]) {
  await scenario(name, [], { kind: "refused" }, (client, options) => {
    options.session = () => owner;
    return client.preparePaidThread("42");
  });
}
for (const [name, response, outcome = "invalid-response"] of [
  ["guest read", { ...locked, uid: 0 }, "session-changed"],
  ["another member's read", { ...locked, uid: 99 }, "session-changed"],
  ["read without a viewer ID", { ...locked, uid: undefined }],
  ["login required despite a matching UID", { ...locked, login: 1 }, "refused"],
  ["another thread", { ...locked, thread: { ...locked.thread, tid: 99 } }],
  ["missing purchase offer", { ...locked, thread: { ...locked.thread, pay: undefined } }],
  ["invalid purchase offer", {
    ...locked,
    thread: { ...locked.thread, pay: { ...locked.thread.pay, price: 7 } },
  }],
]) {
  await scenario(
    `${name} cannot open a purchase form`,
    [get(view, { ...response, schema: 23 })],
    { kind: outcome },
    (client) => client.preparePaidThread("42"),
  );
}
for (const [name, response, expected = { kind: "browser-handoff", destination: thread }] of [
  ["missing purchase form", { ok: 1, uid: 31 }],
  ["purchase form with no auth identity", { ...offer, uid: undefined }],
  ["another member's purchase form", { ...offer, uid: 99 }, { kind: "session-changed" }],
  ["another thread's purchase form", { ...offer, tid: 99 }],
  ["invalid purchase action", {
    ...offer,
    submit: { ...offer.submit, url: "https://untrusted.example/forum.php" },
  }],
]) {
  await scenario(
    `${name} cannot dispatch a purchase`,
    [get(view, { ...locked, schema: 23 }), offerRead(response)],
    expected,
    (client) => client.preparePaidThread("42"),
  );
}
await scenario(
  "a form cannot be confirmed after a same-member session changes",
  [get(view, { ...locked, schema: 23 }), offerRead()],
  { kind: "session-changed" },
  async (client, options) => {
    const prepared = await client.preparePaidThread("42");
    assert.equal(prepared.kind, "purchase-form");
    options.session = () => ({ ...session, continuity: "different-session" });
    return client.confirmPaidThread(prepared.form, true);
  },
);
await scenario(
  "already accessible at preparation does not open a form or submit",
  [get(view, { ...paid, schema: 23 })],
  { kind: "already-accessible", thread: purchased },
  (client) => client.preparePaidThread("42"),
);
const renderedPaid = {
  pid: 101,
  first: 1,
  deleted: 0,
  invisible: 0,
  message: null,
  message_reason: "html",
  body_html: "<p>Fictitious unlocked content.</p>",
};
for (const messageReason of ["html", "bbcodeoff"]) {
  await scenario(
    `schema 23: readable ${messageReason} opening post verifies without raw source`,
    [
      get(view, { ...locked, schema: 23 }),
      offerRead(),
      post(purchasePOST, purchaseFields, acknowledgement),
      get(view, {
        ...paid,
        schema: 23,
        posts: [{ ...renderedPaid, message_reason: messageReason }],
      }),
    ],
    { kind: "purchased", thread: purchased },
    confirm,
  );
}
for (const [name, readback, extra] of [
  ["still locked", locked],
  ["unlock without a readable opening post", {
    ...paid,
    posts: [{ pid: 101, first: 1, message_reason: "" }],
  }],
  ...[
    ["unknown restriction on a rendered opening", { message_reason: "unknown" }],
    [
      "rendered opening with a raw-source contradiction",
      { message: "Fictitious raw content." },
    ],
    [
      "visible teaser beside locked markup",
      { body_html: '<p>Teaser</p><div class="locked">Fictitious lock</div>' },
    ],
    ["rendered opening with no visible content", { body_html: "<p> </p>" }],
    [
      "rendered opening with only hidden content",
      { body_html: "<p hidden>Fictitious hidden content.</p>" },
    ],
    ["invisible opening with renderable HTML", { invisible: -2 }],
    ["deleted opening with renderable HTML", { deleted: 1 }],
  ].map(([name, patch]) => [
    name,
    { ...paid, posts: [{ ...renderedPaid, ...patch }] },
  ]),
  ["account continuity changed", paid, { switchSession: true }],
]) {
  await scenario(
    `${name} after acknowledgement remains uncertain without a retry`,
    [
      get(view, { ...locked, schema: 23 }),
      offerRead(),
      post(purchasePOST, purchaseFields, acknowledgement),
      get(view, { ...readback, schema: 23 }, extra),
    ],
    { kind: "uncertain" },
    async (client) => {
      const prepared = await client.preparePaidThread("42");
      assert.equal(prepared.kind, "purchase-form");
      const outcome = await client.confirmPaidThread(prepared.form, true);
      assert.deepEqual(await client.confirmPaidThread(prepared.form, true), {
        kind: "invalid-input",
      });
      return outcome;
    },
  );
}
await scenario(
  "lost paid-thread response remains uncertain without a repeated payment",
  [
    ...preparePurchase,
    post(purchasePOST, purchaseFields, undefined, { drop: true }),
  ],
  { kind: "uncertain" },
  confirm,
);
await scenario(
  "purchase acknowledgement with the wrong exact opening post remains uncertain",
  [
    ...preparePurchase,
    post(purchasePOST, purchaseFields, acknowledgement),
    get(view, { ...paid, posts: [{ ...paid.posts[0], pid: 999 }] }),
  ],
  { kind: "uncertain" },
  confirm,
);
await scenario(
  "already purchased is a separate receipt",
  [
    ...preparePurchase,
    post(purchasePOST, purchaseFields, {
      ...acknowledgement,
      ok: 0,
      kind: "message",
      message_key: "credits_buy_thread",
    }),
    get(view, paid),
  ],
  { kind: "already-accessible", thread: purchased },
  confirm,
);
const goodsURL = `${forum}?mod=viewthread&do=tradeinfo&tid=42&pid=102`;
const orderFormURL = `${forum}?mod=trade&tid=42&pid=102`;
const orderPOST = `${forum}?mod=trade&action=trade&tid=42&pid=102`;
const memberMarkup = `<head><script>var STYLEID = '2', discuz_uid = '31';</script></head>`;
const goodsMarkup = `<html>${memberMarkup}<body><div class="ih"><div class="avt"><a href="home.php?mod=space&amp;uid=33">Seller avatar</a></div><dl><dt>Fictitious Seller</dt></dl></div>
<h1 class="ph"><a href="${goodsURL}">Fictitious badge</a></h1><div class="spi">
<dl><dt>商品数量:</dt><dd>2</dd><dt>地点:</dt><dd>Fictitious location</dd></dl>
<dl class="nums"><dd><p>10 Fictional credits</p></dd></dl><dd class="xg1"><del>15 Fictional credits</del></dd>
<p class="pns"><button onclick="window.open('${orderFormURL.slice(origin.length + 1)}','','');"><span>购买</span></button></p></div>
<div class="mtw"><div class="c pbm">Fictitious goods description</div></div></body></html>`;
const goodsTarget = { threadId: "42", postId: "102" };
const goods = {
  ...goodsTarget,
  url: goodsURL,
  subject: "Fictitious badge",
  seller: { id: "33", name: "Fictitious Seller" },
  prices: ["10 Fictional credits"],
  originalPrices: ["15 Fictional credits"],
  stock: 2,
  soldOut: false,
  details: [
    { label: "商品数量", value: "2" },
    { label: "地点", value: "Fictitious location" },
  ],
  description: "Fictitious goods description",
  thumbnailURL: null,
  imageURL: null,
  orderFormURL,
};
const goodsRead = get(goodsURL, undefined, { html: goodsMarkup });
await scenario(
  "read trade item details and its read-only order form destination",
  [goodsRead],
  { kind: "trade-goods", goods },
  (client) => client.readTradeGoods(goodsTarget),
);
await scenario(
  "sold-out trade item has no order form link",
  [
    get(goodsURL, undefined, {
      html: goodsMarkup
        .replace(/<button onclick="[^"]+">/, "<button disabled>")
        .replace("<dd>2</dd>", "<dd>0</dd>"),
    }),
  ],
  {
    kind: "trade-goods",
    goods: {
      ...goods,
      stock: 0,
      soldOut: true,
      orderFormURL: null,
      details: [{ ...goods.details[0], value: "0" }, goods.details[1]],
    },
  },
  (client) => client.readTradeGoods(goodsTarget),
);
await scenario(
  "a different item page cannot supply a buy link",
  [
    get(goodsURL, undefined, {
      html: goodsMarkup.replace(
        goodsURL,
        goodsURL.replace("pid=102", "pid=888"),
      ),
    }),
  ],
  { kind: "invalid-response" },
  (client) => client.readTradeGoods(goodsTarget),
);
await scenario(
  "trade history has a browser destination and no HTTP request",
  [],
  {
    kind: "browser-handoff",
    destination: `${origin}/home.php?mod=space&do=trade&view=tradelog`,
  },
  (client) => client.tradeHistory(),
);
const orderId = "FictionalOrder0123";
const orderURL = `${forum}?mod=trade&orderid=${orderId}`;
const orderMarkup = `<html>${memberMarkup}<body><script>var feevalue = 0; var credit = 10; var currentcredit = 55;</script>
<form id="tradepost" method="post" action="${orderPOST.replaceAll("&", "&amp;")}">
<input type="hidden" name="formhash" value="fictional-order-hash"><input name="number" value="1">
<input type="hidden" name="transport" value="1"><input type="hidden" name="offline" value="1">
<label for="buyername">Fictitious receiver</label><input name="buyername" id="buyername" maxlength="50" value="">
<label for="buyercontact">Fictitious address</label><input name="buyercontact" id="buyercontact" maxlength="100" value="">
<input type="hidden" name="buyerzip" value=""><input type="hidden" name="buyerphone" value=""><input type="hidden" name="buyermobile" value="">
<textarea name="buyermsg"></textarea><button type="submit" name="tradesubmit" value="true">确认购买</button></form></body></html>`;
const orderOpen = get(orderFormURL, undefined, { html: orderMarkup });
const orderFields = {
  formhash: "fictional-order-hash",
  number: "2",
  transport: "1",
  offline: "1",
  buyername: "Fictitious Buyer",
  buyercontact: "Imaginary Address",
  buyerzip: "",
  buyerphone: "",
  buyermobile: "",
  buyermsg: "Fictitious note",
  tradesubmit: "true",
};
const orderReceipt = {
  ...acknowledgement,
  kind: "message",
  message_key: "trade_order_created",
  url: orderURL,
  alert: "info",
  message: "Fictitious order created",
};
const orderInput = {
  quantity: 2,
  message: "Fictitious note",
  recipient: {
    buyername: "Fictitious Buyer",
    buyercontact: "Imaginary Address",
  },
};
async function openBuyForm(client) {
  const item = await client.readTradeGoods(goodsTarget);
  assert.equal(item.kind, "trade-goods");
  return client.prepareTradeOrder(item.goods);
}
async function makeOrder(client) {
  const open = await openBuyForm(client);
  assert.equal(open.kind, "trade-order-form");
  return client.createTradeOrder(open.form, orderInput);
}
await scenario(
  "inspect a physical credit order form and create only the order",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, orderReceipt),
  ],
  { kind: "order-created", order: { orderId, url: orderURL } },
  async (client) => {
    const open = await openBuyForm(client);
    assert.equal(open.kind, "trade-order-form");
    assert.equal(open.form.terms.creditPerItem, 10);
    assert.equal(open.form.terms.balance, 55);
    assert.equal(open.form.terms.stock, 2);
    assert.deepEqual(open.form.terms.recipientFields, [
      {
        name: "buyername",
        label: "Fictitious receiver",
        value: "",
        maxLength: 50,
      },
      {
        name: "buyercontact",
        label: "Fictitious address",
        value: "",
        maxLength: 100,
      },
    ]);
    assert.deepEqual(
      await client.createTradeOrder(open.form, { ...orderInput, quantity: 3 }),
      { kind: "invalid-input" },
    );
    return client.createTradeOrder(open.form, orderInput);
  },
);
await scenario(
  "manual order redirect identifies only the new order",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, undefined, {
      html: "",
      status: 302,
      location: orderURL,
    }),
  ],
  { kind: "order-created", order: { orderId, url: orderURL } },
  makeOrder,
);
await scenario(
  "cash order continues at the read-only browser form",
  [
    goodsRead,
    get(orderFormURL, undefined, {
      html: orderMarkup.replace(
        "var credit = 10",
        "var price = 12.5; var credit = 5",
      ),
    }),
  ],
  { kind: "browser-handoff", destination: orderFormURL },
  openBuyForm,
);
await scenario(
  "trade form targeting another item is refused before dispatch",
  [
    goodsRead,
    get(orderFormURL, undefined, {
      html: orderMarkup.replace("pid=102", "pid=222"),
    }),
  ],
  { kind: "invalid-response" },
  openBuyForm,
);
await scenario(
  "trade order stock refusal is distinct",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, {
      ...orderReceipt,
      ok: 0,
      alert: "error",
      message_key: "trade_lack",
      url: "",
      message: "Fictitious inventory shortage",
    }),
  ],
  {
    kind: "refused",
    code: "trade_lack",
    message: "Fictitious inventory shortage",
  },
  makeOrder,
);
await scenario(
  "lost trade order acknowledgement does not create a repeat order",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, undefined, { drop: true }),
  ],
  { kind: "uncertain" },
  makeOrder,
);
const paymentSecret = "fictitious-review-password";
const orderMetadata = (
  status,
) => `<div id="tradeorder"><dl><dt>交易单号</dt><dd>${orderId}</dd><dt>交易状态</dt><dd>${status}</dd>
<dt>积分总额</dt><dd>20 Fictional credits</dd><dt>买家</dt><dd><a href="home.php?mod=space&amp;uid=31">Fictitious Buyer</a></dd></dl></div>`;
const paymentControl = `<form id="tradepost" method="post" action="${orderURL.replaceAll("&", "&amp;")}">
<input type="hidden" name="formhash" value="fictional-payment-hash">
<input type="hidden" name="offlinestatus" value="4"><input type="password" name="password" value="">
<textarea name="message"></textarea><button type="submit" name="offlinesubmit" value="true">我已付款</button></form>`;
const orderDetail = `<html>${memberMarkup}<body>${orderMetadata("等待买家付款")}${paymentControl}</body></html>`;
const orderRead = get(orderURL, undefined, { html: orderDetail });
const orderDescription = {
  orderId,
  url: orderURL,
  status: "awaiting-payment",
  buyerId: "31",
  credit: { amount: 20, name: "Fictional credits" },
};
const paymentBody = {
  formhash: "fictional-payment-hash",
  offlinestatus: "4",
  password: paymentSecret,
  message: "Fictitious payment note",
  offlinesubmit: "true",
};
const paymentReceipt = {
  ...orderReceipt,
  message_key: "trade_orderstatus_updated",
};
async function makePayment(client, id = orderId) {
  const open = await client.prepareTradePayment(id);
  assert.equal(open.kind, "trade-payment-form");
  assert.deepEqual(open.form.order, orderDescription);
  const result = await client.payTradeOrder(open.form, {
    password: paymentSecret,
    message: "Fictitious payment note",
  });
  assert.deepEqual(
    await client.payTradeOrder(open.form, { password: paymentSecret }),
    { kind: "invalid-input" },
  );
  return result;
}
await scenario(
  "read an exact individual order and its current payment terms",
  [orderRead],
  { kind: "trade-order", order: orderDescription },
  (client) => client.readTradeOrder(orderId),
);
await scenario(
  "place an order and explicitly pay that returned order in a separate request",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, orderReceipt),
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, paymentReceipt),
  ],
  { kind: "paid", order: { orderId, url: orderURL } },
  async (client) => {
    const placed = await makeOrder(client);
    assert.equal(placed.kind, "order-created");
    return makePayment(client, placed.order.orderId);
  },
);
await scenario(
  "wrong password can be refused with ok=1",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, {
      ...paymentReceipt,
      message_key: "trade_password_error",
      message: `Fictitious wrong password: ${paymentSecret}`,
    }),
  ],
  { kind: "refused", code: "trade_password_error" },
  (client) => makePayment(client),
);
await scenario(
  "a success key on a different order cannot establish payment",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, {
      ...paymentReceipt,
      url: orderURL.replace(orderId, "AnotherFictitiousOrder"),
    }),
  ],
  { kind: "uncertain" },
  (client) => makePayment(client),
);
await scenario(
  "legacy redirect from a payment does not establish the result",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, undefined, {
      status: 302,
      location: orderURL,
      html: "",
    }),
  ],
  { kind: "uncertain" },
  (client) => makePayment(client),
);
await scenario(
  "payment inputs are refused when the order belongs to a different buyer",
  [
    get(orderURL, undefined, {
      html: orderDetail.replace("uid=31", "uid=32"),
    }),
  ],
  { kind: "refused", code: "wrong-buyer" },
  (client) => client.prepareTradePayment(orderId),
);
await scenario(
  "already paid order is returned without a new payment",
  [
    get(orderURL, undefined, {
      html: `<html>${memberMarkup}<body>${orderMetadata("买家已付款")}</body></html>`,
    }),
  ],
  { kind: "already-paid", order: { ...orderDescription, status: "paid" } },
  (client) => client.prepareTradePayment(orderId),
);
await scenario(
  "a payment form aimed at a different order is invalid",
  [
    get(orderURL, undefined, {
      html: orderDetail.replace(
        `orderid=${orderId}`,
        "orderid=DifferentFictitiousOrder",
      ),
    }),
  ],
  { kind: "invalid-response" },
  (client) => client.prepareTradePayment(orderId),
);
await scenario(
  "lost payment response does not send a second payment",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, undefined, { drop: true }),
  ],
  { kind: "uncertain" },
  (client) => makePayment(client),
);
await scenario(
  "pay from the original order receipt using the same authorized buy form hash",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, orderReceipt),
    post(
      `${orderURL}&${mode}`,
      { ...paymentBody, formhash: orderFields.formhash },
      paymentReceipt,
    ),
  ],
  { kind: "paid", order: { orderId, url: orderURL } },
  async (client) => {
    const placed = await makeOrder(client);
    assert.equal(placed.kind, "order-created");
    assert.deepEqual(await client.prepareTradePayment({ ...placed.order }), {
      kind: "invalid-input",
    });
    const prepared = await client.prepareTradePayment(placed.order);
    assert.equal(prepared.kind, "trade-payment-form");
    assert.equal(prepared.form.order.orderId, orderId);
    assert.equal(prepared.form.order.status, "created");
    assert.equal(prepared.form.order.credit.amount, 20);
    return client.payTradeOrder(prepared.form, {
      password: paymentSecret,
      message: "Fictitious payment note",
    });
  },
);
await scenario(
  "native order acknowledgement identifies creation only",
  [
    goodsRead,
    orderOpen,
    post(`${orderPOST}&${mode}`, orderFields, undefined, {
      html: `<div id="messagetext" class="alert_info">
<p>交易单创建成功，现在将转入交易单页面</p><p class="alert_btnleft"><a href="${orderURL}">Continue to order</a></p></div>`,
    }),
  ],
  { kind: "order-created", order: { orderId, url: orderURL } },
  makeOrder,
);
const legacyLock = `<div class="locked"><a class="viewpay" href="forum.php?mod=misc&amp;action=pay&amp;tid=42&amp;pid=101">购买主题</a>
<em>已有 2 人购买</em>本主题需向作者支付 <strong>5 Fictional credits</strong> 才能浏览</div>`;
const legacyThread = (
  body,
) => `<html>${memberMarkup}<body><h1><span id="thread_subject">${title}</span></h1><div id="postlist">
<div id="post_101"><table id="pid101"><tr><td id="postmessage_101">${body}</td></tr></table></div></div></body></html>`;
const legacyOfferURL = `${forum}?mod=misc&action=pay&paysubmit=yes&infloat=yes`;
const xml = (fragment) =>
  `<?xml version="1.0"?><root><![CDATA[${fragment}]]></root>`;
const legacyDialog =
  xml(`<form id="payform" method="post" action="${legacyOfferURL.replaceAll("&", "&amp;")}">
<input type="hidden" name="formhash" value="fictional-hash"><input type="hidden" name="referer" value="${thread}">
<input type="hidden" name="tid" value="42"><input type="hidden" name="handlekey" value="pay">
<table><tr><th>作者</th><td><a href="home.php?mod=space&amp;uid=33">Fictitious Author</a></td></tr>
<tr><th>售价(Fictional credits)</th><td>5</td></tr><tr><th>作者所得(Fictional credits)</th><td>4</td></tr>
<tr><th>购买后余额(Fictional credits)</th><td>95</td></tr></table><button type="submit" name="paysubmit" value="true">提交</button></form>`);
const xmlBody = (html) => ({ html, contentType: "text/xml" });
await scenario(
  "native locked post and XML offer, acknowledgement and exact readable opening post",
  [
    get(view, undefined, { html: legacyThread(legacyLock) }),
    get(`${dialog}&${mode}&tsdmform=1`, undefined, xmlBody(legacyDialog)),
    post(
      `${legacyOfferURL}&inajax=1&${mode}`,
      {
        formhash: "fictional-hash",
        referer: thread,
        tid: "42",
        handlekey: "pay",
        paysubmit: "true",
      },
      undefined,
      xmlBody(xml('<div class="alert_right">购买成功</div>')),
    ),
    get(view, undefined, {
      html: legacyThread("Fictitious unlocked opening post"),
    }),
  ],
  {
    kind: "purchased",
    thread: { ...paidThread, payers: null, access: "accessible" },
  },
  confirm,
);
await scenario(
  "nonliteral cash terms require the browser",
  [
    goodsRead,
    get(orderFormURL, undefined, {
      html: orderMarkup.replace(
        "var credit = 10",
        "var price = Number('12.5'); var credit = 10",
      ),
    }),
  ],
  { kind: "browser-handoff", destination: orderFormURL },
  openBuyForm,
);
await scenario(
  "virtual order has no recipient fields and remains separate from payment",
  [
    goodsRead,
    get(orderFormURL, undefined, {
      html: orderMarkup
        .replace('name="transport" value="1"', 'name="transport" value="3"')
        .replace(
          /<label for="buyer(?:name|contact)"[^>]*>[^<]*<\/label><input[^>]*>/g,
          "",
        ),
    }),
    post(
      `${orderPOST}&${mode}`,
      Object.fromEntries(
        Object.entries({ ...orderFields, transport: "3" }).filter(
          ([key]) => !["buyername", "buyercontact"].includes(key),
        ),
      ),
      orderReceipt,
    ),
  ],
  { kind: "order-created", order: { orderId, url: orderURL } },
  async (client) => {
    const open = await openBuyForm(client);
    assert.equal(open.kind, "trade-order-form");
    assert.deepEqual(open.form.terms.recipientFields, []);
    return client.createTradeOrder(open.form, {
      quantity: 2,
      message: "Fictitious note",
    });
  },
);
await scenario(
  "an order page without qualified details remains a browser handoff",
  [
    get(orderURL, undefined, {
      html: `<html>${memberMarkup}<body>Fictitious order</body></html>`,
    }),
  ],
  { kind: "browser-handoff", destination: orderURL },
  (client) => client.prepareTradePayment(orderId),
);
await scenario(
  "replayed payment system-error page remains uncertain",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, {
      ...paymentReceipt,
      kind: "page",
      ok: 0,
      url: "",
      message_key: "",
    }),
  ],
  { kind: "uncertain" },
  (client) => makePayment(client),
);
await scenario(
  "insufficient credit cannot be mistaken for a payment",
  [
    orderRead,
    post(`${orderURL}&${mode}`, paymentBody, {
      ...paymentReceipt,
      ok: 0,
      alert: "error",
      url: "",
      message_key: "trade_credit_lack",
    }),
  ],
  { kind: "refused", code: "trade_credit_lack" },
  (client) => makePayment(client),
);
await scenario(
  "a changed session cannot use the prior trade order form",
  [goodsRead, orderOpen],
  { kind: "session-changed" },
  async (client, options) => {
    const open = await openBuyForm(client);
    assert.equal(open.kind, "trade-order-form");
    options.session = () => ({
      ...session,
      continuity: "fictional-replacement",
    });
    return client.createTradeOrder(open.form, orderInput);
  },
);
await scenario(
  "an older plugin can serve the native dialog on a second read-only request",
  [
    get(view, locked),
    get(`${dialog}&${mode}&tsdmform=1`, {
      ok: 0,
      error: "unknown",
      form: "buy",
      uid: 31,
    }),
    get(`${dialog}&${mode}`, undefined, xmlBody(legacyDialog)),
  ],
  {
    kind: "purchase-form",
    form: {
      threadId: "42",
      postId: "101",
      terms: {
        author: { id: "33", name: "Fictitious Author" },
        price: 5,
        authorReceives: 4,
        balanceAfterPurchase: 95,
        credit: { id: null, name: "Fictional credits", unit: "" },
      },
    },
  },
  (client) => client.preparePaidThread("42"),
);
const { tradeWalkthrough } = await import("./example.mjs");
await scenario(
  "the packed TypeScript guide declines purchase and order creation independently",
  [...preparePurchase, goodsRead, orderOpen],
  {
    purchase: { kind: "not-confirmed" },
    order: { kind: "not-confirmed" },
    history: {
      kind: "browser-handoff",
      destination: `${origin}/home.php?mod=space&do=trade&view=tradelog`,
    },
  },
  (_client, options) =>
    tradeWalkthrough(
      options,
      "42",
      goodsTarget,
      orderInput,
      async () => false,
      async () => {
        throw new Error("Unexpected password prompt");
      },
    ),
);
console.log(JSON.stringify(results));
