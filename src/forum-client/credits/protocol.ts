import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  label,
  type Node,
  type Element,
} from "../html.js";
import { nativeIdentity, unwrap } from "../account-forms.js";
import { numericId, object } from "../notice-transport.js";
import { safeURL } from "../routes.js";
import { selectV4, v4StatusURL } from "../v4-selection.js";
import type { NoticeHost, NoticeSession } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import type { CreditsFailure } from "./types.js";

export { object as record, numericId, nativeIdentity };
export const string = (value: unknown) =>
  typeof value === "string" ? value : "";
export const whole = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
export const bit = (value: unknown) => value === 0 || value === 1;
export const formhash = (value: unknown) =>
  /^[a-fA-F0-9]{8}$/.test(string(value)) ? string(value) : "";
export const failure = (
  kind: CreditsFailure["kind"],
  message: string,
  code?: string,
): CreditsFailure => ({ kind, message, ...(code ? { code } : {}) });
export const positive = (value: unknown) => {
  const id = numericId(value);
  return id === "0" ? null : id;
};
export function urlAt(
  origin: string,
  path: string,
  query: Record<string, string>,
) {
  const url = new URL(path, origin);
  url.search = new URLSearchParams(query).toString();
  return url;
}
export function forumURL(raw: unknown, base: URL, path?: string) {
  if (typeof raw !== "string" || !raw) return null;
  const url = safeURL(raw, base.href);
  return url &&
    url.origin === base.origin &&
    !url.hash &&
    (!path || url.pathname === path) &&
    new Set(url.searchParams.keys()).size ===
      [...url.searchParams.keys()].length
    ? url
    : null;
}
export function answer(response: HostResponse) {
  let data: Record<string, unknown> | null = null;
  if (/json/i.test(response.contentType)) {
    try {
      data = object(JSON.parse(response.body));
    } catch {
      /* Unrecognized JSON. */
    }
  }
  const html = data
    ? string(data.head) + string(data.document)
    : /html|xml/i.test(response.contentType)
      ? unwrap(response.body)
      : "";
  return { data, html };
}
export function nativeMessage(html: string): {
  doc: Node;
  message: string;
  isError: boolean;
} {
  const doc = documentFrom(html);
  const box =
    byId(doc, "messagetext") ??
    descendants(doc, (n) => hasClass(n, "alert_error"))[0];
  return {
    doc,
    message: label(box),
    isError: Boolean(box && hasClass(box, "alert_error")),
  };
}
export function readIssue(
  response: HostResponse,
  data: Record<string, unknown> | null,
  memberId: string,
) {
  if (response.status === 429 || data?.error === "busy") {
    const retry = whole(data?.retry_after);
    return {
      ...failure(
        "rate-limited",
        string(data?.message) || "The forum asked the caller to wait.",
      ),
      ...(retry !== null && retry >= 0 ? { retryAfterSeconds: retry } : {}),
    };
  }
  if (
    [401, 403, 404].includes(response.status) ||
    data?.login === 1 ||
    data?.error === "login"
  )
    return failure(
      "refused",
      string(data?.message) || "The forum refused this request.",
      string(data?.message_key) || String(response.status),
    );
  if (data?.uid !== undefined && numericId(data.uid) !== memberId)
    return failure(
      "session-changed",
      "The response was served to a different account.",
    );
  if (response.status !== 200)
    return failure(
      "invalid-response",
      `Forum returned HTTP ${response.status}.`,
    );
  if (
    data?.ok === 0 &&
    !["action", "off", "unknown", "unsupported"].includes(string(data.error))
  )
    return failure(
      "refused",
      string(data.message) || "The forum declined this request.",
      string(data.message_key),
    );
  return null;
}
export function nativeControls(
  html: string,
  formId: string,
): { doc: Node; message: string; isError: boolean; form: Element | undefined } {
  const { doc, message, isError } = nativeMessage(html);
  const forms = descendants(
    doc,
    (n) => n.tagName === "form" && attr(n, "id") === formId,
  );
  return {
    doc,
    message,
    isError,
    form: forms.length === 1 ? forms[0] : undefined,
  };
}

export async function creditPageAvailable(
  host: NoticeHost,
  owner: NoticeSession,
  operation: "credit_base" | "usergroup_info",
) {
  const url = v4StatusURL(host.origin);
  const status = await host.request(url, owner);
  if (status.kind !== "response")
    return failure(status.kind, "Credit capabilities unavailable.");
  if (status.response.status === 404) return false;
  const issue = readIssue(
    status.response,
    answer(status.response).data,
    owner.memberId,
  );
  if (issue) return issue;
  const selected = selectV4(
    status.response,
    url,
    "credit_pages",
    operation,
    owner.memberId,
  );
  return selected.kind === "v4";
}
