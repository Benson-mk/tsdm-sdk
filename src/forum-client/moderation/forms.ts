import { operationURL } from "../account-forms.js";
import { id, record, rows, string } from "../activity-protocol.js";
import {
  attr,
  controlDisabled,
  descendants,
  label,
  text,
  type Element,
  type Node,
} from "../html.js";
import { query } from "../posts/forms.js";
import { descriptor, operations } from "./operations.js";
import { forum, jsonWrite, validId } from "./protocol.js";
import type {
  ModerationChoice,
  ModerationField,
  ModerationForm,
  ModerationTarget,
  ModerationValues,
} from "./types.js";

export interface OfferedModeration {
  form: ModerationForm;
  url: string;
  fixed: URLSearchParams;
}
export const token = /^[\w-]{1,128}$/;
const flag = (value: unknown) => value === 1 || value === true;
const asValue = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : string(value);
const checked = (node: Element, name: string) =>
  node.attrs.some((item) => item.name === name);
const moderatorExtras = ["reason", "sendreasonpm"];
const highlightFields = /^highlight_style\[[123]\]$/;
const readonlyFields = ["position", "selectattach"];
const requiredFields = [
  "moveto",
  "copyto",
  "othertid",
  "subject",
  "split",
  "message",
  "logidarray[]",
];
const commonFixed = [
  "formhash",
  "fid",
  "tid",
  "pid",
  "page",
  "frommodcp",
  "redirect",
  "referer",
  "handlekey",
  "modsubmit",
  "ratesubmit",
  "commentsubmit",
  "topiclist",
  "topiclist[]",
  "moderate[]",
];
const collateral = ["banuser", "userdelpost", "crimerecord"];
const floorActions = ["delpost", "warn", "banpost", "stickreply"];
const standaloneActions = ["stamp", "stamplist", "copy", "merge", "split"];
export function moderationCapability(
  operation: ModerationTarget["operation"],
) {
  if (descriptor(operation).group || standaloneActions.includes(operation))
    return "moderate";
  if (
    ["delpost", "warn", "banpost", "delcomment", "removerate"].includes(
      operation,
    )
  )
    return operation;
  return null;
}
const financialActions = ["removereward", "refund"];

export function selectTarget(
  target: ModerationTarget,
): ModerationTarget | null {
  if (
    !target ||
    !Object.hasOwn(operations, target.operation) ||
    !validId(target.forumId) ||
    !Array.isArray(target.threadIds) ||
    !target.threadIds.length ||
    target.threadIds.length > 100 ||
    !target.threadIds.every(validId) ||
    new Set(target.threadIds).size !== target.threadIds.length ||
    (!descriptor(target.operation).group && target.threadIds.length !== 1) ||
    (descriptor(target.operation).post
      ? !validId(target.postId)
      : target.postId !== undefined) ||
    (target.operation === "delcomment"
      ? !validId(target.commentId)
      : target.commentId !== undefined) ||
    (target.operation === "deleteattach"
      ? !validId(target.attachmentId)
      : target.attachmentId !== undefined) ||
    (target.page !== undefined &&
      (!["repair", "deleteattach"].includes(target.operation) ||
        !Number.isSafeInteger(target.page) ||
        target.page < 1)) ||
    (target.splitPages !== undefined &&
      (target.operation !== "split" ||
        !Array.isArray(target.splitPages) ||
        !target.splitPages.length ||
        target.splitPages.length > 32 ||
        new Set(target.splitPages).size !== target.splitPages.length ||
        !target.splitPages.every(
          (page) => Number.isSafeInteger(page) && page > 0,
        ))) ||
    (target.undo !== undefined &&
      (target.undo !== true || target.operation !== "stickreply"))
  )
    return null;
  return Object.freeze({
    operation: target.operation,
    forumId: target.forumId,
    threadIds: Object.freeze([...target.threadIds]),
    ...(target.postId && { postId: target.postId }),
    ...(target.commentId && { commentId: target.commentId }),
    ...(target.undo && { undo: target.undo }),
    ...(target.attachmentId && { attachmentId: target.attachmentId }),
    ...(target.page && { page: target.page }),
    ...(target.splitPages && {
      splitPages: Object.freeze([...target.splitPages]),
    }),
  });
}
export function moderationWindow(origin: string, target: ModerationTarget) {
  const { operation, forumId: fid, postId: pid, commentId, undo } = target;
  const tid = target.threadIds[0]!;
  const info = descriptor(operation);
  if (operation === "delcomment")
    return jsonWrite(
      forum(origin, {
        mod: "topicadmin",
        action: operation,
        tid,
        handlekey: "mods",
        infloat: "yes",
        nopost: "yes",
        "topiclist[]": commentId!,
        inajax: "1",
      }),
    );
  if (operation === "removerate")
    return jsonWrite(
      forum(origin, {
        mod: "misc",
        action: operation,
        tid,
        pid: pid!,
        infloat: "yes",
        handlekey: "rate",
        inajax: "1",
      }),
    );
  if (financialActions.includes(operation))
    return query(
      forum(origin, { mod: "topicadmin", action: operation, fid, tid }),
      { tsdmapp: "json", tsdmform: "1", nodoc: "1" },
    );
  const url = new URL(
    forum(origin, {
      mod: "topicadmin",
      action: info.group ? "moderate" : target.operation,
      fid: target.forumId,
    }),
  );
  if (info.group)
    for (const tid of target.threadIds)
      url.searchParams.append("moderate[]", tid);
  else url.searchParams.set("tid", tid);
  if (floorActions.includes(operation))
    url.searchParams.set("topiclist[]", pid!);
  const native = query(url.href, {
    handlekey: "mods",
    infloat: "yes",
    nopost: "yes",
    ...(info.group && { optgroup: String(info.group) }),
    ...(info.query && { operation }),
    ...(undo && { undo: "1" }),
    inajax: "1",
  });
  return jsonWrite(native);
}
function submissionURL(
  raw: string,
  source: string,
  target: ModerationTarget,
  structured: boolean,
) {
  const { group } = descriptor(target.operation);
  const rating = target.operation === "removerate";
  const expected: Record<string, string> = {
    mod: rating ? "misc" : "topicadmin",
    action: group ? "moderate" : target.operation,
    ...(group && { optgroup: String(group) }),
    [rating ? "ratesubmit" : "modsubmit"]: "yes",
    infloat: "yes",
  };
  const native = operationURL(raw, new URL(source), "/forum.php", expected);
  if (
    !native ||
    [...native.searchParams].some(
      ([name, value]) =>
        !Object.hasOwn(expected, name) &&
        !(name === "modclick" && value === "yes" && !group) &&
        !(name === "inajax" && value === "1"),
    )
  )
    return null;
  return query(native.href, {
    inajax: "1",
    tsdmapp: "json",
    ...(structured && { tsdmv: "4" }),
  });
}
function fixedFields(
  raw: readonly [string, string][],
  source: string,
  target: ModerationTarget,
) {
  const fixed = new URLSearchParams();
  for (const [name, value] of raw) {
    if (
      !commonFixed.includes(name) ||
      typeof value !== "string" ||
      /[\0\r\n]/.test(value) ||
      (fixed.has(name) && name !== "moderate[]")
    )
      return null;
    if (name === "frommodcp" && value !== "") return null;
    if (["redirect", "referer"].includes(name) && value) {
      let destination;
      try {
        destination = new URL(value, source);
      } catch {
        return null;
      }
      destination.hash = "";
      if (
        !operationURL(destination.href, new URL(source), "/", {}) &&
        !operationURL(destination.href, new URL(source), "/forum.php", {
          mod: "forumdisplay",
          fid: target.forumId,
        }) &&
        !operationURL(destination.href, new URL(source), "/forum.php", {
          mod: "viewthread",
          tid: target.threadIds[0]!,
        })
      )
        return null;
    }
    fixed.append(name, value);
  }
  const rating = target.operation === "removerate";
  if (
    !token.test(fixed.get("formhash") ?? "") ||
    (!rating && fixed.get("fid") !== target.forumId) ||
    fixed.get("handlekey") !== (rating ? "rate" : "mods")
  )
    return null;
  if (
    !descriptor(target.operation).group &&
    fixed.get("tid") !== target.threadIds[0]
  )
    return null;
  if (
    floorActions.includes(target.operation) &&
    fixed.get("topiclist[]") !== target.postId
  )
    return null;
  if (
    target.operation === "delcomment" &&
    fixed.get("topiclist") !== target.commentId
  )
    return null;
  if (rating && fixed.get("pid") !== target.postId) return null;
  const bound = ["topiclist", "topiclist[]", "pid", "tid", "moderate[]"];
  const allowed = descriptor(target.operation).group
    ? ["moderate[]"]
    : [
        "tid",
        ...(rating
          ? ["pid"]
          : target.operation === "delcomment"
            ? ["topiclist"]
            : floorActions.includes(target.operation)
              ? ["topiclist[]"]
              : []),
      ];
  if (bound.some((name) => fixed.has(name) && !allowed.includes(name)))
    return null;
  return fixed;
}
function field(
  name: string,
  value: string,
  choices: ModerationChoice[] = [],
  required = false,
  multiple = false,
): ModerationField {
  return Object.freeze({
    name,
    value,
    choices: Object.freeze(choices.map((item) => Object.freeze(item))),
    required,
    multiple,
  });
}
function choicesOf(value: unknown) {
  return (rows(value) ?? []).flatMap((item) =>
    item &&
    !flag(item.disabled) &&
    ["string", "number"].includes(typeof item.value)
      ? [{ value: asValue(item.value), label: string(item.label) }]
      : [],
  );
}
function fieldsFromStructured(
  data: Record<string, unknown>,
  operation: Record<string, unknown>,
  target: ModerationTarget,
) {
  const controls = [
    ...Object.values(operation),
    ...Object.values(data),
    ...(rows(operation.style) ?? []),
  ];
  const result: ModerationField[] = [];
  for (const name of [
    ...descriptor(target.operation).fields,
    ...moderatorExtras,
  ]) {
    const node = controls.map(record).find((item) => item?.name === name);
    if (name === "logidarray[]") {
      const logs = (rows(data.logs) ?? []).flatMap((item) => {
        const value = string(item?.value);
        return /^\d+ \d+ \d+$/.test(value)
          ? [
              {
                value,
                label: [
                  string(item?.username),
                  asValue(item?.score),
                  string(item?.reason),
                ]
                  .filter(Boolean)
                  .join(" · "),
              },
            ]
          : [];
      });
      if (node && logs.length) result.push(field(name, "", logs, true, true));
    } else if (name === "moveto" || (name === "copyto" && node)) {
      const forums = (rows(data.forums) ?? []).flatMap((item) => {
        const fid = id(item?.fid);
        return fid && (name === "copyto" || fid !== target.forumId)
          ? [{ value: fid, label: string(item?.name) }]
          : [];
      });
      if (forums.length) result.push(field(name, "", forums, true));
    } else if (node) {
      const choices = choicesOf(node.choices);
      const value = asValue(node.value);
      result.push(
        name === "sendreasonpm"
          ? field(
              name,
              flag(node.forced) || flag(node.checked) ? value : "",
              [{ value, label: string(node.label) }],
              flag(node.forced),
            )
          : field(
              name,
              value,
              choices,
              flag(node.required) || requiredFields.includes(name),
            ),
      );
    }
  }
  return result;
}
function nativeControl(
  name: string,
  nodes: Element[],
  owner: Element,
): ModerationField | null {
  const editing = nodes.filter((node) => !controlDisabled(node));
  const selected = editing[0];
  if (!selected) {
    if (
      name === "sendreasonpm" &&
      nodes.length === 1 &&
      checked(nodes[0]!, "checked")
    ) {
      const value = attr(nodes[0]!, "value") || "on";
      return field(name, value, [{ value, label: "" }], true);
    }
    return null;
  }
  const type = attr(selected, "type");
  if (type === "radio" || type === "checkbox") {
    if (!editing.every((node) => attr(node, "type") === type)) return null;
    const chosen = editing.find((node) => checked(node, "checked"));
    const choices = editing.map((node) => {
      const link = attr(node, "id");
      const caption =
        link &&
        descendants(
          owner,
          (item) => item.tagName === "label" && attr(item, "for") === link,
        )[0];
      return {
        value: attr(node, "value") || "on",
        label: caption ? label(caption) : "",
      };
    });
    return field(
      name,
      chosen
        ? attr(chosen, "value") || "on"
        : type === "radio"
          ? choices[0]!.value
          : "",
      choices,
      requiredFields.includes(name),
      name === "logidarray[]",
    );
  }
  if (editing.length !== 1) return null;
  if (selected.tagName === "select") {
    const options = descendants(
      selected,
      (option) => option.tagName === "option" && !controlDisabled(option),
    );
    const choices = options.map((option) => ({
      value: attr(option, "value"),
      label: label(option),
    }));
    if (!choices.length) return null;
    const option =
      options.find((option) => checked(option, "selected")) ?? options[0]!;
    return field(
      name,
      attr(option, "value"),
      choices,
      requiredFields.includes(name),
    );
  }
  if (
    selected.tagName === "textarea" ||
    ["hidden", "text", ""].includes(type)
  ) {
    const value =
      selected.tagName === "textarea"
        ? text(selected)
        : attr(selected, "value");
    const choices =
      name === "highlight_color"
        ? Array.from({ length: 9 }, (_, i) => ({
            value: String(i),
            label: "",
          }))
        : highlightFields.test(name)
          ? ["0", "1"].map((value) => ({ value, label: "" }))
          : [];
    return field(
      name,
      value,
      choices,
      requiredFields.includes(name) || checked(selected, "required"),
    );
  }
  return null;
}
function finish(
  target: ModerationTarget,
  source: string,
  action: string,
  raw: [string, string][],
  fields: ModerationField[],
  context: string[],
  structured: boolean,
) {
  const url = submissionURL(action, source, target, structured);
  const fixed = fixedFields(raw, source, target);
  if (!url || !fixed) return null;
  const { group, fields: expected } = descriptor(target.operation);
  if (group) {
    const ids = fixed.getAll("moderate[]");
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((tid) => !target.threadIds.includes(tid))
    )
      return null;
    if (ids.length !== target.threadIds.length)
      return { offeredThreadIds: Object.freeze(ids) };
    fixed.set("operations[]", target.operation);
  }
  if (
    expected.some(
      (name) =>
        !fields.some((item) => item.name === name) &&
        ![
          "position",
          "reducetitle",
          "selectattach",
          "threadtypeid",
          "expirationdown",
        ].includes(name),
    )
  )
    return null;
  const form: ModerationForm = Object.freeze({
    target,
    method: "POST",
    fields: Object.freeze(fields),
    context: Object.freeze(context),
  });
  return { form, url, fixed };
}
export function offeredForm(
  data: Record<string, unknown>,
  source: string,
  target: ModerationTarget,
) {
  const info = descriptor(target.operation);
  const submit = record(data.submit);
  const hidden = record(submit?.fields);
  const financial = financialActions.includes(target.operation);
  const standalone = standaloneActions.includes(target.operation);
  const formName = info.group || standalone ? "moderate" : target.operation;
  if (
    data.type !== "form" ||
    data.schema !== 17 ||
    data.ok !== 1 ||
    data.form !== formName ||
    (standalone &&
      (data.action !== target.operation ||
        id(data.fid) !== target.forumId)) ||
    (data.fid !== undefined && id(data.fid) !== target.forumId) ||
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !hidden ||
    (Array.isArray(data.unsupported) && data.unsupported.length) ||
    (Array.isArray(data.hook_fields) && data.hook_fields.length) ||
    collateral.some((name) => {
      const value = data[name];
      return (Array.isArray(value) ? value : [value]).some((item) =>
        flag(record(item)?.checked),
      );
    })
  )
    return null;
  const lists = record(submit.lists) ?? {};
  const raw = Object.entries(hidden) as [string, string][];
  let op: Record<string, unknown> = {};
  if (info.group) {
    if (
      id(data.fid) !== target.forumId ||
      data.optgroup !== info.group ||
      (data.operation && data.operation !== target.operation)
    )
      return null;
    const matching = rows(data.operations)?.filter(
      (item) =>
        item?.name === "operations[]" && item.value === target.operation,
    );
    const offered = matching?.length === 1 ? matching[0] : null;
    if (!offered || flag(offered.disabled)) return null;
    op = offered;
    const ids = lists["moderate[]"];
    if (
      !Array.isArray(ids) ||
      !ids.every(validId) ||
      !Array.isArray(data.tids) ||
      JSON.stringify(ids) !== JSON.stringify(data.tids.map(id)) ||
      Object.keys(lists).length !== 1
    )
      return null;
    for (const tid of ids) raw.push(["moderate[]", tid]);
  } else if (floorActions.includes(target.operation)) {
    if (
      id(data.tid) !== target.threadIds[0] ||
      id(data.fid) !== target.forumId ||
      !Array.isArray(data.pids) ||
      data.pids.length !== 1 ||
      id(data.pids[0]) !== target.postId ||
      Object.keys(lists).length !== 1 ||
      !Array.isArray(lists["topiclist[]"]) ||
      lists["topiclist[]"].length !== 1 ||
      lists["topiclist[]"][0] !== target.postId
    )
      return null;
    raw.push(["topiclist[]", target.postId!]);
  } else if (
    Object.keys(lists).length ||
    id(data.tid) !== target.threadIds[0] ||
    (target.postId && id(data.pid) !== target.postId) ||
    (target.commentId && id(data.id) !== target.commentId)
  )
    return null;
  const context = financial
    ? [
        string(data.subject),
        string(record(data.credit)?.title),
        ...["price", "payers", "income", "solved"].flatMap((key) =>
          data[key] === undefined ? [] : [`${key} ${asValue(data[key])}`],
        ),
      ].filter(Boolean)
    : [];
  if (
    financial &&
    (!context.length ||
      (target.operation === "removereward" && data.special !== 3))
  )
    return null;
  return finish(
    target,
    source,
    string(submit.url),
    raw,
    fieldsFromStructured(data, op, target),
    context,
    !financial,
  );
}
export function nativeForm(
  doc: Node,
  source: string,
  target: ModerationTarget,
) {
  const { group, fields: expected } = descriptor(target.operation);
  const name = group
    ? "moderateform"
    : target.operation === "removerate"
      ? "rateform"
      : "topicadminform";
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === name,
  );
  const form = forms.length === 1 ? forms[0] : null;
  if (
    !form ||
    attr(form, "method").toLowerCase() !== "post" ||
    (attr(form, "enctype") &&
      attr(form, "enctype") !== "application/x-www-form-urlencoded")
  )
    return null;
  const find = (node: Element) =>
    ["input", "textarea", "select", "button"].includes(node.tagName);
  const controls = descendants(form, find);
  if (
    controls.some((control) =>
      ["form", "formaction", "formmethod", "formenctype"].some((name) =>
        checked(control, name),
      ),
    )
  )
    return null;
  const lookup = (name: string) =>
    controls.filter((item) => attr(item, "name") === name);
  if (
    group &&
    !lookup("operations[]").some(
      (item) =>
        !controlDisabled(item) && attr(item, "value") === target.operation,
    )
  )
    return null;
  if (
    collateral.some((name) =>
      lookup(name).some((item) => checked(item, "checked")),
    )
  )
    return null;
  const raw: [string, string][] = controls.flatMap((control) => {
    const name = attr(control, "name");
    return commonFixed.includes(name) &&
      !controlDisabled(control) &&
      attr(control, "type") === "hidden"
      ? [[name, attr(control, "value")]]
      : [];
  });
  const fields = [...expected, ...moderatorExtras].flatMap((name) => {
    const input = nativeControl(name, lookup(name), form);
    return input ? [input] : [];
  });
  const financial = financialActions.includes(target.operation);
  const context = financial ? [label(form).slice(0, 600)].filter(Boolean) : [];
  if (financial && !context.length) return null;
  return finish(
    target,
    source,
    attr(form, "action"),
    raw,
    fields,
    context,
    false,
  );
}
export function moderationBody(
  offer: OfferedModeration,
  values: ModerationValues,
) {
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.keys(values).some(
      (name) =>
        readonlyFields.includes(name) ||
        !offer.form.fields.some((field) => field.name === name),
    )
  )
    return null;
  const body = new URLSearchParams(offer.fixed);
  for (const field of offer.form.fields) {
    const { name, choices } = field;
    if (["copyto", "moveto"].includes(name) && !Object.hasOwn(values, name))
      return null;
    const value = Object.hasOwn(values, name) ? values[name] : field.value;
    if (field.multiple) {
      if (
        !Array.isArray(value) ||
        !value.length ||
        new Set(value).size !== value.length ||
        value.some(
          (item) =>
            typeof item !== "string" ||
            !choices.some((choice) => choice.value === item),
        )
      )
        return null;
      for (const item of value) body.append(name, item);
      continue;
    }
    if (
      typeof value !== "string" ||
      value.length > 4000 ||
      /[\0]/.test(value) ||
      (field.required && !value.trim())
    )
      return null;
    if (
      choices.length &&
      !choices.some((choice) => choice.value === value) &&
      name !== "threadtypeid" &&
      !(name === "sendreasonpm" && value === "")
    )
      return null;
    if (name === "sendreasonpm" && !value) continue;
    if (
      name.startsWith("expiration") &&
      value &&
      !/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(value)
    )
      return null;
    if (name === "highlight_bgcolor" && value && !/^#[\da-f]{6}$/i.test(value))
      return null;
    if (
      name === "othertid" &&
      (!validId(value) || offer.form.target.threadIds.includes(value))
    )
      return null;
    if (
      name === "split" &&
      (!value.split(",").every(validId) ||
        new Set(value.split(",")).size !== value.split(",").length)
    )
      return null;
    if (name === "threadtypeid" && value !== "0" && !validId(value))
      return null;
    body.append(name, value);
  }
  return body;
}
