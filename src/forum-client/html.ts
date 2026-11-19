import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ContentNode } from "./types.js";
export type Node = DefaultTreeAdapterMap["node"];
export type Element = DefaultTreeAdapterMap["element"];
export function element(node: Node): node is Element {
  return "tagName" in node;
}
export function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
export function attr(node: Node, key: string): string {
  return element(node)
    ? (node.attrs.find((a) => a.name === key)?.value ?? "")
    : "";
}
export function descendants(
  node: Node,
  predicate: (node: Element) => boolean,
): Element[] {
  return children(node).flatMap((child) => [
    ...(element(child) && predicate(child) ? [child] : []),
    ...descendants(child, predicate),
  ]);
}
export function byId(node: Node, id: string): Element | undefined {
  return descendants(node, (child) => attr(child, "id") === id)[0];
}
/** Native disabled fieldset/first-legend and optgroup semantics, without DOM. */
export function controlDisabled(node: Element): boolean {
  const disabled = (value: Element) =>
    value.attrs.some((a) => a.name === "disabled");
  if (disabled(node)) return true;
  let child: Node = node;
  for (
    let parent: Node | null = node.parentNode;
    parent;
    parent = "parentNode" in parent ? parent.parentNode : null
  ) {
    if (element(parent) && disabled(parent)) {
      if (parent.tagName === "optgroup" && node.tagName === "option")
        return true;
      if (
        parent.tagName === "fieldset" &&
        children(parent).find((n) => element(n) && n.tagName === "legend") !==
          child
      )
        return true;
    }
    child = parent;
  }
  return false;
}
export function hasClass(node: Node, name: string): boolean {
  return attr(node, "class").split(/\s+/).includes(name);
}
export function text(node: Node | undefined): string {
  if (!node) return "";
  if ("value" in node) return node.value;
  if (element(node) && ["script", "style"].includes(node.tagName)) return "";
  return children(node).map(text).join("");
}
export function label(node: Node | undefined): string {
  return text(node).replace(/\s+/g, " ").trim();
}
export function safeURL(raw: string, base: string): string | null {
  if (!raw.trim()) return null;
  try {
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const allowed = new Set(
  "p div span br hr strong b em i u s del ins sub sup small blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr th td caption h1 h2 h3 h4 h5 h6 details summary a img".split(
    " ",
  ),
);
const discarded = new Set(
  "script style link meta base noscript template svg math input button select textarea".split(
    " ",
  ),
);
const interactive = new Set("iframe object embed video audio form".split(" "));
export function explicitlyHidden(node: Element) {
  return (
    node.attrs.some(({ name }) => name === "hidden") ||
    attr(node, "aria-hidden").toLowerCase() === "true" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/i.test(
      attr(node, "style"),
    )
  );
}

function visibleSource(
  node: Element,
  tag: string,
  name?: string,
): Element | undefined {
  for (const child of children(node)) {
    if (
      !element(child) ||
      explicitlyHidden(child) ||
      discarded.has(child.tagName)
    )
      continue;
    if (
      child.tagName === tag &&
      (!name || attr(child, "name").toLowerCase() === name)
    )
      return child;
    const nested = visibleSource(child, tag, name);
    if (nested) return nested;
  }
}

function flashFile(vars: string, base: string): string | null {
  for (const part of vars.split("&")) {
    const match = /^(?:son|mp3|file|url|src|sound)=(.+)$/i.exec(part.trim());
    if (!match) continue;
    let value = match[1]!
      .trim()
      .replace(/%u([a-f\d]{4})/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    try {
      value = decodeURIComponent(value);
    } catch {
      /* Some original filenames contain literal percent signs. */
    }
    if (/^(?:https?:)?\/\//i.test(value)) {
      const url = safeURL(value, base);
      if (url) return url;
    }
  }
  return null;
}

function playerDestination(node: Element, base: string) {
  const tag = node.tagName;
  if (tag === "embed") {
    for (let parent: Node | null = node.parentNode; parent && element(parent); parent = parent.parentNode) {
      if (parent.tagName === "object") return null;
    }
  }
  let raw = attr(node, "src");
  let audio = tag === "audio";
  if (tag === "script") {
    const script = children(node).map(text).join("");
    const player =
      /\bdetectPlayer\(\s*["'][^"']*["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']+)["']/.exec(
        script,
      );
    if (player) {
      audio = /^(?:mp3|wma|ra|rm|ram|m4a|ogg|wav)$/i.test(player[1]!);
      raw = player[2]!;
    } else if (
      /\b(?:AC_FL_RunContent\s*\(|detectHtml5Support\s*\(\s*\)\s*\?)/.test(
        script,
      )
    ) {
      raw =
        /<iframe[^>]*\ssrc=\\?["']([^"'\\]+)/i.exec(script)?.[1] ??
        /["']src["']\s*,\s*["']([^"']+)["']/.exec(script)?.[1] ??
        "";
    } else return null;
  } else if (tag === "object" || tag === "embed") {
    const nested = tag === "object" ? visibleSource(node, "embed") : undefined;
    const param = (name: string) => {
      const p = visibleSource(node, "param", name);
      return p ? attr(p, "value") : "";
    };
    raw =
      flashFile(attr(node, "flashvars"), base) ||
      flashFile(param("flashvars"), base) ||
      (nested && flashFile(attr(nested, "flashvars"), base)) ||
      (tag === "object"
        ? attr(node, "data") ||
          param("movie") ||
          param("src") ||
          (nested && attr(nested, "src")) ||
          ""
        : raw || attr(node, "data-src"));
  } else if (tag === "audio" || tag === "video") {
    const source = !raw && visibleSource(node, "source");
    raw ||= source ? attr(source, "src") : "";
  } else if (tag === "iframe") {
    if (!raw || /^about:/i.test(raw.trim())) raw = attr(node, "data-src");
  } else return null;
  const url = safeURL(raw, base);
  if (!url) return null;
  audio ||= /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac|wma)$/i.test(
    new URL(url).pathname,
  );
  return { kind: audio ? ("audio" as const) : ("video" as const), url };
}

export function content(
  node: Node,
  base: string,
  inlineImages?: ReadonlyMap<Element, string>,
  nativeLayout?: ReadonlySet<Element>,
): ContentNode[] {
  return children(node).flatMap((child): ContentNode[] => {
    if ("value" in child) return [{ kind: "text", text: child.value }];
    if (
      !element(child) ||
      (child.tagName !== "script" && discarded.has(child.tagName))
    )
      return [];
    if (explicitlyHidden(child))
      return [
        {
          kind: "unsupported",
          description:
            "Additional native content is hidden; view it in the native forum.",
          children: [],
        },
      ];
    if (child.tagName === "script") {
      const media = playerDestination(child, base);
      return media
        ? [
            {
              kind: "unsupported",
              description: "Embedded media player",
              media,
              children: [],
            },
          ]
        : [];
    }
    if (
      attr(child, "id") === "hb_mask" &&
      hasClass(child, "mask") &&
      descendants(
        child,
        (node) => attr(node, "id") === "hb_env" && hasClass(node, "env"),
      ).length > 0
    )
      return [
        {
          kind: "unsupported",
          description:
            "Native red-packet interaction requires the native forum.",
          children: [],
        },
      ];
    const spoilerBody =
      (hasClass(child, "spoiler") || hasClass(child, "spoiler_wrap")) &&
      descendants(
        child,
        (n) => hasClass(n, "spoilerbody") || hasClass(n, "spoiler_content"),
      )[0];
    if (spoilerBody) {
      const controls = descendants(
        child,
        (n) =>
          hasClass(n, "spoilerbutton") ||
          hasClass(n, "spoiler_btn") ||
          hasClass(n, "spoilerheader") ||
          hasClass(n, "spoiler_control"),
      );
      const control = controls.find((n) => attr(n, "value") || label(n));
      return [
        {
          kind: "element",
          tag: "details",
          attributes: {},
          children: [
            {
              kind: "element",
              tag: "summary",
              attributes: {},
              children: [
                {
                  kind: "text",
                  text: control
                    ? attr(control, "value") ||
                      label(control) ||
                      "Show hidden content"
                    : "Show hidden content",
                },
              ],
            },
            ...content(spoilerBody, base, inlineImages, nativeLayout),
          ],
        },
      ];
    }
    if (child.tagName === "ignore_js_op")
      return content(child, base, inlineImages, nativeLayout);
    if (interactive.has(child.tagName)) {
      const media = playerDestination(child, base);
      return [
        {
          kind: "unsupported",
          description: "Unsupported interactive content",
          ...(media ? { media } : {}),
          children: content(child, base, inlineImages, nativeLayout),
        },
      ];
    }
    if (!allowed.has(child.tagName))
      return [
        {
          kind: "unsupported",
          description: `Unsupported formatting (${child.tagName})`,
          children: content(child, base, inlineImages, nativeLayout),
        },
      ];
    if (
      nativeLayout?.has(child) &&
      !["locked", "showhide", "attach_nopermission"].some((name) =>
        hasClass(child, name),
      )
    )
      return content(child, base, inlineImages, nativeLayout);
    const attributes: Record<string, string> = {};
    if (
      ["locked", "showhide", "attach_nopermission"].some((name) =>
        hasClass(child, name),
      )
    )
      attributes.class = "permission-notice";
    if (hasClass(child, "quote")) attributes.class = "quote";
    if (hasClass(child, "blockcode")) attributes.class = "code-block";
    const align =
      attr(child, "align") ||
      /(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)\s*(?:;|$)/.exec(
        attr(child, "style"),
      )?.[1];
    if (align && ["left", "right", "center", "justify"].includes(align))
      attributes.style = `text-align:${align}`;
    if (child.tagName === "a") {
      const url = safeURL(attr(child, "href"), base);
      if (url) {
        attributes.href = url;
        attributes.rel = "noopener noreferrer";
      }
    }
    if (child.tagName === "img") {
      const raw =
        ["data-src", "zoomfile", "file", "data-original", "src"]
          .map((key) => attr(child, key))
          .find(Boolean) ?? "";
      const qualified = inlineImages?.get(child);
      const url = qualified ?? safeURL(raw, base);
      if (
        !url ||
        (!qualified &&
          !/\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(new URL(url).pathname))
      ) {
        return [
          {
            kind: "unsupported",
            description: "Image or attachment requires native viewing",
            children: [],
          },
        ];
      }
      attributes.src = url;
      attributes.alt = attr(child, "alt");
      attributes.loading = "lazy";
      attributes.referrerpolicy = "no-referrer";
    }
    for (const key of ["colspan", "rowspan"])
      if (/^[1-9]\d?$/.test(attr(child, key)))
        attributes[key] = attr(child, key);
    if (["ltr", "rtl", "auto"].includes(attr(child, "dir")))
      attributes.dir = attr(child, "dir");
    if (attr(child, "title")) attributes.title = attr(child, "title");
    return [
      {
        kind: "element",
        tag: child.tagName,
        attributes,
        children: content(child, base, inlineImages, nativeLayout),
      },
    ];
  });
}
export function documentFrom(source: string): Node {
  return parse(source);
}
export function fragmentFrom(source: string): Node {
  return parseFragment(source);
}
