import { positive, record } from "../discovery/shared.js";
import { content, fragmentFrom, safeURL } from "../html.js";
import type { Account } from "../types.js";
import type { SpaceEntry, SpaceMember, SpacePage, SpaceView } from "./model.js";
import { continuation, forumURL, type SpaceRoute } from "./routes.js";

type Fields = Record<string, unknown>;
const schemas: Partial<
  Record<SpaceView, readonly [string, number, string, string]>
> = {
  statuses: ["space_doing", 57, "doings", "doid"],
  "status-replies": ["space_docomment", 58, "comments", "id"],
  timeline: ["space_feed", 59, "feeds", "feedid"],
  following: ["space_follow", 60, "users", "uid"],
  followers: ["space_follow", 60, "users", "uid"],
  blogs: ["space_blog", 61, "blogs", "blogid"],
  albums: ["space_album", 62, "albums", "albumid"],
  wall: ["space_wall", 63, "comments", "cid"],
  greetings: ["space_poke", 64, "pokes", "uid"],
};

export const str = (value: unknown) =>
  typeof value === "string" ? value : null;
export const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export const flag = (value: unknown) => value === 1 || value === true;
export function person(id: unknown, name: unknown): SpaceMember | null {
  const uid = positive(id);
  return uid ? { id: uid, name: str(name) } : null;
}

export function entry(id: string, fields: Partial<SpaceEntry>): SpaceEntry {
  return {
    id,
    author: null,
    title: null,
    text: null,
    content: [],
    privacy: null,
    parentId: null,
    pending: false,
    deleted: false,
    timestamp: null,
    url: null,
    image: null,
    links: [],
    ...fields,
  };
}

function links(fields: Fields, base: string): SpaceEntry["links"] {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (!key.endsWith("_url") || typeof value !== "string" || !value) return [];
    const url = forumURL(value, base);
    if (!url || !["/home.php", "/forum.php"].includes(url.pathname)) return [];
    // Only expose destinations safe to open as documents. Confirmation forms
    // with tokenized action links belong to the effect transport.
    if (
      [
        "follow_url",
        "unfollow_url",
        "special_url",
        "recommend_url",
        "addfriend_url",
      ].includes(key) ||
      ["hash", "formhash"].some((field) => url.searchParams.has(field))
    )
      return [];
    return [{ relation: key.slice(0, -4), url: url.href }];
  });
}

function structuredEntry(row: Fields, key: string, route: SpaceRoute) {
  const id = positive(row[key]);
  if (!id) return null;
  const base = route.url.origin;
  const thread = record(row.thread);
  const author = flag(row.anonymous)
    ? null
    : person(row.uid ?? row.authorid, row.username ?? row.author);
  const text = str(row.message ?? row.summary ?? row.note ?? row.recentnote);
  const html = str(row.message_html ?? thread?.content_html);
  if (
    ["statuses", "status-replies", "wall"].includes(route.view) &&
    text === null &&
    html === null &&
    !flag(row.deleted)
  )
    return null;
  const threadId = positive(thread?.tid);
  const rawURL = str(row.url);
  const image = str(row.cover ?? row.icon);
  return entry(id, {
    author,
    title: str(row.subject ?? row.albumname ?? thread?.subject),
    text,
    content: html === null ? [] : content(fragmentFrom(html), route.url.href),
    privacy:
      str(thread?.restricted) ||
      (flag(row.need_password)
        ? "password"
        : flag(row.locked)
          ? "locked"
          : count(row.friend) === null
            ? null
            : String(row.friend)),
    parentId: positive(row.upid),
    pending: flag(row.pending),
    deleted: flag(row.deleted),
    timestamp: count(row.dateline ?? row.updatetime),
    url: rawURL
      ? (forumURL(rawURL, base)?.href ?? null)
      : threadId
        ? new URL(`/forum.php?mod=viewthread&tid=${threadId}`, base).href
        : null,
    image: image ? safeURL(image, base) : null,
    links: [...links(row, base), ...links(thread ?? {}, base)],
  });
}

export const supportsStructuredSpace = (route: SpaceRoute) =>
  route.view !== "photo" && Boolean(schemas[route.view]);

export function structuredPage(
  payload: Fields,
  route: SpaceRoute,
  account: Account,
): SpacePage | "mismatch" | null {
  if (route.view === "photo") return null;
  const schema = schemas[route.view];
  if (
    !schema ||
    payload.type !== schema[0] ||
    payload.schema !== schema[1] ||
    !flag(payload.ok)
  )
    return null;
  const ownerFields = record(payload.owner);
  const owner = person(
    ownerFields?.uid ?? (route.view === "greetings" ? payload.uid : null),
    ownerFields?.username,
  );
  if (route.owner && owner?.id !== route.owner && !(route.fragment && !owner))
    return "mismatch";
  if (positive(payload.page) !== route.page) return "mismatch";
  if (
    route.view === "timeline" &&
    ((route.scope === "we"
      ? (owner && owner.id !== route.owner) ||
        ["follow", "other"].includes(String(payload.view))
      : payload.view !== route.scope) ||
      flag(payload.more) !== route.fragment ||
      (route.fragment &&
        flag(payload.archiver) !==
          (route.url.searchParams.get("archiver") === "1")))
  )
    return "mismatch";
  if (
    route.view === "status-replies" &&
    positive(payload.doid) !== route.url.searchParams.get("doid")
  )
    return "mismatch";
  if (
    route.view === "statuses" &&
    route.url.searchParams.has("doid") &&
    positive(payload.doid) !== route.url.searchParams.get("doid")
  )
    return "mismatch";
  if (
    route.view === "wall" &&
    positive(payload.cid) !== route.url.searchParams.get("cid")
  )
    return "mismatch";
  if (
    (route.view === "following" && payload.list !== "following") ||
    (route.view === "followers" && payload.list !== "follower")
  )
    return "mismatch";
  if (route.view === "albums" && payload.mode !== "albums") return "mismatch";
  if (
    ["statuses", "blogs", "albums"].includes(route.view) &&
    route.scope &&
    payload.view !== route.scope
  )
    return "mismatch";
  for (const key of [
    "order",
    "catid",
    "classid",
    "fuid",
    "searchkey",
    "tagid",
    "tag",
  ]) {
    const expected = route.url.searchParams.get(key);
    if (expected !== null && String(payload[key]) !== expected)
      return "mismatch";
  }
  const rows = payload[schema[2]];
  if (!Array.isArray(rows)) return null;
  const entries: SpaceEntry[] = [];
  for (const value of rows) {
    const row = record(value);
    const item = row && structuredEntry(row, schema[3], route);
    if (!item) return null;
    if (
      route.owner &&
      ["statuses", "blogs", "albums"].includes(route.view) &&
      item.author?.id !== route.owner
    )
      return "mismatch";
    entries.push(item);
  }
  const pages = count(payload.pages);
  let next: string | null = null;
  if (route.view === "timeline") {
    const advertised = str(payload.next);
    if (advertised) {
      next = continuation(route, advertised);
      if (!next) return "mismatch";
    }
  } else if (pages !== null && pages > Number(route.page)) {
    const url = new URL(route.url);
    url.searchParams.set(route.pageField, String(Number(route.page) + 1));
    next = url.href;
  }
  return {
    kind: "page",
    view: route.view,
    url: route.url.href,
    account,
    owner: owner ?? (route.fragment ? person(route.owner, null) : null),
    entries,
    hidden: count(payload.hidden),
    next,
    links: links(payload, route.url.origin),
  };
}
