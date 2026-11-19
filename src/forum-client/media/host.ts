import { numericId, object } from "../notice-transport.js";
import { safeURL } from "../routes.js";
import type {
  MediaClientOptions,
  MediaRequest,
  MediaResponse,
  MediaSession,
} from "./types.js";

export { object as record, numericId };
export const text = (r: MediaResponse) => new TextDecoder().decode(r.bytes);
export function json(value: string) {
  try {
    return object(JSON.parse(value));
  } catch {
    return null;
  }
}
export function forumURL(value: unknown, base: URL, path?: string) {
  if (typeof value !== "string" || !value) return null;
  const url = safeURL(value, base.href);
  return url &&
    url.origin === base.origin &&
    !url.hash &&
    (!path || url.pathname === path) &&
    new Set(url.searchParams.keys()).size ===
      [...url.searchParams.keys()].length
    ? url
    : null;
}
export function header(response: MediaResponse, name: string) {
  const entries = Object.entries(response.headers).filter(
    ([key]) => key.toLowerCase() === name,
  );
  return entries.length === 1 ? entries[0]?.[1] : undefined;
}
export const invalid = (message: string) =>
  ({ kind: "invalid", message }) as const;
export const unknown = (message: string) =>
  ({ kind: "unknown", message }) as const;
export const refused = (message: string, code?: string) =>
  ({ kind: "refused", message, ...(code ? { code } : {}) }) as const;
export const sessionChanged = {
  kind: "session-changed",
  message: "The forum session changed.",
} as const;
export const positive = (value: unknown) => {
  const id = numericId(value);
  return id === "0" ? null : id;
};
type WithoutSession<T> = T extends MediaRequest
  ? Omit<T, "session" | "fresh">
  : never;
export function mediaHost(options: MediaClientOptions) {
  const base = safeURL(options.origin);
  if (!base || base.origin !== options.origin)
    throw new TypeError("A canonical HTTPS forum origin is required.");
  const origin = base;
  function session(): MediaSession | null {
    const item = options.session();
    return item &&
      numericId(item.memberId) === item.memberId &&
      typeof item.continuity === "string" &&
      item.continuity
      ? Object.freeze({ memberId: item.memberId, continuity: item.continuity })
      : null;
  }
  function current(owner: MediaSession) {
    const actual = session();
    return (
      actual?.memberId === owner.memberId &&
      actual.continuity === owner.continuity
    );
  }
  async function request(
    url: URL,
    owner: MediaSession,
    init: WithoutSession<MediaRequest> = { method: "GET", effect: false },
  ) {
    if (!current(owner)) return sessionChanged;
    if (!forumURL(url.href, origin))
      return invalid("Invalid forum destination.");
    let response: MediaResponse;
    try {
      response = await options.transport.request(url.href, {
        ...init,
        session: owner,
        fresh: true,
      });
    } catch {
      return init.effect
        ? unknown("The forum may have received the request.")
        : invalid("The forum response was unavailable.");
    }
    if (!current(owner))
      return init.effect
        ? unknown("The session changed after dispatch.")
        : sessionChanged;
    if (response.url !== url.href || response.redirect !== "none")
      return init.effect
        ? unknown("The effect response could not be verified.")
        : invalid(
            "The host must return the unfollowed response for the requested destination.",
          );
    return { kind: "response", response } as const;
  }
  return { origin, session, current, request };
}
export type MediaHost = ReturnType<typeof mediaHost>;
