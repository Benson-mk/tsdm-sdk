import { answer } from "../activity-protocol.js";
import { nativeIdentity, operationURL } from "../account-forms.js";
import {
  attr,
  children,
  descendants,
  element,
  hasClass,
  type Element,
  type Node,
} from "../html.js";
import {
  noticeHost,
  numericId,
  type NoticeSession,
} from "../notice-transport.js";
import { query } from "../posts/forms.js";
import type { HostResponse } from "../types.js";
import type { BankClientOptions, BankFailure } from "./types.js";

export const plugin = "bank_ane:bank";
export const bankId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,17}$/.test(value);
export const bankURL = (origin: string, params: Record<string, string> = {}) =>
  query(`${origin}/plugin.php`, { id: plugin, ...params });
export function bankRoute(
  raw: string,
  base: string,
  params: Record<string, string> = {},
  optional: readonly string[] = [],
) {
  const url = operationURL(raw, new URL(base), "/plugin.php", {
    id: plugin,
    ...params,
  });
  return url &&
    [...url.searchParams.keys()].every(
      (key) =>
        key === "id" || Object.hasOwn(params, key) || optional.includes(key),
    )
    ? url
    : null;
}
export const has = (node: Element, name: string) =>
  node.attrs.some((attribute) => attribute.name === name);
export function ancestor(
  node: Node,
  predicate: (node: Element) => boolean,
): Element | null {
  const up = (node: Node) => ("parentNode" in node ? node.parentNode : null);
  for (let parent = up(node); parent; parent = up(parent)) {
    if (element(parent) && predicate(parent)) return parent;
  }
  return null;
}
export function bankText(
  node: Node | undefined,
  ignore: (node: Element) => boolean = () => false,
) {
  const collect = (node: Node): string => {
    if ("value" in node) return node.value;
    if (element(node)) {
      if (node.tagName === "br") return " ";
      if (
        [
          "script",
          "style",
          "template",
          "input",
          "textarea",
          "select",
          "button",
        ].includes(node.tagName) ||
        has(node, "hidden") ||
        ignore(node)
      )
        return "";
    }
    return children(node).map(collect).join("");
  };
  return node ? collect(node).replace(/\s+/g, " ").trim() : "";
}
export function section(
  doc: Node,
  heading: string,
  prefix = false,
): Element | null {
  const tables = descendants(
    doc,
    (node) => node.tagName === "table" && attr(node, "id") === "ttt",
  ).filter((table) =>
    descendants(
      table,
      (node) =>
        node.tagName === "h2" &&
        ancestor(node, (parent) => parent.tagName === "table") === table,
    ).some((node) =>
      prefix ? bankText(node).startsWith(heading) : bankText(node) === heading,
    ),
  );
  return tables.length === 1 ? tables[0]! : null;
}
export const tableRows = (table: Element): Element[] =>
  descendants(
    table,
    (node) =>
      node.tagName === "tr" &&
      ancestor(node, (parent) => parent.tagName === "table") === table,
  );
export const cells = (row: Element): Element[] =>
  children(row)
    .filter(element)
    .filter((node) => node.tagName === "td" || node.tagName === "th");
export const messageNodes = (doc: Node): Element[] =>
  descendants(
    doc,
    (node) =>
      attr(node, "id") === "messagetext" || hasClass(node, "alert_error"),
  );

type BankExchange =
  | {
      kind: "answer";
      response: HostResponse;
      page: ReturnType<typeof answer>;
      viewer: string | null;
      uid: string | null;
    }
  | BankFailure;
export function bankHost(options: BankClientOptions) {
  const { origin, session, current } = noticeHost({
    origin: options.origin,
    session: () => options.session(),
    transport: {
      request: (url, request) =>
        options.transport.request(
          url,
          request.method === "POST"
            ? { ...request, effect: true }
            : { ...request, effect: false },
        ),
    },
  });
  async function exchange(
    url: string,
    owner: NoticeSession,
    body?: string,
  ): Promise<BankExchange> {
    if (!current(owner)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url,
        body === undefined
          ? { method: "GET", fresh: true, effect: false, session: owner }
          : { method: "POST", fresh: true, effect: true, session: owner, body },
      );
    } catch {
      return { kind: current(owner) ? "network" : "session-changed" } as const;
    }
    if (!current(owner)) return { kind: "session-changed" } as const;
    if (response.url !== url || response.redirect !== "none")
      return { kind: "invalid-response" } as const;
    const page = answer(response);
    return {
      kind: "answer",
      response,
      page,
      viewer: nativeIdentity(page.html, new URL(url)),
      uid: numericId(page.data?.uid),
    } as const;
  }
  async function read(
    url: string,
    owner: NoticeSession,
  ): Promise<{ kind: "page"; doc: Node } | BankFailure> {
    const reply = await exchange(url, owner);
    if (reply.kind !== "answer") return reply;
    const { response, page, viewer, uid } = reply;
    if (
      [401, 403, 429].includes(response.status) ||
      page.data?.login === 1 ||
      descendants(
        page.doc,
        (node) => node.tagName === "form" && attr(node, "id") === "loginform",
      ).length
    ) {
      return {
        kind: "refused",
        code: response.status === 429 ? "rate-limited" : "login",
      } as const;
    }
    if (
      (viewer !== null && viewer !== owner.memberId) ||
      (uid !== null && uid !== owner.memberId)
    )
      return { kind: "session-changed" } as const;
    if (
      response.status !== 200 ||
      (viewer !== owner.memberId && uid !== owner.memberId) ||
      !page.html
    )
      return { kind: "invalid-response" } as const;
    const messages = messageNodes(page.doc);
    if (messages.length) {
      const message = bankText(
        messages[0],
        (node) => node.tagName === "a",
      ).slice(0, 200);
      return message
        ? ({ kind: "refused", message } as const)
        : ({ kind: "invalid-response" } as const);
    }
    return { kind: "page", doc: page.doc } as const;
  }
  return { origin, session, current, exchange, read };
}
