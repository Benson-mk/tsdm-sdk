import { id, record } from "../activity-protocol.js";
import { descendants, hasClass } from "../html.js";
import type { NoticeSession } from "../notice-transport.js";
import type { moderationHost } from "./protocol.js";
import { nativeForm, offeredForm } from "./forms.js";
import type { ModerationEffect, ModerationTarget } from "./types.js";

export function moderationReceipt(
  reply: Awaited<ReturnType<ReturnType<typeof moderationHost>["exchange"]>>,
  owner: NoticeSession,
  target: ModerationTarget,
  source: string,
): ModerationEffect {
  const uncertain = { kind: "uncertain", target } as const;
  if (reply.kind === "refused") return reply;
  if (reply.kind !== "answer") return uncertain;
  const { data, doc, html } = reply;
  const rating = target.operation === "removerate";
  const repair = target.operation === "repair";
  const attachment = target.operation === "deleteattach";
  const code = attachment
    ? "deleteattach_succeed"
    : rating
      ? "thread_rate_removesucceed"
      : repair
        ? "admin_repair_succeed"
        : "admin_succeed";
  const handle = rating ? "rate" : "mods";
  const acknowledged = { kind: "acknowledged", target, code } as const;
  if (
    !attachment &&
    !repair &&
    (data ? id(data.uid) === owner.memberId && data.ok === 1 : true)
  ) {
    const redrawn =
      data?.type === "form"
        ? offeredForm(data, source, target)
        : !data ||
            (data.type === "result" &&
              data.schema === 13 &&
              data.kind === "page")
          ? nativeForm(doc, source, target)
          : null;
    if (redrawn && "form" in redrawn) return { kind: "redrawn", target };
  }
  if (data) {
    if (
      id(data.uid) !== owner.memberId ||
      data.type !== "result" ||
      data.schema !== 13 ||
      data.ok !== 1
    )
      return uncertain;
    const values = record(data.values);
    if (
      target.threadIds.length === 1 &&
      values?.tid !== undefined &&
      id(values.tid) !== target.threadIds[0]
    )
      return uncertain;
    if (
      target.postId &&
      values?.pid !== undefined &&
      id(values.pid) !== target.postId
    )
      return uncertain;
    if (
      !attachment &&
      data.message_key === code &&
      ((data.kind === "handle" && data.handlekey === handle) ||
        (data.kind === "message" && data.alert === "right"))
    )
      return acknowledged;
    if (attachment && data.count !== undefined) {
      if (data.count === 1 && data.message_key === code) return acknowledged;
      if (data.count === 0 && data.message_key === "deleteattach_none")
        return { kind: "refused", code: "deleteattach_none" };
    }
    if (!attachment || data.kind !== "page" || data.count !== undefined)
      return uncertain;
  }
  if (attachment) {
    if (html.trim() === "1") return acknowledged;
    if (html.trim() === "0")
      return { kind: "refused", code: "deleteattach_none" };
  } else if (!data) {
    // Recognize the forum's literal AJAX callback and never evaluate the script.
    const success = new RegExp(
      `<script\\b[^>]*>\\s*(?:if\\s*\\(typeof succeedhandle_${handle}=='function'\\)\\s*\\{\\s*)?succeedhandle_${handle}\\('(?:[^'\\\\]|\\\\.)*',\\s*'(?:[^'\\\\]|\\\\.)*',\\s*\\{[^<]*?\\}\\);?\\s*\\}?\\s*</script>`,
      "i",
    );
    const refusal = new RegExp(`(?:^|[;{]\\s*)errorhandle_${handle}\\(`);
    if (!repair && success.test(html) && !refusal.test(html))
      return acknowledged;
    if (
      repair &&
      descendants(doc, (node) => hasClass(node, "alert_right")).length === 1 &&
      refusal.test(html)
    )
      return acknowledged;
    if (
      refusal.test(html) ||
      descendants(doc, (node) => hasClass(node, "alert_error")).length
    )
      return { kind: "refused", code: "native-refusal" };
  }
  return uncertain;
}
