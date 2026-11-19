import { routeFor, safeURL } from "./routes.js";
import { numericId } from "./notice-transport.js";
import type { ContentNode } from "./types.js";

export interface NoticeIgnoreTarget {
  readonly type: string;
  readonly authorId: string;
}

export function ignoreTarget(type: unknown, author: unknown): NoticeIgnoreTarget | null {
  const authorId = numericId(author);
  return typeof type === "string" && /^[a-zA-Z0-9_-]+$/.test(type) && authorId !== null
    ? { type, authorId }
    : null;
}

export function ignoreTargetFromLink(value: string, base: string): NoticeIgnoreTarget | null {
  const url = safeURL(value, base);
  if (!url || url.origin !== new URL(base).origin || url.pathname !== "/home.php") return null;
  const q = url.searchParams;
  if (q.get("mod") !== "spacecp" || q.get("ac") !== "common" || q.get("op") !== "ignore" ||
      ["mod", "ac", "op", "type", "authorid"].some(key => q.getAll(key).length !== 1)) return null;
  return ignoreTarget(q.get("type"), q.get("authorid"));
}

export function noticePostURL(value: string, origin: string): string | null {
  const route = routeFor(value);
  return route?.url.origin === origin && (route.kind === "thread" || route.kind === "redirect")
    ? route.url.href : null;
}

export function postDestinations(body: readonly ContentNode[], origin: string): string[] {
  const urls = new Set<string>();
  function visit(nodes: readonly ContentNode[]) {
    for (const node of nodes) {
      if (node.kind === "text") continue;
      if (node.kind === "element" && node.tag === "a" && node.attributes.href) {
        const url = noticePostURL(node.attributes.href, origin);
        if (url) urls.add(url);
      }
      visit(node.children);
    }
  }
  visit(body);
  return [...urls];
}

export function noticeContent(nodes: readonly ContentNode[]): ContentNode[] {
  return nodes.map((node) => {
    if (node.kind === "text") return node;
    const children = noticeContent(node.children);
    if (
      node.kind === "element" &&
      [node.attributes.href, node.attributes.src].some(
        (value) => value && [...new URL(value).searchParams.keys()].some(
          (key) => key.toLowerCase() === "formhash",
        ),
      )
    ) {
      return {
        kind: "unsupported",
        description: "This action requires current native forum controls.",
        children,
      };
    }
    return { ...node, children };
  });
}
