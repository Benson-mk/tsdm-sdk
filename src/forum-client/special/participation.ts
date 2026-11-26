import { operationURL } from "../account-forms.js";
import { requiresStructuredLogin } from "../activity-protocol.js";
import {
  integer,
  noticeHost,
  numericId,
  object,
  type NoticeSession,
} from "../notice-transport.js";
import type { PostClientOptions, PostRequest } from "../posts/client.js";
import {
  enabled,
  json,
  positive,
  query,
  sameOrigin,
  scalar,
  structured,
} from "../posts/forms.js";
import { resultThread } from "../posts/native.js";
import { decodeStructuredThread } from "../structured-thread.js";

export type SpecialThreadRequest = PostRequest & { readonly effect: boolean };
export interface SpecialThreadClientOptions extends Omit<
  PostClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: SpecialThreadRequest,
    ): ReturnType<PostClientOptions["transport"]["request"]>;
  };
}
export type SpecialActionTarget = {
  boardId: string;
  threadId: string;
  page?: number;
} & (
  | { operation: "poll-vote" | "activity-apply" | "activity-cancel" }
  | { operation: "debate-position" | "debate-join"; stand: 1 | 2 }
  | { operation: "debater-vote" | "bounty-answer"; postId: string }
);
export interface SpecialActionInput {
  choices?: readonly string[];
  fields?: Readonly<Record<string, string | readonly string[]>>;
}
export interface SpecialActivityInput {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "textarea" | "select" | "radio" | "checkbox";
  readonly value: string;
  readonly required: boolean;
  readonly choices: readonly Readonly<{ value: string; label: string }>[];
}
export interface SpecialActionForm {
  readonly target: Readonly<SpecialActionTarget>;
  readonly method: "POST" | "GET";
  readonly choices?: readonly Readonly<{ id: string; label: string }>[];
  readonly maxChoices?: number;
  readonly inputs?: readonly SpecialActivityInput[];
}
export type SpecialActionPreparation =
  | { kind: "action-form"; form: SpecialActionForm }
  | { kind: "browser-handoff"; destination: string }
  | {
      kind:
        | "refused"
        | "invalid-input"
        | "invalid-response"
        | "session-changed"
        | "network";
    };
export type SpecialActionResult =
  | {
      kind:
        | "poll-voted"
        | "activity-applied"
        | "activity-cancelled"
        | "debate-position-voted"
        | "debater-voted"
        | "bounty-answer-selected"
        | "already-voted";
      message: string;
    }
  | { kind: "refused"; message: string; code?: string }
  | { kind: "invalid-input" | "session-changed" | "uncertain" };

type Action = Omit<SpecialActionForm, "target"> & {
  url: URL;
  fields: URLSearchParams;
  key: string;
  success: Exclude<
    Extract<SpecialActionResult, { message: string }>["kind"],
    "refused" | "already-voted"
  >;
  values(input: SpecialActionInput): [string, string][] | null;
};

const blocked = (name: string) =>
  /^(?:mod|action|fid|tid|pid|formhash|stand|tsdmapp|delete)(?:$|\[)/i.test(
    name,
  );

function fields(value: unknown): URLSearchParams | null {
  const data = object(value);
  if (!data) return null;
  const fields = new URLSearchParams();
  for (const [name, raw] of Object.entries(data)) {
    const value = scalar(raw);
    if (value === null || blocked(name)) return null;
    fields.set(name, value);
  }
  return fields;
}

function actionURL(
  raw: unknown,
  source: URL,
  expected: Record<string, string>,
  extra: readonly string[],
) {
  const url =
    typeof raw === "string" &&
    operationURL(raw, source, "/forum.php", expected);
  return url &&
    [...url.searchParams.keys()].every(
      (name) => Object.hasOwn(expected, name) || extra.includes(name),
    )
    ? url
    : null;
}

function poll(
  block: Record<string, unknown>,
  open: Record<string, unknown>,
  target: SpecialActionTarget,
  source: URL,
): Action | null {
  const form = object(block.form);
  const url = actionURL(
    form?.action,
    source,
    {
      mod: "misc",
      action: "votepoll",
      fid: target.boardId,
      tid: target.threadId,
      pollsubmit: "yes",
    },
    ["quickforward", "inajax"],
  );
  const supplied = fields(form?.fields);
  if (
    !url ||
    !supplied ||
    form?.method !== "POST" ||
    form.choice !== "pollanswers[]" ||
    typeof open.formhash !== "string" ||
    !open.formhash ||
    !Array.isArray(block.choices) ||
    !integer(block.maxchoices, 1)
  )
    return null;
  const items = block.choices.map(object);
  const choices = items.flatMap((choice) => {
    const id = positive(choice?.id);
    return id && typeof choice?.text === "string"
      ? [{ id, label: choice.text }]
      : [];
  });
  if (
    choices.length !== items.length ||
    new Set(choices.map(({ id }) => id)).size !== choices.length ||
    !choices.length
  )
    return null;
  const body = new URLSearchParams({ formhash: open.formhash });
  for (const [name, value] of supplied) {
    if (/^pollanswers(?:$|\[)/.test(name)) return null;
    body.append(name, value);
  }
  if (!body.has("pollsubmit")) body.set("pollsubmit", "true");
  const maxChoices = enabled(block.multiple) ? block.maxchoices : 1;
  return {
    method: "POST",
    fields: body,
    url,
    key: "thread_poll_succeed",
    success: "poll-voted",
    maxChoices,
    choices: Object.freeze(choices.map((choice) => Object.freeze(choice))),
    values(input) {
      if (input.fields !== undefined) return null;
      const ids = input.choices;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > maxChoices ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !choices.some((choice) => choice.id === id))
      )
        return null;
      return ids.map((id, index) => [`pollanswers[${index}]`, id]);
    },
  };
}

function activity(
  block: Record<string, unknown>,
  open: Record<string, unknown>,
  target: SpecialActionTarget,
  source: URL,
): Action | "native" | null {
  const applying = target.operation === "activity-apply";
  const form = object(applying ? block.apply : block.cancel);
  const openingPosts = Array.isArray(open.posts)
    ? open.posts.map(object).filter((post) => enabled(post?.first))
    : [];
  const openingId =
    openingPosts.length === 1 ? positive(openingPosts[0]?.pid) : null;
  if (!openingId) return "native";
  const url = actionURL(
    form?.action,
    source,
    {
      mod: "misc",
      action: "activityapplies",
      fid: target.boardId,
      tid: target.threadId,
      pid: openingId,
    },
    ["inajax"],
  );
  const fixed = fields(form?.fields);
  if (
    !url ||
    !fixed ||
    form?.method !== "POST" ||
    !Array.isArray(form.inputs) ||
    typeof open.formhash !== "string" ||
    !open.formhash ||
    (applying
      ? fixed.get("handlekey") !== "activityapplies" ||
        fixed.get("activitysubmit") !== "true" ||
        fixed.has("activitycancel")
      : fixed.get("activitycancel") !== "true" || fixed.has("activitysubmit"))
  )
    return null;
  const inputs: SpecialActivityInput[] = [];
  for (const raw of form.inputs) {
    const control = object(raw);
    const name = control?.name;
    const type = control?.type;
    if (
      type !== "text" &&
      type !== "textarea" &&
      type !== "select" &&
      type !== "radio" &&
      type !== "checkbox"
    )
      return "native";
    if (
      typeof name !== "string" ||
      !name ||
      /[\0\[\]\r\n]/.test(name) ||
      blocked(name) ||
      fixed.has(name) ||
      inputs.some((input) => input.name === name)
    )
      return null;
    const choices = Array.isArray(control.choices)
      ? control.choices.flatMap((raw) => {
          const item = object(raw);
          const value = scalar(item?.value);
          return value !== null && typeof item?.label === "string"
            ? [{ value, label: item.label }]
            : [];
        })
      : [];
    if (
      (type === "select" || type === "radio" || type === "checkbox") &&
      (!choices.length ||
        new Set(choices.map((item) => item.value)).size !== choices.length)
    )
      return "native";
    inputs.push(
      Object.freeze({
        name,
        type,
        label: typeof control.title === "string" ? control.title : name,
        value: scalar(control.value) ?? "",
        required: enabled(control.required),
        choices: Object.freeze(choices.map((item) => Object.freeze(item))),
      }),
    );
  }
  const body = new URLSearchParams({ formhash: open.formhash });
  for (const entry of fixed) body.append(...entry);
  if (applying) url.searchParams.set("inajax", "1");
  return {
    method: "POST",
    url,
    fields: body,
    key: applying ? "activity_completion" : "activity_cancel_success",
    success: applying ? "activity-applied" : "activity-cancelled",
    inputs: Object.freeze(inputs),
    values(input) {
      if (input.choices !== undefined) return null;
      const provided = input.fields === undefined ? {} : object(input.fields);
      if (
        !provided ||
        Object.keys(provided).some(
          (name) => !inputs.some((control) => control.name === name),
        )
      )
        return null;
      const values: [string, string][] = [];
      for (const control of inputs) {
        const { name, type, value: fallback, choices, required } = control;
        const supplied = Object.hasOwn(provided, name)
          ? provided[name]
          : undefined;
        if (type === "checkbox") {
          const selected = supplied ?? (fallback ? [fallback] : []);
          if (
            !Array.isArray(selected) ||
            (required && !selected.length) ||
            new Set(selected).size !== selected.length ||
            selected.some(
              (value) => !choices.some((choice) => choice.value === value),
            )
          )
            return null;
          selected.forEach((value, index) =>
            values.push([`${name}[${index}]`, value]),
          );
          continue;
        }
        const value = supplied ?? fallback;
        if (
          typeof value !== "string" ||
          value.includes("\0") ||
          (required && !value.trim()) ||
          ((type === "radio" || type === "select") &&
            !choices.some((choice) => choice.value === value))
        )
          return null;
        values.push([name, value]);
      }
      return values;
    },
  };
}

function template(raw: unknown, token: "stand" | "pid", value: string) {
  if (typeof raw !== "string") return null;
  const sections = raw.split(`{${token}}`);
  return sections.length === 2 && !/[{}]/.test(sections.join(""))
    ? sections.join(value)
    : null;
}

function emptyInput(input: SpecialActionInput): [string, string][] | null {
  return input.choices === undefined && input.fields === undefined ? [] : null;
}

function debateVote(
  block: Record<string, unknown>,
  target: SpecialActionTarget,
  source: URL,
): Action | null {
  if (
    target.operation !== "debate-position" &&
    target.operation !== "debater-vote"
  )
    return null;
  const side = target.operation === "debate-position";
  const form = object(side ? block.vote : block.vote_post);
  const key = side ? "stand" : "pid";
  const value = "stand" in target ? String(target.stand) : target.postId;
  const url = actionURL(
    template(form?.action_template, key, value),
    source,
    { mod: "misc", action: "debatevote", tid: target.threadId, [key]: value },
    ["inajax"],
  );
  const supplied = fields(form?.fields);
  if (
    !url ||
    form?.method !== "GET" ||
    !supplied ||
    [...supplied.keys()].some((name) => name !== "inajax") ||
    (url.searchParams.get("inajax") ?? supplied.get("inajax")) !== "1" ||
    (supplied.has("inajax") && supplied.get("inajax") !== "1")
  )
    return null;
  return {
    method: "GET",
    url,
    fields: supplied,
    key: "debate_poll_succeed",
    success: side ? "debate-position-voted" : "debater-voted",
    values: emptyInput,
  };
}

function bountyAnswer(
  block: Record<string, unknown>,
  data: Record<string, unknown>,
  target: Extract<SpecialActionTarget, { postId: string }>,
  source: URL,
): Action | null {
  const form = object(block.set_best);
  const url = actionURL(
    template(form?.action_template, "pid", target.postId),
    source,
    {
      mod: "misc",
      action: "bestanswer",
      tid: target.threadId,
      pid: target.postId,
      bestanswersubmit: "yes",
    },
    ["from", "inajax"],
  );
  const supplied = fields(form?.fields);
  if (
    !url ||
    form?.method !== "POST" ||
    !supplied ||
    typeof data.formhash !== "string" ||
    !data.formhash
  )
    return null;
  const body = new URLSearchParams({ formhash: data.formhash });
  for (const entry of supplied) body.append(...entry);
  return {
    method: "POST",
    url,
    fields: body,
    key: "reward_completion",
    success: "bounty-answer-selected",
    values: emptyInput,
  };
}

const specs = {
  "poll-vote": { code: "1", type: "poll", flag: "can_vote" },
  "activity-apply": { code: "4", type: "activity", flag: "can_apply" },
  "activity-cancel": { code: "4", type: "activity", flag: "can_cancel" },
  "debate-position": { code: "5", type: "debate", flag: "can_vote" },
  "debater-vote": { code: "5", type: "debate" },
  "debate-join": { code: "5", type: "debate" },
  "bounty-answer": { code: "3", type: "reward", flag: "can_set_best" },
} as const;

export function createSpecialParticipation(
  options: SpecialThreadClientOptions,
  editorOptions: PostClientOptions,
) {
  const host = noticeHost(editorOptions);
  const forms = new WeakMap<
    SpecialActionForm,
    { action: Action; session: NoticeSession }
  >();

  async function prepareSpecialAction(
    target: SpecialActionTarget,
  ): Promise<SpecialActionPreparation> {
    if (
      !target ||
      !Object.hasOwn(specs, target.operation) ||
      typeof target.threadId !== "string" ||
      !positive(target.threadId) ||
      typeof target.boardId !== "string" ||
      !positive(target.boardId) ||
      (target.page !== undefined && !integer(target.page, 1))
    )
      return { kind: "invalid-input" };
    if (
      (target.operation === "debate-position" ||
        target.operation === "debate-join") &&
      target.stand !== 1 &&
      target.stand !== 2
    )
      return { kind: "invalid-input" };
    if (
      (target.operation === "debater-vote" ||
        target.operation === "bounty-answer") &&
      (typeof target.postId !== "string" || !positive(target.postId))
    )
      return { kind: "invalid-input" };
    const selected = Object.freeze({ ...target });
    const session = host.session();
    if (!session) return { kind: "refused" };
    const source = new URL(
      query(`${host.origin}/forum.php`, {
        mod: "viewthread",
        tid: selected.threadId,
        ...(selected.page !== undefined && { page: String(selected.page) }),
      }),
    );
    const response = await host.request(structured(source.href), session);
    if (response.kind !== "response") return response;
    if ([401, 403, 429].includes(response.response.status))
      return { kind: "refused" };
    if (response.response.status !== 200) return { kind: "invalid-response" };
    const payload = json(response.response.body);
    if (
      payload?.uid !== undefined &&
      numericId(payload.uid) !== session.memberId
    )
      return { kind: "session-changed" };
    if (requiresStructuredLogin(payload)) return { kind: "refused" };
    if (
      payload?.ok === 0 &&
      !["off", "unknown", "action"].includes(String(payload.error))
    )
      return { kind: "refused" };
    if (payload?.type === "thread" && payload.ok !== 1)
      return { kind: "invalid-response" };
    const data = decodeStructuredThread(payload);
    if (!data)
      return { kind: "browser-handoff", destination: source.href };
    const thread = object(data.thread);
    if (
      numericId(data.uid) !== session.memberId ||
      positive(thread?.tid) !== selected.threadId ||
      positive(thread?.fid) !== selected.boardId
    )
      return { kind: "invalid-response" };
    const block = object(data.special);
    const spec = specs[selected.operation];
    if (
      numericId(thread?.special) !== spec.code ||
      numericId(thread?.closed) !== "0"
    )
      return { kind: "refused" };
    if (!block) return { kind: "browser-handoff", destination: source.href };
    if (
      block.type !== spec.type ||
      ("flag" in spec && !enabled(block[spec.flag]))
    )
      return { kind: "refused" };
    if (spec.type === "debate" && numericId(block.ended) !== "0")
      return { kind: "refused" };
    if (selected.operation === "debate-join") {
      const currentStand = numericId(
        object(data.reply)?.stand ?? block.reply_stand,
      );
      if (
        !currentStand ||
        (currentStand !== "0" && currentStand !== String(selected.stand))
      )
        return { kind: "refused" };
      const destination = actionURL(
        template(block.join_template, "stand", String(selected.stand)),
        source,
        {
          mod: "post",
          action: "reply",
          tid: selected.threadId,
          fid: selected.boardId,
          stand: String(selected.stand),
        },
        [],
      );
      return destination
        ? { kind: "browser-handoff", destination: destination.href }
        : { kind: "invalid-response" };
    }
    if (
      selected.operation === "debater-vote" ||
      selected.operation === "bounty-answer"
    ) {
      const posts = Array.isArray(data.posts)
        ? data.posts
            .map(object)
            .filter((post) => positive(post?.pid) === selected.postId)
        : [];
      const post = posts.length === 1 ? posts[0] : null;
      if (!post || numericId(post.first) !== "0") return { kind: "refused" };
      if (
        selected.operation === "debater-vote" &&
        (!positive(post.authorid) ||
          numericId(post.authorid) === session.memberId ||
          !["1", "2"].includes(numericId(post.stand) ?? ""))
      )
        return { kind: "refused" };
      if (selected.operation === "bounty-answer") {
        const allowed = object(block.set_best)?.pids;
        if (
          numericId(block.resolved) !== "0" ||
          !Array.isArray(allowed) ||
          !allowed.some((pid) => positive(pid) === selected.postId)
        )
          return { kind: "refused" };
      }
    }
    let action;
    switch (selected.operation) {
      case "poll-vote":
        action = poll(block, data, selected, source);
        break;
      case "activity-apply":
      case "activity-cancel":
        action = activity(block, data, selected, source);
        break;
      case "debate-position":
      case "debater-vote":
        action = debateVote(block, selected, source);
        break;
      case "bounty-answer":
        action = bountyAnswer(block, data, selected, source);
        break;
    }
    if (action === "native")
      return { kind: "browser-handoff", destination: source.href };
    if (!action) return { kind: "invalid-response" };
    const form: SpecialActionForm = Object.freeze({
      target: selected,
      method: action.method,
      ...(action.choices && { choices: action.choices }),
      ...(action.maxChoices !== undefined && { maxChoices: action.maxChoices }),
      ...(action.inputs && { inputs: action.inputs }),
    });
    forms.set(form, { action, session });
    return { kind: "action-form", form };
  }

  async function submitSpecialAction(
    form: SpecialActionForm,
    input: SpecialActionInput = {},
  ): Promise<SpecialActionResult> {
    const record = forms.get(form);
    if (!record || !input) return { kind: "invalid-input" };
    const { action, session } = record;
    if (!host.current(session)) return { kind: "session-changed" };
    const values = action.values(input);
    if (!values) return { kind: "invalid-input" };
    const fields = new URLSearchParams(action.fields);
    for (const [name, value] of values) fields.set(name, value);
    const url = query(action.url.href, {
      ...(action.method === "GET" && Object.fromEntries(fields)),
      tsdmapp: "json",
    });
    forms.delete(form);
    try {
      const response = await options.transport.request(url, {
        fresh: true,
        session,
        effect: true,
        ...(action.method === "GET"
          ? { method: "GET" }
          : { method: "POST", body: fields.toString() }),
      });
      if (
        !host.current(session) ||
        response.redirect !== "none" ||
        response.url !== url
      )
        return { kind: "uncertain" };
      if ([401, 403, 429].includes(response.status))
        return { kind: "refused", message: "The forum refused the action." };
      if (response.status !== 200) return { kind: "uncertain" };
      const data = json(response.body);
      if (
        !data ||
        data.type !== "result" ||
        data.schema !== 13 ||
        numericId(data.uid) !== session.memberId ||
        !["handle", "message", "redirect"].includes(String(data.kind))
      )
        return { kind: "uncertain" };
      if (
        data.url &&
        resultThread(sameOrigin(data.url, url)) !== form.target.threadId
      )
        return { kind: "uncertain" };
      const message = typeof data.message === "string" ? data.message : "";
      const code = typeof data.message_key === "string" ? data.message_key : "";
      const needsLogin = requiresStructuredLogin(data);
      if (
        !needsLogin &&
        action.key === "debate_poll_succeed" &&
        code === "debate_poll_voted"
      )
        return { kind: "already-voted", message };
      if (
        data.ok === 0 ||
        needsLogin ||
        data.alert === "error" ||
        (action.key === "debate_poll_succeed" && code === "debate_poll_myself")
      )
        return { kind: "refused", message, ...(code && { code }) };
      if (data.ok !== 1 || code !== action.key) return { kind: "uncertain" };
      return { kind: action.success, message };
    } catch {
      return { kind: "uncertain" };
    }
  }
  return { prepareSpecialAction, submitSpecialAction };
}
