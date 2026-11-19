import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  label,
  type Element,
} from "./html.js";
import {
  activityURL,
  answer,
  id,
  int,
  record,
  responseIssue,
  string,
} from "./activity-protocol.js";
import { accountFrom, decodeThread } from "./read-thread.js";
import { numericId } from "./notice-transport.js";
import { routeFor } from "./routes.js";
import type { ActivityFailure } from "./activity-read-types.js";
import type { ActivityTarget, PreparedActivity } from "./activity-effects.js";
import type { HostResponse } from "./types.js";

export type Target = {
  publicTarget: ActivityTarget;
  page: URL;
  threadId: string;
  postId?: string;
};
export type Authority = {
  url: URL;
  hash: string;
  boardId?: string;
  evaluation?: PreparedActivity["evaluation"];
};
const refused = (message: string) =>
  ({ kind: "refused", code: "permission", message }) as const;
export function activityTarget(
  base: URL,
  choice: ActivityTarget,
): Target | null {
  const route = routeFor(choice.threadURL);
  const tid = id(route?.url.searchParams.get("tid"));
  const postAction = ["rate", "report", "comment"].includes(choice.action);
  if (
    !route ||
    route.kind !== "thread" ||
    route.url.origin !== base.origin ||
    !tid ||
    (postAction
      ? !id(choice.postId)
      : !["recommend", "subtract"].includes(choice.action) ||
        choice.postId !== undefined)
  )
    return null;
  const page = route.url;
  const fragment = page.hash;
  if (
    (fragment && fragment !== `#pid${choice.postId}`) ||
    (page.searchParams.has("viewpid") &&
      page.searchParams.get("viewpid") !== choice.postId)
  )
    return null;
  page.hash = "";
  if (!activityURL(page.href, base)) return null;
  return {
    publicTarget: { ...choice },
    page,
    threadId: tid,
    ...(choice.postId !== undefined ? { postId: choice.postId } : {}),
  };
}
export const sideOf = (action: ActivityTarget["action"]) =>
  action === "recommend" ? "add" : "subtract";
export function offeredURL(raw: unknown, target: Target, boardId?: string) {
  const {
    page,
    publicTarget: { action },
    threadId,
    postId,
  } = target;
  const url = activityURL(string(raw), page);
  if (!raw || !url || url.searchParams.get("tid") !== threadId) return null;
  const q = url.searchParams;
  let values: Record<string, string>;
  let optional: string[] = [];
  if (action === "report") {
    if (url.pathname !== "/misc.php" || !boardId) return null;
    values = {
      mod: "report",
      rtype: "post",
      rid: postId!,
      tid: threadId,
      fid: boardId,
    };
  } else {
    if (url.pathname !== "/forum.php") return null;
    if (!postId) {
      if (!q.get("hash")) return null;
      values = {
        mod: "misc",
        action: "recommend",
        do: sideOf(action),
        tid: threadId,
        hash: q.get("hash")!,
      };
      optional = ["inajax"];
    } else {
      values = { mod: "misc", action, tid: threadId, pid: postId };
      optional = action === "comment" ? ["extra", "page"] : [];
    }
  }
  return Object.entries(values).every(([key, value]) => q.get(key) === value) &&
    [...q.keys()].every(
      (key) => Object.hasOwn(values, key) || optional.includes(key),
    )
    ? url
    : null;
}

export function activityAuthority(
  target: Target,
  response: HostResponse,
  memberId: string,
): Authority | ActivityFailure | null {
  const { data, doc, failure } = answer(response);
  if (data?.uid !== undefined && numericId(data.uid) !== memberId)
    return {
      kind: "session-changed",
      message: "The thread was served to a different account.",
    };
  const issue = responseIssue(response, data);
  if (issue) return issue;
  if (failure || (data?.ok === 0 && data.message))
    return refused(string(data?.message) || failure);
  if (response.status !== 200) return null;
  const {
    publicTarget: { action },
    threadId,
    postId,
    page,
  } = target;
  const thread = record(data?.thread);
  if (
    data?.type === "thread" &&
    data.ok === 1 &&
    (int(data.schema) ?? 0) >= 3 &&
    thread &&
    numericId(data.uid) === memberId
  ) {
    if (id(thread.tid) !== threadId)
      return {
        kind: "invalid",
        message: "The forum returned a different thread.",
      };
    const hash = string(data.formhash);
    const boardId = id(thread.fid);
    if (!postId) {
      const recommendation = record(data.recommend);
      const side = sideOf(action);
      const button = record(recommendation?.[side]);
      if (
        recommendation?.can === 0 ||
        recommendation?.shown === 0 ||
        (recommendation?.shown === 1 && !button)
      )
        return refused("The forum did not offer this evaluation.");
      const name = string(button?.label);
      if (recommendation?.shown === 1 && name) {
        const urls = record(recommendation.urls);
        const raw =
          urls?.[side] ??
          (hash &&
            `/forum.php?${new URLSearchParams({ mod: "misc", action: "recommend", do: side, tid: threadId, hash })}`);
        const url = offeredURL(raw, target);
        const count = int(button?.count);
        if (!url) return null;
        url.searchParams.set("inajax", "1");
        return {
          url,
          hash: url.searchParams.get("hash")!,
          evaluation: {
            label: name,
            ...(count !== null && count >= 0 ? { count } : {}),
          },
        };
      }
    } else if (Array.isArray(data.posts)) {
      const matching = data.posts
        .map(record)
        .filter((post) => id(post?.pid) === postId);
      if (matching.length > 1)
        return {
          kind: "invalid",
          message: "The forum duplicated the requested post.",
        };
      const post = matching[0];
      const can = record(post?.can)?.[action];
      if (can === 0)
        return refused("The forum did not offer this post action.");
      const url = offeredURL(
        record(post?.urls)?.[action],
        target,
        boardId ?? undefined,
      );
      if (can === 1 && url && hash)
        return { url, hash, ...(boardId ? { boardId } : {}) };
    }
  }
  const read = decodeThread(response, page.href);
  if (read.kind !== "thread") return null;
  if (read.account.kind !== "member" || read.account.id !== memberId)
    return {
      kind: "session-changed",
      message: "The native thread member could not be verified.",
    };
  const nativeDoc =
    data?.head && typeof data.head === "string"
      ? documentFrom(data.head + string(data.document))
      : doc;
  const safeRoots = new Set<Element>(
    descendants(nativeDoc, (n) =>
      /^postmessage_\d+$/.test(attr(n, "id")),
    ).flatMap((n) => [n, ...descendants(n, () => true)]),
  );
  const forumControl = (node: Element) => !safeRoots.has(node);
  if (!postId) {
    const side = sideOf(action),
      container = descendants(
        nativeDoc,
        (n) => attr(n, "id") === "p_btn" && forumControl(n),
      )[0];
    const button = container && byId(container, `recommend_${side}`);
    const url = button && offeredURL(attr(button, "href"), target);
    if (!url || !button)
      return refused("The forum did not offer this evaluation.");
    const countText = label(byId(button, `recommendv_${side}`));
    url.searchParams.set("inajax", "1");
    return {
      url,
      hash: url.searchParams.get("hash")!,
      evaluation: {
        label: label(button),
        ...(/^\d+$/.test(countText) ? { count: Number(countText) } : {}),
      },
    };
  }
  const post = read.thread.posts.find((post) => post.id === postId);
  const wrapper = byId(nativeDoc, `post_${postId}`);
  const commentLinks = wrapper
    ? descendants(
        wrapper,
        (n) => n.tagName === "a" && hasClass(n, "cmmnt") && forumControl(n),
      )
    : [];
  const commentLink = commentLinks.length === 1 ? commentLinks[0] : undefined;
  const raw =
    action === "rate"
      ? post?.rateURL
      : action === "report"
        ? post?.reportURL
        : commentLink && attr(commentLink, "href");
  const report = raw && action === "report" ? activityURL(raw, page) : null;
  const boardId = report ? id(report.searchParams.get("fid")) : null;
  const url = post && offeredURL(raw, target, boardId ?? undefined);
  if (!url) return refused("The forum did not offer this post action.");
  const hashes = new Set(
    descendants(
      nativeDoc,
      (n) =>
        n.tagName === "input" &&
        attr(n, "name") === "formhash" &&
        attr(n, "type") === "hidden",
    )
      .map((n) => attr(n, "value"))
      .filter(Boolean),
  );
  if (hashes.size !== 1) return null;
  const [hash] = hashes;
  const header = accountFrom(nativeDoc, response.url);
  if (header.kind !== "member" || header.id !== memberId) return null;
  return { url, hash: hash!, ...(boardId ? { boardId } : {}) };
}
