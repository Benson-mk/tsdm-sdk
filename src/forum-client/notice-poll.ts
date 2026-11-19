import { content, documentFrom } from "./html.js";
import { ignoreTarget, noticeContent, postDestinations, type NoticeIgnoreTarget } from "./notice-links.js";
import {
  integer, noticeJSON, numericId, object,
  type NoticeFailure, type NoticeHost, type NoticeSession,
} from "./notice-transport.js";
import type { ContentNode } from "./types.js";

export interface UnreadNotice {
  readonly id: string;
  readonly dateline: number;
  readonly type: string | null;
  readonly authorId: string | null;
  readonly body: readonly ContentNode[];
  readonly postDestinations: readonly string[];
  readonly ignoreTarget: NoticeIgnoreTarget | null;
}

export interface PollUnreadNoticesOptions {
  since: number;
  coverage?: "window" | "account";
  maxPages?: number;
}

export interface UnreadNoticePoll {
  readonly memberId: string | null;
  readonly rows: readonly UnreadNotice[];
  readonly window: "unknown" | "partial" | "complete";
  readonly accountCoverage: "unproven" | "exhausted";
  readonly stop: NoticeFailure | "session-required" | "invalid-input" |
    "window-boundary" | "exhausted" | "legacy-incomplete" | "page-limit" | "invalid-cursor";
  readonly forumUnreadCount: number | null;
  readonly nextSince: number;
}

export type NoticeAcknowledgement = {
  kind: "cleared" | "newer-unread" | "unknown-effect" | "not-dispatched";
};

type PollProof = { session: NoticeSession; time: number; formhash: string; revision: number };
const maxDefaultPages = 10;
const pageSize = 200;

function unreadRows(value: unknown, origin: string): UnreadNotice[] | null {
  if (!Array.isArray(value)) return null;
  const rows: UnreadNotice[] = [];
  for (const entry of value as unknown[]) {
    const item = object(entry);
    if (!item || (item.new !== 0 && item.new !== 1)) return null;
    if (item.new === 0) continue;
    const id = numericId(item.id);
    if (!id || id === "0" || !integer(item.dateline, 1)) return null;
    const html = typeof item.note === "string" ? item.note : "";
    const body = html
      ? noticeContent(content(documentFrom(html), origin + "/"))
      : typeof item.text === "string" ? [{ kind: "text" as const, text: item.text }] : [];
    rows.push({
      id, dateline: item.dateline, body,
      type: typeof item.type === "string" ? item.type : null,
      authorId: numericId(item.authorid),
      postDestinations: postDestinations(body, origin),
      ignoreTarget: ignoreTarget(item.type, item.authorid),
    });
  }
  return rows;
}

function actionURL(origin: string, action: "notify" | "seen"): URL {
  const url = new URL("/plugin.php", origin);
  url.search = new URLSearchParams({ id: "tsdmapp:api", action }).toString();
  return url;
}

export function noticePolling(host: NoticeHost) {
  const proofs = new WeakMap<UnreadNoticePoll, PollProof>();
  let revision = 0;
  let effectInFlight = false;

  function beginNoticeEffect(): (() => void) | null {
    if (effectInFlight) return null;
    effectInFlight = true;
    revision++;
    return () => { effectInFlight = false; };
  }

  async function pollUnreadNotices({ since, coverage = "window", maxPages = maxDefaultPages }: PollUnreadNoticesOptions): Promise<UnreadNoticePoll> {
    const started = revision;
    const canAcknowledge = !effectInFlight;
    const session = host.session();
    const rows = new Map<string, UnreadNotice>();
    const unreadIds = new Set<string>();
    let count: number | null = null;
    let time: number | null = null;
    let formhash: string | null = null;
    let accepted = 0;
    let oldest = Infinity;
    let boundary = false;
    let before: string | null = null;
    let cursorTail: UnreadNotice | undefined;

    function finish(stop: UnreadNoticePoll["stop"]): UnreadNoticePoll {
      const exhausted = stop === "exhausted";
      const result: UnreadNoticePoll = {
        memberId: session?.memberId ?? null,
        rows: [...rows.values()],
        window: exhausted || boundary ? "complete" : accepted ? "partial" : "unknown",
        accountCoverage: exhausted ? "exhausted" : "unproven",
        stop,
        forumUnreadCount: count,
        nextSince: (exhausted || stop === "window-boundary") && time !== null
          ? Math.max(time, since) : since,
      };
      if (exhausted && session && time !== null && formhash && canAcknowledge && started === revision) {
        proofs.set(result, { session, time, formhash, revision: started });
      }
      return result;
    }

    if (!integer(since, 0) || !integer(maxPages, 1) || !["window", "account"].includes(coverage)) {
      return finish("invalid-input");
    }
    if (!session) return finish("session-required");

    while (accepted < maxPages) {
      const url = actionURL(host.origin, "notify");
      if (before === null) url.searchParams.set("since", String(since));
      url.searchParams.set("limit", String(pageSize));
      if (before !== null) url.searchParams.set("before", before);
      const response = await host.request(url.href, session);
      if (response.kind !== "response") return finish(response.kind);
      const decoded = noticeJSON(response.response);
      if (decoded.kind !== "json") return finish(decoded.kind);
      const { data } = decoded;
      const returnedId = numericId(data.uid);
      if (returnedId !== session.memberId) return finish(returnedId === null ? "invalid-response" : "session-changed");
      const page = unreadRows(data.notices, host.origin);
      if (!page || (data.has_more !== undefined && data.has_more !== 0 && data.has_more !== 1)) {
        return finish("invalid-response");
      }
      if (before !== null && data.has_more === undefined) return finish("invalid-response");
      for (const row of page) {
        if (row.dateline > oldest) return finish("invalid-response");
        oldest = row.dateline;
      }
      if (!accepted) {
        const total = object(data.counts)?.notice;
        count = integer(total, 0) ? total : null;
        time = integer(data.time, 1) ? data.time : null;
        formhash = typeof data.formhash === "string" && data.formhash.trim() ? data.formhash : null;
      }
      accepted++;
      const previousSize = unreadIds.size;
      for (const row of page) {
        unreadIds.add(row.id);
        if (row.dateline < since) boundary = true;
        else if (!rows.has(row.id)) rows.set(row.id, row);
      }
      const tail = page.at(-1);
      const advances = !cursorTail || (tail && (
        tail.dateline < cursorTail.dateline ||
        (tail.dateline === cursorTail.dateline && BigInt(tail.id) < BigInt(cursorTail.id))
      ));
      if (data.has_more === 0) {
        if ((data.next != null && data.next !== "") ||
          (cursorTail && tail && (!advances || unreadIds.size === previousSize))) {
          return finish("invalid-cursor");
        }
        if (count === null || unreadIds.size >= count) return finish("exhausted");
        return finish(boundary && coverage === "window" ? "window-boundary" : "invalid-response");
      }
      if (data.has_more === undefined) {
        if (count !== null && count === page.length && unreadIds.size === count) return finish("exhausted");
        return finish(boundary && coverage === "window" ? "window-boundary" : "legacy-incomplete");
      }
      const next = data.next;
      if (!tail || next !== `${tail.dateline}_${tail.id}` || !advances) return finish("invalid-cursor");
      if (boundary && coverage === "window") return finish("window-boundary");
      cursorTail = tail;
      before = next;
    }
    return finish("page-limit");
  }

  async function acknowledgeAllUnreadNotices(poll: UnreadNoticePoll): Promise<NoticeAcknowledgement> {
    const proof = proofs.get(poll);
    if (!proof || proof.revision !== revision || !host.current(proof.session)) return { kind: "not-dispatched" };
    const finish = beginNoticeEffect();
    if (!finish) return { kind: "not-dispatched" };
    try {
      const body = new URLSearchParams({ formhash: proof.formhash, notice: String(proof.time) });
      const response = await host.request(actionURL(host.origin, "seen").href, proof.session, body.toString());
      if (response.kind === "response") {
        const decoded = noticeJSON(response.response);
        if (decoded.kind === "json" && numericId(decoded.data.uid) === proof.session.memberId) {
          const { notice, newer } = decoded.data;
          if (newer === 1) return { kind: "newer-unread" };
          if (notice === 1 && (newer === 0 || newer === undefined)) return { kind: "cleared" };
        }
      }
      return { kind: "unknown-effect" };
    } finally {
      finish();
    }
  }
  return { pollUnreadNotices, acknowledgeAllUnreadNotices, beginNoticeEffect };
}
