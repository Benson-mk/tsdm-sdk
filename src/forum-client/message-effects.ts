import { nativeIdentity, operationURL, token } from "./account-forms.js";
import { attr, descendants } from "./html.js";
import {
  integer,
  noticeJSON,
  numericId,
  object,
  type NoticeHost,
  type NoticeSession,
} from "./notice-transport.js";
import { messageJSON, pageDocument, pageSource } from "./message-pages.js";

export interface PrivateMessagePrompt {
  readonly kind: "private-prompt";
  readonly memberId: string;
  readonly count: number | null;
}

export interface HomepageMessageCheck {
  readonly kind: "homepage-check";
  readonly memberId: string;
  readonly effect: "may-credit-daily-login";
}

export function messageEffects(host: NoticeHost) {
  const base = new URL(host.origin);
  const notDispatched = { kind: "not-dispatched" } as const;
  const uncertain = { kind: "uncertain" } as const;
  const refused = { kind: "refused" } as const;
  const unsupported = { kind: "unsupported" } as const;
  const sessionChanged = { kind: "session-changed" } as const;
  const checkRoute = { mod: "spacecp", ac: "pm", op: "checknewpm" };
  const checkKeys = new Set([...Object.keys(checkRoute), "rand"]);
  let promptInFlight = false;
  let promptGeneration = 0;
  let pendingPrompt: {
    proof: PrivateMessagePrompt;
    session: NoticeSession;
    formhash: string;
  } | null = null;
  const issuedChecks = new WeakMap<
    HomepageMessageCheck,
    { session: NoticeSession; url: string }
  >();

  function api(action: "seen" | "notify") {
    const url = new URL("/plugin.php", base);
    url.search = new URLSearchParams({ id: "tsdmapp:api", action }).toString();
    return url.href;
  }

  async function preparePrivateMessageAcknowledgement() {
    const session = host.session();
    if (!session || promptInFlight) return refused;
    const generation = ++promptGeneration;
    pendingPrompt = null;
    const observed = await host.request(api("notify"), session);
    if (observed.kind !== "response") return observed;
    const decoded = noticeJSON(observed.response);
    if (decoded.kind !== "json") return decoded;
    if (
      numericId(decoded.data.uid) !== session.memberId ||
      generation !== promptGeneration
    )
      return sessionChanged;
    const formhash = token(decoded.data.formhash);
    if (!formhash) return unsupported;
    const count = object(decoded.data.counts)?.pm;
    const proof: PrivateMessagePrompt = Object.freeze({
      kind: "private-prompt",
      memberId: session.memberId,
      count: integer(count, 0) ? count : null,
    });
    pendingPrompt = { proof, session, formhash };
    return proof;
  }

  async function acknowledgePrivateMessagePrompt(
    proof: PrivateMessagePrompt,
    settings: { confirm: boolean },
  ) {
    const pending = pendingPrompt;
    if (
      !pending ||
      pending.proof !== proof ||
      settings.confirm !== true ||
      !host.current(pending.session)
    )
      return notDispatched;
    pendingPrompt = null;
    promptInFlight = true;
    try {
      const body = new URLSearchParams({
        formhash: pending.formhash,
        pm: "1",
      }).toString();
      const result = await host.request(api("seen"), pending.session, body);
      if (result.kind !== "response") return uncertain;
      const decoded = noticeJSON(result.response);
      if (
        decoded.kind === "json" &&
        numericId(decoded.data.uid) === pending.session.memberId &&
        decoded.data.pm === 1 &&
        (decoded.data.notice === 0 || decoded.data.notice === undefined)
      )
        return { kind: "cleared" } as const;
      return uncertain;
    } finally {
      promptInFlight = false;
    }
  }

  async function prepareHomepageMessageCheck() {
    const session = host.session();
    if (!session) return refused;
    const homepage = new URL("/forum.php", base);
    homepage.search = new URLSearchParams({
      mod: "index",
      tsdmapp: "json",
      nodoc: "1",
    }).toString();
    const request = await host.request(homepage.href, session);
    if (request.kind !== "response") return request;
    const { response } = request;
    if (response.status === 429) return { kind: "rate-limited" } as const;
    if (response.status !== 200) return refused;
    const data = messageJSON(response.body);
    const doc = pageDocument(response, data);
    if (data?.ok === 0) return refused;
    const native = nativeIdentity(pageSource(response, data), base);
    const uid = data?.uid === undefined ? native : numericId(data.uid);
    if (uid !== session.memberId || (native !== null && native !== uid))
      return sessionChanged;
    const candidates =
      typeof data?.checknewpm === "string"
        ? [data.checknewpm]
        : descendants(doc, (node) => node.tagName === "script").map((node) =>
            attr(node, "src"),
          );
    const urls = new Set(
      candidates.flatMap((raw) => {
        const url = operationURL(raw, base, "/home.php", checkRoute);
        return url &&
          [...url.searchParams.keys()].every((name) => checkKeys.has(name))
          ? [url.href]
          : [];
      }),
    );
    if (urls.size !== 1) return unsupported;
    const proof: HomepageMessageCheck = Object.freeze({
      kind: "homepage-check",
      memberId: session.memberId,
      effect: "may-credit-daily-login",
    });
    issuedChecks.set(proof, { session, url: [...urls][0]! });
    return proof;
  }

  async function checkHomepageMessages(
    proof: HomepageMessageCheck,
    settings: { confirm: boolean },
  ) {
    const prepared = issuedChecks.get(proof);
    if (
      !prepared ||
      settings.confirm !== true ||
      !host.current(prepared.session)
    )
      return notDispatched;
    issuedChecks.delete(proof);
    const request = await host.request(prepared.url, prepared.session);
    if (request.kind !== "response" || request.response.status !== 200)
      return uncertain;
    return { kind: "loaded", credit: "unknown" } as const;
  }

  return {
    preparePrivateMessageAcknowledgement,
    acknowledgePrivateMessagePrompt,
    prepareHomepageMessageCheck,
    checkHomepageMessages,
  };
}
