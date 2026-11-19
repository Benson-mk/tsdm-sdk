import { unwrap } from "../account-forms.js";
import { byId, descendants, documentFrom, label, text } from "../html.js";
import { accountFrom } from "../read-thread.js";
import {
  parseReadPayload,
  readAccount,
  structuredFailure,
} from "../structured-read.js";
import type { HostResponse } from "../types.js";
import type {
  PreparedSpaceWrite,
  PrepareSpaceWrite,
  SpaceClientOptions,
  SpaceEffect,
  SpacePreparation,
  SpaceRead,
  SpacePage,
} from "./model.js";
import { spaceEffects, type SpaceObservation } from "./effects.js";
import { documentScripts, named, nativePage } from "./native.js";
import { spaceRoute } from "./routes.js";
import { str, structuredPage, supportsStructuredSpace } from "./structured.js";

export type * from "./model.js";

export interface SpaceClient {
  read(destination: string): Promise<SpaceRead>;
  readNext(page: SpacePage): Promise<SpaceRead>;
  prepare(input: PrepareSpaceWrite): Promise<SpacePreparation>;
  submit(
    handle: PreparedSpaceWrite,
    intent: { deliberate: boolean },
  ): Promise<SpaceEffect>;
}

function spaceAccount(doc: Parameters<typeof accountFrom>[0], base: string) {
  const account = accountFrom(doc, base);
  const head = descendants(doc, (node) => node.tagName === "head")[0];
  const uid =
    head &&
    /\bdiscuz_uid\s*=\s*['"](0|[1-9]\d*)['"]/.exec(documentScripts(head))?.[1];
  if (account.kind !== "unknown" || uid === undefined) return account;
  return uid === "0"
    ? { kind: "guest" as const }
    : { kind: "member" as const, id: uid, name: `Member ${uid}` };
}

function json(response: HostResponse) {
  const parsed = parseReadPayload(response);
  if (parsed || !/^\s*"/.test(response.body)) return parsed;
  try {
    const nested: unknown = JSON.parse(response.body);
    return typeof nested === "string"
      ? parseReadPayload({ ...response, body: nested })
      : null;
  } catch {
    return null;
  }
}

export function createSpaceClient({
  origin,
  session,
  transport,
}: SpaceClientOptions): SpaceClient {
  const base = new URL(origin).origin;
  const pages = new WeakMap<
    SpacePage,
    {
      next: string | null;
      url: string;
      account: SpacePage["account"];
      session: string;
    }
  >();
  const remember = (page: SpacePage, continuity: string) => {
    pages.set(page, {
      next: page.next,
      url: page.url,
      account: { ...page.account },
      session: continuity,
    });
    return page;
  };
  async function read(
    destination: string,
    capture?: (value: SpaceObservation) => void,
  ): Promise<SpaceRead> {
    const route = spaceRoute(destination, base);
    if (!route)
      return {
        kind: "invalid",
        url: destination,
        message: "Unsupported member space destination.",
      };
    const url = route.url.href;
    const handoff = (message: string): SpaceRead => ({
      kind: "document-navigation",
      url,
      destination: url,
      message,
    });
    if (route.view === "photo" || route.view === "member")
      return handoff("Open the native member space in the same forum session.");
    const continuity = session();
    if (!continuity)
      return {
        kind: "session-changed",
        url,
        message: "A continuous host session is required.",
      };
    const failure = (
      kind:
        | "invalid"
        | "incomplete"
        | "login"
        | "permission"
        | "missing"
        | "limited"
        | "unavailable"
        | "session-changed",
      message: string,
    ): SpaceRead => ({ kind, url, message });
    const selected = new URL(url);
    selected.searchParams.set("tsdmapp", "json");
    if (supportsStructuredSpace(route)) {
      selected.searchParams.set("tsdmv", "4");
      selected.searchParams.set("nodoc", "1");
    }
    const native = new URL(url);
    if (route.fragment || route.view === "status-replies")
      native.searchParams.set("inajax", "1");
    for (const requestURL of [selected, native]) {
      let response: HostResponse;
      try {
        response = await transport.request(requestURL.href, {
          fresh: true,
          session: continuity,
          method: "GET",
          effect: false,
        });
      } catch {
        return session() !== continuity
          ? failure("session-changed", "The forum session changed.")
          : failure(
              "unavailable",
              "The host could not complete the space read.",
            );
      }
      if (session() !== continuity)
        return failure("session-changed", "The forum session changed.");
      if (response.redirect === "opaque")
        return handoff("Open the original space destination to continue.");
      if (response.redirect !== "none" || response.url !== requestURL.href)
        return failure(
          "invalid",
          "The returned space destination did not match.",
        );
      const payload = json(response);
      const viewer = readAccount(payload ?? {});
      const refusal = structuredFailure(payload ?? {}, response, viewer);
      if (
        refusal &&
        ["login", "missing", "permission", "limited"].includes(refusal.kind) &&
        "message" in refusal
      ) {
        if (refusal.kind === "login") return failure("login", refusal.message);
        if (refusal.kind === "missing")
          return failure("missing", refusal.message);
        if (refusal.kind === "permission")
          return failure("permission", refusal.message);
        if (refusal.kind === "limited")
          return failure("limited", refusal.message);
      }
      if (response.status !== 200)
        return failure(
          "unavailable",
          "The forum could not return the space page.",
        );
      const messageKey = str(payload?.message_key) ?? "";
      const message = str(payload?.message) ?? "";
      if (messageKey === "to_login") return failure("login", message);
      if (/does_not_exist|not_found/.test(messageKey))
        return failure("missing", message);
      if (payload?.ok === 0 && (messageKey || message))
        return failure("permission", message || messageKey);
      if (payload) {
        const result = structuredPage(payload, route, viewer);
        if (result === "mismatch")
          return failure("invalid", "The returned space scope did not match.");
        if (result) {
          capture?.({ payload, doc: null, route });
          return remember(result, continuity);
        }
      }
      const source = unwrap(
        payload ? (str(payload.document) ?? "") : response.body,
      );
      const doc = documentFrom(source);
      if (byId(doc, "invalueform"))
        return handoff("The forum requires a password for this content.");
      if (byId(doc, "challenge-form") || byId(doc, "cf-challenge-running"))
        return handoff("The forum requires browser verification.");
      const notice = byId(doc, "messagetext");
      const privacy = named(doc, "nfl");
      if (
        byId(doc, "messagelogin") ||
        (notice && /先登[录錄入]|sign in|log in/i.test(text(notice)))
      )
        return failure("login", label(notice));
      if (notice && /不存在|not found/i.test(text(notice)))
        return failure("missing", label(notice));
      if (notice || (privacy && named(privacy, "xs2")))
        return failure("permission", label(notice ?? privacy));
      const nativeAccount = spaceAccount(doc, url);
      if (
        viewer.kind !== "unknown" &&
        nativeAccount.kind !== "unknown" &&
        (viewer.kind !== nativeAccount.kind ||
          (viewer.kind === "member" &&
            nativeAccount.kind === "member" &&
            viewer.id !== nativeAccount.id))
      )
        return failure(
          "session-changed",
          "The response contains conflicting viewer identities.",
        );
      const account = viewer.kind === "unknown" ? nativeAccount : viewer;
      if (route.view === "greetings" && account.kind === "guest")
        return failure("login", "Sign in to read received greetings.");
      const result = nativePage(doc, route, account, source);
      if (result) {
        capture?.({ payload, doc, route });
        return remember(result, continuity);
      }
    }
    return failure(
      "incomplete",
      "The response did not establish the requested space page.",
    );
  }
  async function readNext(page: SpacePage): Promise<SpaceRead> {
    const previous = pages.get(page);
    if (!previous?.next)
      return {
        kind: "invalid",
        url: previous?.url ?? base,
        message: "No continuation was issued for this page.",
      };
    const changed = (): SpaceRead => ({
      kind: "session-changed",
      url: previous.next!,
      message: "The forum session changed.",
    });
    if (session() !== previous.session) return changed();
    const result = await read(previous.next);
    if (session() !== previous.session) return changed();
    if (result.kind !== "page") return result;
    const { account } = result;
    if (
      previous.account.kind !== "unknown" &&
      account.kind !== "unknown" &&
      (previous.account.kind !== account.kind ||
        (previous.account.kind === "member" &&
          account.kind === "member" &&
          previous.account.id !== account.id))
    )
      return changed();
    if (account.kind === "unknown") {
      // Native AJAX fragments can omit the viewer. Keep the earlier binding
      // privately while preserving the fragment's observed account in its result.
      pages.set(result, {
        next: result.next,
        url: result.url,
        account: previous.account,
        session: previous.session,
      });
    }
    return result;
  }
  return {
    read,
    readNext,
    ...spaceEffects(
      { origin, session, transport },
      base,
      read,
      json,
      spaceAccount,
    ),
  };
}
