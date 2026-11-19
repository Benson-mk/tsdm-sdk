import { activityURL } from "../activity-protocol.js";
import {
  attr,
  content,
  descendants,
  hasClass,
  label,
  type Node,
} from "../html.js";
import { readable } from "../read-thread.js";
import { submittedControls, unique } from "./native.js";
import { object } from "../notice-transport.js";
import { formFields, forumRoute, id, text, token, whole } from "./protocol.js";
import type { PaidThread, PaidThreadTerms } from "./client.js";

export function purchaseDestination(
  raw: string,
  source: string,
  thread: PaidThread,
  fields: URLSearchParams,
) {
  const url = forumRoute(
    raw,
    source,
    { mod: "misc", action: "pay", paysubmit: "yes" },
    ["infloat", "inajax", "tid", "pid", "handlekey", "extra"],
  );
  if (
    !url ||
    (url.searchParams.has("tid") &&
      url.searchParams.get("tid") !== thread.threadId) ||
    (url.searchParams.has("pid") &&
      url.searchParams.get("pid") !== thread.postId) ||
    (url.searchParams.has("inajax") &&
      url.searchParams.get("inajax") !== "1") ||
    (url.searchParams.has("handlekey") &&
      url.searchParams.get("handlekey") !== "pay") ||
    (url.searchParams.has("infloat") &&
      url.searchParams.get("infloat") !== "yes")
  )
    return null;
  if (
    !token(fields.get("formhash")) ||
    fields.get("tid") !== thread.threadId ||
    (fields.has("pid") && fields.get("pid") !== thread.postId) ||
    fields.get("handlekey") !== "pay" ||
    fields.get("paysubmit") !== "true" ||
    [...fields.keys()].some(
      (name) =>
        fields.getAll(name).length > 1 ||
        /^(?:mod|action|orderid|password|offlinesubmit|tradesubmit)(?:$|\[)/i.test(
          name,
        ) ||
        /^(?:formhash|tid|pid|referer|handlekey|paysubmit)\[/.test(name),
    )
  )
    return null;
  const referer = fields.get("referer");
  if (referer) {
    try {
      const ref = new URL(referer, source);
      if (
        ref.origin !== url.origin ||
        ref.username ||
        ref.password ||
        ref.pathname.startsWith("//")
      )
        return null;
    } catch {
      return null;
    }
  } else return null;
  url.searchParams.set("inajax", "1");
  return url;
}

export function structuredPurchase(
  data: Record<string, unknown>,
  source: string,
  thread: PaidThread,
) {
  const submit = object(data.submit);
  const fields = formFields(submit?.fields);
  const url =
    fields && purchaseDestination(text(submit?.url), source, thread, fields);
  const party = object(data.author);
  const credit = object(data.credit);
  const price = data.price,
    net = data.net,
    balance = data.balance;
  if (
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== "buy" ||
    data.ok !== 1 ||
    id(data.tid) !== thread.threadId ||
    (data.pid != null && id(data.pid) !== thread.postId) ||
    !fields ||
    !url ||
    submit?.method !== "POST" ||
    (submit.enctype !== undefined &&
      submit.enctype !== "application/x-www-form-urlencoded") ||
    (data.formhash !== undefined && data.formhash !== fields.get("formhash")) ||
    !party ||
    typeof party.name !== "string" ||
    !party.name ||
    !credit ||
    !id(credit.id) ||
    !text(credit.title) ||
    typeof credit.unit !== "string" ||
    !whole(price) ||
    price !== thread.price ||
    !whole(net) ||
    net < 0 ||
    net > price ||
    !whole(balance) ||
    [data.hook_fields, data.unsupported].some(
      (value) => value != null && (!Array.isArray(value) || value.length !== 0),
    )
  )
    return null;
  const terms: PaidThreadTerms = {
    author: { id: id(party.uid), name: party.name },
    price,
    authorReceives: net,
    balanceAfterPurchase: balance,
    credit: { id: id(credit.id), name: text(credit.title), unit: credit.unit },
  };
  return { url: url.href, fields, terms };
}

export function nativePaidThread(
  doc: Node,
  url: string,
  threadId: string,
  previous?: PaidThread,
): PaidThread | null {
  const list = unique(
    descendants(doc, (node) => attr(node, "id") === "postlist"),
  );
  const title = label(
    unique(descendants(doc, (node) => attr(node, "id") === "thread_subject")) ??
      undefined,
  );
  if (!list || !title) return null;
  const opening = descendants(list, (node) =>
    /^post_[1-9]\d*$/.test(attr(node, "id")),
  )[0];
  if (!opening) return null;
  const postId = attr(opening, "id").slice(5);
  const locks = descendants(opening, (node) => hasClass(node, "locked"));
  if (!locks.length && previous?.postId === postId) {
    const message = unique(
      descendants(
        opening,
        (node) => attr(node, "id") === `postmessage_${postId}`,
      ),
    );
    return message && readable(content(message, url))
      ? { ...previous, title, payers: null, access: "accessible" }
      : null;
  }
  if (locks.length !== 1) return null;
  const lock = locks[0]!;
  const link = unique(
    descendants(
      lock,
      (node) => node.tagName === "a" && hasClass(node, "viewpay"),
    ),
  );
  if (
    !link ||
    !forumRoute(attr(link, "href"), url, {
      mod: "misc",
      action: "pay",
      tid: threadId,
      pid: postId,
    })
  )
    return null;
  const marker = label(lock);
  const price = Number(
    /本主题需向作者支付\s*(\d+)\s*\S.*才能浏览/.exec(marker)?.[1],
  );
  const count = Number(/已有\s*(\d+)\s*人购买/.exec(marker)?.[1]);
  return whole(price) && price > 0
    ? {
        threadId,
        postId,
        title,
        price,
        payers: whole(count) ? count : null,
        access: "requires-purchase",
        url,
      }
    : null;
}

export function nativePurchase(doc: Node, source: string, thread: PaidThread) {
  const form = unique(
    descendants(
      doc,
      (node) => node.tagName === "form" && attr(node, "id") === "payform",
    ),
  );
  if (!form || attr(form, "method").toLowerCase() !== "post") return null;
  const fields = submittedControls(form, "paysubmit");
  const url =
    fields && purchaseDestination(attr(form, "action"), source, thread, fields);
  if (!fields || !url) return null;
  const rows = new Map<string, Node>();
  for (const row of descendants(form, (node) => node.tagName === "tr")) {
    const key = label(
      unique(descendants(row, (node) => node.tagName === "th")) ?? undefined,
    );
    const value = unique(descendants(row, (node) => node.tagName === "td"));
    if (!key || !value || rows.has(key)) return null;
    rows.set(key, value);
  }
  const author = rows.get("作者");
  const link =
    author && unique(descendants(author, (node) => node.tagName === "a"));
  const profile = link && activityURL(attr(link, "href"), new URL(source));
  const priceKey = [...rows.keys()].filter((key) =>
    /^售价\([^()]+\)$/.test(key),
  );
  const unit = priceKey.length === 1 ? priceKey[0]!.slice(3, -1) : "";
  const amount = (key: string) => {
    const value = label(rows.get(key));
    return /^-?\d+$/.test(value) ? Number(value) : NaN;
  };
  const price = amount(`售价(${unit})`);
  const net = amount(`作者所得(${unit})`);
  const balance = amount(`购买后余额(${unit})`);
  const name = label(author);
  if (
    !name ||
    !unit ||
    price !== thread.price ||
    !whole(net) ||
    net < 0 ||
    net > price ||
    !whole(balance)
  )
    return null;
  const terms: PaidThreadTerms = {
    author: {
      name,
      id:
        profile?.pathname === "/home.php" &&
        profile.searchParams.get("mod") === "space"
          ? id(profile.searchParams.get("uid"))
          : null,
    },
    price,
    authorReceives: net,
    balanceAfterPurchase: balance,
    credit: { id: null, name: unit, unit: "" },
  };
  return { url: url.href, fields, terms };
}

export function nativePurchaseSucceeded(doc: Node) {
  const result = unique(
    descendants(doc, (node) => hasClass(node, "alert_right")),
  );
  return label(result ?? undefined) === "购买成功" || label(doc) === "购买成功";
}
