import {
  accountOpening,
  accountStep,
  methods,
  nativeChangeResult,
  nativeIdentity,
  operationURL,
  scripts,
  token,
  unwrap,
  type AccountStep,
} from "./account-forms.js";
import { attr, descendants, documentFrom, fragmentFrom } from "./html.js";
import type { HostResponse } from "../index.js";

export type AccountRequest = { fresh: true; session: string } & (
  | {
      method: "GET";
      effect: boolean;
      body?: never;
      headers?: Readonly<{ "X-Tsdmapp-Device": string }>;
    }
  | { method: "POST"; effect: true; body: string }
);

export interface AccountClientOptions {
  origin: string;
  /** Opaque, non-secret continuity identifier for the host's isolated cookie jar. */
  session(): string | null;
  transport: {
    request(url: string, request: AccountRequest): Promise<HostResponse>;
  };
}

export type SessionIdentity =
  { kind: "guest" } | { kind: "member"; id: string };
export type AccountFailure = {
  kind: "invalid" | "session-changed" | "unavailable" | "rate-limited";
};
export type LogoutResult =
  | AccountFailure
  | AccountEffectFailure
  | {
      kind: "signed-out" | "already-guest" | "unverified";
    };
export interface AccountStatus {
  kind: "status";
  identity: SessionIdentity;
  version: string;
  api: number;
  switches: Readonly<Partial<Record<string, boolean>>>;
  lists: Readonly<Partial<Record<string, readonly string[]>>>;
  checkin?: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    openNow: boolean;
  };
}

export interface StoredDeviceStatusInput {
  memberId: string;
  deviceId: string;
}

export type StoredDeviceStatusResult =
  | AccountFailure
  | (StoredDeviceStatusInput & { kind: "device-revoked" })
  | (AccountStatus & { identity: Extract<SessionIdentity, { kind: "member" }> });

export interface LoginForm {
  readonly kind: "login-form";
  readonly registration: string;
  readonly lostPassword: string;
  readonly needsVerificationImage: boolean;
}
export interface LoginCredentials {
  loginField: "username" | "email" | "uid";
  identifier: string;
  password: string;
  question?: { id: string; answer: string };
  verificationCode?: string;
}
export interface AccountBrowserHandoff {
  kind: "browser";
  reason: "login" | "other-check";
  destination: string;
}
export type AccountChange = "password" | "email" | "security-question";
export interface AccountChangeField {
  readonly name: string;
  readonly label: string;
  readonly obscure: boolean;
  readonly choices?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly initial?: string;
}
export interface AccountVerificationForm {
  readonly kind: "verify-password";
  readonly change: AccountChange;
}
export interface AccountChangeForm {
  readonly kind: "account-change-form";
  readonly change: AccountChange;
  readonly fields: readonly AccountChangeField[];
}

export type AccountChangeOpenResult =
  | AccountFailure
  | AccountEffectFailure
  | AccountBrowserHandoff
  | AccountVerificationForm
  | AccountChangeForm;
export type AccountChangeResult =
  AccountFailure | AccountEffectFailure | { kind: "changed" | "unverified" };
export type AccountEffectFailure = { kind: "uncertain" } | { kind: "refused" };
export type LoginResult =
  | AccountFailure
  | AccountEffectFailure
  | {
      kind: "signed-in";
      identity: { kind: "member"; id: string; name: string };
    };

const switches = [
  "nodoc",
  "write",
  "bbcode",
  "special",
  "postform",
  "preview",
  "postsource",
  "sync",
  "hongbao",
  "device",
  "comments",
  "recommend",
  "modcp_log",
  "admin",
  "modcp_report",
  "bggrant",
  "batchrate",
  "v4",
  "announce",
  "notify_paging",
  "achievement",
];
const lists = [
  "actions",
  "modcp_pages",
  "forms",
  "thread_lists",
  "modcp_pages_v4",
  "credit_pages",
  "block_pages",
  "space_pages",
  "task_pages",
  "magic_pages",
];

function json(body: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* Native responses have no JSON envelope. */
  }
  return {};
}

function uid(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
    ? value
    : null;
}

function flag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

export function createAccountClient({
  origin,
  session,
  transport,
}: AccountClientOptions) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.origin !== origin)
    throw new TypeError("Expected a canonical HTTPS origin.");
  const statusURL = new URL("/plugin.php?id=tsdmapp%3Aapi&action=status", base);

  async function request(
    url: URL,
    expected: string | null,
    effect = false,
    body?: URLSearchParams,
    deviceId?: string,
  ): Promise<AccountFailure | { kind: "response"; response: HostResponse }> {
    if (!expected || session() !== expected) return { kind: "session-changed" };
    try {
      const response = await transport.request(
        url.href,
        body === undefined
          ? {
              method: "GET",
              fresh: true,
              session: expected,
              effect,
              ...(deviceId && { headers: { "X-Tsdmapp-Device": deviceId } }),
            }
          : {
              method: "POST",
              fresh: true,
              session: expected,
              effect: true,
              body: body.toString(),
            },
      );
      if (session() !== expected) return { kind: "session-changed" };
      if (response.redirect !== "none" || response.url !== url.href)
        return { kind: "invalid" };
      return { kind: "response", response };
    } catch {
      return {
        kind: session() === expected ? "unavailable" : "session-changed",
      };
    }
  }

  function decodeStatus(
    response: HostResponse,
    data = json(response.body),
  ): AccountFailure | { public: AccountStatus; formHash: string } {
    if (response.status === 429 || (data.ok === 0 && data.error === "busy"))
      return { kind: "rate-limited" };
    if (response.status !== 200 || data.ok !== 1)
      return { kind: "unavailable" };
    const id = uid(data.uid);
    if (
      id === null ||
      typeof data.version !== "string" ||
      typeof data.api !== "number" ||
      !Number.isSafeInteger(data.api) ||
      data.api < 1
    )
      return { kind: "invalid" };
    const flags: Partial<Record<string, boolean>> = {};
    const advertised: Partial<Record<string, string[]>> = {};
    for (const key of switches)
      if (flag(data[key])) flags[key] = data[key] === 1;
    for (const key of lists) {
      const value = data[key];
      if (
        Array.isArray(value) &&
        value.every((item) => typeof item === "string")
      )
        advertised[key] = value;
    }
    const { enabled, start_hour, end_hour, open_now } = jsonObject(
      data.checkin,
    );
    const checkin =
      flag(enabled) &&
      flag(open_now) &&
      typeof start_hour === "number" &&
      typeof end_hour === "number"
        ? {
            enabled: enabled === 1,
            startHour: start_hour,
            endHour: end_hour,
            openNow: open_now === 1,
          }
        : undefined;
    return {
      public: {
        kind: "status",
        version: data.version,
        api: data.api,
        identity: id === "0" ? { kind: "guest" } : { kind: "member", id },
        switches: flags,
        lists: advertised,
        ...(checkin ? { checkin } : {}),
      },
      formHash: token(data.formhash),
    };
  }

  async function status(expected: string | null) {
    const result = await request(statusURL, expected);
    return result.kind === "response" ? decodeStatus(result.response) : result;
  }

  async function identity(
    expected: string | null,
    needsHash = false,
  ): Promise<AccountFailure | { identity: SessionIdentity; formHash: string }> {
    const served = await status(expected);
    if (
      "public" in served &&
      (!needsHash || served.formHash || served.public.identity.kind === "guest")
    ) {
      return { identity: served.public.identity, formHash: served.formHash };
    }
    if ("kind" in served && served.kind === "session-changed") return served;
    const page = await request(
      new URL("/home.php?mod=spacecp", base),
      expected,
    );
    if (page.kind === "response" && page.response.status === 200) {
      const doc = documentFrom(page.response.body);
      const id = nativeIdentity(page.response.body, base);
      if (id === "0" && !("public" in served))
        return { identity: { kind: "guest" }, formHash: "" };
      if (
        id &&
        id !== "0" &&
        (!("public" in served) ||
          (served.public.identity.kind === "member" &&
            served.public.identity.id === id))
      ) {
        const hashes = new Set(
          descendants(
            doc,
            (node) =>
              node.tagName === "input" && attr(node, "name") === "formhash",
          )
            .map((node) => token(attr(node, "value")))
            .filter(Boolean),
        );
        return {
          identity: { kind: "member", id },
          formHash: hashes.size === 1 ? [...hashes][0]! : "",
        };
      }
    }
    if (page.kind === "session-changed") return page;
    return "public" in served
      ? { identity: served.public.identity, formHash: "" }
      : served;
  }

  let logoutPending = false;
  const loginPage = new URL("/member.php?mod=logging&action=login", base);
  let loginGeneration = 0;
  let activeLogin:
    | {
        form: LoginForm;
        session: string;
        action: URL;
        hash: string;
        image: string;
      }
    | undefined;

  const center = new URL("/home.php?mod=spacecp&ac=account", base);
  type Pending = {
    session: string;
    memberId: string;
    change: AccountChange;
    form: Extract<AccountStep, { form: unknown }>["form"];
  };
  const verifications = new WeakMap<AccountVerificationForm, Pending>();
  const changes = new WeakMap<AccountChangeForm, Pending>();

  async function loadStep(
    url: URL,
    expected: string,
    change: AccountChange,
    signedFrom?: URL,
  ) {
    const loaded = await request(url, expected);
    if (loaded.kind !== "response") return loaded;
    if (loaded.response.status === 429)
      return { kind: "rate-limited" } as const;
    if (loaded.response.status !== 200) return { kind: "unavailable" } as const;
    return accountStep(loaded.response.body, base, methods[change], signedFrom);
  }

  function expose(
    step: AccountStep | AccountFailure,
    expected: string,
    memberId: string,
    change: AccountChange,
  ): AccountChangeOpenResult {
    if (session() !== expected) return { kind: "session-changed" };
    if (step.kind === "browser")
      return {
        kind: "browser",
        reason: "other-check",
        destination: center.href,
      };
    if (step.kind === "verify") {
      const view: AccountVerificationForm = Object.freeze({
        kind: "verify-password",
        change,
      });
      verifications.set(view, {
        session: expected,
        memberId,
        change,
        form: step.form,
      });
      return view;
    }
    if (step.kind === "change") {
      const fields = step.form.fields.map((field) =>
        Object.freeze({
          ...field,
          ...(field.choices
            ? {
                choices: Object.freeze(
                  field.choices.map((choice) => Object.freeze({ ...choice })),
                ),
              }
            : {}),
        }),
      );
      const view: AccountChangeForm = Object.freeze({
        kind: "account-change-form",
        change,
        fields: Object.freeze(fields),
      });
      changes.set(view, {
        session: expected,
        memberId,
        change,
        form: step.form,
      });
      return view;
    }
    if (step.kind === "signed" || step.kind === "password-choice")
      return { kind: "invalid" };
    return { kind: step.kind };
  }

  return {
    async openAccountChange(
      memberId: string,
      change: AccountChange,
    ): Promise<AccountChangeOpenResult> {
      const expected = session();
      if (
        !expected ||
        !uid(memberId) ||
        memberId === "0" ||
        !Object.hasOwn(methods, change)
      )
        return { kind: "invalid" };
      const overview = await request(center, expected);
      if (overview.kind !== "response") return overview;
      if (overview.response.status === 429) return { kind: "rate-limited" };
      if (overview.response.status !== 200) return { kind: "unavailable" };
      const target = accountOpening(
        overview.response.body,
        base,
        methods[change],
        memberId,
      );
      if (!target) return { kind: "invalid" };
      let step = await loadStep(target, expected, change);
      if (step.kind === "password-choice")
        step = await loadStep(step.url, expected, change);
      if (step.kind === "signed")
        step = await loadStep(step.url, expected, change, step.url);
      return expose(step, expected, memberId, change);
    },
    async verifyAccountChange(
      form: AccountVerificationForm,
      password: string,
    ): Promise<AccountChangeOpenResult> {
      const pending = verifications.get(form);
      if (!pending || !password) return { kind: "invalid" };
      if (session() !== pending.session) return { kind: "session-changed" };
      verifications.delete(form);
      const data = new URLSearchParams(pending.form.hidden);
      data.set("password", password);
      const result = await request(
        pending.form.action,
        pending.session,
        true,
        data,
      );
      if (result.kind !== "response" || result.response.status !== 200)
        return { kind: "uncertain" };
      const step = accountStep(
        result.response.body,
        base,
        methods[pending.change],
      );
      if (step.kind === "signed") {
        const loaded = await loadStep(
          step.url,
          pending.session,
          pending.change,
          step.url,
        );
        if (loaded.kind === "change")
          return expose(
            loaded,
            pending.session,
            pending.memberId,
            pending.change,
          );
        return { kind: "uncertain" };
      }
      if (
        step.kind === "refused" ||
        step.kind === "browser" ||
        step.kind === "change"
      )
        return expose(step, pending.session, pending.memberId, pending.change);
      return { kind: "uncertain" };
    },
    async submitAccountChange(
      form: AccountChangeForm,
      values: Readonly<Record<string, string>>,
    ): Promise<AccountChangeResult> {
      const pending = changes.get(form);
      if (!pending || Object.keys(values).length !== pending.form.fields.length)
        return { kind: "invalid" };
      if (session() !== pending.session) return { kind: "session-changed" };
      const data = new URLSearchParams(pending.form.hidden);
      for (const field of pending.form.fields) {
        const value = values[field.name];
        if (
          !Object.hasOwn(values, field.name) ||
          typeof value !== "string" ||
          (field.choices &&
            !field.choices.some((choice) => choice.value === value))
        )
          return { kind: "invalid" };
        data.set(field.name, value);
      }
      changes.delete(form);
      const action = new URL(pending.form.action);
      action.searchParams.set("tsdmapp", "json");
      const result = await request(action, pending.session, true, data);
      if (
        result.kind !== "response" ||
        result.response.status !== 200 ||
        session() !== pending.session
      )
        return { kind: "uncertain" };
      const { body } = result.response;
      const payload = json(body);
      if (
        payload.type === "result" &&
        payload.schema === 13 &&
        uid(payload.uid) === pending.memberId &&
        payload.login !== 1 &&
        flag(payload.ok)
      ) {
        if (payload.message_key === "account_change_success")
          return { kind: "changed" };
        if (
          payload.message_key === "profile_repasswd_illegal" ||
          (payload.alert === "error" &&
            (payload.kind === "handle" || payload.kind === "message") &&
            typeof payload.message === "string" &&
            payload.message.trim())
        )
          return { kind: "refused" };
        if (
          payload.kind === "page" &&
          typeof payload.document === "string" &&
          nativeChangeResult(payload.document) === "refused"
        )
          return { kind: "refused" };
        return { kind: "unverified" };
      }
      return {
        kind: Object.keys(payload).length
          ? "unverified"
          : nativeChangeResult(body),
      };
    },
    async readIdentity(): Promise<SessionIdentity | AccountFailure> {
      const result = await identity(session());
      return "identity" in result ? result.identity : result;
    },
    async logout(expectedMemberId: string): Promise<LogoutResult> {
      const expected = session();
      if (
        !expected ||
        !uid(expectedMemberId) ||
        expectedMemberId === "0" ||
        logoutPending
      )
        return { kind: "invalid" };
      logoutPending = true;
      try {
        const before = await identity(expected, true);
        if (!("identity" in before)) return before;
        if (before.identity.kind === "guest") return { kind: "already-guest" };
        if (before.identity.id !== expectedMemberId)
          return { kind: "session-changed" };
        if (!before.formHash) return { kind: "invalid" };
        const action = new URL("/member.php?mod=logging&action=logout", base);
        action.searchParams.set("formhash", before.formHash);
        const sent = await request(action, expected, true);
        if (sent.kind === "unavailable" || sent.kind === "session-changed")
          return { kind: "uncertain" };
        const after = await identity(expected);
        if ("kind" in after && after.kind === "session-changed")
          return { kind: "uncertain" };
        return {
          kind:
            "identity" in after && after.identity.kind === "guest"
              ? "signed-out"
              : "unverified",
        };
      } finally {
        logoutPending = false;
      }
    },
    async openLoginForm(): Promise<
      LoginForm | AccountBrowserHandoff | AccountFailure
    > {
      activeLogin = undefined;
      const generation = ++loginGeneration;
      const expected = session();
      const source = new URL(loginPage);
      source.search +=
        "&infloat=yes&handlekey=login&inajax=1&ajaxtarget=fwin_content_login";
      const result = await request(source, expected);
      if (result.kind !== "response") return result;
      if (!expected || session() !== expected || loginGeneration !== generation)
        return { kind: "session-changed" };
      if (result.response.status === 429) return { kind: "rate-limited" };
      const doc = fragmentFrom(unwrap(result.response.body));
      for (const form of descendants(
        doc,
        (node) => node.tagName === "form" && attr(node, "name") === "login",
      )) {
        const action = operationURL(attr(form, "action"), base, "/member.php", {
          mod: "logging",
          action: "login",
          loginsubmit: "yes",
          handlekey: "login",
        });
        const hash = token(input(form, "formhash"));
        if (
          result.response.status !== 200 ||
          attr(form, "method").toLowerCase() !== "post" ||
          !action ||
          !token(action.searchParams.get("loginhash")) ||
          !hash
        )
          continue;
        const image = input(form, "seccodehash");
        if (image !== undefined && !token(image)) continue;
        const loginHash = action.searchParams.get("loginhash")!;
        // Send only the documented login parameters, in the native AJAX mode.
        const destination = new URL(loginPage);
        destination.search +=
          "&loginsubmit=yes&handlekey=login&inajax=1&loginhash=" + loginHash;
        const registration = descendants(form, (node) => node.tagName === "a")
          .map((node) =>
            operationURL(attr(node, "href"), base, "/member.php", {}),
          )
          .find(
            (url) =>
              url?.searchParams.size === 1 &&
              token(url.searchParams.get("mod")) &&
              !["logging", "lostpasswd"].includes(url.searchParams.get("mod")!),
          );
        const publicForm: LoginForm = Object.freeze({
          kind: "login-form",
          registration: (
            registration ?? new URL("/member.php?mod=register", base)
          ).href,
          lostPassword: new URL("/member.php?mod=lostpasswd", base).href,
          needsVerificationImage: Boolean(image),
        });
        activeLogin = {
          form: publicForm,
          session: expected,
          action: destination,
          hash,
          image: image ?? "",
        };
        return publicForm;
      }
      return { kind: "browser", reason: "login", destination: loginPage.href };
    },
    loginVerificationImage(
      form: LoginForm,
    ):
      | AccountFailure
      | { kind: "no-image" }
      | { kind: "verification-image"; destination: string; session: string } {
      if (!activeLogin || activeLogin.form !== form) return { kind: "invalid" };
      if (activeLogin.session !== session()) return { kind: "session-changed" };
      if (!activeLogin.image) return { kind: "no-image" };
      const destination = new URL("/misc.php?mod=seccode", base);
      destination.searchParams.set("update", String(Date.now()));
      destination.searchParams.set("idhash", activeLogin.image);
      return {
        kind: "verification-image",
        destination: destination.href,
        session: activeLogin.session,
      };
    },
    async submitLogin(
      form: LoginForm,
      credentials: LoginCredentials,
    ): Promise<LoginResult> {
      const pending = activeLogin;
      if (!pending || pending.form !== form) return { kind: "invalid" };
      if (pending.session !== session()) return { kind: "session-changed" };
      if (
        !["username", "email", "uid"].includes(credentials.loginField) ||
        !credentials.identifier ||
        !credentials.password ||
        (pending.image && !credentials.verificationCode) ||
        (credentials.question &&
          (!/^[1-7]$/.test(credentials.question.id) ||
            !credentials.question.answer))
      )
        return { kind: "invalid" };
      activeLogin = undefined;
      const data = new URLSearchParams({
        formhash: pending.hash,
        referer: `${origin}/`,
        loginfield: credentials.loginField,
        username: credentials.identifier,
        password: credentials.password,
        questionid: credentials.question?.id ?? "0",
        answer: credentials.question?.answer ?? "",
        cookietime: "0",
        loginsubmit: "true",
      });
      if (pending.image) {
        data.set("seccodehash", pending.image);
        data.set("seccodemodid", "member::logging");
        data.set("seccodeverify", credentials.verificationCode!);
      }
      const result = await request(pending.action, pending.session, true, data);
      if (
        result.kind !== "response" ||
        result.response.status !== 200 ||
        session() !== pending.session
      )
        return { kind: "uncertain" };
      const code = scripts(result.response.body);
      const success =
        /\bsucceedhandle_login\(\s*'(?:[^'\\]|\\.)*',\s*'(?:[^'\\]|\\.)*',\s*\{([\s\S]*?)\}\s*\)/.exec(
          code,
        )?.[1];
      if (success) {
        const id = uid(/'uid'\s*:\s*'(\d+)'/.exec(success)?.[1]);
        const name = /'username'\s*:\s*'((?:[^'\\]|\\['"\\])+)'/
          .exec(success)?.[1]
          ?.replace(/\\(['"\\])/g, "$1");
        if (id && id !== "0" && name)
          return { kind: "signed-in", identity: { kind: "member", id, name } };
        return { kind: "uncertain" };
      }
      return {
        kind: /\berrorhandle_login\(\s*'/.test(code) ? "refused" : "uncertain",
      };
    },
    async readStatus(): Promise<AccountStatus | AccountFailure> {
      const result = await status(session());
      return "public" in result ? result.public : result;
    },
    async readStoredDeviceStatus({
      memberId,
      deviceId,
    }: StoredDeviceStatusInput): Promise<StoredDeviceStatusResult> {
      if (
        typeof memberId !== "string" ||
        !uid(memberId) ||
        memberId === "0" ||
        typeof deviceId !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deviceId)
      )
        return { kind: "invalid" };
      const result = await request(statusURL, session(), false, undefined, deviceId);
      if (result.kind !== "response") return result;
      const data = json(result.response.body);
      if (
        [200, 401, 403].includes(result.response.status) &&
        data.ok === 0 &&
        data.error === "device_revoked"
      ) {
        return uid(data.uid) === memberId &&
          typeof data.device === "string" &&
          data.device.toLowerCase() === deviceId
          ? { kind: "device-revoked", memberId, deviceId }
          : { kind: "invalid" };
      }
      const decoded = decodeStatus(result.response, data);
      if ("kind" in decoded) return decoded;
      const { identity } = decoded.public;
      return identity.kind === "member" && identity.id === memberId
        ? { ...decoded.public, identity }
        : { kind: "invalid" };
    },
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function input(
  form: Parameters<typeof descendants>[0],
  name: string,
): string | undefined {
  const matches = descendants(
    form,
    (node) => node.tagName === "input" && attr(node, "name") === name,
  );
  return matches.length === 1 && matches[0]
    ? attr(matches[0], "value")
    : undefined;
}
