import { positive } from "../discovery/shared.js";
import type { SpaceView } from "./model.js";

export function forumURL(raw: string, origin: string): URL | null {
  try {
    const url = new URL(raw, origin);
    return /^https?:$/.test(url.protocol) &&
      url.origin === origin &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export interface SpaceRoute {
  view: SpaceView | "photo";
  url: URL;
  owner: string | null;
  page: string;
  pageField: string;
  scope: string | null;
  fragment: boolean;
}

export function spaceRoute(raw: string, origin: string): SpaceRoute | null {
  const url = forumURL(raw, origin);
  if (url?.pathname !== "/home.php") return null;
  const p = url.searchParams;
  url.hash = "";
  for (const key of [
    "tsdmapp",
    "tsdmv",
    "nodoc",
    "tsdmform",
    "quickforward",
    "from",
  ])
    p.delete(key);
  if ([...p.keys()].some((key) => p.getAll(key).length !== 1)) return null;
  const owner = positive(p.get("uid"));
  if (p.has("uid") && !owner) return null;
  const mod = p.get("mod");
  const tab = p.get("do");
  const ac = p.get("ac");
  const op = p.get("op");
  let view: SpaceRoute["view"] | undefined;
  let fragment = false;
  let scope = p.get("view");
  if (mod === "space") {
    if (ac || op) return null;
    if (tab === "doing") view = "statuses";
    if (tab === "blog") view = p.has("id") ? "blog" : "blogs";
    if (tab === "album")
      view = p.has("picid") ? "photo" : p.has("id") ? "photos" : "albums";
    if (tab === "wall") view = "wall";
    if (!tab && owner) view = "member";
  }
  if (mod === "follow" && !ac && !op) {
    if (tab === "following") view = "following";
    if (tab === "follower") view = "followers";
    if (
      (!tab && (!scope || ["other", "follow"].includes(scope))) ||
      (tab === "view" && owner)
    ) {
      view = "timeline";
      scope = owner ? "we" : (scope ?? "follow");
    }
  }
  if (mod === "spacecp" && !tab) {
    if (ac === "doing" && op === "getcomment" && positive(p.get("doid")))
      view = "status-replies";
    if (ac === "poke" && !op && !owner) view = "greetings";
    if (
      ac === "follow" &&
      op === "getfeed" &&
      (owner || ["follow", "other"].includes(p.get("viewtype") ?? ""))
    ) {
      if (p.has("archiver") && !["0", "1"].includes(p.get("archiver")!))
        return null;
      view = "timeline";
      fragment = true;
      scope = owner ? "we" : p.get("viewtype");
    }
  }
  const pageField = view === "status-replies" ? "page_c" : "page";
  const page = positive(p.get(pageField) ?? "1");
  if (!view || !page || !Number.isSafeInteger(Number(page))) return null;
  for (const key of ["id", "picid", "doid", "cid"]) {
    if (
      !p.has(key) ||
      positive(p.get(key)) ||
      (view === "photos" && key === "id" && p.get(key) === "-1")
    )
      continue;
    return null;
  }
  const allowed = new Set([
    "mod",
    "uid",
    "do",
    "ac",
    "op",
    "view",
    "page",
    "page_c",
    "id",
    "picid",
    "doid",
    "cid",
    "archiver",
    "viewtype",
    "inajax",
    "order",
    "catid",
    "classid",
    "fuid",
    "searchkey",
    "tagid",
    "tag",
    "highlight",
  ]);
  if ([...p.keys()].some((key) => !allowed.has(key))) return null;
  return { view, url, owner, page, pageField, scope, fragment };
}

export function feedPosition(
  route: SpaceRoute,
  archive: boolean,
  page: number,
): string {
  const destination = new URL("/home.php", route.url);
  destination.search = new URLSearchParams({
    mod: "spacecp",
    ac: "follow",
    op: "getfeed",
    archiver: archive ? "1" : "0",
    page: String(page),
    ...(route.owner
      ? { uid: route.owner }
      : { viewtype: route.scope ?? "follow" }),
  }).toString();
  return destination.href;
}

export function continuation(route: SpaceRoute, raw: string): string | null {
  const next = spaceRoute(raw, route.url.origin);
  if (
    !next ||
    next.view !== route.view ||
    next.owner !== route.owner ||
    next.scope !== route.scope
  )
    return null;
  const from = route.url.searchParams;
  const to = next.url.searchParams;
  if (route.view === "timeline") {
    if (!next.fragment) return null;
    if (from.get("archiver") !== "1" && to.get("archiver") === "1")
      return next.page === "1" ? next.url.href : null;
    if ((from.get("archiver") === "1") !== (to.get("archiver") === "1"))
      return null;
  } else {
    for (const key of new Set([...from.keys(), ...to.keys()])) {
      if (
        key !== "inajax" &&
        key !== route.pageField &&
        from.get(key) !== to.get(key)
      )
        return null;
    }
  }
  return Number(next.page) > Number(route.page) ? next.url.href : null;
}
