import {
  attr,
  children,
  controlDisabled,
  descendants,
  element,
  hasClass,
  label,
  text,
  type Node,
} from "../html.js";
import { sameOrigin } from "../posts/forms.js";
import { forumRoute, id, whole } from "./protocol.js";
import type { TradeGoods, TradeItemTarget } from "./client.js";

export function readGoods(
  doc: Node,
  source: string,
  target: TradeItemTarget,
  memberId: string,
): TradeGoods | "removed" | null {
  const displays = descendants(doc, (node) => hasClass(node, "spi"));
  if (
    !displays.length &&
    descendants(doc, (node) => hasClass(node, "trdb")).length
  )
    return "removed";
  const headings = descendants(
    doc,
    (node) => node.tagName === "h1" && hasClass(node, "ph"),
  );
  if (displays.length !== 1 || headings.length !== 1) return null;
  const display = displays[0]!;
  const heading = headings[0]!;
  const links = descendants(
    heading,
    (node) => node.tagName === "a" && Boolean(attr(node, "href")),
  );
  const subject = label(heading);
  if (
    links.length !== 1 ||
    !subject ||
    !forumRoute(attr(links[0]!, "href"), source, {
      mod: "viewthread",
      do: "tradeinfo",
      tid: target.threadId,
      pid: target.postId,
    })
  )
    return null;
  const sellerBox = descendants(doc, (node) => hasClass(node, "ih"));
  const seller = sellerBox.length === 1 ? sellerBox[0] : null;
  const avatar =
    seller && descendants(seller, (node) => hasClass(node, "avt"))[0];
  const sellerAnchors = avatar
    ? descendants(avatar, (node) => node.tagName === "a")
    : [];
  const sellerURL =
    sellerAnchors.length === 1
      ? sameOrigin(attr(sellerAnchors[0]!, "href"), source)
      : null;
  const sellerId =
    sellerURL?.pathname === "/home.php" &&
    sellerURL.searchParams.get("mod") === "space" &&
    sellerURL.searchParams.getAll("uid").length === 1
      ? id(sellerURL.searchParams.get("uid"))
      : null;
  const sellerName = seller
    ? children(
        descendants(seller, (node) => node.tagName === "dt")[0] ?? seller,
      )
        .filter((node) => "value" in node)
        .map(text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const lists = descendants(display, (node) => node.tagName === "dl");
  const detailsList = lists.find((node) => !hasClass(node, "nums"));
  const details: { label: string; value: string }[] = [];
  if (detailsList) {
    let key = "";
    for (const child of children(detailsList).filter(element)) {
      if (child.tagName === "dt") key = label(child).replace(/\s*[:：]$/, "");
      else if (child.tagName === "dd" && key) {
        const value = label(child);
        if (value && (!/^(?:剩余时间|剩餘時間)$/.test(key) || /\d/.test(value)))
          details.push({ label: key, value });
        key = "";
      }
    }
  }
  const quantity = details.find((row) =>
    /^(?:商品数量|商品數量)$/.test(row.label),
  )?.value;
  const stock =
    quantity && /^\d+$/.test(quantity) && whole(Number(quantity))
      ? Number(quantity)
      : null;
  const prices = lists
    .filter((node) => hasClass(node, "nums"))
    .flatMap((node) =>
      descendants(node, (child) => child.tagName === "p").map(label),
    )
    .filter(Boolean);
  const originalPrices = descendants(display, (node) => node.tagName === "del")
    .map(label)
    .filter(Boolean);
  const buttons = descendants(display, (node) => hasClass(node, "pns")).flatMap(
    (node) => descendants(node, (child) => child.tagName === "button"),
  );
  const soldOut =
    stock === 0 ||
    buttons.some((node) => controlDisabled(node) && !attr(node, "onclick"));
  const candidates = buttons
    .filter((node) => !controlDisabled(node))
    .flatMap((node) => {
      const raw =
        /^\s*window\.open\(\s*['"]([^'"\r\n]+)['"]\s*,\s*['"]['"]\s*,\s*['"]['"]\s*\)\s*;?\s*$/.exec(
          attr(node, "onclick"),
        )?.[1];
      const url =
        raw &&
        forumRoute(raw, source, {
          mod: "trade",
          tid: target.threadId,
          pid: target.postId,
        });
      return url ? [url.href] : [];
    });
  const imageZone = descendants(doc, (node) => hasClass(node, "spvimg"))[0];
  const image =
    imageZone && descendants(imageZone, (node) => node.tagName === "img")[0];
  const thumbnailURL = image
    ? (sameOrigin(attr(image, "src"), source)?.href ?? null)
    : null;
  const zoom = image
    ? /^\s*zoom\(this,\s*'([^'\r\n]+)'\s*\)\s*;?\s*$/.exec(
        attr(image, "onclick"),
      )?.[1]
    : undefined;
  const imageURL =
    (zoom ? sameOrigin(zoom, source)?.href : null) ?? thumbnailURL;
  const descriptionBox = descendants(doc, (node) =>
    hasClass(node, "mtw"),
  ).flatMap((node) => descendants(node, (child) => hasClass(child, "c")))[0];
  return {
    ...target,
    url: source,
    subject,
    seller: { id: sellerId, name: sellerName },
    prices,
    originalPrices,
    stock,
    soldOut,
    details,
    description: label(descriptionBox),
    thumbnailURL,
    imageURL,
    orderFormURL:
      !soldOut && sellerId !== memberId && candidates.length === 1
        ? candidates[0]!
        : null,
  };
}
