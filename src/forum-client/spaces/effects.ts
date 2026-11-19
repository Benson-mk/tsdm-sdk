import { numericId } from "../notice-transport.js";
import { unsupportedV4 } from "../v4-selection.js";
import { operationURL, unwrap } from "../account-forms.js";
import { positive, record } from "../discovery/shared.js";
import {
  attr,
  byId,
  controlDisabled,
  descendants,
  documentFrom,
  label,
  text,
  type Element,
  type Node,
} from "../html.js";
import { documentScripts } from "./native.js";
import { readAccount } from "../structured-read.js";
import type { HostResponse } from "../../index.js";
import type {
  PreparedSpaceWrite,
  PrepareSpaceWrite,
  SpaceClientOptions,
  SpaceCommand,
  SpaceEffect,
  SpacePage,
  SpacePreparation,
  SpaceRead,
} from "./model.js";
import { forumURL, spaceRoute, type SpaceRoute } from "./routes.js";
import { flag, str } from "./structured.js";

type Fields = Record<string, unknown>;
type Identify = (doc: Node, base: string) => ReturnType<typeof readAccount>;
export interface SpaceObservation {
  payload: Fields | null;
  doc: Node | null;
  route: SpaceRoute;
}
type Plan = {
  ac: string;
  submit?: URL;
  query?: Record<string, string>;
  fields: Record<string, string>;
  key: string;
  success: string;
  target: string | null;
};
const formHash = (value: unknown) =>
  typeof value === "string" && /^[a-z0-9]{8}$/i.test(value) ? value : null;
const field = (node: Node, name: string) =>
  descendants(
    node,
    (item) => attr(item, "name") === name && !controlDisabled(item),
  );
const can = (value: unknown) => record(value) !== null || flag(value);
const validId = (value: unknown) =>
  typeof value === "string" && Boolean(positive(value));
const textInput = (value: unknown, max = Infinity) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  [...value.trim()].length <= max;

const lists = {
  statuses: "doings",
  "status-replies": "comments",
  timeline: "feeds",
  following: "users",
  followers: "users",
  wall: "comments",
  greetings: "pokes",
} as const;
function sourceRow(
  page: SpacePage,
  observation: SpaceObservation,
  id: string,
) {
  const key = lists[page.view as keyof typeof lists];
  const rows = observation.payload?.[key];
  const idKey =
    page.view === "statuses"
      ? "doid"
      : page.view === "status-replies"
        ? "id"
        : page.view === "timeline"
          ? "feedid"
          : page.view === "wall"
            ? "cid"
            : "uid";
  return Array.isArray(rows)
    ? rows.map(record).find((item) => positive(item?.[idKey]) === id)
    : undefined;
}
function nativeAction(
  observed: SpaceObservation,
  ac: string,
  op: string,
  keys: Record<string, string>,
  selector?: string,
) {
  if (!observed.doc) return false;
  return descendants(
    observed.doc,
    (item) =>
      item.tagName === "a" && (!selector || attr(item, "id") === selector),
  ).some((item) => {
    const raw = attr(item, "href");
    const url = raw && forumURL(raw, observed.route.url.origin);
    return (
      url &&
      url.pathname === "/home.php" &&
      url.searchParams.get("mod") === "spacecp" &&
      url.searchParams.get("ac") === ac &&
      url.searchParams.get("op") === op &&
      Object.entries(keys).every(
        ([key, value]) => url.searchParams.get(key) === value,
      )
    );
  });
}

function observedHash(doc: Node, base: string): string | null {
  const input = field(doc, "formhash")[0];
  if (input) return formHash(attr(input, "value"));
  for (const link of descendants(doc, (node) => node.tagName === "a")) {
    const href = attr(link, "href");
    const url = href && forumURL(href, base);
    if (
      url &&
      url.pathname === "/member.php" &&
      url.searchParams.get("mod") === "logging" &&
      url.searchParams.get("action") === "logout"
    ) {
      const token = formHash(url.searchParams.get("formhash"));
      if (token) return token;
    }
  }
  return formHash(
    /\bformhash\s*=\s*['"]([a-z0-9]{8})['"]/i.exec(documentScripts(doc))?.[1],
  );
}

function sourceFor(
  input: PrepareSpaceWrite,
  base: string,
): SpaceRoute | null {
  if (!input.source) return null;
  const route = spaceRoute(input.source, base);
  if (!route) return null;
  const c = input.command;
  const params = route.url.searchParams;
  switch (c.action) {
    case "post-status":
      return route.view === "statuses" ? route : null;
    case "reply-status":
      return route.view === "status-replies" &&
        params.get("doid") === c.statusId
        ? route
        : null;
    case "delete-status":
      return c.replyId
        ? route.view === "status-replies" && params.get("doid") === c.statusId
          ? route
          : null
        : route.view === "statuses"
          ? route
          : null;
    case "post-wall":
      return route.view === "wall" &&
        (route.owner ?? input.accountId) === c.memberId
        ? route
        : null;
    case "reply-wall":
      return route.view === "wall" &&
        (route.owner ?? input.accountId) === input.accountId
        ? route
        : null;
    case "delete-wall":
      return route.view === "wall" ? route : null;
    case "ignore-greeting":
    case "ignore-all-greetings":
      return route.view === "greetings" ? route : null;
    case "follow":
      return route.view === "following" &&
        route.owner === c.memberId &&
        c.memberId !== input.accountId
        ? route
        : null;
    case "unfollow":
    case "rename-follow":
      return route.view === "following" &&
        (route.owner ?? input.accountId) === input.accountId &&
        c.memberId !== input.accountId
        ? route
        : null;
    case "relay":
    case "delete-feed":
      return route.view === "timeline" ? route : null;
    default:
      return null;
  }
}

function planFor(
  c: SpaceCommand,
  page: SpacePage,
  observed: SpaceObservation,
  accountId: string,
): Plan | null {
  const payload = observed.payload;
  const doc = observed.doc;
  const target =
    "statusId" in c
      ? (c.replyId ?? c.statusId)
      : "commentId" in c
        ? c.commentId
        : "feedId" in c
          ? c.feedId
          : "memberId" in c
            ? c.memberId
            : null;
  const row = target ? sourceRow(page, observed, target) : undefined;
  const displayed = page.entries.find((item) => item.id === target);
  const post = (
    ac: string,
    key: string,
    fields: Plan["fields"],
    query?: Plan["query"],
    success = "do_success",
  ): Plan => ({
    ac,
    key,
    fields,
    ...(query ? { query } : {}),
    success,
    target,
  });
  const remove = { deletesubmit: "true" };
  switch (c.action) {
    case "post-status":
      return (can(payload?.post) || (doc && byId(doc, "mood_addform"))) &&
        textInput(c.message, 200)
        ? post("doing", "doing", {
            addsubmit: "true",
            message: c.message.trim(),
          })
        : null;
    case "reply-status": {
      const allowed = c.replyId
        ? displayed &&
          (can(row?.reply) ||
            (doc &&
              descendants(
                doc,
                (node) => attr(node, "id") === `comment_${c.replyId}_li`,
              ).some(
                (item) =>
                  descendants(item, (link) =>
                    /^docomment_form\(/.test(attr(link, "onclick")),
                  ).length,
              )))
        : can(payload?.reply) ||
          (doc && field(doc, "commentsubmit").length > 0);
      return allowed && textInput(c.message, 200)
        ? post(
            "doing",
            `doing_${c.statusId}`,
            { commentsubmit: "true", message: c.message.trim() },
            { op: "comment", doid: c.statusId, docid: c.replyId ?? "0" },
          )
        : null;
    }
    case "delete-status": {
      const keys = {
        doid: c.statusId,
        ...(c.replyId ? { docid: c.replyId } : {}),
      };
      const allowed =
        displayed &&
        (can(row?.delete) ||
          flag(row?.can_delete) ||
          nativeAction(observed, "doing", "delete", keys));
      return allowed
        ? post(
            "doing",
            `doinghk_${c.statusId}${c.replyId ? "_" + c.replyId : ""}`,
            remove,
            { op: "delete", ...keys },
          )
        : null;
    }
    case "post-wall": {
      const fields = record(record(payload?.post)?.fields);
      const structured =
        can(payload?.post) &&
        (!fields || !("id" in fields) || positive(fields.id) === c.memberId);
      return (structured ||
        (doc && byId(doc, `quickcommentform_${c.memberId}`))) &&
        textInput(c.message)
        ? post("comment", `qcwall_${c.memberId}`, {
            id: c.memberId,
            idtype: "uid",
            commentsubmit: "true",
            quickcomment: "true",
            message: c.message.trim(),
          })
        : null;
    }
    case "reply-wall": {
      const author = displayed?.author?.id;
      const fields = record(record(row?.reply)?.fields);
      const allowed =
        (can(row?.reply) &&
          (!fields?.id || positive(fields.id) === author) &&
          (!fields?.cid || positive(fields.cid) === c.commentId)) ||
        nativeAction(
          observed,
          "comment",
          "reply",
          { cid: c.commentId },
          `c_${c.commentId}_reply`,
        );
      return author && author !== accountId && allowed && textInput(c.message)
        ? post(
            "comment",
            `replycommenthk_${c.commentId}`,
            {
              id: author,
              idtype: "uid",
              commentsubmit: "true",
              cid: c.commentId,
              message: c.message.trim(),
            },
            undefined,
            "note_wall_reply_success",
          )
        : null;
    }
    case "delete-wall":
      return displayed &&
        (can(row?.delete) ||
          flag(row?.can_delete) ||
          nativeAction(
            observed,
            "comment",
            "delete",
            { cid: c.commentId },
            `c_${c.commentId}_delete`,
          ))
        ? post("comment", `delcommenthk_${c.commentId}`, remove, {
            op: "delete",
            cid: c.commentId,
          })
        : null;
    case "ignore-greeting":
      return displayed &&
        (can(row?.ignore) ||
          nativeAction(observed, "poke", "ignore", { uid: c.memberId }))
        ? post(
            "poke",
            "pokeignore",
            { ignoresubmit: "true", from: "" },
            { op: "ignore", uid: c.memberId },
            "has_been_hailed_overlooked",
          )
        : null;
    case "ignore-all-greetings":
      return can(payload?.ignore_all) ||
        nativeAction(observed, "poke", "ignore", {}, "a_poke")
        ? post(
            "poke",
            "allignore",
            { ignoresubmit: "true", from: "" },
            { op: "ignore" },
            "has_been_hailed_overlooked",
          )
        : null;
    case "follow":
      return page.owner?.id === c.memberId
        ? post(
            "follow",
            "followmod",
            {},
            { op: "add", fuid: c.memberId },
            "follow_add_succeed",
          )
        : null;
    case "unfollow":
      return displayed &&
        (row?.unfollow_url ||
          nativeAction(observed, "follow", "del", { fuid: c.memberId }))
        ? post(
            "follow",
            "followmod",
            {},
            { op: "del", fuid: c.memberId },
            "follow_cancel_succeed",
          )
        : null;
    case "rename-follow":
      return displayed &&
        (row?.note_url ||
          nativeAction(observed, "follow", "bkname", { fuid: c.memberId })) &&
        typeof c.name === "string"
        ? post(
            "follow",
            `fbkname_${c.memberId}`,
            { editbkname: "true", bkname: c.name.trim() },
            { op: "bkname", fuid: c.memberId },
            "follow_remark_succeed",
          )
        : null;
    case "relay": {
      const thread = record(row?.thread);
      const link = displayed?.links.find((item) => item.relation === "relay");
      const advertised = link && forumURL(link.url, observed.route.url.origin);
      const tid = positive(
        thread?.tid ?? (advertised ? advertised.searchParams.get("tid") : null),
      );
      return advertised &&
        advertised.pathname === "/home.php" &&
        advertised.searchParams.get("mod") === "spacecp" &&
        advertised.searchParams.get("ac") === "follow" &&
        advertised.searchParams.get("op") === "relay" &&
        advertised.searchParams.get("tid") === tid &&
        advertised.searchParams.get("feedid") === c.feedId &&
        tid &&
        typeof c.reply === "boolean" &&
        typeof c.note === "string" &&
        Buffer.byteLength(c.note.trim()) <= 140
        ? post(
            "follow",
            `qrelay_${tid}`,
            {
              relaysubmit: "true",
              tid,
              note: c.note.trim(),
              ...(c.reply ? { addnewreply: "1" } : {}),
            },
            { op: "relay", tid },
            "relay_feed_success",
          )
        : null;
    }
    case "delete-feed":
      return displayed &&
        (can(row?.delete) ||
          nativeAction(observed, "follow", "delete", { feedid: c.feedId }))
        ? post("follow", `c_delete_${c.feedId}`, remove, {
            op: "delete",
            feedid: c.feedId,
          })
        : null;
    default:
      return null;
  }
}

function documentForm(
  doc: Node,
  destination: URL,
  submit: string,
): Element | null {
  const forms = descendants(
    doc,
    (node) =>
      node.tagName === "form" &&
      attr(node, "method").toLowerCase() === "post" &&
      field(node, submit).some((item) => attr(item, "value") === "true"),
  );
  const matches = forms.filter((node) => {
    const action = forumURL(attr(node, "action"), destination.origin);
    return (
      action?.pathname === destination.pathname &&
      [...destination.searchParams].every(
        ([key, value]) =>
          action.searchParams.getAll(key).length === 1 &&
          action.searchParams.get(key) === value,
      ) &&
      [...action.searchParams.keys()].every(
        (key) =>
          destination.searchParams.has(key) ||
          ["handlekey", "inajax"].includes(key),
      )
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

function greetingOffer(
  payload: Fields,
  destination: URL,
  command: Extract<
    SpaceCommand,
    { action: "send-greeting" | "reply-greeting" }
  >,
) {
  const operation = command.action === "reply-greeting" ? "reply" : "send";
  const submit = record(payload.submit);
  const fields = record(submit?.fields);
  const token = formHash(fields?.formhash);
  const key = str(fields?.handlekey);
  const referer = str(fields?.referer);
  const controls = record(payload.iconid);
  const url = operationURL(str(submit?.url) ?? "", destination, "/home.php", {
    mod: "spacecp",
    ac: "poke",
    op: operation,
    uid: command.memberId,
  });
  if (
    payload.ok !== 1 ||
    payload.type !== "form" ||
    payload.schema !== 17 ||
    payload.form !== "poke" ||
    payload.op !== operation ||
    numericId(payload.touid) !== command.memberId ||
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !url ||
    [...url.searchParams].some(
      ([name, value]) =>
        !destination.searchParams.has(name) &&
        !(name === "inajax" && value === "1"),
    ) ||
    !fields ||
    !token ||
    !key ||
    !/^[a-zA-Z0-9_]{1,128}$/.test(key) ||
    fields.pokesubmit !== "true" ||
    fields.from !== "" ||
    Object.keys(fields).some(
      (name) =>
        !["formhash", "handlekey", "pokesubmit", "from", "referer"].includes(
          name,
        ),
    ) ||
    (fields.referer !== undefined &&
      (!referer || !forumURL(referer, destination.origin))) ||
    (submit.lists !== undefined &&
      (!record(submit.lists) || Object.keys(record(submit.lists)!).length)) ||
    [payload.hook_fields, payload.unsupported].some(
      (value) =>
        value !== undefined && (!Array.isArray(value) || value.length),
    ) ||
    controls?.name !== "iconid" ||
    controls.type !== "radio" ||
    !Array.isArray(controls.choices) ||
    !controls.choices.some((value) => {
      const choice = record(value);
      return str(choice?.value) === command.iconId && !flag(choice?.disabled);
    }) ||
    record(payload.note)?.name !== "note" ||
    typeof command.note !== "string" ||
    [...command.note.trim()].length > 50
  )
    return null;
  url.searchParams.set("inajax", "1");
  url.searchParams.set("tsdmapp", "json");
  url.searchParams.set("tsdmv", "4");
  const plan: Plan = {
    ac: "poke",
    submit: url,
    fields: {
      ...(referer && { referer }),
      pokesubmit: "true",
      from: "",
      iconid: command.iconId,
      note: command.note.trim(),
    },
    key,
    success: "poke_success",
    target: command.memberId,
  };
  return { plan, token };
}

function blogPlan(
  c: Extract<SpaceCommand, { action: "publish-blog" }>,
  form: Element,
): Plan | null {
  const offered = (name: string, value: string) =>
    field(form, name).some(
      (select) =>
        select.tagName === "select" &&
        descendants(
          select,
          (option) =>
            option.tagName === "option" &&
            !controlDisabled(option) &&
            attr(option, "value") === value,
        ).length > 0,
    );
  const category = c.category ?? "0";
  if (
    !textInput(c.subject, 255) ||
    !textInput(c.message) ||
    !offered("friend", c.privacy) ||
    !["0", "1", "2", "3", "4"].includes(c.privacy) ||
    c.privacy === "2" ||
    (c.privacy === "4" && !textInput(c.password, 100)) ||
    (!c.newCategory && !offered("classid", category)) ||
    (c.newCategory && !textInput(c.newCategory, 100)) ||
    (c.systemCategory && !offered("catid", c.systemCategory)) ||
    !field(form, "subject").length ||
    !field(form, "message").length
  )
    return null;
  return {
    ac: "blog",
    key: "",
    target: null,
    success: "do_success",
    query: { blogid: "" },
    fields: {
      blogsubmit: "true",
      plaintext: "1",
      subject: c.subject.trim(),
      message: c.message
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replace(/\r\n?/g, "\n"),
      classid: c.newCategory ? `new:${c.newCategory.trim()}` : category,
      friend: c.privacy,
      tags: "",
      ...(c.privacy === "4" && c.password ? { password: c.password } : {}),
      ...(c.systemCategory ? { catid: c.systemCategory } : {}),
    },
  };
}

function writeResult(
  response: HostResponse,
  url: URL,
  plan: Plan,
  prepared: PreparedSpaceWrite,
  json: (response: HostResponse) => Fields | null,
  identify: Identify,
): SpaceEffect {
  if (response.redirect !== "none" || response.url !== url.href)
    return { kind: "uncertain" };
  const payload = json(response);
  const key = str(payload?.message_key);
  const message = str(payload?.message) ?? "";
  const viewer = readAccount(payload ?? {});
  if (viewer.kind === "member" && viewer.id !== prepared.accountId)
    return { kind: "uncertain" };
  if (response.status === 429) return { kind: "limited" };
  if (response.status === 401 || payload?.login === 1 || key === "to_login")
    return { kind: "login" };
  if (response.status === 403) return { kind: "refused" };
  if (response.status !== 200) return { kind: "uncertain" };
  if (payload?.type === "result" && payload.schema === 13) {
    const explicitGreetingSuccess =
      plan.ac === "poke" && key === plan.success && payload.handlekey === "";
    if (
      payload.kind === "handle" &&
      payload.handlekey !== plan.key &&
      !explicitGreetingSuccess
    )
      return { kind: "uncertain" };
    if (payload.ok === 0 || payload.alert === "error")
      return {
        kind: "refused",
        ...(key ? { messageKey: key } : {}),
        ...(message ? { message } : {}),
      };
    if (
      payload.ok === 1 &&
      key === plan.success &&
      ["message", "handle", "redirect"].includes(String(payload.kind)) &&
      viewer.kind === "member"
    ) {
      const destination =
        typeof payload.url === "string"
          ? spaceRoute(payload.url, url.origin)
          : null;
      const blog =
        destination?.view === "blog" &&
        (!destination.owner || destination.owner === prepared.accountId)
          ? destination.url.href
          : null;
      if (prepared.action === "publish-blog" && !blog)
        return { kind: "uncertain" };
      return {
        kind: "confirmed",
        action: prepared.action,
        messageKey: key,
        destination: prepared.action === "publish-blog" ? blog : null,
        savedName: str(record(payload.values)?.bkname),
      };
    }
  }
  const source = payload ? (str(payload.document) ?? "") : response.body;
  const native = documentFrom(unwrap(source));
  const nativeViewer = identify(native, url.href);
  if (nativeViewer.kind === "member" && nativeViewer.id !== prepared.accountId)
    return { kind: "uncertain" };
  const ownHandler =
    plan.key &&
    new RegExp(
      String.raw`^\s*(?:if\s*\(\s*typeof\s+(?:succeed|error)handle_${plan.key}\s*={2,3}\s*['"]function['"]\s*\)\s*\{\s*)?(succeed|error)handle_${plan.key}\s*\(\s*(['"])`,
    );
  const handler = ownHandler
    ? descendants(native, (node) => node.tagName === "script")
        .map(
          (node) => ownHandler.exec(node.childNodes.map(text).join(""))?.[1],
        )
        .find(Boolean)
    : null;
  if (handler === "succeed")
    return {
      kind: "confirmed",
      action: prepared.action,
      messageKey: null,
      destination: null,
      savedName: null,
    };
  if (handler === "error" || source.trim() === "Access Denied")
    return { kind: "refused" };
  const notice = byId(native, "messagetext");
  if (
    byId(native, "messagelogin") ||
    (notice && /先登[录錄入]|sign in|log in/i.test(label(notice)))
  )
    return { kind: "login" };
  if (notice && /权限|權限|不存在|太快/.test(label(notice)))
    return { kind: "refused", message: label(notice) };
  return { kind: "uncertain" };
}

export function spaceEffects(
  options: SpaceClientOptions,
  base: string,
  read: (
    destination: string,
    capture?: (value: SpaceObservation) => void,
  ) => Promise<SpaceRead>,
  json: (response: HostResponse) => Fields | null,
  identify: Identify,
  capability: (
    group: "forms",
    name: string,
    continuity: string,
    memberId: string,
  ) => Promise<{ kind: "session-changed" | "limited" | "legacy" | "v4" }>,
) {
  const prepared = new WeakMap<
    PreparedSpaceWrite,
    {
      plan: Plan;
      token: string;
      session: string;
      identity: PreparedSpaceWrite;
    }
  >();
  const failure = (
    kind:
      | "invalid"
      | "incomplete"
      | "login"
      | "permission"
      | "missing"
      | "limited"
      | "unavailable",
    url: string,
    message: string,
  ): SpacePreparation => ({ kind, url, message });
  function remember(
    plan: Plan,
    token: string,
    continuity: string,
    accountId: string,
    action: SpaceCommand["action"],
  ) {
    const identity: PreparedSpaceWrite = {
      kind: "prepared",
      action,
      accountId,
      targetId: plan.target,
    };
    const handle = Object.freeze({ ...identity });
    prepared.set(handle, { plan, token, session: continuity, identity });
    return handle;
  }
  return {
    async prepare(request: PrepareSpaceWrite): Promise<SpacePreparation> {
      const input = { ...request, command: { ...request.command } };
      const { accountId, command } = input;
      const continuity = options.session();
      const source = input.source ?? base;
      const identifierKeys = [
        "memberId",
        "statusId",
        "replyId",
        "commentId",
        "feedId",
      ] as const;
      if (
        !validId(accountId) ||
        identifierKeys.some(
          (key) =>
            key in command &&
            !validId((command as Record<string, unknown>)[key]),
        )
      )
        return failure(
          "invalid",
          source,
          "Invalid account or space identifier.",
        );
      if (!continuity) return { kind: "stale" };
      let plan: Plan | null;
      let token: string | null;
      if (
        command.action === "publish-blog" ||
        command.action === "send-greeting" ||
        command.action === "reply-greeting"
      ) {
        if (
          input.source !== null ||
          ("memberId" in command && command.memberId === accountId)
        )
          return failure(
            "invalid",
            source,
            "The requested form scope is invalid.",
          );
        const blog = command.action === "publish-blog";
        const destination = new URL("/home.php", base);
        const operation =
          command.action === "reply-greeting" ? "reply" : "send";
        destination.search = new URLSearchParams({
          mod: "spacecp",
          ...(blog
            ? { ac: "blog" }
            : { ac: "poke", op: operation, uid: command.memberId }),
        }).toString();
        const formURL = destination.href;
        const handoff = (): SpacePreparation => ({
          kind: "document-navigation",
          url: formURL,
          destination: formURL,
          message: "Open this forum form in the original session.",
        });
        let structuredOffer: ReturnType<typeof greetingOffer> = null;
        if (!blog) {
          const status = await capability(
            "forms",
            "poke",
            continuity,
            accountId,
          );
          if (status.kind === "session-changed") return { kind: "stale" };
          if (status.kind === "limited")
            return failure(
              "limited",
              formURL,
              "The forum is limiting requests.",
            );
          if (status.kind === "v4") {
            const window = new URL(formURL);
            window.searchParams.set(
              "handlekey",
              operation === "reply"
                ? "pokereply"
                : `propokehk_${command.memberId}`,
            );
            for (const [key, value] of Object.entries({
              infloat: "yes",
              inajax: "1",
              tsdmapp: "json",
              tsdmv: "4",
              tsdmform: "1",
              nodoc: "1",
            }))
              window.searchParams.set(key, value);
            let response: HostResponse | undefined;
            try {
              response = await options.transport.request(window.href, {
                fresh: true,
                session: continuity,
                effect: false,
                method: "GET",
              });
            } catch {
              // The full page can still supply the form after an unavailable window.
            }
            if (options.session() !== continuity) return { kind: "stale" };
            if (response) {
              if (response.redirect === "opaque") return handoff();
              if (
                response.redirect !== "none" ||
                response.url !== window.href
              )
                return failure(
                  "invalid",
                  formURL,
                  "The returned form destination did not match.",
                );
              const payload = json(response);
              if (response.status === 429 || payload?.error === "busy")
                return failure(
                  "limited",
                  formURL,
                  "The forum is limiting requests.",
                );
              if (
                response.status === 401 ||
                payload?.login === 1 ||
                payload?.message_key === "to_login"
              )
                return failure(
                  "login",
                  formURL,
                  "Sign in through the forum.",
                );
              const viewer = numericId(payload?.uid);
              if (viewer !== null && viewer !== accountId)
                return { kind: "stale" };
              if (
                response.status === 403 ||
                (payload?.ok === 0 && !unsupportedV4(payload))
              )
                return failure(
                  "permission",
                  formURL,
                  str(payload?.message) || "The forum denied this form.",
                );
              if (response.status === 404)
                return failure(
                  "missing",
                  formURL,
                  "The forum form is missing.",
                );
              if (response.status === 200 && payload && viewer === accountId)
                structuredOffer = greetingOffer(
                  payload,
                  destination,
                  command,
                );
            }
          }
        }
        if (structuredOffer)
          return remember(
            structuredOffer.plan,
            structuredOffer.token,
            continuity,
            accountId,
            command.action,
          );
        let response: HostResponse;
        try {
          response = await options.transport.request(formURL, {
            fresh: true,
            session: continuity,
            effect: false,
            method: "GET",
          });
        } catch {
          return options.session() === continuity
            ? failure(
                "unavailable",
                formURL,
                "The host could not load the forum form.",
              )
            : { kind: "stale" };
        }
        if (options.session() !== continuity) return { kind: "stale" };
        if (response.redirect === "opaque") return handoff();
        if (response.redirect !== "none" || response.url !== formURL)
          return failure(
            "invalid",
            formURL,
            "The returned form destination did not match.",
          );
        if (response.status === 429)
          return failure(
            "limited",
            formURL,
            "The forum is limiting requests.",
          );
        if (response.status === 401)
          return failure("login", formURL, "Sign in through the forum.");
        if (response.status === 403)
          return failure(
            "permission",
            formURL,
            "The forum denied this form.",
          );
        if (response.status === 404)
          return failure("missing", formURL, "The forum form is missing.");
        if (response.status !== 200)
          return failure(
            "unavailable",
            formURL,
            "The forum could not load this form.",
          );
        const payload = json(response);
        const doc = documentFrom(
          unwrap(payload ? (str(payload.document) ?? "") : response.body),
        );
        if (
          byId(doc, "challenge-form") ||
          byId(doc, "seccode") ||
          byId(doc, "secqaa")
        )
          return handoff();
        const nativeViewer = identify(doc, formURL);
        const envelopeViewer = readAccount(payload ?? {});
        const viewer =
          envelopeViewer.kind === "unknown" ? nativeViewer : envelopeViewer;
        const notice = byId(doc, "messagetext");
        if (
          viewer.kind === "guest" ||
          nativeViewer.kind === "guest" ||
          payload?.login === 1 ||
          byId(doc, "messagelogin")
        )
          return failure("login", formURL, "Sign in through the forum.");
        if (notice || payload?.ok === 0)
          return failure(
            "permission",
            formURL,
            label(notice) ||
              str(payload?.message) ||
              "The forum denied this form.",
          );
        if (
          viewer.kind !== "member" ||
          viewer.id !== accountId ||
          (nativeViewer.kind === "member" && nativeViewer.id !== accountId)
        )
          return { kind: "stale" };
        if (blog) destination.searchParams.set("blogid", "");
        const form = documentForm(
          doc,
          destination,
          blog ? "blogsubmit" : "pokesubmit",
        );
        if (!form) return handoff();
        const hashes = field(form, "formhash");
        token =
          hashes.length === 1 ? formHash(attr(hashes[0]!, "value")) : null;
        if (blog) {
          if (command.privacy === "2") return handoff();
          plan = blogPlan(command, form);
        } else {
          const icon = field(form, "iconid").find(
            (item) =>
              attr(item, "type") === "radio" &&
              attr(item, "value") === command.iconId,
          );
          const note = command.note;
          plan =
            icon && typeof note === "string" && [...note.trim()].length <= 50
              ? {
                  ac: "poke",
                  query: { op: operation, uid: command.memberId },
                  fields: {
                    pokesubmit: "true",
                    iconid: command.iconId,
                    note: note.trim(),
                    from: "",
                  },
                  key:
                    operation === "reply"
                      ? "pokereply"
                      : `propokehk_${command.memberId}`,
                  success: "poke_success",
                  target: command.memberId,
                }
              : null;
        }
      } else {
        const route = sourceFor(input, base);
        if (!route)
          return failure(
            "invalid",
            source,
            "The operation requires a matching space page.",
          );
        let observation: SpaceObservation | undefined;
        const page = await read(route.url.href, (value) => {
          observation = value;
        });
        if (options.session() !== continuity) return { kind: "stale" };
        if (page.kind !== "page") return page;
        if (page.account.kind === "guest")
          return failure("login", source, "Sign in through the forum.");
        if (
          page.account.kind === "unknown" &&
          observation?.doc &&
          ["status-replies", "timeline"].includes(page.view)
        ) {
          const destination = new URL("/home.php", base);
          if (page.view === "status-replies") {
            destination.search = new URLSearchParams({
              mod: "space",
              do: "doing",
              doid: route.url.searchParams.get("doid")!,
            }).toString();
          } else {
            destination.search = new URLSearchParams({
              mod: "follow",
              ...(route.owner
                ? { uid: route.owner, do: "view" }
                : { view: route.scope ?? "follow" }),
            }).toString();
          }
          return {
            kind: "document-navigation",
            url: page.url,
            destination: destination.href,
            message:
              "Open the full forum page to continue in the original account.",
          };
        }
        if (
          page.account.kind !== "member" ||
          page.account.id !== accountId ||
          !observation
        )
          return { kind: "stale" };
        const { payload, doc } = observation;
        const nativeHash = doc && observedHash(doc, base);
        token = formHash(payload?.formhash ?? nativeHash);
        plan = planFor(command, page, observation, accountId);
      }
      if (!plan || !token)
        return failure(
          "incomplete",
          source,
          "The forum did not offer the requested operation for this target and input.",
        );
      return remember(plan, token, continuity, accountId, command.action);
    },
    async submit(
      handle: PreparedSpaceWrite,
      intent: { deliberate: boolean },
    ): Promise<SpaceEffect> {
      if (intent.deliberate !== true) return { kind: "invalid" };
      const record = prepared.get(handle);
      if (!record) return { kind: "stale" };
      prepared.delete(handle);
      if (options.session() !== record.session) return { kind: "stale" };
      const { plan, token, identity } = record;
      const url = plan.submit ?? new URL("/home.php", base);
      if (!plan.submit)
        url.search = new URLSearchParams({
          mod: "spacecp",
          ac: plan.ac,
          ...plan.query,
          ...(plan.ac === "blog" ? {} : { inajax: "1" }),
          tsdmapp: "json",
        }).toString();
      const body = new URLSearchParams({
        [identity.action === "follow" ? "hash" : "formhash"]: token,
        ...plan.fields,
        ...(plan.key ? { handlekey: plan.key } : {}),
      }).toString();
      try {
        const response = await options.transport.request(url.href, {
          fresh: true,
          session: record.session,
          method: "POST",
          effect: true,
          body,
        });
        return options.session() === record.session
          ? writeResult(response, url, plan, identity, json, identify)
          : { kind: "uncertain" };
      } catch {
        return { kind: "uncertain" };
      }
    },
  };
}
