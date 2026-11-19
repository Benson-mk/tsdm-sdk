import { selectV4, unsupportedV4 } from "./v4-selection.js";
import type { HostResponse } from "../index.js";
import type {
  AccountClientOptions,
  AccountFailure,
  AccountRequest,
} from "./account-client.js";
import {
  nativeIdentity,
  operationURL,
  scripts,
  token,
  unwrap,
} from "./account-forms.js";
import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  safeURL,
} from "./html.js";
import {
  nativeForm,
  privacyFilter,
  profileForm,
  profileTabs,
  record,
  settingsBody,
  type Fields,
  type Form,
} from "./profile-forms.js";

import {
  blacklistQuery,
  nativeBlacklist,
  structuredBlacklist,
} from "./profile-blacklist.js";

export type ProfileRequest = AccountRequest & {
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType?: string;
};
export interface BlacklistMember {
  id: string;
  name: string;
}

export interface ProfileClientOptions extends AccountClientOptions {
  transport: {
    request(url: string, request: ProfileRequest): Promise<HostResponse>;
  };
}
export type ProfileFailure =
  | AccountFailure
  | {
      kind: "refused";
      reason: string;
    }
  | { kind: "unsupported" | "login-required" | "uncertain" | "unverified" };

export type PrivacyTab = "base" | "feed" | "other" | "filter";
export type SettingsField = {
  readonly name: string;
  readonly label: string;
} & (
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "choice";
      readonly value: string;
      readonly choices: readonly {
        readonly value: string;
        readonly label: string;
      }[];
    }
  | {
      readonly kind: "toggle";
      readonly value: boolean;
      readonly checkedValue: string;
    }
);
export interface SettingsEditor {
  readonly kind: "profile" | "signature" | "privacy";
  readonly memberId: string;
  readonly tab: string;
  readonly fields: readonly SettingsField[];
}

export interface AvatarSettings {
  readonly kind: "avatar";
  readonly memberId: string;
  readonly currentUrl: string | null;
  readonly externalUrl: string | null;
  readonly uploadAvailable: boolean;
}
export interface AvatarUploadHandoff {
  readonly kind: "avatar-upload";
  readonly destination: string;
  readonly memberId: string;
  readonly session: string;
  readonly method: "POST";
  readonly contentType: "application/x-www-form-urlencoded";
  readonly fields: readonly ["avatar1", "avatar2", "avatar3"];
}

export interface ForumSyncDocument {
  readonly kind: "sync-document";
  readonly memberId: string;
  readonly updated: number;
  readonly data: string | null;
  readonly maxBytes: number | null;
}

export interface ForumDevice {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  firstSeen: number;
  lastSeen: number;
  revoked: boolean;
  revokedAt: number;
  notified: boolean;
  current: boolean;
}
export interface RegisterForumDevice {
  id: string;
  platform: string;
  appVersion: string;
  name?: string;
}

function json(body: string) {
  try {
    return record(JSON.parse(body));
  } catch {
    return {};
  }
}
function memberId(value: unknown): string | null {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return typeof id === "string" && /^[1-9]\d*$/.test(id) ? id : null;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function flag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}
function deviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
  );
}
function device(value: unknown): ForumDevice | null {
  const row = record(value);
  if (
    !deviceId(row.device) ||
    typeof row.name !== "string" ||
    typeof row.platform !== "string" ||
    typeof row.app_version !== "string" ||
    !count(row.first_seen) ||
    !count(row.last_seen) ||
    !count(row.revoked_at) ||
    !flag(row.revoked) ||
    !flag(row.notified) ||
    !flag(row.current)
  )
    return null;
  return {
    id: row.device,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    revoked: row.revoked === 1,
    revokedAt: row.revoked_at,
    notified: row.notified === 1,
    current: row.current === 1,
  };
}
function pluginProblem(
  data: Record<string, unknown>,
  status: number,
): ProfileFailure | undefined {
  if (status === 429 || (data.ok === 0 && data.error === "busy"))
    return { kind: "rate-limited" };
  if (data.ok === 0 && data.error === "login")
    return { kind: "login-required" };
  if (
    (data.ok === 0 && data.error === "action") ||
    (data.ok === 1 && data.supported === 0)
  )
    return { kind: "unsupported" };
  if (
    data.ok === 0 &&
    typeof data.error === "string" &&
    /^[a-z_]+$/.test(data.error)
  )
    return { kind: "refused", reason: data.error };
}

function multipart(fields: Fields) {
  const boundary = `tsdm-sdk-${crypto.randomUUID()}`;
  const sections = fields.map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: sections.join("") + `--${boundary}--\r\n`,
  };
}
function parameters(url: URL, values: Record<string, string>): URL {
  const copy = new URL(url);
  for (const [key, value] of Object.entries(values))
    copy.searchParams.set(key, value);
  return copy;
}
function writeOutcome(
  response: HostResponse,
  member: string,
  privacy: boolean,
): ProfileFailure | { kind: "saved" } {
  const data = json(response.body);
  if (data.uid !== undefined && memberId(data.uid) !== member)
    return { kind: "uncertain" };
  if (response.status === 429) return { kind: "rate-limited" };
  if (response.status !== 200) return { kind: "unverified" };
  if (data.login === 1 || data.error === "login")
    return { kind: "login-required" };
  const wrapped = data.type === "result" && data.schema === 13;
  const native = Object.keys(data).length === 0;
  const body = native
    ? response.body
    : typeof data.document === "string"
      ? data.document
      : "";
  const script = scripts(body);
  const error = /\bparent\.show_error\(\s*['"]([\w[\]]+)['"]/.exec(script)?.[1];
  if (error) return { kind: "refused", reason: error };
  if (wrapped && (data.alert === "error" || data.error === "refused"))
    return { kind: "refused", reason: "forum" };
  if (data.type === "form" || (data.type === "privacy_filter" && !wrapped))
    return { kind: "refused", reason: "redrawn-form" };
  if (
    wrapped &&
    data.ok === 1 &&
    (privacy
      ? data.message_key === "do_success"
      : (data.kind === "message" && data.alert === "right") ||
        (data.kind === "page" && /\bparent\.show_success\(/.test(script)))
  )
    return { kind: "saved" };
  if (
    native &&
    ((!privacy && /\bparent\.show_success\(/.test(script)) ||
      (privacy &&
        descendants(
          documentFrom(unwrap(body)),
          (node) =>
            attr(node, "id") === "messagetext" && hasClass(node, "alert_right"),
        ).length))
  )
    return { kind: "saved" };
  return { kind: "unverified" };
}

export function createProfileClient({
  origin,
  session,
  transport,
}: ProfileClientOptions) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.origin !== origin)
    throw new TypeError("Expected a canonical HTTPS origin.");
  const plugin = (action: string) =>
    new URL(`/plugin.php?id=tsdmapp%3Aapi&action=${action}`, base);
  function scope(member: string) {
    const continuity = session();
    return memberId(member) && continuity ? { member, continuity } : null;
  }
  type Scope = NonNullable<ReturnType<typeof scope>>;
  async function exchange(
    url: URL,
    active: Scope,
    post?: {
      body: string;
      contentType?: string;
      headers?: Readonly<Record<string, string>>;
    },
  ): Promise<ProfileFailure | { kind: "response"; response: HostResponse }> {
    if (session() !== active.continuity) return { kind: "session-changed" };
    try {
      const response = await transport.request(
        url.href,
        post
          ? {
              method: "POST",
              effect: true,
              fresh: true,
              session: active.continuity,
              ...post,
            }
          : {
              method: "GET",
              effect: false,
              fresh: true,
              session: active.continuity,
            },
      );
      if (session() !== active.continuity)
        return { kind: post ? "uncertain" : "session-changed" };
      if (response.redirect !== "none" || response.url !== url.href)
        return { kind: post ? "unverified" : "invalid" };
      return { kind: "response", response };
    } catch {
      return {
        kind: post
          ? "uncertain"
          : session() === active.continuity
            ? "unavailable"
            : "session-changed",
      };
    }
  }
  async function pluginRead(action: string, active: Scope) {
    const received = await exchange(plugin(action), active);
    if (received.kind !== "response") return received;
    const { response } = received;
    const data = json(response.body);
    if (data.uid !== undefined && memberId(data.uid) !== active.member)
      return {
        kind: data.uid === 0 ? "login-required" : "session-changed",
      } as const;
    const problem = pluginProblem(data, response.status);
    if (problem) return problem;
    if (response.status !== 200 || data.ok !== 1)
      return { kind: "unavailable" } as const;
    if (memberId(data.uid) !== active.member)
      return { kind: "invalid" } as const;
    return { kind: "data", data } as const;
  }
  async function deviceList(active: Scope) {
    const result = await pluginRead("device", active);
    if (result.kind !== "data") return result;
    const { data } = result;
    if (
      data.type !== "devices" ||
      data.schema !== 20 ||
      data.supported !== 1 ||
      !Array.isArray(data.devices) ||
      !count(data.max) ||
      !(data.current === "" || deviceId(data.current))
    )
      return { kind: "invalid" } as const;
    const devices: ForumDevice[] = [];
    for (const value of data.devices) {
      const row = device(value);
      if (!row || devices.some((item) => item.id === row.id))
        return { kind: "invalid" } as const;
      devices.push(row);
    }
    return {
      kind: "list",
      devices,
      current: data.current || null,
      limit: data.max,
      hash: token(data.formhash),
    } as const;
  }
  async function writeDevice(
    active: Scope,
    op: "register" | "revoke" | "remove",
    id: string,
    hash: string,
    registration?: RegisterForumDevice,
  ) {
    if (!hash) return { kind: "invalid" } as const;
    const fields = new URLSearchParams({ formhash: hash, op, device: id });
    if (registration) {
      fields.set("platform", registration.platform);
      fields.set("app_version", registration.appVersion);
      if (registration.name) fields.set("name", registration.name);
    }
    const result = await exchange(plugin("device"), active, {
      body: fields.toString(),
      ...(registration ? { headers: { "X-Tsdmapp-Device": id } } : {}),
    });
    if (result.kind !== "response") return result;
    const { response } = result;
    const data = json(response.body);
    if (data.uid !== undefined && memberId(data.uid) !== active.member)
      return { kind: "uncertain" } as const;
    const problem = pluginProblem(data, response.status);
    if (problem) return problem;
    if (
      response.status !== 200 ||
      data.ok !== 1 ||
      memberId(data.uid) !== active.member ||
      data.type !== "devices" ||
      data.schema !== 20 ||
      data.supported !== 1 ||
      data.op !== op
    )
      return { kind: "unverified" } as const;
    if (op === "remove")
      return data.removed === id
        ? ({ kind: "removed", id } as const)
        : ({ kind: "unverified" } as const);
    const row = device(data.device);
    if (!row || row.id !== id || row.revoked !== (op === "revoke"))
      return { kind: "unverified" } as const;
    if (op === "revoke") return { kind: "revoked", device: row } as const;
    if (!flag(data.created)) return { kind: "unverified" } as const;
    return {
      kind: "registered",
      device: row,
      created: data.created === 1,
    } as const;
  }
  async function changeDevice(
    member: string,
    id: string,
    op: "revoke" | "remove",
  ) {
    const active = scope(member);
    if (!active || !deviceId(id)) return { kind: "invalid" } as const;
    const list = await deviceList(active);
    if (list.kind !== "list") return list;
    if (!list.devices.some((row) => row.id === id))
      return { kind: "refused", reason: "nodevice" } as const;
    return writeDevice(active, op, id, list.hash);
  }
  const home = (ac: string, op?: string) =>
    parameters(new URL("/home.php?mod=spacecp", base), {
      ac,
      ...(op ? { op } : {}),
    });
  const structured = { tsdmapp: "json", tsdmform: "1", nodoc: "1" };
  const v4 = { tsdmapp: "json", tsdmv: "4", nodoc: "1" };
  const editors = new WeakMap<SettingsEditor, { active: Scope; form: Form }>();
  function expose(
    form: Form,
    active: Scope,
    kind: SettingsEditor["kind"],
  ): SettingsEditor | ProfileFailure {
    const fields = form.groups.flat();
    const names = [
      ...form.fixed.map((pair) => pair[0]),
      ...fields.map((field) => field.name),
    ];
    if (
      new Set(names).size !== names.length ||
      form.fixed.some(([name]) => !/^[\w[\]]+$/.test(name))
    )
      return { kind: "unsupported" };
    const editor: SettingsEditor = Object.freeze({
      kind,
      memberId: active.member,
      tab: form.action.searchParams.get("op") ?? "",
      fields: structuredClone(fields),
    });
    editors.set(editor, { active, form });
    return editor;
  }
  async function page(url: URL, active: Scope) {
    const result = await exchange(url, active);
    if (result.kind !== "response") return result;
    const { response } = result;
    const data = json(response.body);
    if (response.status === 429 || data.error === "busy")
      return { kind: "rate-limited" } as const;
    if (response.status === 401) return { kind: "login-required" } as const;
    if (response.status === 403)
      return { kind: "refused", reason: "forum" } as const;
    if (response.status !== 200) return { kind: "unavailable" } as const;
    if (
      data.uid === 0 ||
      data.uid === "0" ||
      data.login === 1 ||
      data.error === "login"
    )
      return { kind: "login-required" } as const;
    if (data.uid !== undefined && memberId(data.uid) !== active.member)
      return { kind: "session-changed" } as const;
    if (
      data.type === "message" ||
      (data.ok === 0 && data.error !== undefined && !unsupportedV4(data))
    )
      return { kind: "refused", reason: "forum" } as const;
    const html =
      typeof data.document === "string"
        ? unwrap(data.document)
        : unwrap(response.body);
    const viewer = nativeIdentity(html, base);
    if (viewer === "0") return { kind: "login-required" } as const;
    if (viewer && viewer !== active.member)
      return { kind: "session-changed" } as const;
    return {
      kind: "page",
      data: memberId(data.uid) === active.member ? data : {},
      doc: viewer === active.member ? documentFrom(html) : null,
      html,
    } as const;
  }
  async function blockCapability(
    active: Scope,
    name: "privacy_filter" | "blockuser",
  ) {
    const url = plugin("status");
    const status = await exchange(url, active);
    if (status.kind !== "response") return status;
    const data = json(status.response.body);
    if (
      data.login === 1 ||
      data.error === "login" ||
      data.uid === 0 ||
      data.uid === "0" ||
      status.response.status === 401
    )
      return { kind: "login-required" } as const;
    if (
      status.response.status === 403 ||
      (data.ok === 0 && data.error !== "busy" && !unsupportedV4(data))
    )
      return { kind: "refused", reason: "forum" } as const;
    if (data.uid !== undefined && memberId(data.uid) !== active.member)
      return { kind: "session-changed" } as const;
    const selection = selectV4(
      status.response,
      url.href,
      "block_pages",
      name,
      active.member,
    );
    return selection.kind === "limited"
      ? ({ kind: "rate-limited" } as const)
      : selection;
  }
  async function openEditor(
    active: Scope,
    kind: SettingsEditor["kind"],
    requested?: string,
  ) {
    const privacy = kind === "privacy";
    const ac = privacy ? "privacy" : "profile";
    const wanted = kind === "signature";
    const queue: (string | undefined)[] = [requested];
    const seen = new Set<string>();
    while (queue.length) {
      const op = queue.shift();
      if (op && seen.has(op)) continue;
      const dest = home(ac, op);
      const capability =
        privacy && op === "filter"
          ? await blockCapability(active, "privacy_filter")
          : null;
      if (
        capability &&
        capability.kind !== "legacy" &&
        capability.kind !== "v4"
      )
        return capability;
      const flags = privacy
        ? capability?.kind === "v4"
          ? v4
          : null
        : structured;
      let result = await page(flags ? parameters(dest, flags) : dest, active);
      if (result.kind !== "page") return result;
      let form = privacy
        ? flags
          ? privacyFilter(result.data, base)
          : null
        : profileForm(result.data, base, wanted);
      if (form && op && form.action.searchParams.get("op") !== op)
        return { kind: "invalid" } as const;
      if (form) return expose(form, active, kind);
      const suppliedTab =
        typeof result.data.op === "string" ? result.data.op : "";
      const advertised = Array.isArray(result.data.ops)
        ? result.data.ops.map((value) => record(value).op)
        : [];
      const structuredTabs =
        wanted &&
        suppliedTab &&
        result.data.type === "form" &&
        result.data.form === "profile" &&
        result.data.schema === 17;
      if (structuredTabs) {
        seen.add(suppliedTab);
      } else if (!result.doc && flags) {
        result = await page(dest, active);
        if (result.kind !== "page") return result;
      }
      if (result.doc) {
        form = nativeForm(result.doc, base, ac, op) ?? null;
        const tab = form?.action.searchParams.get("op");
        if (tab) seen.add(tab);
        if (wanted && form) {
          form.groups = form.groups.filter(
            (group) => group[0]?.name === "sightml",
          );
          if (form.groups.length) return expose(form, active, kind);
        } else if (form) return expose(form, active, kind);
        if (wanted) {
          for (const link of descendants(
            result.doc,
            (node) => node.tagName === "a",
          )) {
            const url = operationURL(attr(link, "href"), base, "/home.php", {
              mod: "spacecp",
              ac: "profile",
            });
            if (url) advertised.push(url.searchParams.get("op"));
          }
        }
      }
      if (op) seen.add(op);
      if (wanted)
        queue.push(
          ...profileTabs.filter(
            (tab) =>
              advertised.includes(tab) &&
              !seen.has(tab) &&
              !queue.includes(tab),
          ),
        );
    }
    return { kind: "unsupported" } as const;
  }
  async function submitForm(form: Form, fields: Fields, active: Scope) {
    const url =
      form.representation === "v4"
        ? parameters(form.action, { tsdmapp: "json", tsdmv: "4" })
        : form.representation === "structured" || !form.multipart
          ? parameters(form.action, { tsdmapp: "json" })
          : form.action;
    return exchange(
      url,
      active,
      form.multipart
        ? multipart(fields)
        : { body: new URLSearchParams(fields).toString() },
    );
  }
  const avatarPages = new WeakMap<
    AvatarSettings,
    { active: Scope; form: Form | null; destination: string | null }
  >();
  async function avatarPage(
    active: Scope,
  ): Promise<AvatarSettings | ProfileFailure> {
    const dest = home("avatar");
    const result = await page(dest, active);
    if (result.kind !== "page") return result;
    if (!result.doc) return { kind: "invalid" };
    const avatar = byId(result.doc, "avatarform");
    const head = nativeForm(result.doc, base, "avatar");
    const field = head?.groups
      .flat()
      .find((item) => item.name === "headedit" && item.kind === "text");
    if (!avatar && !field) return { kind: "unsupported" };
    const images = avatar
      ? descendants(avatar, (node) => node.tagName === "img")
      : [];
    const image =
      images.find(
        (node) => hasClass(node, "_avt") || hasClass(node, "user_avatar"),
      ) ?? images[0];
    const editor = byId(result.doc, "avatardesigner");
    const code = /\bvar\s+data\s*=\s*"([^"]*)"\s*\.split\(\s*['"],['"]\s*\)/
      .exec(scripts(result.html))?.[1]
      ?.split(",");
    const index = code?.indexOf("stl_src") ?? -1;
    const offered =
      editor && index >= 0 ? safeURL(code?.[index + 1] ?? "", dest.href) : null;
    const upload = offered ? new URL(offered) : null;
    const destination =
      upload?.protocol === "https:" &&
      !upload.hash &&
      upload.searchParams.getAll("a").length === 1 &&
      upload.searchParams.get("a") === "rectavatar" &&
      upload.searchParams.get("input")
        ? upload.href
        : null;
    const view: AvatarSettings = Object.freeze({
      kind: "avatar",
      memberId: active.member,
      currentUrl: image
        ? safeURL(attr(image, "data-src") || attr(image, "src"), dest.href)
        : null,
      externalUrl: typeof field?.value === "string" ? field.value : null,
      uploadAvailable: Boolean(destination),
    });
    avatarPages.set(view, { active, form: field ? head : null, destination });
    return view;
  }
  const blacklistURL = new URL("/home.php", base);
  blacklistURL.search = new URLSearchParams(blacklistQuery).toString();
  async function blacklist(
    active: Scope,
    target?: string,
    checkCapability = true,
  ) {
    const url = target
      ? parameters(blacklistURL, { bu_q: target })
      : blacklistURL;
    const capability = checkCapability
      ? await blockCapability(active, "blockuser")
      : null;
    if (
      capability &&
      capability.kind !== "legacy" &&
      capability.kind !== "v4"
    )
      return capability;
    const useV4 = capability?.kind === "v4";
    let result = await page(useV4 ? parameters(url, v4) : url, active);
    if (result.kind !== "page") return result;
    if (
      useV4 &&
      result.data.type === "blockuser" &&
      result.data.schema === 56
    ) {
      const parsed = structuredBlacklist(
        result.data,
        base,
        active.member,
        target,
      );
      return parsed
        ? ({ kind: "list", ...parsed } as const)
        : ({ kind: "invalid" } as const);
    }
    let parsed =
      result.doc &&
      nativeBlacklist(result.doc, result.html, base, active.member, target);
    if (!parsed && useV4) {
      result = await page(url, active);
      if (result.kind !== "page") return result;
      parsed =
        result.doc &&
        nativeBlacklist(result.doc, result.html, base, active.member, target);
    }
    return parsed
      ? ({ kind: "list", ...parsed } as const)
      : ({ kind: "unsupported" } as const);
  }
  async function changeBlacklist(
    member: string,
    target: string,
    name?: string,
  ) {
    const active = scope(member);
    if (!active || !memberId(target) || member === target)
      return { kind: "invalid" } as const;
    const add = name !== undefined;
    const before = await blacklist(active, add ? target : undefined);
    if (before.kind !== "list") return before;
    if (before.lookupError && before.lookupError !== "dup")
      return { kind: "refused", reason: before.lookupError } as const;
    const listed = before.members.find((item) => item.id === target);
    if (add && (!before.lookup || before.lookup.name !== name))
      return { kind: "invalid" } as const;
    if (add ? Boolean(listed) : !listed && before.complete)
      return { kind: "already-applied", memberId: target } as const;
    const form = add ? before.add : before.remove.get(target);
    if (!form) return { kind: "unsupported" } as const;
    const action = before.structured
      ? parameters(form.action, { tsdmapp: "json", tsdmv: "4" })
      : form.action;
    const sent = await exchange(action, active, {
      body: new URLSearchParams(form.fields).toString(),
    });
    if (sent.kind === "session-changed") return sent;
    if (session() !== active.continuity) return { kind: "uncertain" } as const;
    let refused: ProfileFailure | undefined;
    if (sent.kind === "response") {
      const data = json(sent.response.body);
      if (data.uid !== undefined && memberId(data.uid) !== member)
        return { kind: "uncertain" } as const;
      const error = record(data.error).code;
      if (
        data.type === "blockuser" &&
        data.schema === 56 &&
        typeof error === "string" &&
        /^[a-z_]+$/.test(error) &&
        error !== "dup"
      )
        refused = { kind: "refused", reason: error };
      else {
        const outcome = writeOutcome(sent.response, member, false);
        if (
          ["refused", "login-required", "rate-limited"].includes(outcome.kind)
        )
          refused = outcome as ProfileFailure;
      }
    }
    const after = await blacklist(active, undefined, before.structured);
    if (after.kind === "session-changed" || session() !== active.continuity)
      return { kind: "uncertain" } as const;
    const matches =
      after.kind === "list" &&
      (add
        ? after.members.some((item) => item.id === target)
        : after.complete && !after.members.some((item) => item.id === target));
    if (refused) return matches ? ({ kind: "uncertain" } as const) : refused;
    return matches
      ? ({ kind: "confirmed", memberId: target } as const)
      : ({ kind: "uncertain" } as const);
  }
  const snapshots = new WeakMap<
    ForumSyncDocument,
    { active: Scope; hash: string }
  >();
  return {
    async listBlacklist(member: string) {
      const active = scope(member);
      if (!active) return { kind: "invalid" } as const;
      const result = await blacklist(active);
      if (result.kind !== "list") return result;
      const { members, complete, count, limit } = result;
      return { kind: "blacklist", members, complete, count, limit } as const;
    },
    async lookupBlacklistMember(member: string, target: string) {
      const active = scope(member);
      if (!active || !memberId(target) || member === target)
        return { kind: "invalid" } as const;
      const result = await blacklist(active, target);
      if (result.kind !== "list") return result;
      if (
        result.lookupError &&
        !["dup", "notfound"].includes(result.lookupError)
      )
        return { kind: "refused", reason: result.lookupError } as const;
      if (!result.lookup) return { kind: "not-found" } as const;
      return {
        kind: "blacklist-member",
        ...result.lookup,
        alreadyListed: result.members.some((row) => row.id === target),
        canAdd: Boolean(result.add),
      } as const;
    },
    addToBlacklist(member: string, target: string, name: string) {
      if (typeof name !== "string" || !name.trim())
        return Promise.resolve({ kind: "invalid" } as const);
      return changeBlacklist(member, target, name);
    },
    removeFromBlacklist(member: string, target: string) {
      return changeBlacklist(member, target);
    },
    openAvatar(member: string) {
      const active = scope(member);
      return active
        ? avatarPage(active)
        : Promise.resolve({ kind: "invalid" } as const);
    },
    prepareAvatarUpload(
      avatar: AvatarSettings,
    ): AvatarUploadHandoff | ProfileFailure {
      const pending = avatarPages.get(avatar);
      if (!pending) return { kind: "invalid" };
      if (session() !== pending.active.continuity)
        return { kind: "session-changed" };
      if (!pending.destination) return { kind: "unsupported" };
      avatarPages.delete(avatar);
      return {
        kind: "avatar-upload",
        destination: pending.destination,
        memberId: pending.active.member,
        session: pending.active.continuity,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        fields: ["avatar1", "avatar2", "avatar3"],
      };
    },
    async setAvatarUrl(avatar: AvatarSettings, url: string) {
      const pending = avatarPages.get(avatar);
      if (!pending) return { kind: "invalid" } as const;
      if (session() !== pending.active.continuity)
        return { kind: "session-changed" } as const;
      if (!pending.form) return { kind: "unsupported" } as const;
      if (
        typeof url !== "string" ||
        (url !== "" && (!/^https?:\/\//i.test(url) || !safeURL(url, origin)))
      )
        return { kind: "invalid" } as const;
      if (avatar.externalUrl === url) return { kind: "already-set" } as const;
      avatarPages.delete(avatar);
      const fields = new URLSearchParams([
        ...pending.form.fixed,
        ["headedit", url],
      ]);
      const sent = await exchange(pending.form.action, pending.active, {
        body: fields.toString(),
      });
      if (sent.kind !== "response" && sent.kind !== "unverified") return sent;
      if (sent.kind === "response") {
        const outcome = writeOutcome(
          sent.response,
          pending.active.member,
          true,
        );
        if (
          ["refused", "rate-limited", "login-required", "uncertain"].includes(
            outcome.kind,
          )
        )
          return outcome;
      }
      const after = await avatarPage(pending.active);
      if (after.kind === "session-changed")
        return { kind: "uncertain" } as const;
      return {
        kind:
          after.kind === "avatar" && after.externalUrl === url
            ? "saved"
            : "unverified",
      } as const;
    },
    openProfile(
      member: string,
      tab?: "base" | "info" | "contact" | "edu" | "work",
    ) {
      const active = scope(member);
      return active && (!tab || profileTabs.includes(tab))
        ? openEditor(active, "profile", tab)
        : Promise.resolve({ kind: "invalid" } as const);
    },
    openSignature(member: string) {
      const active = scope(member);
      return active
        ? openEditor(active, "signature")
        : Promise.resolve({ kind: "invalid" } as const);
    },
    openPrivacy(member: string, tab: PrivacyTab) {
      const active = scope(member);
      return active && ["base", "feed", "other", "filter"].includes(tab)
        ? openEditor(active, "privacy", tab)
        : Promise.resolve({ kind: "invalid" } as const);
    },
    async saveSettings(
      editor: SettingsEditor,
      changes: Readonly<Record<string, string | boolean>>,
    ) {
      const pending = editors.get(editor);
      if (!pending) return { kind: "invalid" } as const;
      if (session() !== pending.active.continuity)
        return { kind: "session-changed" } as const;
      const privacy = editor.kind === "privacy";
      const updates = { ...changes };
      const fields = settingsBody(pending.form, updates, privacy);
      if (!fields) return { kind: "invalid" } as const;
      editors.delete(editor);
      const result = await submitForm(pending.form, fields, pending.active);
      const outcome =
        result.kind === "response"
          ? writeOutcome(result.response, pending.active.member, privacy)
          : result;
      if (!privacy || outcome.kind !== "unverified") return outcome;
      const requested = Object.entries(updates);
      const initial = pending.form.groups.flat();
      if (
        !requested.some(
          ([name, value]) =>
            initial.find((field) => field.name === name)?.value !== value,
        )
      )
        return outcome;
      const after = await openEditor(pending.active, "privacy", editor.tab);
      if (after.kind === "session-changed")
        return { kind: "uncertain" } as const;
      return after.kind === "privacy" &&
        requested.every(
          ([name, value]) =>
            after.fields.find((field) => field.name === name)?.value === value,
        )
        ? ({ kind: "saved" } as const)
        : outcome;
    },
    async downloadSync(
      member: string,
    ): Promise<ProfileFailure | ForumSyncDocument> {
      const active = scope(member);
      if (!active) return { kind: "invalid" };
      const result = await pluginRead("sync", active);
      if (result.kind !== "data") return result;
      const { data } = result;
      if (
        data.supported !== 1 ||
        !count(data.updated) ||
        !(data.data === null || typeof data.data === "string")
      )
        return { kind: "invalid" };
      const snapshot: ForumSyncDocument = Object.freeze({
        kind: "sync-document",
        memberId: member,
        updated: data.updated,
        data: data.data,
        maxBytes: count(data.max_bytes) ? data.max_bytes : null,
      });
      snapshots.set(snapshot, { active, hash: token(data.formhash) });
      return snapshot;
    },
    async uploadSync(snapshot: ForumSyncDocument, data: string) {
      const pending = snapshots.get(snapshot);
      if (!pending || !pending.hash || typeof data !== "string")
        return { kind: "invalid" } as const;
      if (session() !== pending.active.continuity)
        return { kind: "session-changed" } as const;
      if (
        snapshot.maxBytes &&
        new TextEncoder().encode(data).length > snapshot.maxBytes
      )
        return { kind: "too-large", maxBytes: snapshot.maxBytes } as const;
      snapshots.delete(snapshot);
      const body = new URLSearchParams({
        formhash: pending.hash,
        base_updated: String(snapshot.updated),
        data,
      });
      const result = await exchange(plugin("sync"), pending.active, {
        body: body.toString(),
      });
      if (result.kind !== "response") return result;
      const response = json(result.response.body);
      if (
        response.uid !== undefined &&
        memberId(response.uid) !== pending.active.member
      )
        return { kind: "uncertain" } as const;
      const { status } = result.response;
      if (
        status === 409 &&
        response.ok === 0 &&
        response.error === "conflict" &&
        count(response.updated) &&
        (response.data === null || typeof response.data === "string")
      )
        return {
          kind: "conflict",
          updated: response.updated,
          data: response.data,
        } as const;
      if (
        status === 413 &&
        response.ok === 0 &&
        response.error === "size" &&
        count(response.max_bytes)
      )
        return { kind: "too-large", maxBytes: response.max_bytes } as const;
      const problem = pluginProblem(response, status);
      if (problem) return problem;
      if (
        status === 200 &&
        response.ok === 1 &&
        count(response.updated) &&
        response.updated > 0
      )
        return { kind: "uploaded", updated: response.updated } as const;
      return { kind: "unverified" } as const;
    },
    async listDevices(member: string) {
      const active = scope(member);
      if (!active) return { kind: "invalid" } as const;
      const result = await deviceList(active);
      if (result.kind !== "list") return result;
      return {
        kind: "devices",
        devices: result.devices,
        current: result.current,
        limit: result.limit,
      } as const;
    },
    async registerDevice(member: string, input: RegisterForumDevice) {
      const active = scope(member);
      if (
        !active ||
        !deviceId(input.id) ||
        !input.platform ||
        !input.appVersion
      )
        return { kind: "invalid" } as const;
      const registration = { ...input };
      const status = await pluginRead("status", active);
      if (status.kind !== "data") return status;
      if (status.data.device !== 1) return { kind: "unsupported" } as const;
      return writeDevice(
        active,
        "register",
        registration.id,
        token(status.data.formhash),
        registration,
      );
    },
    revokeDevice(member: string, id: string) {
      return changeDevice(member, id, "revoke");
    },
    removeDevice(member: string, id: string) {
      return changeDevice(member, id, "remove");
    },
  };
}
