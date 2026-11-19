import type {
  ForumTask,
  ForumTaskAction,
  ForumTaskTab,
  MagicCapacity,
  MagicInventoryItem,
  MagicShopItem,
} from "./types.js";
import { id } from "../activity-protocol.js";
import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  type Element,
  type Node,
} from "../html.js";
import { homeRoute, href } from "./protocol.js";
import { taskLink } from "./tasks.js";

const tag = (node: Element, name: string) => node.tagName === name;
const matches = (scope: Node, predicate: (node: Element) => boolean) =>
  descendants(scope, predicate);
function activeTab(scope: Node, base: string, params: Record<string, string>) {
  return matches(scope, (node) => tag(node, "li") && hasClass(node, "a")).some(
    (tab) =>
      matches(tab, (node) => tag(node, "a")).some((link) =>
        homeRoute(attr(link, "href"), base, params, ["page"]),
      ),
  );
}
const count = (value: string) =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
export function nativeTaskList(doc: Node, base: string, tab: ForumTaskTab) {
  const scope = byId(doc, "ct");
  if (!scope || !activeTab(scope, base, { mod: "task", item: tab }))
    return null;
  const listed: ForumTask[] = [];
  const seen = new Set<string>();
  for (const row of matches(scope, (node) => tag(node, "tr"))) {
    const anchors = matches(row, (node) => tag(node, "a"));
    for (const anchor of anchors) {
      const raw = attr(anchor, "href");
      const target = href(raw, base);
      const taskId = target && id(new URL(target).searchParams.get("id"));
      if (
        !taskId ||
        seen.has(taskId) ||
        !taskLink(raw, base, "view", taskId) ||
        !label(anchor)
      )
        continue;
      seen.add(taskId);
      const actions: ForumTaskAction[] = [];
      if (
        tab !== "doing" &&
        anchors.some((link) =>
          taskLink(attr(link, "href"), base, "apply", taskId),
        )
      )
        actions.push("apply");
      if (
        tab === "doing" &&
        anchors.some((link) =>
          taskLink(attr(link, "href"), base, "draw", taskId),
        )
      )
        actions.push("claim");
      const description = label(
        matches(row, (node) => tag(node, "p") && hasClass(node, "xg2"))[0],
      );
      const reward = label(
        matches(row, (node) => tag(node, "td") && hasClass(node, "xi1"))[0],
      );
      const progressText = label(byId(row, `csc_${taskId}`));
      const progress =
        /^\d+(?:\.\d+)?$/.test(progressText) && Number(progressText) <= 100
          ? Number(progressText)
          : null;
      listed.push(
        Object.freeze({
          id: taskId,
          name: label(anchor),
          description,
          reward: reward ? { text: reward } : null,
          applicants: null,
          progress,
          url: target!,
          actions: Object.freeze(actions),
        }),
      );
    }
  }
  return listed.length ||
    matches(scope, (node) => tag(node, "p") && hasClass(node, "emp")).length
    ? listed
    : null;
}
export function nativeMagicPage(
  doc: Node,
  base: string,
  mode: "shop" | "mybox",
  page: number,
) {
  const scope = byId(doc, "ct");
  if (!scope || !activeTab(scope, base, { mod: "magic", action: mode }))
    return null;
  const main = matches(scope, (node) => hasClass(node, "mn"))[0];
  if (!main) return null;
  const grid = matches(
    main,
    (node) => tag(node, "ul") && hasClass(node, "mgcl"),
  )[0];
  if (
    !grid &&
    !matches(main, (node) => tag(node, "p") && hasClass(node, "emp")).length
  )
    return null;
  const pagination = matches(main, (node) => hasClass(node, "pg"))[0];
  const selected = pagination
    ? count(label(matches(pagination, (node) => tag(node, "strong"))[0]))
    : null;
  if (
    (selected !== null && selected !== page) ||
    (selected === null && page > 1)
  )
    return null;
  const pages = Math.max(
    page,
    ...(pagination
      ? matches(pagination, (node) => tag(node, "a")).flatMap((link) => {
          const route = homeRoute(
            attr(link, "href"),
            base,
            { mod: "magic", action: mode },
            ["page"],
          );
          const index = count(route?.searchParams.get("page") ?? "");
          return index ? [index] : [];
        })
      : []),
  );
  const summary = label(matches(main, (node) => hasClass(node, "tbmu"))[0]);
  const caps = /(\d+)\s*\/\s*(\d+)/.exec(summary);
  const used = count(caps?.[1] ?? ""),
    max = count(caps?.[2] ?? "");
  const capacity: MagicCapacity | null =
    used !== null && max !== null ? { used, max } : null;
  const shop: MagicShopItem[] = [],
    inventory: MagicInventoryItem[] = [];
  const seen = new Set<string>();
  for (const row of grid
    ? children(grid)
        .filter(element)
        .filter((node) => tag(node, "li"))
    : []) {
    const box = matches(row, (node) => hasClass(node, "mg_img"))[0];
    const identifier = box
      ? /^magic_([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?)$/.exec(
          attr(box, "id"),
        )?.[1]
      : null;
    const paragraphs = children(row)
      .filter(element)
      .filter((node) => tag(node, "p"));
    const name =
      paragraphs[0] &&
      label(matches(paragraphs[0], (node) => tag(node, "strong"))[0]);
    if (!box || !identifier || !name || seen.has(identifier)) continue;
    seen.add(identifier);
    const picture = matches(box, (node) => tag(node, "img"))[0];
    const description = label(
      matches(row, (node) => hasClass(node, "tip_c"))[0],
    );
    const imageURL = picture ? href(attr(picture, "src"), base) : null;
    const common = { identifier, name, description, imageURL };
    const links = matches(row, (node) => tag(node, "a"));
    if (mode === "shop") {
      const priceNode =
        paragraphs[1] &&
        matches(
          paragraphs[1],
          (node) => tag(node, "strong") && hasClass(node, "xs2"),
        )[0];
      const price = count(label(priceNode));
      const available =
        price !== null &&
        links.some((link) =>
          homeRoute(attr(link, "href"), base, {
            mod: "magic",
            action: "shop",
            operation: "buy",
            mid: identifier,
          }),
        );
      shop.push(
        Object.freeze({ ...common, id: null, price, credit: null, available }),
      );
    } else {
      const ids = links.flatMap((link) => {
        const raw = attr(link, "href");
        const url = homeRoute(raw, base, { mod: "magic", action: "mybox" }, [
          "operation",
          "magicid",
        ]);
        const magicId = id(url?.searchParams.get("magicid"));
        const operation = url?.searchParams.get("operation");
        return magicId &&
          operation &&
          ["use", "give", "sell", "drop"].includes(operation)
          ? [{ magicId, operation }]
          : [];
      });
      const first = ids[0];
      if (!first || ids.some((entry) => entry.magicId !== first.magicId))
        continue;
      const numbers = paragraphs[1]
        ? matches(
            paragraphs[1],
            (node) => tag(node, "font") || tag(node, "span"),
          ).map(label)
        : [];
      const quantity = count(numbers[0] ?? "");
      inventory.push(
        Object.freeze({
          ...common,
          id: first.magicId,
          count: quantity,
          weight: count(numbers[1] ?? ""),
          available:
            quantity !== null &&
            quantity > 0 &&
            ids.some((entry) => entry.operation === "use"),
        }),
      );
    }
  }
  return { capacity, page, pages, shop, inventory };
}
