import {
  attr,
  descendants,
  hasClass,
  label,
  text as nodeText,
  type Node,
} from "../html.js";
import { activityURL } from "../activity-protocol.js";
import { forumURL, forumRoute, id, token, whole } from "./protocol.js";
import { has, named, submittedControls, unique } from "./native.js";
import type {
  TradeGoods,
  TradeOrderReference,
  TradeOrderTerms,
} from "./client.js";

export function orderId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,128}$/.test(value);
}
export function orderURL(origin: string, orderId: string) {
  return forumURL(origin, { mod: "trade", orderid: orderId });
}
export function orderReference(
  raw: string,
  source: string,
): TradeOrderReference | null {
  const target = activityURL(raw, new URL(source));
  const candidate = target?.searchParams.get("orderid");
  return orderId(candidate) &&
    forumRoute(raw, source, { mod: "trade", orderid: candidate })
    ? { orderId: candidate, url: orderURL(new URL(source).origin, candidate) }
    : null;
}

export function orderForm(doc: Node, source: string, goods: TradeGoods) {
  const form = unique(
    descendants(
      doc,
      (node) => node.tagName === "form" && attr(node, "id") === "tradepost",
    ),
  );
  if (!form || attr(form, "method").toLowerCase() !== "post") return null;
  const url = forumRoute(attr(form, "action"), source, {
    mod: "trade",
    action: "trade",
    tid: goods.threadId,
    pid: goods.postId,
  });
  if (!url) return null;
  const fields = submittedControls(form, "tradesubmit");
  if (!fields) return "browser" as const;
  if (
    !token(fields.get("formhash")) ||
    fields.get("tradesubmit") !== "true" ||
    (fields.has("tid") && fields.get("tid") !== goods.threadId) ||
    (fields.has("pid") && fields.get("pid") !== goods.postId) ||
    [...fields.keys()].some(
      (name) =>
        /^(?:mod|action|orderid|password|offlinesubmit|offlinestatus|paysubmit)(?:$|\[)/i.test(
          name,
        ) ||
        /^(?:formhash|tid|pid|tradesubmit|number|offline|transport|buyermsg)\[/.test(
          name,
        ),
    )
  )
    return null;
  const quantityControl = unique(named(form, "number"));
  const quantity = id(fields.get("number"));
  if (
    !quantity ||
    !whole(Number(quantity)) ||
    !quantityControl ||
    quantityControl.tagName !== "input"
  )
    return null;
  const scripts = descendants(doc, (node) => node.tagName === "script").map(
    (node) => node.childNodes.map(nodeText).join(""),
  );
  const priceScripts = scripts.filter((script) =>
    /\bvar\s+currentcredit\b/.test(script),
  );
  const prices =
    priceScripts.length === 1 &&
    /^\s*(?:zoomstatus\s*=\s*parseInt\([01]\);\s*)?var\s+feevalue\s*=\s*0;\s*(?:var\s+price\s*=\s*(\d+(?:\.\d+)?);\s*)?var\s+credit\s*=\s*(\d+);\s*var\s+currentcredit\s*=\s*(\d+);\s*$/.exec(
      priceScripts[0]!,
    );
  if (!prices) return "browser" as const;
  const [, money = "0", rawCredit, rawBalance] = prices;
  const credit = Number(rawCredit);
  const balance = Number(rawBalance);
  if (
    Number(money) !== 0 ||
    !whole(credit) ||
    credit <= 0 ||
    !whole(balance) ||
    fields.get("offline") !== "1" ||
    !["1", "3"].includes(fields.get("transport") ?? "") ||
    fields.has("fee")
  )
    return "browser" as const;
  const recipient: {
    name: string;
    label: string;
    value: string;
    maxLength: number | null;
    required: boolean;
  }[] = [];
  const offered = new Set([
    "buyername",
    "buyercontact",
    "buyerzip",
    "buyerphone",
    "buyermobile",
  ]);
  for (const node of descendants(
    form,
    (node) => node.tagName === "input" && !has(node, "disabled"),
  )) {
    const name = attr(node, "name");
    const type = attr(node, "type").toLowerCase();
    if (
      !fields.has(name) ||
      name === "number" ||
      (type && type !== "text" && type !== "tel")
    )
      continue;
    if (!offered.has(name)) return "browser" as const;
    const title = descendants(
      form,
      (item) =>
        item.tagName === "label" &&
        Boolean(attr(node, "id")) &&
        attr(item, "for") === attr(node, "id"),
    );
    const limit = id(attr(node, "maxlength"));
    recipient.push({
      name,
      label: title.length === 1 ? label(title[0]) || name : name,
      value: fields.get(name)!,
      maxLength: limit && whole(Number(limit)) ? Number(limit) : null,
      required: has(node, "required"),
    });
  }
  const terms: TradeOrderTerms = Object.freeze({
    creditPerItem: credit,
    balance,
    quantity: Number(quantity),
    stock: goods.stock,
    recipientFields: Object.freeze(
      recipient.map(({ required: _required, ...field }) =>
        Object.freeze(field),
      ),
    ),
  });
  return { url: url.href, fields, terms, recipient };
}

export function orderDetails(doc: Node, source: string, selected: string) {
  const panel = unique(
    descendants(doc, (node) => attr(node, "id") === "tradeorder"),
  );
  if (!panel) return null;
  const terms = new Map<string, Node>();
  for (const list of descendants(panel, (node) => node.tagName === "dl")) {
    const entries = list.childNodes.filter((node) => "tagName" in node);
    for (let index = 0; index + 1 < entries.length; index++) {
      const [key, value] = [entries[index]!, entries[index + 1]!];
      if (key.tagName !== "dt" || value.tagName !== "dd") continue;
      const name = label(key)
        .replace(/[:：]$/, "")
        .trim();
      if (terms.has(name)) return null;
      terms.set(name, value);
    }
  }
  const term = (name: string) => {
    const node = terms.get(name);
    return node ? label(node) : "";
  };
  if (term("交易单号") !== selected) return null;
  const state = term("交易状态");
  const status =
    state === "等待买家付款"
      ? "awaiting-payment"
      : state === "买家已付款"
        ? "paid"
        : "other";
  const buyer = terms.get("买家");
  const link =
    buyer && unique(descendants(buyer, (node) => node.tagName === "a"));
  const target = link && activityURL(attr(link, "href"), new URL(source));
  const buyerId =
    target?.pathname === "/home.php" &&
    target.searchParams.get("mod") === "space"
      ? id(target.searchParams.get("uid"))
      : null;
  const credit = /^(\d+)\s*(\D.*)$/.exec(term("积分总额"));
  const amount = credit && Number(credit[1]);
  return Object.freeze({
    orderId: selected,
    url: source,
    status,
    buyerId,
    credit:
      whole(amount) && amount > 0
        ? Object.freeze({ amount, name: credit![2]!.trim() })
        : null,
  });
}

export function paymentForm(doc: Node, source: string, selected: string) {
  const form = unique(
    descendants(
      doc,
      (node) => node.tagName === "form" && attr(node, "id") === "tradepost",
    ),
  );
  if (!form || attr(form, "method").toLowerCase() !== "post") return null;
  const url = forumRoute(attr(form, "action"), source, {
    mod: "trade",
    orderid: selected,
  });
  if (!url) return null;
  const password = unique(named(form, "password"));
  if (
    !password ||
    password.tagName !== "input" ||
    attr(password, "type").toLowerCase() !== "password" ||
    attr(password, "value") ||
    has(password, "form")
  )
    return null;
  const fields = submittedControls(form, "offlinesubmit", password);
  if (
    !fields ||
    !token(fields.get("formhash")) ||
    fields.get("offlinestatus") !== "4" ||
    fields.get("offlinesubmit") !== "true" ||
    !fields.has("message") ||
    [...fields.keys()].some(
      (name) =>
        !["formhash", "offlinestatus", "offlinesubmit", "message"].includes(
          name,
        ),
    )
  )
    return null;
  return { url: url.href, fields };
}

export function nativeOrderCreated(doc: Node, source: string) {
  const receipt = unique(
    descendants(
      doc,
      (node) =>
        attr(node, "id") === "messagetext" && hasClass(node, "alert_info"),
    ),
  );
  if (!receipt) return null;
  const announcement = unique(
    descendants(
      receipt,
      (node) => node.tagName === "p" && !hasClass(node, "alert_btnleft"),
    ),
  );
  const continuation = unique(
    descendants(receipt, (node) => hasClass(node, "alert_btnleft")),
  );
  const link =
    continuation &&
    unique(descendants(continuation, (node) => node.tagName === "a"));
  const announcementText = announcement?.childNodes
    .filter((child) => child.nodeName === "#text")
    .map(nodeText)
    .join("")
    .trim();
  return announcementText === "交易单创建成功，现在将转入交易单页面" && link
    ? orderReference(attr(link, "href"), source)
    : null;
}
