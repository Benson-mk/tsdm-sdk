import { attr, byId, descendants, hasClass, label } from "../html.js";
import { numericId } from "../notice-transport.js";
import { postCallback } from "../post-response.js";
import type { HostResponse } from "../types.js";
import { json, sameOrigin } from "./forms.js";
import { canonical, documentBody, memberOf, resultThread } from "./native.js";

const moderated = (message: unknown) =>
  typeof message === "string" &&
  /需要[审審]核|requires moderation|awaiting moderation/i.test(message);
const challenge = (key: unknown, message: unknown) =>
  key === "submit_seccode_invalid" ||
  key === "submit_secqaa_invalid" ||
  (!key &&
    typeof message === "string" &&
    /验证码填写错误|驗證碼填寫錯誤|验证问答填写错误|驗證問答填寫錯誤/.test(
      message,
    ));

type Outcome =
  | { kind: "candidate"; destination: URL; threadId: string }
  | {
      kind:
        | "moderation"
        | "redisplayed"
        | "refused"
        | "challenge-refused"
        | "uncertain";
    };

export function writeOutcome(
  response: HostResponse & { location?: string },
  source: string,
  memberId: string,
): Outcome {
  const candidate = (raw: unknown): Outcome => {
    const destination = sameOrigin(raw, source);
    const threadId = resultThread(destination);
    return destination && threadId
      ? { kind: "candidate", destination, threadId }
      : { kind: "uncertain" };
  };
  if ([301, 302, 303].includes(response.status))
    return candidate(response.location);
  if ([401, 403, 429].includes(response.status)) return { kind: "refused" };
  if (response.status !== 200) return { kind: "uncertain" };
  const data = json(response.body);
  if (data?.type === "result" && data.schema === 13) {
    if (numericId(data.uid) !== memberId) return { kind: "uncertain" };
    if (data.login === 1) return { kind: "refused" };
    if (challenge(data.message_key, data.message))
      return { kind: "challenge-refused" };
    if (data.kind !== "page") {
      if (
        (data.kind === "message" || data.kind === "handle") &&
        (data.ok === 0 || data.alert === "error")
      )
        return { kind: "refused" };
      if (data.ok !== 1) return { kind: "uncertain" };
      if (
        data.message_key === "post_newthread_mod_succeed" ||
        moderated(data.message)
      )
        return { kind: "moderation" };
      if (
        data.kind === "redirect" ||
        (data.kind === "handle" && data.handlekey === "post") ||
        (data.kind === "message" && data.alert === "right")
      )
        return candidate(data.url);
      return { kind: "uncertain" };
    }
  } else if (data && data.type !== undefined) return { kind: "uncertain" };
  if (data && data.uid !== undefined && numericId(data.uid) !== memberId)
    return { kind: "uncertain" };
  const callback = postCallback(response);
  if (callback) {
    const message = callback.values.at(-1);
    if (callback.success)
      return moderated(message)
        ? { kind: "moderation" }
        : candidate(callback.values[0]);
    if (challenge("", message)) return { kind: "challenge-refused" };
    return { kind: "refused" };
  }
  const doc = documentBody(response.body, data);
  if (!doc) return { kind: "uncertain" };
  const message = byId(doc, "messagetext");
  if (message) {
    const words = label(message);
    if (challenge("", words)) return { kind: "challenge-refused" };
    if (hasClass(message, "alert_error") || byId(doc, "messagelogin"))
      return { kind: "refused" };
    if (hasClass(message, "alert_right")) {
      if (moderated(words)) return { kind: "moderation" };
      const actions = descendants(message, (node) =>
        hasClass(node, "alert_btnleft"),
      );
      const links = actions.flatMap((node) =>
        descendants(node, (link) => link.tagName === "a"),
      );
      if (links.length === 1) return candidate(attr(links[0]!, "href"));
    }
  }
  const editor = byId(doc, "postform");
  if (editor?.tagName === "form" && memberOf(doc, source) === memberId)
    return { kind: "redisplayed" };
  if (byId(doc, "postlist")) return candidate(canonical(doc));
  return { kind: "uncertain" };
}
