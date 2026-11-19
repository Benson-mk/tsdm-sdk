import type { ActivitySession } from "../activity-client.js";
import type {
  ModeratorPanelOptions,
  PanelFailure,
  PanelLoginOffer,
  PanelSelectionOutcome,
} from "./types.js";
import {
  activityURL,
  answer,
  id,
  responseIssue,
  string,
} from "../activity-protocol.js";
import { attr, controlDisabled, descendants, type Node } from "../html.js";
import { noticeHost } from "../notice-transport.js";
import type { HostResponse } from "../types.js";

export type PanelFields = Record<string, string>;
export function panelRoute(origin: string, fields: PanelFields) {
  const url = new URL("/forum.php", origin);
  url.search = new URLSearchParams({ mod: "modcp", ...fields }).toString();
  return url;
}

export function panelDestination(
  raw: string,
  requested: URL,
  action: string,
  op?: string,
) {
  const url = activityURL(raw, requested);
  return url?.pathname === "/forum.php" &&
    url.searchParams.get("mod") === "modcp" &&
    url.searchParams.get("action") === action &&
    (op === undefined || url.searchParams.get("op") === op)
    ? url
    : null;
}

export function hidden(
  form: Node,
  names: readonly string[],
): PanelFields | null {
  const fields: PanelFields = {};
  for (const node of descendants(
    form,
    (node) =>
      node.tagName === "input" &&
      attr(node, "type") === "hidden" &&
      !controlDisabled(node),
  )) {
    const name = attr(node, "name");
    if (!names.includes(name)) continue;
    if (Object.hasOwn(fields, name)) return null;
    fields[name] = attr(node, "value");
  }
  return fields;
}

export const formhash = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_]{1,128}$/.test(value);
export const positive = (value: unknown): value is string =>
  typeof value === "string" && id(value) === value;

export function loginEvidence(
  parsed: ReturnType<typeof answer>,
  requested: URL,
) {
  const native = descendants(
    parsed.doc,
    (node) =>
      node.tagName === "form" &&
      descendants(
        node,
        (input) =>
          input.tagName === "input" &&
          attr(input, "name") === "cppwd" &&
          attr(input, "type") === "password" &&
          !controlDisabled(input),
      ).length === 1,
  );
  if (native.length === 1) {
    const form = native[0]!;
    const fields = hidden(form, ["formhash", "fid", "submit", "login_panel"]);
    const url = panelDestination(attr(form, "action"), requested, "login");
    if (
      attr(form, "method").toLowerCase() === "post" &&
      fields &&
      formhash(fields.formhash) &&
      (fields.fid === "0" || positive(fields.fid)) &&
      fields.submit === "yes" &&
      fields.login_panel === "yes" &&
      url &&
      url.searchParams.size === 2
    )
      return { url, token: fields.formhash, forumId: fields.fid };
  }
  if (
    !native.length &&
    parsed.data?.ok === 0 &&
    parsed.data.error === "modcp_login" &&
    formhash(parsed.data.formhash)
  ) {
    const fid = requested.searchParams.get("fid") ?? "0";
    if (fid === "0" || positive(fid))
      return {
        url: panelRoute(requested.origin, { action: "login" }),
        token: parsed.data.formhash,
        forumId: fid,
      };
  }
  return null;
}

export function panelIdentity(
  parsed: ReturnType<typeof answer>,
  owner: ActivitySession,
) {
  if (parsed.data?.uid !== undefined) {
    if (String(parsed.data.uid) === "0" && parsed.data.login === 1)
      return "refused";
    if (id(parsed.data.uid) !== owner.memberId) return "session-changed";
  }
  const natives = [...parsed.html.matchAll(/\bdiscuz_uid\s*=\s*['"]?(\d+)\b/g)];
  if (natives.some((match) => match[1] !== owner.memberId))
    return "session-changed";
  return null;
}

export function panelRefusal(
  response: HostResponse,
  parsed: ReturnType<typeof answer>,
): PanelFailure | null {
  const issue = responseIssue(response, parsed.data);
  if (issue) return { kind: "refused", code: issue.code };
  if (parsed.data?.ok === 0 || parsed.data?.alert === "error" || parsed.failure)
    return {
      kind: "refused",
      code:
        string(parsed.data?.message_key) ||
        string(parsed.data?.error) ||
        "forum-refusal",
    };
  return null;
}

export function panelHost(options: ModeratorPanelOptions) {
  const { origin, session, current } = noticeHost({
    origin: options.origin,
    session: options.session,
    transport: {
      request: (url, request) =>
        options.transport.request(
          url,
          request.method === "GET"
            ? { ...request, effect: false }
            : { ...request, effect: true },
        ),
    },
  });
  async function request(
    url: URL,
    owner: ActivitySession,
    fields?: URLSearchParams,
    effect = fields !== undefined,
    login = false,
  ) {
    if (!current(owner)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url.href,
        fields === undefined
          ? { method: "GET", effect, fresh: true, session: owner }
          : {
              method: "POST",
              effect: true,
              fresh: true,
              session: owner,
              body: fields.toString(),
            },
      );
    } catch {
      return {
        kind: effect
          ? "uncertain"
          : current(owner)
            ? "network"
            : "session-changed",
      } as const;
    }
    if (!current(owner))
      return { kind: effect ? "uncertain" : "session-changed" } as const;
    if (
      response.url !== url.href ||
      response.redirect === "followed" ||
      (!login && response.redirect !== "none")
    )
      return { kind: effect ? "uncertain" : "invalid-response" } as const;
    return { kind: "response", response, parsed: answer(response) } as const;
  }
  return { origin, session, current, request };
}

export type PanelOfferLogin = (
  request: URL,
  owner: ActivitySession,
  parsed: ReturnType<typeof answer>,
) => PanelLoginOffer | null;
export type PanelHost = ReturnType<typeof panelHost>;
export type PanelContext = ReturnType<typeof panelContext>;
export function panelContext(host: PanelHost, offerLogin: PanelOfferLogin) {
  async function read(url: URL, owner: ActivitySession, effect = false) {
    const reply = await host.request(url, owner, undefined, effect);
    if (reply.kind !== "response") return reply;
    const { parsed, response } = reply;
    const identity = panelIdentity(parsed, owner);
    if (identity)
      return identity === "refused"
        ? ({ kind: "refused", code: "login" } as const)
        : ({ kind: effect ? "uncertain" : identity } as const);
    if (response.status >= 500 && effect) return { kind: "uncertain" } as const;
    const login =
      response.status === 200 ? offerLogin(url, owner, parsed) : null;
    if (login) return login;
    const problem = panelRefusal(response, parsed);
    if (problem) return problem;
    return response.status === 200
      ? reply
      : ({ kind: effect ? "uncertain" : "invalid-response" } as const);
  }
  async function write(
    url: URL,
    owner: ActivitySession,
    fields: URLSearchParams,
  ) {
    const reply = await host.request(url, owner, fields);
    if (reply.kind !== "response") return reply;
    const { parsed, response } = reply;
    const identity = panelIdentity(parsed, owner);
    if (identity)
      return identity === "refused"
        ? ({ kind: "refused", code: "login" } as const)
        : ({ kind: "uncertain" } as const);
    if (response.status >= 500) return { kind: "uncertain" } as const;
    if (loginEvidence(parsed, url) || parsed.data?.error === "modcp_login")
      return { kind: "refused", code: "panel-login" } as const;
    const issue = responseIssue(response, parsed.data);
    if (issue) return { kind: "refused", code: issue.code } as const;
    return response.status === 200 ? reply : ({ kind: "uncertain" } as const);
  }
  return { ...host, read, write };
}

export function exactFields(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.every(
    ([key, field]) => allowed.includes(key) && typeof field === "string",
  )
    ? (Object.fromEntries(entries) as PanelFields)
    : null;
}
export function routeKeys(url: URL, allowed: readonly string[]) {
  return [...url.searchParams.keys()].every(
    (key) =>
      key === "mod" ||
      key === "action" ||
      key === "op" ||
      allowed.includes(key),
  );
}
export const pageNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const jsonRead = { tsdmapp: "json", nodoc: "1" } as const;
export function addQuery(url: URL, fields: PanelFields) {
  const result = new URL(url);
  for (const [key, value] of Object.entries(fields))
    result.searchParams.set(key, value);
  return result;
}
export function assessSelection(
  ids: readonly string[],
  listed: readonly string[],
  complete: boolean,
): PanelSelectionOutcome {
  const remainingIds = ids.filter((id) => listed.includes(id));
  const absent = ids.filter((id) => !listed.includes(id));
  return {
    kind: remainingIds.length
      ? absent.length && complete
        ? "partial"
        : "redrawn"
      : complete
        ? "completed"
        : "uncertain",
    confirmedIds: complete ? absent : [],
    remainingIds,
    unknownIds: complete ? [] : absent,
  };
}
export const validSelection = (
  ids: readonly string[],
  offered: readonly string[],
) =>
  Array.isArray(ids) &&
  ids.length > 0 &&
  new Set(ids).size === ids.length &&
  ids.every((id) => positive(id) && offered.includes(id));

export const jsonV4Read = { ...jsonRead, tsdmv: "4" } as const;
export const jsonV4Write = { tsdmapp: "json", tsdmv: "4" } as const;
export async function discoverPanelMode(
  panel: PanelContext,
  owner: ActivitySession,
  action: string,
): Promise<boolean | PanelFailure> {
  const status = new URL(
    "/plugin.php?id=tsdmapp:api&action=status",
    panel.origin,
  );
  const reply = await panel.request(status, owner);
  if (reply.kind !== "response")
    return reply.kind === "session-changed" ? reply : false;
  const { parsed, response } = reply;
  const identity = panelIdentity(parsed, owner);
  if (identity)
    return identity === "refused"
      ? { kind: "refused", code: "login" }
      : { kind: identity };
  const issue = responseIssue(response, parsed.data);
  if (issue && response.status !== 404)
    return { kind: "refused", code: issue.code };
  const data = parsed.data;
  return (
    response.status === 200 &&
    data?.ok === 1 &&
    id(data.uid) === owner.memberId &&
    data.v4 === 1 &&
    Array.isArray(data.modcp_pages_v4) &&
    data.modcp_pages_v4.includes(action)
  );
}
