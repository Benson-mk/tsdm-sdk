import {
  noticeJSON,
  numericId,
  object,
  type NoticeFailure,
  type NoticeHost,
  type NoticeSession,
} from "./notice-transport.js";
import { ignoreTarget, type NoticeIgnoreTarget } from "./notice-links.js";

export interface NoticeIgnoreRule {
  readonly type: string;
  readonly authorId: string;
  readonly label: string;
}

export type NoticeIgnoreScope = "author" | "everybody";

export type NoticeIgnoreRulesResult =
  | { kind: "rules"; rules: readonly NoticeIgnoreRule[] }
  | { kind: "not-dispatched"; reason?: NoticeFailure };

export type NoticeIgnoreFormResult =
  | {
      kind: "form";
      target: NoticeIgnoreTarget;
      scopes: readonly NoticeIgnoreScope[];
    }
  | { kind: "not-dispatched"; reason?: NoticeFailure };

export type NoticeIgnoreChange =
  | { kind: "applied"; rules: readonly NoticeIgnoreRule[] }
  | { kind: "already-applied"; rules: readonly NoticeIgnoreRule[] }
  | { kind: "refused" }
  | { kind: "unknown-effect" }
  | { kind: "not-dispatched" };

type PrivacyForm = {
  rules: NoticeIgnoreRule[];
  checkedFields: { name: string; value: string }[];
  submit: { url: string; fields: { name: string; value: string }[] };
};

type IgnoreForm = {
  target: NoticeIgnoreTarget;
  scopes: NoticeIgnoreScope[];
  submit: { url: string; fields: { name: string; value: string }[] };
};

const secret = "tsdmapp=json";
const version = "tsdmv=4";
const privacyPath = "/home.php?mod=spacecp&ac=privacy&op=filter";
const formPath = "/home.php?mod=spacecp&ac=common&op=ignore";

function privacyURL(origin: string): URL {
  const url = new URL(privacyPath, origin);
  url.search += `&${secret}&${version}&nodoc=1`;
  return url;
}

function ignoreFormURL(
  origin: string,
  target: NoticeIgnoreTarget,
  native = false,
): URL {
  const url = new URL(formPath, origin);
  url.searchParams.set("authorid", target.authorId);
  url.searchParams.set("type", target.type);
  url.searchParams.set("handlekey", "noticeignore");
  if (native) {
    url.search += "&infloat=yes&inajax=1";
  } else {
    url.search += `&infloat=yes&inajax=1&${secret}&${version}&tsdmform=1&nodoc=1`;
  }
  return url;
}

function postURL(value: unknown, origin: string): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname === "/home.php" &&
      !url.username && !url.password && !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function formFields(value: unknown): { name: string; value: string }[] | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).every(
      ([name, item]) => typeof item === "string",
    )
      ? Object.entries(value as Record<string, string>).map(([name, item]) => ({
          name,
          value: item,
        }))
      : null;
  }
  if (!Array.isArray(value)) return null;
  const fields: { name: string; value: string }[] = [];
  for (const entry of value) {
    const item = object(entry);
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.value !== "string"
    )
      return null;
    fields.push({ name: item.name, value: item.value });
  }
  return fields;
}

function submission(value: unknown, origin: string, expected: URLSearchParams, flag: string) {
  const submit = object(value);
  const url = postURL(submit?.url, origin);
  const fields = formFields(submit?.fields);
  if (
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !url || !fields ||
    [...expected].some(([key, value]) =>
      url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value
    ) ||
    !["formhash", flag].every((name) =>
      fields.filter((field) => field.name === name && field.value.trim()).length === 1
    ) ||
    new Set(fields.map((field) => field.name)).size !== fields.length
  ) return null;
  return { url: url.href, fields };
}

function ruleFrom(value: unknown): NoticeIgnoreRule | null {
  const item = object(value);
  if (
    !item ||
    typeof item.field !== "string" ||
    typeof item.value !== "string" ||
    typeof item.name !== "string" ||
    typeof item.target !== "string"
  )
    return null;
  const match = /^privacy\[filter_note\]\[([a-zA-Z0-9_-]+)\|([0-9]+)\]$/.exec(
    item.field,
  );
  if (!match || item.value !== `${match[1]}|${match[2]}`) return null;
  return {
    type: match[1]!,
    authorId: match[2]!,
    label: `${item.name} / ${item.target}`,
  };
}

function privacyForm(data: Record<string, unknown>, origin: string): PrivacyForm | null {
  if (data.type !== "privacy_filter" || data.schema !== 55) return null;
  const notices = data.notices;
  if (!Array.isArray(notices)) return null;
  const rules = notices.map(ruleFrom);
  if (rules.some((rule) => rule === null)) return null;
  const submit = submission(data.submit, origin, new URL(privacyPath, origin).searchParams, "privacy2submit");
  if (!submit || submit.fields.some(({ name }) => name.startsWith("privacy[filter_"))) return null;
  const checkedFields: { name: string; value: string }[] = [];
  for (const key of ["groups", "feeds"]) {
    const values = data[key];
    if (!Array.isArray(values)) return null;
    for (const value of values) {
      const item = object(value);
      if (
        !item ||
        typeof item.field !== "string" ||
        typeof item.value !== "string" ||
        item.field !== `privacy[filter_${key === "feeds" ? "icon" : "gid"}][${item.value}]` ||
        (item.checked !== undefined && item.checked !== 0 && item.checked !== 1)
      )
        return null;
      if (key === "feeds" || item.checked === 1) {
        checkedFields.push({ name: item.field, value: item.value });
      }
    }
  }
  for (const rule of rules as NoticeIgnoreRule[]) {
    checkedFields.push({
      name: `privacy[filter_note][${rule.type}|${rule.authorId}]`,
      value: `${rule.type}|${rule.authorId}`,
    });
  }
  if (new Set(checkedFields.map(({ name }) => name)).size !== checkedFields.length) return null;
  return { rules: rules as NoticeIgnoreRule[], checkedFields, submit };
}

function ignoreForm(
  data: Record<string, unknown>,
  expected: NoticeIgnoreTarget,
  origin: string,
): IgnoreForm | null {
  if (
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== "ignore" ||
    data.type_key !== expected.type
  )
    return null;
  const authorid = object(data.authorid);
  if (!authorid || authorid.name !== "authorid" || authorid.value !== expected.authorId)
    return null;
  const choices = authorid.choices;
  if (!Array.isArray(choices)) return null;
  const values = choices.map((choice) => object(choice)?.value);
  if (
    values.some((value) => value !== expected.authorId && value !== "0") ||
    !values.includes(expected.authorId) ||
    !values.includes("0")
  )
    return null;
  const query = new URL(formPath, origin).searchParams;
  query.set("type", expected.type);
  const submit = submission(data.submit, origin, query, "ignoresubmit");
  if (!submit) return null;
  return {
    target: expected,
    scopes: expected.authorId === "0" ? ["everybody"] : ["author", "everybody"],
    submit,
  };
}

function body(fields: readonly { name: string; value: string }[]): string {
  return new URLSearchParams(
    fields.map(({ name, value }) => [name, value] as [string, string]),
  ).toString();
}

function resultIsSuccess(data: Record<string, unknown>): boolean {
  return data.type === "result" && data.schema === 13 && data.message_key === "do_success";
}

function refusal(data: Record<string, unknown>, observedChange: boolean): NoticeIgnoreChange {
  return !observedChange && data.type === "result" && data.schema === 13 &&
    typeof data.message_key === "string" && data.message_key.trim()
    ? { kind: "refused" } : { kind: "unknown-effect" };
}

function ruleMatches(rule: NoticeIgnoreRule, target: NoticeIgnoreTarget): boolean {
  return rule.type === target.type && rule.authorId === target.authorId;
}

function sameFields(
  left: readonly { name: string; value: string }[],
  right: readonly { name: string; value: string }[],
): boolean {
  const normalize = (fields: readonly { name: string; value: string }[]) =>
    [...new Set(fields.map(({ name, value }) => `${name}\u0000${value}`))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function desiredRule(
  target: NoticeIgnoreTarget,
  scope: NoticeIgnoreScope,
  rules: readonly NoticeIgnoreRule[],
): NoticeIgnoreRule | undefined {
  return rules.find((rule) =>
    rule.type === target.type &&
    rule.authorId === (scope === "everybody" ? "0" : target.authorId),
  );
}

export function noticeIgnore(host: NoticeHost) {
  let changing = false;

  async function deliberateChange(change: () => Promise<NoticeIgnoreChange>): Promise<NoticeIgnoreChange> {
    if (changing) return { kind: "not-dispatched" };
    changing = true;
    try {
      return await change();
    } finally {
      changing = false;
    }
  }

  async function loadPrivacy(expected: NoticeSession): Promise<
    | { kind: "privacy"; form: PrivacyForm }
    | { kind: NoticeFailure }
  > {
    const loaded = await host.request(privacyURL(host.origin).href, expected);
    if (loaded.kind !== "response") return loaded;
    const decoded = noticeJSON(loaded.response);
    if (decoded.kind !== "json") return decoded;
    if (numericId(decoded.data.uid) !== expected.memberId) return { kind: "session-changed" };
    const form = privacyForm(decoded.data, host.origin);
    return form ? { kind: "privacy", form } : { kind: "invalid-response" };
  }

  async function loadNoticeIgnoreRules(): Promise<NoticeIgnoreRulesResult> {
    const session = host.session();
    if (!session) return { kind: "not-dispatched", reason: "refused" };
    const loaded = await loadPrivacy(session);
    return loaded.kind === "privacy"
      ? { kind: "rules", rules: loaded.form.rules }
      : { kind: "not-dispatched", reason: loaded.kind };
  }

  async function loadNoticeIgnoreForm(target: NoticeIgnoreTarget): Promise<NoticeIgnoreFormResult> {
    const session = host.session();
    if (
      !session ||
      !/^[a-zA-Z0-9_-]+$/.test(target.type) ||
      !/^(0|[1-9]\d*)$/.test(target.authorId)
    )
      return { kind: "not-dispatched", reason: "refused" };
    const loaded = await host.request(ignoreFormURL(host.origin, target).href, session);
    if (loaded.kind !== "response") return { kind: "not-dispatched", reason: loaded.kind };
    const decoded = noticeJSON(loaded.response);
    if (decoded.kind !== "json") return { kind: "not-dispatched", reason: decoded.kind };
    if (numericId(decoded.data.uid) !== session.memberId)
      return { kind: "not-dispatched", reason: "session-changed" };
    const form = ignoreForm(decoded.data, target, host.origin);
    return form
      ? { kind: "form", target, scopes: form.scopes }
      : { kind: "not-dispatched", reason: "invalid-response" };
  }

  async function addNoticeIgnoreRule(
    target: NoticeIgnoreTarget,
    scope: NoticeIgnoreScope,
  ): Promise<NoticeIgnoreChange> {
    if (!ignoreTarget(target.type, target.authorId) ||
        !["author", "everybody"].includes(scope) ||
        (scope === "author" && target.authorId === "0"))
      return { kind: "not-dispatched" };
    const session = host.session();
    if (!session) return { kind: "not-dispatched" };
    const initial = await loadPrivacy(session);
    if (initial.kind !== "privacy") return { kind: "not-dispatched" };
    const desiredAuthor = scope === "everybody" ? "0" : target.authorId;
    const existing = initial.form.rules.find(
      (rule) => rule.type === target.type && rule.authorId === desiredAuthor,
    );
    if (existing) return { kind: "already-applied", rules: initial.form.rules };
    const formLoaded = await host.request(ignoreFormURL(host.origin, target).href, session);
    if (formLoaded.kind !== "response") return { kind: "not-dispatched" };
    const decoded = noticeJSON(formLoaded.response);
    if (decoded.kind !== "json" || numericId(decoded.data.uid) !== session.memberId)
      return { kind: "not-dispatched" };
    const form = ignoreForm(decoded.data, target, host.origin);
    if (!form || !form.scopes.includes(scope)) return { kind: "not-dispatched" };
    const url = postURL(form.submit.url, host.origin);
    if (!url) return { kind: "not-dispatched" };
    url.search += `&inajax=1&${secret}&${version}`;
    const fields = form.submit.fields.filter(({ name }) => name !== "authorid");
    fields.push({ name: "authorid", value: desiredAuthor });
    const sent = await host.request(url.href, session, body(fields));
    if (sent.kind !== "response") return { kind: "unknown-effect" };
    const result = noticeJSON(sent.response);
    if (result.kind !== "json" || numericId(result.data.uid) !== session.memberId) {
      return { kind: "unknown-effect" };
    }
    const final = await loadPrivacy(session);
    if (resultIsSuccess(result.data)) {
      if (final.kind === "privacy") {
        const next = desiredRule(target, scope, final.form.rules);
        if (next) return { kind: "applied", rules: final.form.rules };
      }
      return { kind: "unknown-effect" };
    }
    return refusal(result.data, final.kind === "privacy" && !!desiredRule(target, scope, final.form.rules));
  }

  async function removeNoticeIgnoreRule(
    target: NoticeIgnoreTarget,
  ): Promise<NoticeIgnoreChange> {
    const session = host.session();
    if (!session) return { kind: "not-dispatched" };
    const initial = await loadPrivacy(session);
    if (initial.kind !== "privacy") return { kind: "not-dispatched" };
    if (!initial.form.rules.some((rule) => ruleMatches(rule, target)))
      return { kind: "not-dispatched" };
    const url = postURL(initial.form.submit.url, host.origin);
    if (!url) return { kind: "not-dispatched" };
    url.search += `&${secret}&${version}`;
    const removed = `privacy[filter_note][${target.type}|${target.authorId}]`;
    const retained = initial.form.checkedFields.filter(({ name }) => name !== removed);
    const fields = [...initial.form.submit.fields, ...retained];
    const sent = await host.request(url.href, session, body(fields));
    if (sent.kind !== "response") return { kind: "unknown-effect" };
    const result = noticeJSON(sent.response);
    if (result.kind !== "json" || numericId(result.data.uid) !== session.memberId) {
      return { kind: "unknown-effect" };
    }
    const final = await loadPrivacy(session);
    if (resultIsSuccess(result.data)) {
      if (
        final.kind === "privacy" &&
        !final.form.rules.some((rule) => ruleMatches(rule, target)) &&
        sameFields(final.form.checkedFields, retained)
      )
        return { kind: "applied", rules: final.form.rules };
      return { kind: "unknown-effect" };
    }
    return refusal(result.data, final.kind === "privacy" && !final.form.rules.some((rule) => ruleMatches(rule, target)));
  }

  function prepareNativeNoticeIgnoreForm(target: NoticeIgnoreTarget) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(target.type) ||
      !/^(0|[1-9]\d*)$/.test(target.authorId)
    )
      return { kind: "not-prepared" as const };
    return {
      kind: "handoff" as const,
      destination: ignoreFormURL(host.origin, target, true).href,
    };
  }

  function prepareNativeNoticeIgnoreRules() {
    return { kind: "handoff" as const, destination: new URL(privacyPath, host.origin).href };
  }

  return {
    loadNoticeIgnoreRules,
    loadNoticeIgnoreForm,
    addNoticeIgnoreRule: (target: NoticeIgnoreTarget, scope: NoticeIgnoreScope) =>
      deliberateChange(() => addNoticeIgnoreRule(target, scope)),
    removeNoticeIgnoreRule: (target: NoticeIgnoreTarget) =>
      deliberateChange(() => removeNoticeIgnoreRule(target)),
    prepareNativeNoticeIgnoreForm,
    prepareNativeNoticeIgnoreRules,
  };
}
