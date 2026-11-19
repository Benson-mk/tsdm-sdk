import { operationURL } from "../account-forms.js";
import { id, record, rows, string } from "../activity-protocol.js";
import type { NoticeSession } from "../notice-transport.js";
import { query } from "../posts/forms.js";
import { forum, jsonWrite, type moderationHost, validId } from "./protocol.js";
import type {
  ModerationFailure,
  ModerationPostTarget,
  ModerationTarget,
  PosterIpResult,
} from "./types.js";
import { token, type OfferedModeration } from "./forms.js";

type Host = ReturnType<typeof moderationHost>;
const invalid = { kind: "invalid-response" } as const;
const unavailable = {
  kind: "refused",
  code: "permission-not-offered",
} as const;
const lean = (url: string) => query(url, { tsdmapp: "json", nodoc: "1" });
const selectedPage = (value: number | undefined) =>
  value === undefined || (Number.isSafeInteger(value) && value > 0);

async function readThread(
  host: Host,
  owner: NoticeSession,
  forumId: string,
  threadId: string,
  page?: number,
  postId?: string,
) {
  const url = lean(
    forum(host.origin, {
      mod: "viewthread",
      tid: threadId,
      ...(page && page > 1 && { page: String(page) }),
    }),
  );
  const reply = await host.exchange(url, owner);
  if (reply.kind !== "answer") return reply;
  const { data } = reply;
  const thread = record(data?.thread);
  if (
    data?.type !== "thread" ||
    data.ok !== 1 ||
    id(data.uid) !== owner.memberId ||
    data.schema !== 21 ||
    id(thread?.tid) !== threadId ||
    id(thread?.fid) !== forumId
  )
    return invalid;
  const perms = record(data.perms);
  const posts = rows(data.posts) ?? [];
  const matches = posts.filter((post) => id(post?.pid) === postId);
  const post = postId && matches.length === 1 ? matches[0] : null;
  if (!perms || (postId && !post)) return invalid;
  return {
    kind: "source" as const,
    url,
    thread,
    perms,
    post,
    posts,
    page: data.page,
  };
}
function offeredURL(
  raw: unknown,
  source: string,
  required: Record<string, string>,
  optional: readonly string[],
) {
  const offered = operationURL(
    string(raw),
    new URL(source),
    "/forum.php",
    required,
  );
  return offered &&
    [...offered.searchParams.keys()].every(
      (name) => Object.hasOwn(required, name) || optional.includes(name),
    )
    ? offered
    : null;
}
function ipv4(value: string) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
    )
  );
}
function address(value: string) {
  if (ipv4(value)) return true;
  if (!value.includes(":") || !/^[\da-f:.]+$/i.test(value)) return false;
  try {
    return new URL(`https://[${value}]`).hostname.startsWith("[");
  } catch {
    return false;
  }
}
export async function readPosterIp(
  host: Host,
  source: ModerationPostTarget,
): Promise<PosterIpResult> {
  if (
    !source ||
    !validId(source.forumId) ||
    !validId(source.threadId) ||
    !validId(source.postId) ||
    !selectedPage(source.page)
  )
    return { kind: "invalid-input" };
  const { forumId, threadId, postId, page } = source;
  const owner = host.session();
  if (!owner) return { kind: "refused", code: "login" };
  const authority = await readThread(
    host,
    owner,
    forumId,
    threadId,
    page,
    postId,
  );
  if (authority.kind !== "source") return authority;
  const { perms, post } = authority;
  if (perms.allow_viewip !== 1 || record(post?.can)?.viewip !== 1)
    return unavailable;
  const offered = offeredURL(
    record(post?.urls)?.viewip,
    authority.url,
    { mod: "topicadmin", action: "getip", pid: postId },
    ["tid", "fid", "inajax", "infloat", "handlekey"],
  );
  if (
    !offered ||
    (offered.searchParams.has("tid") &&
      offered.searchParams.get("tid") !== threadId) ||
    (offered.searchParams.has("fid") &&
      offered.searchParams.get("fid") !== forumId)
  )
    return invalid;
  const reply = await host.exchange(
    query(offered.href, { tsdmapp: "json", tsdmform: "1", nodoc: "1" }),
    owner,
  );
  if (reply.kind !== "answer") return reply;
  const { data } = reply;
  const ip = string(data?.ip);
  const port = data?.port;
  const author = id(post?.authorid);
  if (
    data?.type !== "form" ||
    data.form !== "getip" ||
    data.schema !== 17 ||
    data.ok !== 1 ||
    id(data.uid) !== owner.memberId ||
    id(data.tid) !== threadId ||
    id(data.pid) !== postId ||
    (author && id(data.authorid) !== author) ||
    data.submit !== null ||
    !address(ip) ||
    (port !== null &&
      port !== undefined &&
      (typeof port !== "number" ||
        !Number.isSafeInteger(port) ||
        port < 0 ||
        port > 65535))
  )
    return invalid;
  return {
    kind: "poster-ip",
    forumId,
    threadId,
    postId,
    ip,
    port: typeof port === "number" ? port : null,
    location: string(data.location),
  };
}

export async function directOffer(
  host: Host,
  owner: NoticeSession,
  target: ModerationTarget,
): Promise<OfferedModeration | ModerationFailure> {
  const { operation, forumId, postId, attachmentId, page } = target;
  const tid = target.threadIds[0]!;
  const authority = await readThread(host, owner, forumId, tid, page, postId);
  if (authority.kind !== "source") return authority;
  const { perms, post, thread } = authority;
  const context = [string(thread?.subject)].filter(Boolean);
  const fixed = new URLSearchParams();
  let url: string;
  if (operation === "repair") {
    if (perms.allow_repair !== 1) return unavailable;
    url = jsonWrite(
      forum(host.origin, {
        mod: "topicadmin",
        action: "repair",
        fid: forumId,
        tid,
        handlekey: "mods",
        infloat: "yes",
        nopost: "yes",
        inajax: "1",
      }),
    );
  } else {
    if (perms.allow_delattach !== 1 || record(post?.can)?.edit !== 1)
      return unavailable;
    const offered = offeredURL(
      record(post?.urls)?.edit,
      authority.url,
      {
        mod: "post",
        action: "edit",
        fid: forumId,
        tid,
        pid: postId!,
      },
      ["page", "extra"],
    );
    if (!offered) return invalid;
    const editor = await host.exchange(lean(offered.href), owner);
    if (editor.kind !== "answer") return editor;
    const data = editor.data;
    const formhash = string(data?.formhash);
    if (
      data?.type !== "post" ||
      data.schema !== 16 ||
      data.action !== "edit" ||
      data.ok !== 1 ||
      id(data.uid) !== owner.memberId ||
      id(data.fid) !== forumId ||
      id(data.tid) !== tid ||
      id(data.pid) !== postId ||
      !token.test(formhash)
    )
      return invalid;
    const used = rows(record(data.attach)?.used);
    if (!used) return invalid;
    const matches = used.filter((item) => id(item?.aid) === attachmentId);
    if (matches.length !== 1)
      return { kind: "refused", code: "attachment-not-offered" };
    const filename = string(matches[0]?.filename);
    if (!filename) return invalid;
    context.push(filename);
    url = jsonWrite(
      forum(host.origin, {
        mod: "ajax",
        action: "deleteattach",
        inajax: "yes",
        formhash,
        tid,
        pid: postId!,
        "aids[]": attachmentId!,
      }),
    );
  }
  const form = Object.freeze({
    target,
    method: (operation === "repair" ? "POST" : "GET") as "POST" | "GET",
    fields: Object.freeze([]),
    context: Object.freeze(context),
  });
  return { form, url, fixed };
}

export async function qualifySplit(
  host: Host,
  owner: NoticeSession,
  target: ModerationTarget,
  selection: string,
): Promise<ModerationFailure | null> {
  const floors = new Map<string, string>();
  const positions = new Map<string, string>();
  for (const page of target.splitPages ?? [1]) {
    const read = await readThread(
      host,
      owner,
      target.forumId,
      target.threadIds[0]!,
      page,
    );
    if (read.kind !== "source") return read;
    if (read.page !== page || !read.posts.length) return invalid;
    if (read.perms.allow_split !== 1) return unavailable;
    for (const post of read.posts) {
      const pid = id(post?.pid);
      const position = id(post?.position);
      if (!pid) return invalid;
      if (!position) continue;
      if (
        (floors.has(pid) && floors.get(pid) !== position) ||
        (positions.has(position) && positions.get(position) !== pid)
      )
        return invalid;
      floors.set(pid, position);
      positions.set(position, pid);
    }
  }
  const selected = new Set(selection.split(","));
  if ([...selected].some((position) => !positions.has(position)))
    return { kind: "refused", code: "split-floor-not-observed" };
  if (![...positions.keys()].some((position) => !selected.has(position)))
    return { kind: "refused", code: "split-requires-observed-retained-floor" };
  return null;
}
