import {
  attr,
  byId,
  controlDisabled,
  descendants,
  hasClass,
  label,
} from "../html.js";
import { type NoticeHost } from "../notice-transport.js";
import {
  answer,
  bit,
  failure,
  formhash,
  forumURL,
  nativeControls,
  nativeIdentity,
  numericId,
  readIssue,
  record,
  string,
  urlAt,
  whole,
} from "./protocol.js";
import type {
  Attendance,
  AttendanceResult,
  CheckInChoice,
  CheckInForm,
  CheckInPreparation,
  CheckInResult,
  CreditsFailure,
  CreditsSession,
} from "./types.js";

const feelingCodes = new Set([
  "kx",
  "ng",
  "ym",
  "wl",
  "nu",
  "ch",
  "fd",
  "yl",
  "shuai",
]);
const method = {
  id: "dsu_paulsign:sign",
  operation: "qiandao",
  infloat: "1",
  inajax: "1",
  tsdmapp: "json",
};
type State = { attendance: Attendance; hash: string; destination?: URL };
const unknown = (
  owner: CreditsSession,
  choice: CheckInChoice,
  message: string,
  interruption?: CreditsFailure,
) =>
  ({
    kind: "unknown",
    memberId: owner.memberId,
    choice,
    message,
    ...(interruption ? { interruption } : {}),
  }) as const;
function epoch(value: unknown) {
  const n =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : whole(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function pluginStatus(
  data: Record<string, unknown> | null,
  memberId: string,
): State | null {
  if (data?.ok !== 1 || data.installed !== 1 || !bit(data.checked_today))
    return null;
  const w = record(data.window);
  if (!w || !bit(w.open_now)) return null;
  const start = whole(w.start_hour),
    end = whole(w.end_hour);
  const window =
    bit(w.enabled) &&
    start !== null &&
    start >= 0 &&
    start <= 24 &&
    end !== null &&
    end >= 0 &&
    end <= 24
      ? {
          enabled: w.enabled === 1,
          startHour: start,
          endHour: end,
          openNow: w.open_now === 1,
        }
      : undefined;
  const attendance: Attendance = {
    kind: "attendance",
    memberId,
    source: "plugin",
    checkedToday: data.checked_today === 1,
    canCheckIn:
      data.checked_today === 0 && w.open_now === 1 && data.can_checkin !== 0,
    ...(window ? { window } : {}),
  };
  for (const [key, raw] of [
    ["dayStart", data.day_start],
    ["observedAt", data.time],
    ["lastTime", data.last_time],
    ["days", data.days],
    ["monthDays", data.month_days],
  ] as const) {
    const value = epoch(raw);
    if (value !== null) attendance[key] = value;
  }
  return { attendance, hash: formhash(data.formhash) };
}
function nativeStatus(
  html: string,
  page: URL,
  memberId: string,
): State | CreditsFailure | null {
  const { doc, form, message, isError } = nativeControls(html, "qiandao");
  const identity = nativeIdentity(html, page);
  if (identity === "0")
    return failure("refused", "Sign in to read attendance.", "login");
  if (identity !== memberId)
    return identity === null
      ? null
      : failure(
          "session-changed",
          "The attendance page was served to another account.",
        );
  const desk = label(byId(doc, "qdmsgt"));
  if (!/今天(?:已|未)签到/.test(desk))
    return isError && message ? failure("refused", message) : null;
  const checkedToday = desk.includes("今天已签到");
  const heading = label(
    descendants(doc, (n) => n.tagName === "h1" && hasClass(n, "mt"))[0],
  );
  const closed = /签到时间还未开始|还没有到|已经过了签到时间/.test(heading);
  let destination: URL | null = null;
  let hash = "";
  if (form && attr(form, "method").toLowerCase() === "post") {
    const url = forumURL(attr(form, "action"), page, "/plugin.php");
    const controls = descendants(
      form,
      (n) =>
        ["input", "textarea", "select", "button"].includes(n.tagName) &&
        !controlDisabled(n),
    );
    const tokens = controls.filter(
      (n) =>
        n.tagName === "input" &&
        attr(n, "name") === "formhash" &&
        attr(n, "type") === "hidden",
    );
    if (
      url &&
      url.searchParams.get("id") === method.id &&
      url.searchParams.get("operation") === "qiandao" &&
      [...url.searchParams.keys()].every((k) => Object.hasOwn(method, k)) &&
      tokens.length === 1 &&
      controls.every((n) =>
        [
          "",
          "formhash",
          "qdxq",
          "qdmode",
          "todaysay",
          "fastreply",
          "qdsubmit",
        ].includes(attr(n, "name")),
      )
    ) {
      hash = formhash(attr(tokens[0]!, "value"));
      if (hash) {
        for (const [key, value] of Object.entries(method))
          url.searchParams.set(key, value);
        destination = url;
      }
    }
  }
  const attendance: Attendance = {
    kind: "attendance",
    memberId,
    source: "native",
    checkedToday,
    ...(checkedToday || closed
      ? { canCheckIn: false }
      : destination
        ? { canCheckIn: true }
        : {}),
  };
  return { attendance, hash, ...(destination ? { destination } : {}) };
}
function receiptStatus(html: string, data: Record<string, unknown> | null) {
  const { doc, message } = nativeControls(html, "qiandao");
  const box =
    byId(doc, "dsu_ps_msg") ??
    descendants(doc, (n) => n.tagName === "div" && hasClass(n, "c"))[0];
  const words = label(box) || string(data?.message) || message;
  if (
    /签到时间还未开始|签到时间还没有到|已经过了签到时间|需要先登录/.test(
      words,
    ) ||
    data?.login === 1
  )
    return { kind: "refused", words } as const;
  if (/已经签到|今天已签到/.test(words))
    return { kind: "duplicate", words } as const;
  if (/签到成功/.test(words)) return { kind: "acknowledged", words } as const;
  return { kind: "unclear", words } as const;
}

export function createAttendance(host: NoticeHost) {
  const api = urlAt(host.origin, "/plugin.php", {
    id: "tsdmapp:api",
    action: "checkin",
  });
  const page = urlAt(host.origin, "/plugin.php", { id: method.id });
  const effect = urlAt(host.origin, "/plugin.php", method);
  const forms = new WeakMap<
    CheckInForm,
    { owner: CreditsSession; state: State }
  >();
  const pending = new Set<string>();
  async function read(
    owner: CreditsSession,
    nativeOnly = false,
    allowFallback = true,
  ): Promise<State | CreditsFailure> {
    if (!nativeOnly) {
      const result = await host.request(api.href, owner);
      if (result.kind !== "response")
        return failure(result.kind, "Attendance response unavailable.");
      const { data } = answer(result.response);
      const issue = readIssue(result.response, data, owner.memberId);
      if (issue) return issue;
      const status = pluginStatus(data, owner.memberId);
      if (status) return status;
      if (!allowFallback)
        return failure(
          "invalid-response",
          "The forum did not establish attendance.",
        );
    }
    const result = await host.request(page.href, owner);
    if (result.kind !== "response")
      return failure(result.kind, "Native attendance response unavailable.");
    const { data, html } = answer(result.response);
    const issue = readIssue(result.response, data, owner.memberId);
    return (
      issue ??
      nativeStatus(html, page, owner.memberId) ??
      failure(
        "invalid-response",
        "The native plugin did not establish today's attendance.",
      )
    );
  }
  return {
    async readAttendance(): Promise<AttendanceResult> {
      const owner = host.session();
      if (!owner)
        return failure("refused", "Sign in to read attendance.", "login");
      const result = await read(owner);
      return "attendance" in result ? result.attendance : result;
    },
    async prepareCheckIn(): Promise<CheckInPreparation> {
      const owner = host.session();
      if (!owner) return failure("refused", "Sign in to check in.", "login");
      let state = await read(owner);
      if (!("attendance" in state)) return state;
      if (state.attendance.checkedToday)
        return { kind: "already-checked", attendance: state.attendance };
      if (state.attendance.canCheckIn === false)
        return { kind: "closed", attendance: state.attendance };
      if (!state.hash && state.attendance.source === "plugin") {
        const supplement = await read(owner, true);
        if (!("attendance" in supplement)) {
          if (
            ["session-changed", "refused", "rate-limited"].includes(
              supplement.kind,
            )
          )
            return supplement;
          return {
            kind: "browser-handoff",
            destination: page.href,
            message: "Open the native sign-in plugin to review its form.",
          };
        }
        state = {
          ...supplement,
          attendance: { ...state.attendance, ...supplement.attendance },
        };
        if (state.attendance.checkedToday)
          return { kind: "already-checked", attendance: state.attendance };
        if (state.attendance.canCheckIn === false)
          return { kind: "closed", attendance: state.attendance };
      }
      if (!state.hash || state.attendance.canCheckIn !== true)
        return {
          kind: "browser-handoff",
          destination: page.href,
          message: "Open the native sign-in plugin to review its form.",
        };
      const form = Object.freeze({
        memberId: owner.memberId,
        source: state.attendance.source,
        ...(state.attendance.dayStart !== undefined
          ? { dayStart: state.attendance.dayStart }
          : {}),
      });
      forms.set(form, { owner, state });
      return { kind: "checkin-ready", form };
    },
    async submitCheckIn(
      form: CheckInForm,
      choice: CheckInChoice,
    ): Promise<CheckInResult> {
      const prepared = forms.get(form);
      if (
        !prepared ||
        !feelingCodes.has(choice?.feeling) ||
        typeof choice.message !== "string"
      )
        return failure(
          "invalid-input",
          "Select a current check-in form and a supported feeling.",
        );
      const { owner, state } = prepared;
      if (!host.current(owner))
        return failure(
          "session-changed",
          "The session changed before check-in.",
        );
      const key = owner.memberId;
      if (pending.has(key))
        return failure(
          "invalid-input",
          "A check-in is already in progress for this member.",
        );
      forms.delete(form);
      pending.add(key);
      const selected = { feeling: choice.feeling, message: choice.message };
      const body = new URLSearchParams({
        formhash: state.hash,
        qdxq: selected.feeling,
        qdmode: "1",
        todaysay: selected.message,
        fastreply: "1",
      }).toString();
      try {
        const result = await host.request(
          (state.destination ?? effect).href,
          owner,
          body,
        );
        if (!host.current(owner))
          return unknown(
            owner,
            selected,
            "The session changed after check-in dispatch.",
          );
        let receipt: ReturnType<typeof receiptStatus> = {
          kind: "unclear",
          words: "",
        };
        if (result.kind === "response") {
          const { data, html } = answer(result.response);
          if (
            data?.login === 1 &&
            (data.uid === undefined ||
              numericId(data.uid) === "0" ||
              numericId(data.uid) === owner.memberId)
          )
            return failure(
              "refused",
              string(data.message) || "Sign in to check in.",
              "login",
            );
          if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
            return unknown(
              owner,
              selected,
              "The check-in receipt named another account.",
            );
          const issue = readIssue(result.response, data, owner.memberId);
          if (issue?.kind === "refused" || issue?.kind === "rate-limited")
            return issue;
          if (
            !issue &&
            (!data || (data.type === "result" && data.schema === 13))
          )
            receipt = receiptStatus(html, data);
          if (receipt.kind === "refused")
            return failure(
              "refused",
              receipt.words || "The forum declined check-in.",
            );
        }
        const observed = await read(
          owner,
          state.attendance.source === "native",
          false,
        );
        if ("attendance" in observed) {
          const now = observed.attendance,
            prior = state.attendance;
          const sameDay =
            prior.dayStart === undefined || now.dayStart === prior.dayStart;
          const inOrder =
            prior.observedAt === undefined ||
            now.observedAt === undefined ||
            now.observedAt >= prior.observedAt;
          const recent =
            prior.observedAt !== undefined &&
            now.lastTime !== undefined &&
            now.lastTime >= prior.observedAt &&
            (now.observedAt === undefined || now.lastTime <= now.observedAt);
          if (inOrder && ((sameDay && now.checkedToday) || recent)) {
            const kind =
              receipt.kind === "acknowledged"
                ? "checked-in"
                : receipt.kind === "duplicate"
                  ? "already-checked"
                  : "attendance-observed";
            return {
              kind,
              checkedToday: now.checkedToday,
              attendance: now,
              message: receipt.words,
              choice: selected,
              memberId: owner.memberId,
            };
          }
        }
        return unknown(
          owner,
          selected,
          "The forum did not establish the effect of the check-in request.",
          "attendance" in observed ? undefined : observed,
        );
      } finally {
        pending.delete(key);
      }
    },
  };
}
