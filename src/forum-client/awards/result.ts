import { nativeIdentity } from "../account-forms.js";
import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  label,
} from "../html.js";
import { numericId } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import { answer } from "./protocol.js";
import type { AwardsChoice, AwardsResult } from "./types.js";

export function effectResult(
  response: HostResponse,
  memberId: string,
  choice: AwardsChoice,
  successPrefix?: string,
): AwardsResult {
  const { data, html } = answer(response);
  if (data?.uid !== undefined && numericId(data.uid) !== memberId)
    return { kind: "unknown", choice };
  const nativeViewer = nativeIdentity(html, new URL(response.url));
  if (nativeViewer && nativeViewer !== memberId)
    return { kind: "unknown", choice };
  const structured =
    data?.type === "result" &&
    data.schema === 13 &&
    numericId(data.uid) === memberId;
  const doc = documentFrom(html);
  const box = byId(doc, "messagetext");
  const paragraph = box && descendants(box, (node) => node.tagName === "p")[0];
  const message = (
    structured && typeof data.message === "string"
      ? data.message
      : label(paragraph ?? box)
  ).trim();
  const outcome = (
    kind: "refused" | "redrawn" | "pending-review" | "acknowledged" | "unknown",
  ): AwardsResult => ({ kind, choice, ...(message ? { message } : {}) });
  if (
    [401, 403].includes(response.status) ||
    (structured && (data.login === 1 || data.alert === "error")) ||
    (box && hasClass(box, "alert_error"))
  )
    return outcome("refused");
  if (response.status !== 200) return outcome("unknown");
  if (
    descendants(
      doc,
      (node) =>
        node.tagName === "form" &&
        /(?:claim|sethide|grantgrid|grantrevoke|settitle|buy|exchange|issue|slotadd)/.test(
          attr(node, "action"),
        ),
    ).length
  )
    return outcome("redrawn");
  if (structured && data.kind === "page" && !box) return outcome("redrawn");
  if (structured && !["message", "page"].includes(String(data.kind)))
    return outcome("unknown");
  if (choice.kind === "grant-background") {
    if (!successPrefix || !message.startsWith(successPrefix))
      return outcome("unknown");
    const count = /^\s*(\d+)\s*位/.exec(
      message.slice(successPrefix.length),
    )?.[1];
    if (count === undefined) return outcome("unknown");
    const grantedCount = Number(count);
    if (grantedCount === 0) return outcome("refused");
    if (grantedCount > choice.recipients.length) return outcome("unknown");
    return {
      kind:
        grantedCount < choice.recipients.length ? "partial" : "acknowledged",
      choice,
      message,
      grantedCount,
    };
  }
  if (
    choice.kind === "acquire-medal" &&
    choice.method === 2 &&
    /等待审核|审核中|等待審核|審核中|已提交.*审核|已提交.*審核/.test(message)
  )
    return outcome("pending-review");
  if (
    message &&
    ((structured && data.ok === 1 && data.alert === "right") ||
      (box && hasClass(box, "alert_right")))
  )
    return outcome("acknowledged");
  return outcome("unknown");
}
