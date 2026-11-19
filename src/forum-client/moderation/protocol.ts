import { answer, id, responseIssue, string } from "../activity-protocol.js";
import type { ActivityClientOptions } from "../activity-client.js";
import {
  noticeHost,
  numericId,
  type NoticeSession,
} from "../notice-transport.js";
import { query } from "../posts/forms.js";

export const forum = (origin: string, fields: Record<string, string>) =>
  query(`${origin}/forum.php`, fields);
export const v4Form = (url: string) =>
  query(url, { tsdmapp: "json", tsdmv: "4", tsdmform: "1", nodoc: "1" });
export const jsonWrite = (url: string) => query(url, { tsdmapp: "json" });
export const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,17}$/.test(value);

export function moderationHost(options: ActivityClientOptions) {
  const { origin, session, current } = noticeHost({
    origin: options.origin,
    session: () => options.session(),
    transport: {
      request: (url, request) =>
        options.transport.request(
          url,
          request.method === "GET"
            ? { ...request, effect: false }
            : { ...request, effect: true },
        ),
    },
  });
  async function exchange(
    url: string,
    owner: NoticeSession,
    effect = false,
    body?: string,
  ) {
    if (!current(owner)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url,
        body === undefined
          ? { method: "GET", fresh: true, effect, session: owner }
          : { method: "POST", fresh: true, effect: true, session: owner, body },
      );
    } catch {
      return { kind: current(owner) ? "network" : "session-changed" } as const;
    }
    if (!current(owner)) return { kind: "session-changed" } as const;
    if (response.url !== url || response.redirect !== "none")
      return { kind: "invalid-response" } as const;
    const parsed = answer(response);
    const { data } = parsed;
    if (
      data?.uid !== undefined &&
      numericId(data.uid) !== "0" &&
      id(data.uid) !== owner.memberId
    )
      return { kind: "session-changed" } as const;
    const issue = responseIssue(response, data);
    if (issue) return issue;
    if (data?.uid !== undefined && id(data.uid) !== owner.memberId)
      return { kind: "refused", code: "login" } as const;
    if (response.status !== 200) return { kind: "invalid-response" } as const;
    if (data?.ok === 0 || data?.alert === "error") {
      if (!effect && (data.error === "action" || data.error === "off"))
        return { kind: "unsupported" } as const;
      return {
        kind: "refused",
        code: string(data.message_key) || "forum-refusal",
      } as const;
    }
    return { kind: "answer", ...parsed } as const;
  }
  return { origin, session, current, exchange };
}
