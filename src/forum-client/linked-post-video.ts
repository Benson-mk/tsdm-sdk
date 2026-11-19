import {
  attr,
  children,
  element,
  explicitlyHidden,
  type Element,
  type Node,
} from "./html.js";
import type { ContentNode } from "./types.js";

const skippedTags = new Set([
  "script",
  "style",
  "textarea",
  "input",
  "button",
  "form",
  "iframe",
  "video",
  "audio",
  "object",
  "embed",
  "pre",
  "code",
  "blockquote",
]);
const skippedClasses = new Set([
  "quote",
  "blockcode",
  "locked",
  "showhide",
  "hidecontent",
  "attach_nopermission",
  "vh-post-embed",
]);
function excluded(node: Element) {
  return (
    explicitlyHidden(node) ||
    skippedTags.has(node.tagName) ||
    attr(node, "contenteditable") === "true" ||
    attr(node, "class")
      .split(/\s+/)
      .some((token) => skippedClasses.has(token))
  );
}

function videoPage(raw: string) {
  if (
    raw.length > 2048 ||
    /[\x00-\x20\x7f\\]/.test(raw) ||
    !/^https?:\/\/(?:(?:www|m)\.)?bilibili\.com\//i.test(raw)
  )
    return null;
  const url = URL.parse(raw);
  if (!url) return null;
  const id = /^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})\/?$/.exec(
    url.pathname,
  )?.[1];
  const pages = url.searchParams.getAll("p");
  const page = pages[0] ?? "1";
  if (
    !id ||
    pages.length > 1 ||
    !/^[1-9]\d{0,4}$/.test(page) ||
    Number(page) > 65535
  )
    return null;
  return `https://www.bilibili.com/video/${id}/?p=${page}`;
}

/** Reproduce the forum videohub link once per message without contacting the player. */
export function linkedPostVideo(message: Element): ContentNode[] {
  for (
    let parent: Node | null = message;
    parent;
    parent = "parentNode" in parent ? parent.parentNode : null
  ) {
    if (element(parent) && excluded(parent)) return [];
  }
  let remaining = 6000;
  function visit(node: Node): string | null {
    for (const child of children(node)) {
      if (--remaining < 0) return null;
      if (element(child)) {
        if (excluded(child)) continue;
        const found =
          child.tagName === "a" ? videoPage(attr(child, "href")) : visit(child);
        if (found) return found;
      } else if ("value" in child) {
        for (const match of child.value.matchAll(
          /https?:\/\/[^\s<>"'\[\]（）。，；！]+/g,
        )) {
          const found = videoPage(match[0].replace(/[),.;!?]+$/, ""));
          if (found) return found;
        }
      }
    }
    return null;
  }
  const url = visit(message);
  return url
    ? [
        {
          kind: "unsupported",
          description: "Linked Bilibili video",
          media: { kind: "video", url },
          children: [],
        },
      ]
    : [];
}
