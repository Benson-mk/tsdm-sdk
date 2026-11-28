import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMediaClient } from "tsdm-sdk";

const origin = "https://www.tsdm39.com";
const upstream = process.argv[2];
const target = { threadId: "9200046", attachmentId: "564" };
const other = { ...target, attachmentId: "566" };
const results = [];

function fixture(name, sha256) {
  const bytes = readFileSync(join(upstream, "test/data/tsdmapp", name));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, name);
  return JSON.parse(bytes);
}

function response(body, contentType = "application/json", status = 200) {
  return {
    status,
    contentType,
    bytes: new TextEncoder().encode(
      typeof body === "string" ? body : JSON.stringify(body),
    ),
  };
}

const locked = fixture(
  "thread_v14_attachments.json",
  "59bdab2c7b0b47fb0bef5d5fab6911f48fe20a141a518ad2233bbfbb6505d0f2",
);
const accessible = fixture(
  "thread_v14_hide_replied.json",
  "9460d77da48490c22a3d87660fc08750d2868125812ab57c71b27a5679de1d37",
);
const refusal = fixture(
  "thread_v3_denied_guest.json",
  "9cc7dfb12c9659b96dbfff0682cd7e3fa68d5868b48dcc89aa95112c3323f7f8",
);
const memberId = String(locked.uid);
const authorId = String(accessible.uid);
assert.notEqual(memberId, authorId);
assert.equal(authorId, String(accessible.thread.authorid));
assert.equal(
  authorId,
  String(accessible.posts.find((post) =>
    post.attachments?.some((row) => row.aid === 564),
  ).authorid),
);

const quotePath = ({ attachmentId, threadId }) =>
  `/forum.php?mod=misc&action=attachpay&aid=${attachmentId}&tid=${threadId}`;
const offer = (attachment, amount) =>
  ({ kind: "offer", attachment, amount, creditType: "天使币" });
const handoff = {
  kind: "browser-handoff",
  reason: "purchase",
  destination: origin + quotePath(target),
};
const unknown = { kind: "unknown" };
const refused = { kind: "refused" };
const sessionChanged = { kind: "session-changed" };

function quote(subject, { amount = "2", credit = "天使币", viewer = memberId } = {}) {
  return response(`<!doctype html>
<html><head><script>var discuz_uid = '${viewer}';</script></head><body>
<div id="um"></div>
<form id="attachpayform" method="post"
      action="forum.php?mod=misc&amp;action=attachpay&amp;tid=${subject.threadId}">
  <h3><em>购买附件</em></h3>
  <input type="hidden" name="formhash">
  <input type="hidden" name="referer">
  <input type="hidden" name="aid" value="${subject.attachmentId}">
  <table><tbody><tr><td>售价(${credit})</td><td>${amount} </td></tr></tbody></table>
  <input name="buyall" type="checkbox">
  <button name="paysubmit" type="submit">购买附件</button>
</form></body></html>`, "text/html");
}

const noAttachmentRow = {
  ok: 1,
  type: "thread",
  schema: 23,
  uid: locked.uid,
  thread: { tid: Number(target.threadId) },
  posts: [{
    body_html: [target, other].map((subject) =>
      `<a href="${quotePath(subject).replaceAll("&", "&amp;")}">购买</a>`,
    ).join(""),
  }],
};

async function inspect(name, {
  subject = target,
  viewer = memberId,
  reads,
  expected,
  changeAt,
  changeTo = { memberId: viewer, continuity: "changed" },
}) {
  const requests = [];
  let session = { memberId: viewer, continuity: "original" };
  const destinations = {
    viewthread: `/forum.php?mod=viewthread&tid=${subject.threadId}&tsdmapp=json&nodoc=1`,
    attachpay: quotePath(subject),
  };
  const client = createMediaClient({
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const destination = new URL(url);
        const params = destination.searchParams;
        const route = params.get("action") ?? params.get("mod");
        const flags = ["paysubmit", "buyall", "formhash", "ck"].some(
          (name) => params.has(name),
        );
        requests.push({
          route,
          method: request.method,
          effect: request.effect,
          fresh: request.fresh,
          sameSession:
            request.session.memberId === viewer &&
            request.session.continuity === "original",
          exactDestination: destination.href === origin + destinations[route],
          payment: request.effect || request.method !== "GET" ||
            route === "attachcredit" || flags,
        });
        if (route === changeAt) session = changeTo;
        return { url, redirect: "none", headers: {}, ...reads[requests.length - 1]?.[1] };
      },
    },
  });
  const actual = await client.inspectPaidAttachment(subject);
  assert.deepEqual(requests, reads.map(([route]) => ({
    route, method: "GET", effect: false, fresh: true, sameSession: true,
    exactDestination: true, payment: false,
  })), name);
  const observed = Object.fromEntries(
    Object.keys(expected).map((key) => [key, actual[key]]),
  );
  assert.deepEqual(observed, expected, name);
  if (expected.kind !== "offer")
    assert.equal("amount" in actual || "creditType" in actual, false, name);
  for (const key of ["purchased", "form", "formhash", "fields", "token"])
    assert.equal(key in actual, false, name);
  const paymentRequests = requests.filter((request) => request.payment).length;
  assert.equal(paymentRequests, 0, name);
  results.push({ name, subject, expected, observed, requests, paymentRequests });
}

const thread = (page) => ["viewthread", response(page)];
const native = (reply) => ["attachpay", reply];
const fromLocked = (reply) => [thread(locked), native(reply)];

await inspect("captured post and thread author has access, not proof of purchase", {
  viewer: authorId,
  reads: [thread(accessible)],
  expected: { kind: "already-accessible", attachment: target },
});
await inspect("captured locked thread plus projected native form return exact terms", {
  reads: fromLocked(quote(target)),
  expected: offer(target, 2),
});
await inspect("schema-23 live projection: attachment absent from structured rows", {
  reads: [thread(noAttachmentRow), native(quote(target))],
  expected: offer(target, 2),
});
await inspect("two-price controlled variation: second exact target receives only its own quote", {
  subject: other,
  reads: [thread(noAttachmentRow), native(quote(other, { amount: "7" }))],
  expected: offer(other, 7),
});
await inspect("captured structured login refusal stops before native quote", {
  reads: [thread(refusal)],
  expected: refused,
});
await inspect("explicit native HTTP refusal is not a quote", {
  reads: fromLocked(response("", "text/plain", 403)),
  expected: refused,
});
await inspect("absent native amount is not zero", {
  reads: fromLocked(quote(target, { amount: "" })),
  expected: unknown,
});
await inspect("unknown native credit is not assumed to be 天使币", {
  reads: fromLocked(quote(target, { credit: "不明点数" })),
  expected: unknown,
});
await inspect("wrong hidden attachment identity cannot supply terms", {
  reads: fromLocked(quote(other)),
  expected: handoff,
});
await inspect("wrong form action thread identity cannot supply terms", {
  reads: fromLocked(quote({ ...target, threadId: "1000" })),
  expected: handoff,
});
await inspect("unsupported native HTML preserves the exact browser handoff", {
  reads: fromLocked(response("<main>Unsupported native page</main>", "text/html")),
  expected: handoff,
});
await inspect("native quote without a viewer cannot supply terms", {
  reads: fromLocked(quote(target, { viewer: "" })),
  expected: handoff,
});
await inspect("unfollowed redirect to attachcredit is never followed", {
  reads: fromLocked({
    ...response("", "text/plain", 302),
    headers: { location: "/forum.php?mod=misc&action=attachcredit&aid=564" },
  }),
  expected: handoff,
});
await inspect("same-account re-login during native quote invalidates the response", {
  reads: fromLocked(quote(target)),
  changeAt: "attachpay",
  expected: sessionChanged,
});
await inspect("account switched during structured read is not retried", {
  reads: [thread(locked)],
  changeAt: "viewthread",
  changeTo: { memberId: authorId, continuity: "changed" },
  expected: sessionChanged,
});
await inspect("native quote for another viewer cannot supply terms", {
  reads: fromLocked(quote(target, { viewer: authorId })),
  expected: sessionChanged,
});
await inspect("structured response for another viewer cannot establish access", {
  reads: [thread(accessible)],
  expected: sessionChanged,
});
console.log(JSON.stringify(results));
