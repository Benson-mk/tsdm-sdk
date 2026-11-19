import { positive } from "../discovery/shared.js";
import {
  attr,
  byId,
  children,
  content,
  descendants,
  hasClass,
  label,
  safeURL,
  text,
  type Element,
  type Node,
} from "../html.js";
import type { Account } from "../types.js";
import type { SpaceEntry, SpacePage } from "./model.js";
import {
  continuation,
  feedPosition,
  forumURL,
  spaceRoute,
  type SpaceRoute,
} from "./routes.js";
import { entry, person } from "./structured.js";

const first = (node: Node, predicate: Parameters<typeof descendants>[1]) =>
  descendants(node, predicate)[0];
export function documentScripts(doc: Node): string {
  return descendants(doc, (node) => node.tagName === "script")
    .map((node) => children(node).map(text).join(""))
    .join("\n");
}

export const named = (node: Node, name: string): Element | undefined =>
  first(node, (child) => hasClass(child, name));
const withID = (node: Node, prefix: string) =>
  descendants(node, (child) => attr(child, "id").startsWith(prefix));
const links = (node: Node) =>
  descendants(node, (child) => child.tagName === "a");
const zeroRows = (node: Node) => Boolean(named(node, "emp"));
const identifier = (node: Node, prefix: string) =>
  positive(attr(node, "id").slice(prefix.length).replace(/_li$/, ""));

function nativeLink(node: Node | undefined, route: SpaceRoute) {
  return node ? forumURL(attr(node, "href"), route.url.origin) : null;
}
function author(node: Node | undefined, route: SpaceRoute) {
  return person(
    nativeLink(node, route)?.searchParams.get("uid"),
    label(node) || null,
  );
}
function message(node: Node | undefined, route: SpaceRoute) {
  return node
    ? { text: label(node), content: content(node, route.url.href) }
    : {};
}
function targetLink(
  node: Node,
  route: SpaceRoute,
  relation: string,
  allowed: (url: URL) => boolean,
): SpaceEntry["links"] {
  for (const link of links(node)) {
    const url = nativeLink(link, route);
    if (url && allowed(url)) return [{ relation, url: url.href }];
  }
  return [];
}

function nativeFeed(root: Node, route: SpaceRoute) {
  const rows = withID(root, "feed_li_");
  return rows.map((row) => {
    const id = identifier(row, "feed_li_");
    const from = named(row, "flw_author");
    const headline = first(row, (node) => node.tagName === "h2");
    const link =
      headline &&
      links(headline).find(
        (item) =>
          nativeLink(item, route)?.searchParams.get("mod") === "viewthread",
      );
    const url = nativeLink(link, route);
    const title = label(link);
    const original = withID(row, "original_content_")[0];
    const relay = id && byId(row, `relay_${id}`);
    const quickRelay =
      relay &&
      /^quickrelay\(\s*([1-9]\d*)\s*,\s*([1-9]\d*)\s*\);?$/.exec(
        attr(relay, "onclick"),
      );
    const supplied = targetLink(
      row,
      route,
      "relay",
      (destination) =>
        destination.pathname === "/home.php" &&
        destination.searchParams.get("ac") === "follow" &&
        destination.searchParams.get("op") === "relay",
    );
    if (
      !supplied.length &&
      quickRelay &&
      quickRelay[1] === id &&
      quickRelay[2] === url?.searchParams.get("tid")
    ) {
      supplied.push({
        relation: "relay",
        url: new URL(
          `/home.php?mod=spacecp&ac=follow&op=relay&feedid=${id}&tid=${quickRelay[2]}`,
          route.url,
        ).href,
      });
    }
    return id
      ? entry(id, {
          author: from ? author(links(from)[0], route) : null,
          title: title || null,
          url:
            url?.pathname === "/forum.php" &&
            url.searchParams.get("mod") === "viewthread" &&
            positive(url.searchParams.get("tid"))
              ? url.href
              : null,
          ...message(named(row, "flw_quotenote"), route),
          ...(original ? { content: content(original, route.url.href) } : {}),
          links: supplied,
          deleted: !title && Boolean(named(row, "xg1")),
        })
      : null;
  });
}

function wallComments(root: Node, route: SpaceRoute) {
  return withID(root, "comment_")
    .filter((row) => row.tagName === "dl")
    .map((row) => {
      const id = identifier(row, "comment_");
      const body =
        id &&
        first(
          row,
          (node) =>
            node.tagName === "dd" && attr(node, "id") === `comment_${id}`,
        );
      const from =
        links(row).find((link) => attr(link, "id").startsWith("author_")) ??
        links(row).find((link) => Boolean(author(link, route)));
      return id && body
        ? entry(id, {
            author: author(from, route),
            ...message(body, route),
            links: targetLink(
              row,
              route,
              "reply",
              (url) =>
                url.searchParams.get("ac") === "comment" &&
                url.searchParams.get("op") === "reply" &&
                url.searchParams.get("cid") === id,
            ),
          })
        : null;
    });
}

function nativeEntries(
  doc: Node,
  route: SpaceRoute,
): (SpaceEntry | null)[] | null {
  const main = byId(doc, "ct");
  const p = route.url.searchParams;
  switch (route.view) {
    case "timeline": {
      const list = route.fragment ? doc : byId(doc, "followlist");
      if (!list) return null;
      const feeds = nativeFeed(list, route);
      return !route.fragment || feeds.length ? feeds : null;
    }
    case "statuses": {
      if (!main) return null;
      const rows = descendants(
        main,
        (node) =>
          hasClass(node, "doing_list") && /dl[1-9]\d*$/.test(attr(node, "id")),
      );
      if (!rows.length && !zeroRows(main) && !byId(main, "mood_addform"))
        return null;
      return rows.map((row) => {
        const id =
          positive(
            named(row, "doing_comment_btn") &&
              attr(named(row, "doing_comment_btn")!, "data-doid"),
          ) ?? positive(/dl([1-9]\d*)$/.exec(attr(row, "id"))?.[1]);
        const from = named(row, "doing_avatar");
        const body = named(row, "item_content");
        return id && body
          ? entry(id, {
              author: author(
                from ? links(from)[0] : named(row, "author_name"),
                route,
              ),
              ...message(body, route),
              links: [
                {
                  relation: "comments",
                  url: new URL(
                    `/home.php?mod=spacecp&ac=doing&op=getcomment&doid=${id}`,
                    route.url,
                  ).href,
                },
              ],
            })
          : null;
      });
    }
    case "status-replies": {
      const rows = withID(doc, "comment_").filter((row) =>
        /^comment_\d+_li$/.test(attr(row, "id")),
      );
      if (!rows.length && !named(doc, "doing_empty")) return null;
      return rows.map((row) => {
        const id = identifier(row, "comment_");
        const body = named(row, "item_content_box");
        const member = author(named(row, "author_name"), route);
        return id
          ? entry(id, {
              author: member,
              deleted: !member && !body,
              ...message(body, route),
            })
          : null;
      });
    }
    case "blog": {
      const article = byId(doc, "blog_article");
      const wrapper = main && named(main, "vw");
      const id = p.get("id");
      if (!article || !wrapper || !id) return null;
      return [
        entry(id, {
          title: label(first(wrapper, (node) => node.tagName === "h1")),
          ...message(article, route),
          url: route.url.href,
        }),
        ...wallComments(doc, route),
      ];
    }
    case "blogs":
    case "albums":
    case "photos": {
      if (!main) return null;
      const list = named(
        main,
        route.view === "blogs"
          ? "xld"
          : route.view === "albums"
            ? "mla"
            : "mlp",
      );
      if (!list) return zeroRows(main) ? [] : null;
      const rows = descendants(
        list,
        (node) => node.tagName === (route.view === "blogs" ? "dl" : "li"),
      );
      return rows.map((row) => {
        const link = links(row).find((candidate) => {
          const target = nativeLink(candidate, route);
          return (
            target?.pathname === "/home.php" &&
            target.searchParams.get("do") === p.get("do") &&
            (route.view === "photos"
              ? target.searchParams.has("picid")
              : target.searchParams.has("id"))
          );
        });
        const url = nativeLink(link, route);
        const id = url?.searchParams.get(
          route.view === "photos" ? "picid" : "id",
        );
        const image = first(row, (node) => node.tagName === "img");
        const from = url?.searchParams.get("uid");
        if (
          !url ||
          !id ||
          (!positive(id) && !(route.view === "albums" && id === "-1")) ||
          (from && route.owner && from !== route.owner)
        )
          return null;
        const meta =
          route.view === "blogs" &&
          first(
            row,
            (node) =>
              node.tagName === "dd" &&
              !attr(node, "class") &&
              !attr(node, "id"),
          );
        const blogAuthor =
          meta &&
          links(meta).find(
            (candidate) => author(candidate, route)?.id === from,
          );
        return entry(id, {
          author: person(
            from ?? route.owner,
            blogAuthor ? label(blogAuthor) : null,
          ),
          privacy: meta ? label(named(meta, "y")) || null : null,
          title: label(link) || (image ? attr(image, "alt") : null),
          url: url.href,
          image: image ? safeURL(attr(image, "src"), route.url.href) : null,
          ...(route.view === "blogs"
            ? message(withID(row, "blog_article_")[0], route)
            : {}),
        });
      });
    }
    case "wall": {
      const list = byId(doc, "div_main_content");
      if (!list && !withID(doc, "quickcommentform_").length) return null;
      return wallComments(list ?? doc, route);
    }
    case "greetings": {
      const list = byId(doc, "poke_ul");
      if (!list)
        return main &&
          zeroRows(main) &&
          links(main).some(
            (link) =>
              nativeLink(link, route)?.searchParams.get("ac") === "poke",
          )
          ? []
          : null;
      return withID(list, "poke_")
        .filter((row) => row.tagName === "dl")
        .map((row) => {
          const id = identifier(row, "poke_");
          const from = links(row).find(
            (link) => author(link, route)?.id === id,
          );
          return id && from
            ? entry(id, {
                author: author(from, route),
                ...message(named(row, "xw0"), route),
                links: targetLink(
                  row,
                  route,
                  "reply",
                  (url) =>
                    url.searchParams.get("ac") === "poke" &&
                    url.searchParams.get("op") === "reply" &&
                    url.searchParams.get("uid") === id,
                ),
              })
            : null;
        });
    }
    case "following":
    case "followers": {
      const list = main && named(main, "flw_ulist");
      if (!list) return main && zeroRows(main) ? [] : null;
      return descendants(list, (node) => node.tagName === "li").map((row) => {
        const heading = first(row, (node) => node.tagName === "h6");
        const from = heading && links(heading)[0];
        const member = author(from, route);
        return member
          ? entry(member.id, {
              author: member,
              text: label(withID(row, "followbkame_")[0]) || null,
              url: nativeLink(from, route)?.href ?? null,
            })
          : null;
      });
    }
    default:
      return null;
  }
}

export function nativePage(
  doc: Node,
  route: SpaceRoute,
  account: Account,
  source: string,
): SpacePage | null {
  if (route.view === "photo") return null;
  const archived = route.url.searchParams.get("archiver") === "1";
  const ended = route.fragment && source.trim() === "false";
  const rows = ended ? [] : nativeEntries(doc, route);
  if (!rows || rows.some((row) => !row)) return null;
  const entries = rows.filter((row) => row !== null);
  if (
    route.owner &&
    route.view === "statuses" &&
    entries.some((row) => row.author?.id !== route.owner)
  )
    return null;
  const selected = route.url.searchParams.get(
    route.view === "wall" ? "cid" : "doid",
  );
  if (
    selected &&
    ["wall", "statuses"].includes(route.view) &&
    !entries.some((row) => row.id === selected)
  )
    return null;
  const pages = named(doc, "pg");
  const advertised =
    pages && links(pages).find((link) => hasClass(link, "nxt"));
  let next = advertised
    ? continuation(route, nativeLink(advertised, route)?.href ?? "")
    : null;
  if (route.view === "status-replies" && pages && !next) {
    const nextPage = links(pages)
      .map((link) => Number(attr(link, "data-page")))
      .filter((page) => Number.isSafeInteger(page) && page > Number(route.page))
      .sort((a, b) => a - b)[0];
    if (nextPage) {
      const url = new URL(route.url);
      url.searchParams.set("page_c", String(nextPage));
      next = url.href;
    }
  }
  if (route.fragment)
    next = ended
      ? archived
        ? null
        : feedPosition(route, true, 1)
      : feedPosition(route, archived, Number(route.page) + 1);
  if (route.view === "timeline" && !route.fragment && entries.length && !next) {
    const script = documentScripts(doc);
    next = /primary\s*:\s*1/.test(script)
      ? feedPosition(route, false, 2)
      : feedPosition(route, true, 1);
  }
  const owner = person(
    route.owner ??
      (route.view === "greetings" && account.kind === "member"
        ? account.id
        : null),
    null,
  );
  const pageLinks = byId(doc, "ct");
  return {
    kind: "page",
    view: route.view,
    url: route.url.href,
    account,
    owner,
    entries,
    hidden: null,
    next,
    links: pageLinks
      ? links(pageLinks)
          .flatMap((link) => {
            const destination = nativeLink(link, route);
            const other =
              destination && spaceRoute(destination.href, route.url.origin);
            return other &&
              other.view !== route.view &&
              other.owner === route.owner
              ? [{ relation: other.view, url: other.url.href }]
              : [];
          })
          .filter(
            (link, index, all) =>
              all.findIndex((candidate) => candidate.url === link.url) ===
              index,
          )
      : [],
  };
}
