import { noticePostURL } from "./notice-links.js";
import { decodeNativeNotices, type NativeNoticeEntry } from "./notices.js";
import { routeFor } from "./routes.js";
import type { NoticeFailure, NoticeHost, NoticeSession } from "./notice-transport.js";
import type { Notices } from "./types.js";

export type NoticeHandoff = { kind: "handoff"; destination: string } | { kind: "not-prepared" };
export type NativeNoticeHandoff = Exclude<NoticeHandoff, { kind: "not-prepared" }> & { warning: string };
export type NativeNoticePage = Omit<Notices, "entries"> & { entries: NativeNoticeEntry[] };
export type NativeNoticeResult =
  | ({ kind: "notices"; readEffect: "possible" } & NativeNoticePage)
  | { kind: "unavailable"; reason: NoticeFailure; readEffect: "unknown" }
  | { kind: "not-dispatched" };

export function nativeNotices(host: NoticeHost, beginNoticeEffect: () => (() => void) | null) {
  const handoffs = new WeakMap<NativeNoticeHandoff, { url: URL; session: NoticeSession }>();

  function prepareNativeNoticePage(destination = `${host.origin}/home.php?mod=space&do=notice`): NativeNoticeHandoff | { kind: "not-prepared" } {
    const route = routeFor(destination);
    const session = host.session();
    if (route?.kind !== "notices" || route.url.origin !== host.origin || !session || route.url.hash) {
      return { kind: "not-prepared" };
    }
    route.url.searchParams.delete("tsdmapp");
    const handoff: NativeNoticeHandoff = {
      kind: "handoff",
      destination: route.url.href,
      warning: "Opening this native page may mark notices read, even if the response fails to load or decode.",
    };
    handoffs.set(handoff, { url: route.url, session });
    return handoff;
  }

  async function openNativeNoticePage(handoff: ReturnType<typeof prepareNativeNoticePage>): Promise<NativeNoticeResult> {
    const prepared = handoff.kind === "handoff" && handoffs.get(handoff);
    if (!prepared || !host.current(prepared.session)) return { kind: "not-dispatched" };
    const finish = beginNoticeEffect();
    if (!finish) return { kind: "not-dispatched" };
    handoffs.delete(handoff as NativeNoticeHandoff);
    try {
      const loaded = await host.request(prepared.url.href, prepared.session);
      if (loaded.kind !== "response") return { kind: "unavailable", reason: loaded.kind, readEffect: "unknown" };
      const decoded = decodeNativeNotices(loaded.response, prepared.url.href);
      if (decoded.account.kind === "member" && decoded.account.id !== prepared.session.memberId) {
        return { kind: "unavailable", reason: "session-changed", readEffect: "unknown" };
      }
      if (decoded.kind === "notices") return { kind: "notices", ...decoded.notices, readEffect: "possible" };
      const reason = loaded.response.status === 429 || decoded.kind === "limited"
        ? "rate-limited" : ["login", "permission", "challenge"].includes(decoded.kind) ? "refused" : "invalid-response";
      return { kind: "unavailable", reason, readEffect: "unknown" };
    } finally {
      finish();
    }
  }

  function noticePostDestination(destination: string): NoticeHandoff {
    const url = noticePostURL(destination, host.origin);
    return url && host.session() ? { kind: "handoff", destination: url } : { kind: "not-prepared" };
  }
  return { prepareNativeNoticePage, openNativeNoticePage, noticePostDestination };
}
