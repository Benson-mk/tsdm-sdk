import { integer } from "../notice-transport.js";
import {
  dataObject,
  failure,
  jsonData,
  pluginURL,
  pokemonSessionTransport,
  type Binding,
  type BootstrapMode,
} from "./session.js";
import type {
  PokemonAccount,
  PokemonBootstrapResult,
  PokemonClientOptions,
  PokemonData,
  PokemonFailure,
  PokemonResult,
} from "./types.js";

export type PokemonGroup =
  "config" | "evolution" | "pokemon" | "user" | "shop" | "battle";
export type PokemonQuery = Record<string, string | number>;
export type PokemonDecode<T> = (data: PokemonData, uid: number) => T | null;
const needsRefresh = (result: PokemonFailure) =>
  result.kind === "refused" &&
  (result.code === undefined || result.code === 419) &&
  /^formhash\s+(?:校验失败，请刷新页面后重试|校驗失敗，請刷新頁面後重試)[。.]?$/.test(
    result.message ?? "",
  );
const unknownMessage =
  "The plugin did not establish the effect. Reconcile the original account before considering another submission.";
const sameAccount = (left: PokemonAccount, right: PokemonAccount) =>
  left.memberId === right.memberId && left.continuity === right.continuity;

/** Shared authenticated wire for roster, shop and battle. Named operations own routes and decoders. */
export function createPokemonWire(options: PokemonClientOptions) {
  const host = pokemonSessionTransport(options);
  let active: Binding | null = null;
  let revision = 0;
  let pending: {
    mode: BootstrapMode;
    account: PokemonAccount;
    promise: Promise<Binding | PokemonFailure>;
  } | null = null;
  function connect(
    mode: BootstrapMode,
    account: PokemonAccount,
  ): Promise<Binding | PokemonFailure> {
    if (
      pending &&
      pending.mode === mode &&
      sameAccount(pending.account, account)
    )
      return pending.promise;
    const sequence = ++revision;
    const promise = host
      .bootstrap(mode, account)
      .then((result) => {
        if (!host.current(account) || revision !== sequence)
          return failure("bootstrap", "session-changed");
        active = "kind" in result ? null : result;
        return result;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { mode, account, promise };
    return promise;
  }
  async function bootstrap(
    mode: BootstrapMode = "auto",
  ): Promise<PokemonBootstrapResult> {
    const account = host.account();
    if (!account) return failure("bootstrap", "session-required");
    const binding = await connect(mode, account);
    return "kind" in binding
      ? binding
      : { kind: "ready", session: binding.session };
  }
  async function execute<T>(
    endpoint: PokemonGroup,
    action: string,
    query: PokemonQuery,
    payload: PokemonData | undefined,
    decode: PokemonDecode<T>,
  ): Promise<PokemonResult<T>> {
    const operation = `${endpoint}/${action}`;
    if (
      ["id", "endpoint", "action"].some((name) => Object.hasOwn(query, name))
    ) {
      return failure(operation, "invalid-input");
    }
    const original = active;
    if (!original) return failure(operation, "session-required");
    if (!host.current(original.account)) {
      active = null;
      return failure(operation, "session-changed");
    }
    const url = pluginURL(options.origin, "pokemon:pokemon", {
      endpoint,
      action,
      ...query,
    });
    const write = payload !== undefined;
    const body = write ? JSON.stringify(payload) : undefined;
    const uncertain = () =>
      failure(operation, "uncertain", { message: unknownMessage });
    function invalidate(binding: Binding) {
      if (active === binding) active = null;
    }
    async function attempt(binding: Binding): Promise<PokemonResult<T>> {
      const headers = Object.freeze({
        "X-Pm-Formhash": binding.hash,
        ...(write && { "Content-Type": "application/json" }),
      });
      const reply = await host.request(url, binding.account, headers, body);
      if (reply.kind !== "reply")
        return write && reply.dispatched
          ? uncertain()
          : failure(operation, reply.kind);
      const { response } = reply;
      if (
        response.status >= 500 ||
        (response.status >= 300 && response.status < 400)
      )
        return write ? uncertain() : failure(operation, "invalid-response");
      if (response.status === 429) return failure(operation, "rate-limited");
      const envelope = jsonData(response.body);
      if ([401, 403].includes(response.status) && envelope?.success !== false) {
        invalidate(binding);
        return failure(operation, "refused", {
          code: 401,
          message: "The forum session needs login.",
        });
      }
      if (envelope?.success === false) {
        const code = integer(envelope.code, 0) ? envelope.code : undefined;
        if (code !== undefined && code >= 500 && write) return uncertain();
        if (
          code === 401 ||
          ([401, 403].includes(response.status) && code !== 419)
        )
          invalidate(binding);
        const message =
          typeof envelope.error === "string" && envelope.error.trim()
            ? envelope.error.replaceAll(binding.hash, "[redacted]")
            : "The game refused the operation.";
        return failure(operation, "refused", {
          ...(code !== undefined && { code }),
          message,
        });
      }
      if (
        response.status !== 200 ||
        envelope?.success !== true ||
        !Object.hasOwn(envelope, "data") ||
        (envelope.error !== undefined &&
          envelope.error !== null &&
          envelope.error !== "") ||
        (envelope.code !== undefined &&
          envelope.code !== null &&
          envelope.code !== 0)
      )
        return write ? uncertain() : failure(operation, "invalid-response");
      const data = envelope.data === null ? {} : dataObject(envelope.data);
      if (!data)
        return write ? uncertain() : failure(operation, "invalid-response");
      if (
        operation === "user/profile" &&
        integer(data.uid, 1) &&
        data.uid !== binding.session.uid
      ) {
        invalidate(binding);
        return failure(operation, "session-changed");
      }
      const decoded = decode(data, binding.session.uid);
      return decoded === null
        ? write
          ? uncertain()
          : failure(operation, "invalid-response")
        : { kind: "success", data: decoded };
    }
    const first = await attempt(original);
    if (first.kind === "success" || !needsRefresh(first)) return first;
    if (!host.current(original.account))
      return failure(operation, "session-changed");
    const replacement =
      active &&
      active !== original &&
      sameAccount(active.account, original.account)
        ? active
        : await connect("auto", original.account);
    if (!host.current(original.account))
      return failure(operation, "session-changed");
    if ("kind" in replacement || replacement.hash === original.hash) {
      invalidate(original);
      if (!("kind" in replacement)) invalidate(replacement);
      return first;
    }
    const last = await attempt(replacement);
    if (last.kind !== "success" && needsRefresh(last)) invalidate(replacement);
    return last;
  }
  return {
    bootstrap,
    read: <T>(
      endpoint: PokemonGroup,
      action: string,
      query: PokemonQuery,
      decode: PokemonDecode<T>,
    ) => execute(endpoint, action, query, undefined, decode),
    write: <T>(
      endpoint: PokemonGroup,
      action: string,
      query: PokemonQuery,
      body: PokemonData,
      decode: PokemonDecode<T>,
    ) => execute(endpoint, action, query, body, decode),
  };
}
