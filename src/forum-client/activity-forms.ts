import {
  attr,
  byId,
  children,
  controlDisabled,
  descendants,
  hasClass,
  label,
  type Node,
} from "./html.js";
import {
  activityURL,
  answer,
  id,
  int,
  record,
  responseIssue,
  rows,
  string,
  targetMatches,
} from "./activity-protocol.js";
import { accountFrom } from "./read-thread.js";
import { parseNativeRatingForm } from "./rating.js";
import { reportReasonsFrom } from "./report.js";
import { numericId } from "./notice-transport.js";
import type { Authority, Target } from "./activity-authority.js";
import type { ActivityFailure } from "./activity-read-types.js";
import type {
  ActivityIntent,
  ActivityRatingChoice,
  ActivityCommentItem,
  PreparedActivity,
} from "./activity-effects.js";
import type { HostResponse } from "./types.js";

type Form = {
  url: URL;
  fields: Record<string, string>;
  choices: Omit<PreparedActivity, "target">;
  notify?: { name: string; value: string };
};
export type ActivityForm = Form;
const postParams = {
  rate: { mod: "misc", action: "rate", ratesubmit: "yes", infloat: "yes" },
  report: { mod: "report" },
  comment: {
    mod: "post",
    action: "reply",
    comment: "yes",
    commentsubmit: "yes",
    infloat: "yes",
  },
};
const requiredFields = {
  rate: ["formhash", "tid", "pid", "referer", "handlekey", "ratesubmit"],
  report: [
    "referer",
    "reportsubmit",
    "rtype",
    "rid",
    "fid",
    "url",
    "inajax",
    "handlekey",
    "formhash",
  ],
  comment: ["formhash", "handlekey", "commentsubmit"],
};
export const forumUnits = (s: string) =>
  Array.from(s).reduce(
    (n, c) =>
      n + (c.codePointAt(0)! >= 128 ? 2 : /[\x20-\x7e\t\n]/.test(c) ? 1 : 0),
    0,
  );
const handlekey = (target: Target) =>
  target.publicTarget.action === "report"
    ? `miscreport${target.postId}`
    : target.publicTarget.action;
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((s) => typeof s === "string")
    ? ([...value] as string[])
    : null;
const absent = (value: unknown) => Array.isArray(value) && !value.length;

function validSubmission(
  raw: string,
  fields: Record<string, string>,
  target: Target,
  authority: Authority,
) {
  const {
    publicTarget: { action },
    threadId,
    postId,
    page,
  } = target;
  if (!Object.hasOwn(postParams, action) || !raw) return null;
  const form = action as keyof typeof postParams;
  const url = activityURL(raw, page);
  if (!url || url.pathname !== (form === "report" ? "/misc.php" : "/forum.php"))
    return null;
  const q = url.searchParams;
  const required = {
    ...postParams[form],
    ...(form === "comment" ? { tid: threadId, pid: postId! } : {}),
  };
  const permitted =
    form === "comment"
      ? ["extra", "page", "inajax"]
      : form === "rate"
        ? ["inajax"]
        : [];
  if (
    !Object.entries(required).every(([k, v]) => q.get(k) === v) ||
    [...q.keys()].some(
      (k) => !Object.hasOwn(required, k) && !permitted.includes(k),
    )
  )
    return null;
  const names = requiredFields[form];
  if (
    names.some((n) => !Object.hasOwn(fields, n)) ||
    names.length !== Object.keys(fields).length ||
    fields.formhash !== authority.hash
  )
    return null;
  // Some report deployments name the open handle per PID and the receipt generically.
  if (fields.handlekey !== handlekey(target)) return null;
  if (
    form === "rate" &&
    (fields.tid !== threadId ||
      fields.pid !== postId ||
      fields.ratesubmit !== "true")
  )
    return null;
  if (
    form === "report" &&
    (fields.rtype !== "post" ||
      fields.rid !== postId ||
      fields.fid !== authority.boardId ||
      fields.inajax !== "1" ||
      fields.reportsubmit !== "true")
  )
    return null;
  if (form === "comment" && fields.commentsubmit !== "true") return null;
  if (form !== "report") url.searchParams.set("inajax", "1");
  url.searchParams.set("tsdmapp", "json");
  return url;
}
function ratingChoice(
  value: Record<string, unknown>,
): ActivityRatingChoice | null {
  const input = record(value.input);
  const scoreId = id(value.id),
    name = string(input?.name),
    title = string(value.title);
  const minimum = int(value.min),
    maximum = int(value.max),
    remaining = int(value.today_left);
  const choices =
    Array.isArray(value.choices) && value.choices.every((n) => int(n) !== null)
      ? ([...value.choices] as number[])
      : null;
  if (
    !scoreId ||
    name !== `score${scoreId}` ||
    input?.type !== "text" ||
    input.value !== "0" ||
    !title ||
    minimum === null ||
    maximum === null ||
    minimum > 0 ||
    maximum < 0 ||
    remaining === null ||
    remaining < 0 ||
    !choices ||
    choices.some((n) => n < minimum || n > maximum)
  )
    return null;
  return { name, label: title, minimum, maximum, remaining, choices };
}
function commentChoice(
  value: Record<string, unknown>,
): ActivityCommentItem | null {
  const name = string(value.name),
    label = string(value.label),
    defaultValue = string(value.value);
  const choices = rows(value.choices);
  if (
    !/^commentitem\[[^\[\]]+\]$/.test(name) ||
    value.type !== "hidden" ||
    typeof value.value !== "string" ||
    !label ||
    !choices ||
    choices.some(
      (v) => typeof v?.label !== "string" || typeof v.value !== "string",
    )
  )
    return null;
  const options = choices.map((v) => ({
    value: string(v!.value),
    label: string(v!.label),
  }));
  if (defaultValue && !options.some((o) => o.value === defaultValue))
    return null;
  return { name, label, choices: options, defaultValue };
}
function structured(
  data: Record<string, unknown>,
  target: Target,
  authority: Authority,
): Form | null {
  const action = target.publicTarget.action;
  if (
    data.ok !== 1 ||
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== action ||
    !absent(data.hook_fields) ||
    !absent(data.unsupported) ||
    data.seccheck
  )
    return null;
  if (
    action === "report"
      ? data.rtype !== "post" ||
        id(data.rid) !== target.postId ||
        id(data.fid) !== authority.boardId
      : id(data.tid) !== target.threadId || id(data.pid) !== target.postId
  )
    return null;
  const submit = record(data.submit),
    values = record(submit?.fields);
  if (
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !values ||
    Object.values(values).some((v) => typeof v !== "string") ||
    data.formhash !== authority.hash
  )
    return null;
  const fields = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, string(v)]),
  );
  const url = validSubmission(string(submit.url), fields, target, authority);
  if (!url) return null;
  if (action === "rate") {
    const credits = rows(data.credits)?.map((v) => v && ratingChoice(v));
    const reasons = strings(data.reasons),
      reason = record(data.reason),
      notify = record(data.notify);
    if (
      !credits?.length ||
      credits.some((c) => !c) ||
      new Set(credits.map((c) => c?.name)).size !== credits.length ||
      !reasons ||
      reason?.name !== "reason" ||
      reason.type !== "text" ||
      notify?.name !== "sendreasonpm" ||
      notify.type !== "checkbox" ||
      notify.disabled !== 0 ||
      typeof notify.value !== "string" ||
      (notify.checked !== 0 && notify.checked !== 1)
    )
      return null;
    return {
      url,
      fields,
      choices: {
        rating: credits.filter((c) => c !== null),
        reasons,
        notifyDefault: notify.checked === 1,
        ...(data.self_deduct === 0 || data.self_deduct === 1
          ? { selfDeduct: data.self_deduct === 1 }
          : {}),
      },
      notify: { name: "sendreasonpm", value: notify.value },
    };
  }
  const message = record(data.message),
    maxLength = int(message?.max);
  if (
    message?.name !== "message" ||
    message.type !== "textarea" ||
    message.unit !== "dstrlen" ||
    maxLength === null ||
    maxLength < 1
  )
    return null;
  if (action === "report") {
    const reasons = strings(data.reasons);
    return reasons ? { url, fields, choices: { reasons, maxLength } } : null;
  }
  const items = rows(data.items)?.map((v) => v && commentChoice(v));
  return items &&
    items.every((i) => i !== null) &&
    new Set(items.map((i) => i?.name)).size === items.length
    ? { url, fields, choices: { commentItems: items, maxLength } }
    : null;
}

function scriptText(doc: Node) {
  return descendants(doc, (n) => n.tagName === "script").map((n) =>
    children(n)
      .map((c) => ("value" in c ? c.value : ""))
      .join(""),
  );
}
function native(
  doc: Node,
  response: HostResponse,
  target: Target,
  authority: Authority,
): Form | null {
  const action = target.publicTarget.action;
  const forms = descendants(doc, (n) => n.tagName === "form");
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    attr(form, "method").toLowerCase() !== "post"
  )
    return null;
  if (action === "rate") {
    const parsed = parseNativeRatingForm(response, {
      url: authority.url.href,
      threadId: target.threadId,
      postId: target.postId!,
    });
    const { reason: _reason, sendreasonpm, ...staticFields } = parsed.fields;
    const fields = Object.fromEntries(
      Object.entries(staticFields).filter(([k]) => !/^score\d+$/.test(k)),
    );
    const url = validSubmission(parsed.url, fields, target, authority);
    return url
      ? {
          url,
          fields,
          choices: {
            rating: parsed.scores,
            reasons: parsed.reasons,
            notifyDefault: parsed.notify,
          },
          notify: { name: "sendreasonpm", value: sendreasonpm! },
        }
      : null;
  }
  if (action !== "report" && action !== "comment") return null;
  const report = action === "report";
  if (
    attr(form, "id") !== (report ? `form_${handlekey(target)}` : "commentform")
  )
    return null;
  if (
    descendants(
      form,
      (n) =>
        /seccode|secqa|captcha/i.test(attr(n, "name")) ||
        hasClass(n, "seccode"),
    ).length
  )
    return null;
  const fields: Record<string, string> = {};
  const controls = descendants(form, (n) =>
    ["input", "textarea", "select", "button"].includes(n.tagName),
  );
  const hidden = controls.filter(
    (n) => n.tagName === "input" && attr(n, "type") === "hidden",
  );
  const messages = controls.filter(
    (n) => n.tagName === "textarea" && attr(n, "name") === "message",
  );
  const buttons = controls.filter(
    (n) =>
      (n.tagName === "button" || n.tagName === "input") &&
      attr(n, "type") === "submit",
  );
  if (
    controls.some(controlDisabled) ||
    messages.length !== 1 ||
    buttons.length !== 1 ||
    controls.length !== hidden.length + 2
  )
    return null;
  for (const control of hidden) {
    const name = attr(control, "name");
    if (!requiredFields[action].includes(name) || Object.hasOwn(fields, name))
      return null;
    fields[name] = attr(control, "value");
  }
  const button = buttons[0]!;
  if (
    report
      ? attr(button, "id") !== "report_submit" || attr(button, "name") !== ""
      : attr(button, "name") !== "commentsubmit" ||
        attr(button, "value") !== "true" ||
        Object.hasOwn(fields, "commentsubmit")
  )
    return null;
  if (!report) fields.commentsubmit = attr(button, "value");
  const url = validSubmission(attr(form, "action"), fields, target, authority);
  if (!url) return null;
  if (report) {
    const scripts = scriptText(doc).filter((s) => /var reasons\s*=/.test(s));
    const reasons = scripts.length === 1 ? reportReasonsFrom(scripts[0]!) : [];
    return { url, fields, choices: { reasons, maxLength: 200 } };
  }
  const maxLength = Number(label(byId(doc, "checklen")));
  return Number.isSafeInteger(maxLength) && maxLength > 0
    ? { url, fields, choices: { commentItems: [], maxLength } }
    : null;
}

export function decodeActivityForm(
  response: HostResponse,
  target: Target,
  authority: Authority,
  memberId: string,
): Form | ActivityFailure | null {
  const { data, doc, failure } = answer(response);
  const issue = responseIssue(response, data);
  if (issue) return issue;
  if (data?.uid !== undefined && numericId(data.uid) !== memberId)
    return {
      kind: "session-changed",
      message: "The form was served to a different account.",
    };
  if (data && !targetMatches(data, target))
    return {
      kind: "invalid",
      message: "The form returned a different target.",
    };
  const message = string(data?.message) || failure;
  if (
    message &&
    (failure || data?.ok === 0) &&
    !["off", "action", "unknown"].includes(string(data?.error))
  )
    return { kind: "refused", code: string(data?.message_key), message };
  if (response.status !== 200) return null;
  const header = accountFrom(doc, response.url);
  if (
    header.kind === "guest" ||
    (header.kind === "member" && header.id !== memberId)
  )
    return {
      kind: "session-changed",
      message: "The form header conflicts with the current account.",
    };
  try {
    if (data?.type === "form")
      return numericId(data.uid) === memberId
        ? structured(data, target, authority)
        : null;
    if (
      data?.type === "result" &&
      (data.schema !== 13 || data.kind !== "page" || data.ok !== 1)
    )
      return null;
    return native(doc, response, target, authority);
  } catch {
    return null;
  }
}

export function activityBody(form: Form, intent: ActivityIntent) {
  const fields = { ...form.fields };
  if (intent.action === "rate") {
    const credits = form.choices.rating;
    if (
      !credits ||
      !record(intent.scores) ||
      typeof intent.reason !== "string" ||
      typeof intent.notify !== "boolean" ||
      typeof form.notify?.name !== "string"
    )
      return null;
    if (
      !Object.keys(intent.scores).length ||
      Object.keys(intent.scores).some(
        (name) => !credits.some((c) => c.name === name),
      )
    )
      return null;
    for (const c of credits) {
      const score = Object.hasOwn(intent.scores, c.name)
        ? intent.scores[c.name]!
        : 0;
      if (
        int(score) === null ||
        score < c.minimum ||
        score > c.maximum ||
        Math.abs(score) > c.remaining
      )
        return null;
      fields[c.name] = String(score);
    }
    if (credits.every((c) => fields[c.name] === "0")) return null;
    fields.reason = intent.reason;
    if (intent.notify) fields[form.notify.name] = form.notify.value;
  } else if (intent.action === "report" || intent.action === "comment") {
    if (
      typeof intent.message !== "string" ||
      !intent.message.trim() ||
      forumUnits(intent.message) > (form.choices.maxLength ?? 0)
    )
      return null;
    fields.message = intent.message;
    if (intent.action === "comment") {
      const items = form.choices.commentItems ?? [];
      const supplied = intent.items ?? {};
      if (
        !record(supplied) ||
        Object.keys(supplied).some(
          (name) => !items.some((i) => i.name === name),
        )
      )
        return null;
      for (const item of items) {
        const choice = Object.hasOwn(supplied, item.name)
          ? supplied[item.name]!
          : item.defaultValue;
        if (choice !== "" && !item.choices.some((o) => o.value === choice))
          return null;
        fields[item.name] = choice;
      }
    }
  }
  return new URLSearchParams(fields).toString();
}
