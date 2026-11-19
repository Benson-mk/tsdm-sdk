import {
  attr,
  descendants,
  documentFrom,
  hasClass,
  label,
  type Node,
} from "./html.js";
import { numericId, object } from "./notice-transport.js";
import { safeURL } from "./routes.js";
import type { HostResponse } from "./types.js";

export const record = object;
export const id = (value: unknown) => {
  const result = numericId(value);
  return result === "0" ? null : result;
};
export const string = (value: unknown) =>
  typeof value === "string" ? value : "";
export const int = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
export const rows = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : null;

export function activityURL(value: string, base: URL) {
  const url = safeURL(value, base.href);
  return url &&
    url.origin === base.origin &&
    !url.hash &&
    new Set(url.searchParams.keys()).size ===
      [...url.searchParams.keys()].length
    ? url
    : null;
}

export function answer(response: HostResponse): {
  data: Record<string, unknown> | null;
  html: string;
  doc: Node;
  failure: string;
} {
  let data: Record<string, unknown> | null = null;
  let html = "";
  if (/json/i.test(response.contentType)) {
    try {
      data = record(JSON.parse(response.body));
    } catch {
      /* Unsupported response. */
    }
    html = string(data?.document);
  } else if (/xml/i.test(response.contentType)) {
    html =
      /^\s*(?:<\?xml[^?]*\?>\s*)?<root>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/root>\s*$/.exec(
        response.body,
      )?.[1] ?? "";
  } else if (/^text\/html/i.test(response.contentType)) {
    html = response.body;
  }
  const doc = documentFrom(html);
  const failure =
    descendants(
      doc,
      (node) =>
        hasClass(node, "alert_error") || attr(node, "id") === "messagetext",
    )
      .map(label)
      .find(Boolean) ?? "";
  return { data, html, doc, failure };
}

export function responseIssue(
  response: HostResponse,
  data: Record<string, unknown> | null,
) {
  const code = string(data?.message_key);
  const message = string(data?.message);
  if (response.status === 429 || data?.error === "busy")
    return { kind: "refused", code: "rate-limited", message } as const;
  if (response.status === 401 || data?.login === 1 || code === "to_login")
    return { kind: "refused", code: "login", message } as const;
  if ([403, 404].includes(response.status))
    return { kind: "refused", code: String(response.status), message } as const;
  return null;
}

export function targetMatches(
  data: Record<string, unknown>,
  target: { threadId: string; postId?: string },
) {
  return (
    (data.tid === undefined || id(data.tid) === target.threadId) &&
    (target.postId === undefined ||
      data.pid === undefined ||
      id(data.pid) === target.postId)
  );
}
