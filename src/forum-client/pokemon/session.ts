import { nativeIdentity } from "../account-forms.js";
import { attr, descendants, documentFrom, text } from "../html.js";
import { integer } from "../notice-transport.js";
import { safeURL } from "../routes.js";
import type { HostResponse } from "../types.js";
import type {
  PokemonAccount,
  PokemonClientOptions,
  PokemonData,
  PokemonFailure,
  PokemonRequest,
  PokemonSession,
} from "./types.js";

export type BootstrapMode = "auto" | "status" | "game-page";
export interface Binding {
  account: PokemonAccount;
  hash: string;
  session: PokemonSession;
}
export function jsonData(body: string): PokemonData | null {
  try {
    return dataObject(JSON.parse(body));
  } catch {
    return null;
  }
}
export function dataObject(value: unknown): PokemonData | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PokemonData)
    : null;
}
const bootstrapOperation = "bootstrap";
export const failure = (
  operation: string,
  kind: PokemonFailure["kind"],
  extra: Pick<PokemonFailure, "code" | "message"> = {},
): PokemonFailure => ({ kind, operation, ...extra });
export function pluginURL(
  origin: string,
  id: string,
  params: Record<string, string | number> = {},
) {
  const url = new URL("/plugin.php", origin);
  url.searchParams.set("id", id);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  return url;
}
function gameHash(body: string) {
  const page = documentFrom(body);
  const values = new Set<string>();
  for (const input of descendants(
    page,
    (node) =>
      node.tagName === "input" &&
      attr(node, "name") === "formhash" &&
      attr(node, "type").toLowerCase() === "hidden",
  )) {
    const value = attr(input, "value");
    if (/^\w{1,128}$/.test(value)) values.add(value);
  }
  for (const script of descendants(
    page,
    (node) => node.tagName === "script" && !attr(node, "src"),
  )) {
    const source = script.childNodes.map(text).join("");
    for (const [, value] of source.matchAll(
      /\bformhash\s*=\s*['"](\w{1,128})['"]/g,
    ))
      values.add(value!);
  }
  return values.size === 1 ? [...values][0]! : null;
}

export function pokemonSessionTransport(options: PokemonClientOptions) {
  const origin = safeURL(options.origin);
  if (!origin || origin.origin !== options.origin)
    throw new TypeError("Expected a canonical HTTPS forum origin.");
  function account(): PokemonAccount | null {
    const value = options.session();
    const uid = Number(value?.memberId);
    return value &&
      typeof value.memberId === "string" &&
      /^\d+$/.test(value.memberId) &&
      integer(uid, 1) &&
      String(uid) === value.memberId &&
      typeof value.continuity === "string" &&
      value.continuity.trim()
      ? Object.freeze({
          memberId: value.memberId,
          continuity: value.continuity,
        })
      : null;
  }
  function current(expected: PokemonAccount): boolean {
    const actual = account();
    return (
      actual?.memberId === expected.memberId &&
      actual.continuity === expected.continuity
    );
  }
  async function request(
    url: URL,
    expected: PokemonAccount,
    headers: Readonly<Record<string, string>> = {},
    body?: string,
  ): Promise<
    | { kind: "reply"; response: HostResponse }
    | {
        kind: "network" | "invalid-response" | "session-changed";
        dispatched: boolean;
      }
  > {
    if (!current(expected))
      return { kind: "session-changed", dispatched: false };
    const input: PokemonRequest =
      body === undefined
        ? {
            method: "GET",
            effect: false,
            fresh: true,
            session: expected,
            headers,
          }
        : {
            method: "POST",
            effect: true,
            fresh: true,
            session: expected,
            headers,
            body,
          };
    try {
      const response = await options.transport.request(url.href, input);
      if (!current(expected))
        return { kind: "session-changed", dispatched: true };
      if (response.url !== url.href || response.redirect !== "none")
        return { kind: "invalid-response", dispatched: true };
      return { kind: "reply", response };
    } catch {
      return {
        kind: current(expected) ? "network" : "session-changed",
        dispatched: true,
      };
    }
  }
  async function load(
    mode: Exclude<BootstrapMode, "auto">,
    expected: PokemonAccount,
  ): Promise<Binding | PokemonFailure> {
    const url =
      mode === "status"
        ? pluginURL(options.origin, "tsdmapp:api", { action: "status" })
        : pluginURL(options.origin, "pokemon:game");
    const reply = await request(url, expected);
    if (reply.kind !== "reply") return failure(bootstrapOperation, reply.kind);
    const { response } = reply;
    if (response.status === 429)
      return failure(bootstrapOperation, "rate-limited");
    if ([401, 403].includes(response.status))
      return failure(bootstrapOperation, "refused", {
        code: 401,
        message: "The forum session needs login.",
      });
    if (mode === "status" && response.status === 404)
      return failure(bootstrapOperation, "unsupported");
    if (response.status !== 200)
      return failure(bootstrapOperation, "invalid-response");
    const uid = Number(expected.memberId);
    let hash: string | null;
    if (mode === "status") {
      const status = jsonData(response.body);
      if (status?.login === 1 || status?.error === "login" || status?.uid === 0)
        return failure(bootstrapOperation, "refused", {
          code: 401,
          message: "The forum session needs login.",
        });
      if (status?.error === "busy")
        return failure(bootstrapOperation, "rate-limited");
      if (status?.uid !== undefined && status.uid !== uid)
        return failure(bootstrapOperation, "session-changed");
      hash =
        status?.ok === 1 &&
        status.uid === uid &&
        typeof status.formhash === "string" &&
        /^[a-f0-9]{8}$/.test(status.formhash)
          ? status.formhash
          : null;
      if (!hash) return failure(bootstrapOperation, "unsupported");
    } else {
      if (!/html/i.test(response.contentType))
        return failure(bootstrapOperation, "invalid-response");
      const viewer = nativeIdentity(response.body, url);
      if (viewer === "0")
        return failure(bootstrapOperation, "refused", {
          code: 401,
          message: "The forum session needs login.",
        });
      if (
        (viewer && viewer !== expected.memberId) ||
        (!viewer && /\bdiscuz_uid\s*=\s*['"]\d+['"]/.test(response.body))
      )
        return failure(bootstrapOperation, "session-changed");
      hash = gameHash(response.body);
      if (!hash) return failure(bootstrapOperation, "invalid-response");
    }
    return {
      account: expected,
      hash,
      session: Object.freeze({ uid, source: mode }),
    };
  }
  async function bootstrap(mode: BootstrapMode, expected: PokemonAccount) {
    if (mode === "game-page") return load(mode, expected);
    const status = await load("status", expected);
    return mode === "auto" && "kind" in status && status.kind === "unsupported"
      ? load("game-page", expected)
      : status;
  }
  return { account, current, request, bootstrap };
}
