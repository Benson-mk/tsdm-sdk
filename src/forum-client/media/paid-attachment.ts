import { nativeIdentity } from "../account-forms.js";
import { requiresStructuredLogin } from "../activity-protocol.js";
import {
  attr,
  byId,
  children,
  descendants,
  documentFrom,
  element,
  hasClass,
  label,
} from "../html.js";
import { query, structured } from "../posts/forms.js";
import { decodeStructuredThread } from "../structured-thread.js";
import {
  forumURL,
  invalid,
  json,
  numericId,
  positive,
  record,
  refused,
  sessionChanged,
  text,
  unknown,
  type MediaHost,
} from "./host.js";
import { attachment, purchaseHandoff, resourceURL } from "./retrieval.js";
import type {
  MediaResponse,
  MediaSession,
  PaidAttachmentInspection,
  PaidAttachmentTarget,
} from "./types.js";

const deniedStatuses = new Set([401, 403, 404, 410, 429]);

function hasCurrentAccess(
  page: Record<string, unknown>,
  target: PaidAttachmentTarget,
  owner: MediaSession,
  origin: URL,
) {
  const rows = Array.isArray(page.posts)
    ? page.posts.flatMap((post) => {
        const attachments = record(post)?.attachments;
        return Array.isArray(attachments) ? attachments.map(record) : [];
      })
    : [];
  const matches = rows.filter((row) => positive(row?.aid) === target.attachmentId);
  if (matches.length !== 1) return false;
  const row = matches[0];
  if (row?.locked !== 0 || !positive(row.price)) return false;
  const download = resourceURL(row.download, origin, origin);
  if (!download || download.searchParams.has("ck")) return false;
  const identity = attachment(download, origin);
  return (
    identity?.attachmentId === target.attachmentId &&
    identity.threadId === target.threadId &&
    identity.memberId === owner.memberId
  );
}

function readQuote(
  response: MediaResponse,
  url: URL,
  target: PaidAttachmentTarget,
  owner: MediaSession,
): PaidAttachmentInspection {
  if (deniedStatuses.has(response.status))
    return refused(
      "The forum declined attachment inspection.",
      String(response.status),
    );
  if (
    response.status !== 200 ||
    !/^text\/html(?:\s*;|$)/i.test(response.contentType)
  )
    return purchaseHandoff(url);

  const body = text(response);
  const viewer = nativeIdentity(body, url);
  if (viewer !== null && viewer !== owner.memberId) return sessionChanged;
  if (viewer === null) return purchaseHandoff(url);
  const doc = documentFrom(body);
  const notice = byId(doc, "messagetext");
  if (
    notice &&
    hasClass(notice, "alert_error") &&
    /^(?:抱歉，您没有权限下载本附件|抱歉，只有特定用户可以下载本站附件)$/.test(
      label(descendants(notice, (node) => node.tagName === "p")[0]),
    )
  )
    return refused("The forum declined attachment access.");

  const forms = descendants(doc, (node) => attr(node, "id") === "attachpayform");
  const form = forms[0];
  if (
    !byId(doc, "um") ||
    forms.length !== 1 ||
    form?.tagName !== "form" ||
    attr(form, "method").toLowerCase() !== "post"
  )
    return purchaseHandoff(url);
  const action = forumURL(attr(form, "action"), url, "/forum.php");
  if (
    action?.searchParams.size !== 3 ||
    action.searchParams.get("mod") !== "misc" ||
    action.searchParams.get("action") !== "attachpay" ||
    action.searchParams.get("tid") !== target.threadId
  )
    return purchaseHandoff(url);
  const ids = descendants(
    form,
    (node) => node.tagName === "input" && attr(node, "name") === "aid",
  );
  const id = ids[0];
  const headings = descendants(form, (node) => node.tagName === "h3");
  if (
    ids.length !== 1 ||
    !id ||
    attr(id, "type") !== "hidden" ||
    attr(id, "value") !== target.attachmentId ||
    headings.length !== 1 ||
    label(headings[0]) !== "购买附件"
  )
    return purchaseHandoff(url);

  const prices = descendants(form, (node) => node.tagName === "tr")
    .map((row) =>
      children(row).filter((cell) => element(cell) && cell.tagName === "td"),
    )
    .filter(([key]) => /^售价(?:[（(]|$)/.test(label(key)));
  const [key, value] = prices[0] ?? [];
  const amountLabel = label(value);
  const amount = Number(amountLabel);
  if (
    prices.length !== 1 ||
    prices[0]?.length !== 2 ||
    label(key) !== "售价(天使币)" ||
    !/^[1-9]\d*$/.test(amountLabel) ||
    !Number.isSafeInteger(amount)
  )
    return unknown(
      "The forum did not provide complete, recognized attachment terms.",
    );
  return { kind: "offer", attachment: target, amount, creditType: "天使币" };
}

export function createPaidAttachmentInspection(host: MediaHost) {
  return {
    async inspectPaidAttachment(
      target: PaidAttachmentTarget,
    ): Promise<PaidAttachmentInspection> {
      const threadId = target?.threadId;
      const attachmentId = target?.attachmentId;
      if (
        typeof threadId !== "string" ||
        !positive(threadId) ||
        typeof attachmentId !== "string" ||
        !positive(attachmentId)
      )
        return invalid("Select one attachment and its thread.");
      const original = host.session();
      if (!original || original.memberId === "0")
        return refused("Sign in to inspect attachment terms.", "login");

      const identity = { threadId, attachmentId };
      const endpoint = new URL("/forum.php", host.origin).href;
      const threadURL = new URL(
        structured(query(endpoint, { mod: "viewthread", tid: threadId })),
      );
      const thread = await host.request(threadURL, original);
      if (!host.current(original)) return sessionChanged;
      if (thread.kind !== "response")
        return thread.kind === "session-changed" ? thread : unknown(thread.message);

      const { response } = thread;
      if (deniedStatuses.has(response.status))
        return refused(
          "The forum declined thread access.",
          String(response.status),
        );
      const payload = /^application\/json(?:\s*;|$)/i.test(response.contentType)
        ? json(text(response))
        : null;
      if (
        requiresStructuredLogin(payload) ||
        (payload?.ok === 0 && payload.error === "message")
      )
        return refused("The forum declined thread access.");
      const page =
        response.status === 200 ? decodeStructuredThread(payload) : null;
      if (page) {
        const viewer = numericId(page.uid);
        if (viewer !== null && viewer !== original.memberId)
          return sessionChanged;
        if (positive(record(page.thread)?.tid) !== threadId)
          return unknown(
            "The thread response did not identify the requested thread.",
          );
        if (
          viewer === original.memberId &&
          hasCurrentAccess(page, identity, original, host.origin)
        )
          return { kind: "already-accessible", attachment: identity };
      }

      const quoteURL = new URL(
        query(endpoint, {
          mod: "misc",
          action: "attachpay",
          aid: attachmentId,
          tid: threadId,
        }),
      );
      const quote = await host.request(quoteURL, original);
      if (!host.current(original)) return sessionChanged;
      if (quote.kind !== "response")
        return quote.kind === "session-changed" ? quote : purchaseHandoff(quoteURL);
      return readQuote(quote.response, quoteURL, identity, original);
    },
  };
}
