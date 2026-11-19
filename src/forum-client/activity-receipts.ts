import { attr, byId, children, descendants, label } from "./html.js";
import {
  activityURL,
  answer,
  id,
  record,
  responseIssue,
  string,
  targetMatches,
} from "./activity-protocol.js";
import { numericId } from "./notice-transport.js";
import type { Target } from "./activity-authority.js";
import type { ActivityVerdict } from "./activity-effects.js";
import type { HostResponse } from "./types.js";

const acceptedKeys = {
  rate: "thread_rate_succeed",
  report: "report_succeed",
  comment: "comment_add_succeed",
};
const evaluationKeys = new Set([
  "recommend_succeed",
  "recommend_daycount_succeed",
]);
const unknown: ActivityVerdict = {
  kind: "unknown",
  message:
    "The forum may have applied this action. The response did not establish its effect.",
};
const refused = (message: string, code = "") =>
  ({ kind: "refused", message, code }) as const;
const integerText = (value: unknown) => {
  const text = typeof value === "number" ? String(value) : string(value);
  return /^[+-]?\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : null;
};
function evaluation(
  target: Target,
  message: string,
  delta: unknown,
  index: unknown,
  known: boolean,
): ActivityVerdict {
  const expectedSign = target.publicTarget.action === "recommend" ? 1 : -1;
  const change = integerText(delta),
    score = integerText(index);
  if (
    (change === null && !known) ||
    (delta !== undefined &&
      (change === null || Math.sign(change) !== expectedSign))
  )
    return unknown;
  return {
    kind: "accepted",
    message,
    ...(change !== null ? { delta: change } : {}),
    ...(score !== null ? { index: score } : {}),
  };
}
function continuation(raw: unknown, target: Target): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let location: URL;
  try {
    location = new URL(raw, target.page);
  } catch {
    return null;
  }
  const fragment = location.hash;
  location.hash = "";
  const url = activityURL(location.href, target.page);
  if (
    !url ||
    url.pathname !== "/forum.php" ||
    url.searchParams.get("mod") !== "viewthread" ||
    id(url.searchParams.get("tid")) !== target.threadId ||
    (url.searchParams.has("pid") &&
      url.searchParams.get("pid") !== target.postId) ||
    (fragment && fragment !== `#pid${target.postId}`) ||
    [...url.searchParams.keys()].some(
      (k) => !["mod", "tid", "pid", "extra", "page", "viewpid"].includes(k),
    ) ||
    (url.searchParams.has("viewpid") &&
      url.searchParams.get("viewpid") !== target.postId)
  )
    return null;
  url.hash = fragment;
  return url.href;
}
function expectedForm(doc: ReturnType<typeof answer>["doc"], target: Target) {
  const {
    publicTarget: { action },
    postId,
  } = target;
  const formId =
    action === "report" ? `form_miscreport${postId}` : `${action}form`;
  return Boolean(byId(doc, formId));
}
function decodeScript(doc: ReturnType<typeof answer>["doc"]) {
  return descendants(doc, (n) => n.tagName === "script" && !attr(n, "src"))
    .flatMap((n) => children(n).map((c) => ("value" in c ? c.value : "")))
    .join("\n");
}
const unescape = (value: string) => value.replace(/\\(['"\\])/g, "$1");

export function activityReceipt(
  response: HostResponse,
  target: Target,
  memberId: string,
  returnURL: string,
): ActivityVerdict {
  const { data, doc, failure } = answer(response);
  const {
    publicTarget: { action },
    postId,
  } = target;
  const isEvaluation = action === "recommend" || action === "subtract";
  if (data?.uid !== undefined && numericId(data.uid) !== memberId)
    return unknown;
  const issue = responseIssue(response, data);
  if (issue) return issue;
  if (response.status !== 200) return unknown;
  if (data) {
    if (
      numericId(data.uid) !== memberId ||
      data.type !== "result" ||
      data.schema !== 13 ||
      !targetMatches(data, target)
    )
      return unknown;
    const values = record(data.values) ?? {};
    if (
      !targetMatches(values, target) ||
      (values.rid !== undefined && id(values.rid) !== postId)
    )
      return unknown;
    const message = string(data.message),
      code = string(data.message_key);
    if (data.kind === "page" || data.kind === "form") {
      if (expectedForm(doc, target))
        return {
          kind: "redrawn",
          destination: returnURL,
          message: message || failure || "The forum returned the form again.",
        };
      return failure
        ? refused(failure, code)
        : nativeReceipt(doc, failure, target, returnURL);
    }
    const destination = continuation(data.url, target);
    if (data.kind === "redirect")
      return destination
        ? {
            kind: "handoff",
            destination,
            message: message || "The forum returned a continuation.",
            effect: "unknown",
          }
        : unknown;
    if (!["handle", "message"].includes(string(data.kind))) return unknown;
    const handle = string(data.handlekey);
    if (
      handle &&
      (action === "report"
        ? !["miscreport", `miscreport${postId}`].includes(handle)
        : isEvaluation
          ? false
          : handle !== action)
    )
      return unknown;
    if (isEvaluation) {
      if (
        evaluationKeys.has(code) ||
        (!code && values.recommendv !== undefined)
      )
        return evaluation(
          target,
          message,
          values.recommendv,
          values.recommendc,
          evaluationKeys.has(code),
        );
      return (data.ok === 0 || data.alert === "error") && message
        ? refused(message, code)
        : unknown;
    }
    if (
      code === acceptedKeys[action] &&
      data.ok === 1 &&
      data.alert === "right" &&
      data.login === 0
    ) {
      if (data.url && !destination) return unknown;
      return {
        kind: "accepted",
        message,
        ...(destination ? { destination } : {}),
      };
    }
    if ((data.ok === 0 || data.alert === "error") && message)
      return refused(message, code);
    return unknown;
  }
  return nativeReceipt(doc, failure, target, returnURL);
}

function nativeReceipt(
  doc: ReturnType<typeof answer>["doc"],
  failure: string,
  target: Target,
  returnURL: string,
): ActivityVerdict {
  const {
    publicTarget: { action },
    postId,
  } = target;
  const isEvaluation = action === "recommend" || action === "subtract";
  if (expectedForm(doc, target))
    return {
      kind: "redrawn",
      destination: returnURL,
      message: failure || "The forum returned the form again.",
    };
  const scripts = decodeScript(doc);
  const handler =
    action === "report" ? `miscreport${postId}` : isEvaluation ? "" : action;
  if (isEvaluation) {
    const index = byId(doc, "recommentc"),
      delta = byId(doc, "recommentv");
    const matched =
      /\berrorhandle_\(\s*'(?:[^'\\]|\\.)*'\s*,\s*\{\s*'recommendv':'([+-]?\d+)'\s*,\s*'recommendc':'([+-]?\d+)'\s*\}/.exec(
        scripts,
      );
    if (delta || matched) {
      const change = delta ? label(delta) : matched?.[1];
      const score = index ? label(index) : matched?.[2];
      if (
        matched &&
        ((delta && integerText(change) !== integerText(matched[1])) ||
          (index && integerText(score) !== integerText(matched[2])))
      )
        return unknown;
      return evaluation(target, label(doc), change, score, false);
    }
    const message = label(doc);
    if (failure || (/\berrorhandle_\(/.test(scripts) && message))
      return refused(failure || message);
    return unknown;
  }
  const failures = [
    ...scripts.matchAll(
      /\berrorhandle_(\w+)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\{[^}]*\})\s*\)/g,
    ),
  ].filter((m) => m[1] === handler);
  if (
    action === "report" &&
    failures.length === 1 &&
    failures[0]?.[3] === "{}"
  ) {
    const dialogs = [
      ...scripts.matchAll(
        /\bshowDialog\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'right'/g,
      ),
    ];
    if (
      dialogs.length === 1 &&
      dialogs[0]?.[1] === failures[0][2] &&
      scripts.includes(`hideWindow('${handler}')`)
    )
      return { kind: "accepted", message: unescape(dialogs[0]![1]!) };
  }
  const successes = [
    ...scripts.matchAll(
      /\bsucceedhandle_(\w+)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*\{([^}]*)\}\s*\)/g,
    ),
  ].filter((m) => m[1] === handler);
  if (
    successes.length === 1 &&
    !failure &&
    !failures.length &&
    action !== "report"
  ) {
    const [, , raw, text, fields] = successes[0]!;
    const destination = continuation(unescape(raw!), target);
    const values = Object.fromEntries(
      [...(fields ?? "").matchAll(/'(tid|pid)'\s*:\s*'(\d+)'/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    if ((raw && !destination) || !targetMatches(values, target)) return unknown;
    return {
      kind: "accepted",
      message: unescape(text!),
      ...(destination ? { destination } : {}),
    };
  }
  if (failure || failures.length === 1)
    return refused(failure || unescape(failures[0]![2]!));
  return unknown;
}
