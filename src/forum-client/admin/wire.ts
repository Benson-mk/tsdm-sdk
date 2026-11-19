import { object, numericId, type NoticeSession } from "../notice-transport.js";
import { query } from "../posts/forms.js";
import { safeURL } from "../routes.js";
import type {
  AdminAccess,
  AdminAction,
  AdminClientOptions,
  AdminCredentials,
  AdminFailure,
  AdminLoginState,
  AdminSessionResult,
} from "./types.js";

export type Data = Record<string, unknown>;
export const actionNames = [
  "admincredit",
  "admingroup",
  "adminreport",
  "adminban",
] as const;
export const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
export const count = (value: unknown): value is number =>
  integer(value) && value >= 0;
export const flag = (value: unknown) => value === 1;
export const id = (value: unknown) => {
  const uid = numericId(value);
  return uid && /^[1-9]\d{0,17}$/.test(uid) ? uid : null;
};
const same = (a: NoticeSession, b: NoticeSession | null) =>
  a.memberId === b?.memberId && a.continuity === b.continuity;
const header = "X-Tsdmapp-Admin";
const invalid = { kind: "invalid-response" } as const;
const changed = { kind: "session-changed" } as const;
const no = { kind: "not-confirmed" } as const;
const denied = (code: string): AdminFailure => ({ kind: "refused", code });
const codes = new Set([
  "busy",
  "admin_off",
  "admin_noperm",
  "admin_login",
  "admin_locked",
  "admin_password",
  "admin_secques",
  "password",
  "secques",
  "login",
  "duplicate",
  "formhash",
  "uids",
  "uid",
  "users",
  "credits",
  "reason",
  "notify",
  "overflow",
  "groupid",
  "adminid",
  "expiry",
  "extgroupids",
  "extexpiry",
  "expgroupid",
  "expadminid",
  "ids",
  "msg",
  "clear",
  "ban",
  "bannew",
  "banexpirynew",
  "clear_start",
  "clear_stuck",
  "action",
  "off",
  "member",
  "not_found",
  "username",
  "opid",
  "limit",
  "reason_required",
  "nouser",
  "self",
  "founder_only",
  "founder",
  "group",
  "extgroup",
  "expgroup",
  "extgroups_toomany",
  "expgroup_same",
  "protected",
  "portal",
]);
const reasons = new Set([
  "perm",
  "allowpost",
  "uids",
  "cpaccess",
  "ip",
  "adminid",
  "protected",
  "portal",
  "self",
  "founder_only",
]);
export function reasonCode(value: unknown) {
  return typeof value === "string" && reasons.has(value) ? value : undefined;
}
export function loginState(value: unknown): AdminLoginState | null {
  const data = object(value);
  if (
    !data ||
    (data.locked !== 0 && data.locked !== 1) ||
    !count(data.retry_after) ||
    !count(data.tries_left) ||
    (data.secques !== 0 && data.secques !== 1)
  )
    return null;
  return Object.freeze({
    locked: flag(data.locked),
    retryAfter: data.retry_after,
    triesLeft: data.tries_left,
    securityQuestion: flag(data.secques),
  });
}
export function refusal(data: Data, status: number): AdminFailure {
  const raw = typeof data.error === "string" ? data.error : "";
  const code = codes.has(raw)
    ? raw
    : status === 429
      ? "busy"
      : status === 401
        ? "login"
        : status === 403
          ? "admin_noperm"
          : "forum-refusal";
  const why = reasonCode(data.why);
  const login = loginState(data.login);
  return {
    kind: "refused",
    code,
    ...(why && { why }),
    ...(count(data.retry_after) && { retryAfter: data.retry_after }),
    ...(login && { login }),
  };
}
interface Grant {
  secret: string;
  expiry: number;
  hardExpiry: number;
}
interface Authority {
  owner: NoticeSession;
  hash: string;
  access: AdminAccess | null;
  grant: Grant | null;
  lockedUntil: number;
}
export function createAdminWire(options: AdminClientOptions) {
  const origin = safeURL(options.origin);
  if (!origin || origin.origin !== options.origin)
    throw new TypeError("A canonical HTTPS forum origin is required.");
  const endpoint = new URL("/plugin.php", origin).href;
  const clock = () => options.now?.() ?? Date.now();
  let binding: Authority | null = null;
  let busy = false;
  function session() {
    const owner = options.session();
    return owner &&
      id(owner.memberId) === owner.memberId &&
      typeof owner.continuity === "string" &&
      owner.continuity
      ? Object.freeze({
          memberId: owner.memberId,
          continuity: owner.continuity,
        })
      : null;
  }
  function state(create = false) {
    const owner = session();
    if (binding && !same(binding.owner, owner)) {
      binding = null;
      if (!create) return changed;
    }
    if (!owner) return denied("member-session-required");
    if (!binding)
      binding = { owner, hash: "", access: null, grant: null, lockedUntil: 0 };
    if (binding.grant && clock() >= binding.grant.expiry) binding.grant = null;
    return binding;
  }
  async function exclusive<T>(
    run: () => Promise<T>,
  ): Promise<T | AdminFailure> {
    if (busy) return { kind: "in-flight" };
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  }
  function sessionWindow(data: Data, begin: number) {
    const details = object(data.session);
    if (!flag(details?.active)) return null;
    const ttl = count(details?.ttl) && details.ttl > 0 ? details.ttl : 0;
    const remaining =
      count(details?.expires) &&
      details.expires > 0 &&
      count(data.time) &&
      data.time > 0
        ? details.expires - data.time
        : ttl;
    const lifetime =
      count(details?.max) && details.max > 0 ? details.max : 7200;
    if (remaining <= 30) return null;
    return {
      expiry: begin + (Math.min(remaining, lifetime) - 30) * 1000,
      hardExpiry: begin + (lifetime - 30) * 1000,
    };
  }
  async function request(
    state: Authority,
    action: "status" | "admin" | AdminAction,
    params: Record<string, string>,
    form?: Record<string, string>,
    grant?: Grant,
  ) {
    const begin = clock();
    if (!same(state.owner, session())) {
      binding = null;
      return changed;
    }
    if (grant && begin >= grant.expiry) {
      state.grant = null;
      return denied("admin_login");
    }
    const url = query(endpoint, { id: "tsdmapp:api", action, ...params });
    const headers: Readonly<Record<string, string>> = Object.freeze(
      grant ? { [header]: grant.secret } : {},
    );
    let response;
    try {
      response = await options.transport.request(
        url,
        form
          ? {
              method: "POST",
              effect: true,
              headers,
              fresh: true,
              session: state.owner,
              body: new URLSearchParams({
                ...form,
                formhash: state.hash,
              }).toString(),
            }
          : {
              method: "GET",
              effect: false,
              headers,
              fresh: true,
              session: state.owner,
            },
      );
    } catch {
      if (!same(state.owner, session())) {
        binding = null;
        return changed;
      }
      if (form) state.hash = "";
      return { kind: "network" } as const;
    }
    if (!same(state.owner, session())) {
      binding = null;
      return changed;
    }
    if (response.url !== url || response.redirect !== "none") return invalid;
    let data: Data | null = null;
    if (/\bjson\b/i.test(response.contentType)) {
      try {
        data = object(JSON.parse(response.body));
      } catch {
        /* Invalid response. */
      }
    }
    if (!data) {
      if (form) state.hash = "";
      return invalid;
    }
    const uid = numericId(data.uid);
    if (uid !== state.owner.memberId) {
      if (
        uid === "0" &&
        data.ok === 0 &&
        ["admin_login", "login"].includes(String(data.error))
      ) {
        state.grant = null;
        state.hash = "";
        return refusal(data, response.status);
      }
      if (uid && uid !== "0") {
        binding = null;
        return changed;
      }
      if (
        !uid &&
        response.status === 429 &&
        data.ok === 0 &&
        data.error === "busy"
      )
        return refusal(data, response.status);
      return invalid;
    }
    if (data.ok !== 0 && (data.ok !== 1 || response.status !== 200))
      return invalid;
    if (
      typeof data.formhash === "string" &&
      /^[\w-]{1,128}$/.test(data.formhash)
    )
      state.hash = data.formhash;
    if (grant && state.grant === grant) {
      const window = sessionWindow(data, begin);
      if (window) grant.expiry = Math.min(window.expiry, grant.hardExpiry);
      else if (
        object(data.session)?.active === 0 ||
        object(data.session)?.active === 1
      )
        state.grant = null;
    }
    if (data.ok === 0) {
      if (data.error === "admin_login") state.grant = null;
      if (data.error === "formhash") state.hash = "";
      if (
        data.error === "admin_off" ||
        (data.error === "admin_noperm" &&
          !["perm", "allowpost"].includes(String(data.why)))
      ) {
        state.grant = null;
        state.access = null;
        state.hash = "";
      }
      return refusal(data, response.status);
    }
    return { kind: "answer" as const, data, begin };
  }
  async function discoverAdmin(): Promise<AdminAccess | AdminFailure> {
    return exclusive(async () => {
      const current = state(true);
      if ("kind" in current) return current;
      const status = await request(current, "status", {});
      if (status.kind !== "answer") return status;
      if (
        status.data.admin !== undefined &&
        status.data.admin !== 0 &&
        status.data.admin !== 1
      )
        return invalid;
      if (!flag(status.data.admin)) {
        current.grant = null;
        current.hash = "";
        const off: AdminAccess = Object.freeze({
          kind: "admin-access",
          enabled: false,
          eligible: false,
          founder: false,
          capabilities: Object.freeze({}),
          sessionActive: false,
          login: null,
        });
        current.access = off;
        return off;
      }
      const entry = await request(
        current,
        "admin",
        {},
        undefined,
        current.grant ?? undefined,
      );
      if (entry.kind !== "answer") return entry;
      const { data } = entry;
      if (
        data.type !== "admin" ||
        data.schema !== 25 ||
        data.header !== header ||
        ![0, 1].includes(data.enabled as number) ||
        ![0, 1].includes(data.eligible as number)
      )
        return invalid;
      const caps = object(data.actions);
      if (!caps && flag(data.eligible)) return invalid;
      const capabilities: Partial<
        Record<AdminAction, { read: boolean; write: boolean }>
      > = {};
      for (const action of actionNames) {
        const row = object(caps?.[action]);
        if (!row) continue;
        const read = flag(row.read);
        capabilities[action] = Object.freeze({
          read,
          write: read && flag(row.write),
        });
      }
      const enabled = flag(data.enabled);
      const eligible = enabled && flag(data.eligible);
      if (!eligible) current.grant = null;
      const why = reasonCode(data.why);
      const login = loginState(data.login);
      if (eligible && !login) return invalid;
      current.lockedUntil = login?.locked
        ? clock() + Math.max(1, login.retryAfter) * 1000
        : 0;
      const access: AdminAccess = Object.freeze({
        kind: "admin-access",
        enabled,
        eligible,
        founder: flag(data.founder),
        capabilities: Object.freeze(capabilities),
        sessionActive: Boolean(current.grant),
        login,
        ...(why && { why }),
      });
      current.access = access;
      return access;
    });
  }
  function openAdminSession(
    credentials: AdminCredentials,
    approved: boolean,
  ): Promise<AdminSessionResult> {
    if (approved !== true) return Promise.resolve(no);
    return exclusive(async () => {
      const current = state();
      if ("kind" in current) return current;
      if (!current.access) return denied("discover-required");
      if (!current.access.enabled || !current.access.eligible)
        return denied("admin_noperm");
      if (current.grant) return denied("admin-already-open");
      if (!current.hash) return denied("discover-required");
      const login = current.access.login;
      if (login && clock() < current.lockedUntil)
        return {
          kind: "refused" as const,
          code: "admin_locked",
          login,
          retryAfter: Math.ceil((current.lockedUntil - clock()) / 1000),
        };
      const question = credentials?.question;
      const secret = (value: unknown) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 512 &&
        !value.includes("\0");
      if (
        !secret(credentials?.password) ||
        (login?.securityQuestion && !question) ||
        (question !== undefined &&
          (!question ||
            !integer(question.id) ||
            question.id < 1 ||
            question.id > 7 ||
            !secret(question.answer)))
      )
        return { kind: "invalid-input" } as const;
      const reply = await request(
        current,
        "admin",
        {},
        {
          op: "login",
          password: credentials.password,
          ...(question && {
            questionid: String(question.id),
            answer: question.answer,
          }),
        },
      );
      if (reply.kind === "refused") {
        const served = reply.login ?? login;
        if (
          current.access &&
          served &&
          (reply.login ||
            reply.code === "admin_secques" ||
            reply.code === "admin_locked")
        ) {
          const locked = served.locked || reply.code === "admin_locked";
          const retryAfter = reply.retryAfter ?? served.retryAfter;
          const revised = Object.freeze({
            ...served,
            locked,
            retryAfter,
            securityQuestion:
              served.securityQuestion || reply.code === "admin_secques",
          });
          current.access = Object.freeze({ ...current.access, login: revised });
          current.lockedUntil = locked
            ? clock() + Math.max(1, retryAfter) * 1000
            : 0;
        }
        return reply;
      }
      if (reply.kind !== "answer")
        return { kind: "uncertain" as const, operation: "login" };
      const { data, begin } = reply;
      const window = sessionWindow(data, begin);
      if (
        data.type !== "admin" ||
        data.schema !== 25 ||
        data.op !== "login" ||
        data.header !== header ||
        !window ||
        typeof data.token !== "string" ||
        !/^[\x21-\x7e]{8,512}$/.test(data.token) ||
        clock() >= window.expiry
      )
        return { kind: "uncertain" as const, operation: "login" };
      current.grant = { secret: data.token, ...window };
      return { kind: "admin-opened" } as const;
    });
  }
  function closeAdminSession(approved: boolean): Promise<AdminSessionResult> {
    if (approved !== true) return Promise.resolve(no);
    return exclusive(async () => {
      const current = state();
      if ("kind" in current) return current;
      const grant = current.grant;
      current.grant = null;
      if (!grant) return { kind: "admin-closed" } as const;
      if (!current.hash) {
        const entry = await request(current, "admin", {}, undefined, grant);
        if (entry.kind === "refused" && entry.code === "admin_login")
          return { kind: "admin-closed" } as const;
        if (entry.kind !== "answer" || !current.hash)
          return { kind: "uncertain" as const, operation: "logout" };
      }
      const reply = await request(
        current,
        "admin",
        {},
        { op: "logout" },
        grant,
      );
      if (
        (reply.kind === "answer" &&
          reply.data.type === "admin" &&
          reply.data.op === "logout") ||
        (reply.kind === "refused" && reply.code === "admin_login")
      )
        return { kind: "admin-closed" } as const;
      if (reply.kind === "refused") return reply;
      return { kind: "uncertain" as const, operation: "logout" };
    });
  }
  return {
    state,
    request,
    exclusive,
    discoverAdmin,
    openAdminSession,
    closeAdminSession,
  };
}
