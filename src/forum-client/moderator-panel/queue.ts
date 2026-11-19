import type {
  ModeratorQueueKind,
  ModeratorQueueAction,
  ModeratorQueueItem,
  ModeratorQueuePage,
  ModeratorQueueResult,
  ModeratorQueueOutcome,
} from "./types.js";
import type {
  PanelFailure,
  PanelLoginOffer,
  PanelSelectionOutcome,
} from "./types.js";
import type { ActivitySession } from "../activity-client.js";
import { id, record, string } from "../activity-protocol.js";
import { attr, descendants, hasClass, label } from "../html.js";
import {
  activePanelTab,
  authorLink,
  hasNext,
  offeredEmpty,
  panelForms,
  selectedForum,
  selectedRows,
} from "./native.js";
import {
  assessSelection,
  discoverPanelMode,
  formhash,
  hidden,
  jsonV4Read,
  jsonV4Write,
  pageNumber,
  panelDestination,
  panelRefusal,
  panelRoute,
  positive,
  type PanelContext,
  type PanelFields,
} from "./protocol.js";

const decisions = ["validate", "ignore", "delete"] as const;
interface QueueBinding {
  owner: ActivitySession;
  structured: boolean;
  fields: PanelFields | null;
}
const servedFields = ["formhash", "fid", "filter", "posttableid"];

function structuredQueue(
  data: Record<string, unknown>,
  url: URL,
  owner: ActivitySession,
  kind: ModeratorQueueKind,
  forumId: string,
) {
  if (
    data.ok !== 1 ||
    data.schema !== 42 ||
    id(data.uid) !== owner.memberId ||
    data.op !== kind ||
    data.allowed !== 1 ||
    data.filter !== 0 ||
    String(data.fid) !== forumId ||
    (kind !== "members" &&
      (!Array.isArray(data.forums) ||
        !data.forums.some((raw) => id(record(raw)?.fid) === forumId)))
  )
    return null;
  const values = kind === "members" ? data.members : data.items;
  if (
    !Array.isArray(values) ||
    !pageNumber(data.page) ||
    typeof data.pages !== "number" ||
    !Number.isSafeInteger(data.pages)
  )
    return null;
  const submit = record(data.submit);
  const fixed = record(submit?.fields);
  const destination = panelDestination(
    string(submit?.url),
    url,
    "moderate",
    kind,
  );
  const available = Array.isArray(submit?.actions)
    ? decisions.filter((action) =>
        (submit.actions as unknown[]).includes(action),
      )
    : [];
  const fields: PanelFields | null =
    destination &&
    destination.searchParams.size === 3 &&
    submit?.method === "POST" &&
    submit.ids_field === "moderate[]" &&
    submit.action_field === "modact" &&
    submit.reason_field === "reason" &&
    formhash(fixed?.formhash) &&
    fixed.filter === "0" &&
    (fixed.fid === undefined || fixed.fid === forumId)
      ? {
          formhash: fixed.formhash,
          filter: "0",
          ...(kind !== "members" && { fid: forumId }),
          ...(typeof fixed.posttableid === "string" &&
            /^\d+$/.test(fixed.posttableid) && {
              posttableid: fixed.posttableid,
            }),
        }
      : null;
  const items: ModeratorQueueItem[] = [];
  for (const value of values) {
    const row = record(value);
    const rowId = id(kind === "members" ? row?.uid : row?.id);
    if (
      !row ||
      !rowId ||
      (kind !== "members" && id(row.fid) !== forumId) ||
      items.some((item) => item.id === rowId)
    )
      return null;
    items.push(
      freezeItem({
        id: rowId,
        title: string(row.thread_subject),
        message: string(row.message),
        author: string(kind === "members" ? row.username : row.author),
        authorId: id(row.authorid),
        actions: fields
          ? available.filter(
              (action) =>
                kind !== "members" ||
                action !== "delete" ||
                row.can_delete === 1,
            )
          : [],
      }),
    );
  }
  return {
    fields,
    items,
    number: data.page,
    hasNext: data.page < data.pages,
    structured: true,
  };
}
function freezeItem(item: ModeratorQueueItem) {
  return Object.freeze({ ...item, actions: Object.freeze(item.actions) });
}

function nativeQueue(
  doc: Parameters<typeof activePanelTab>[0],
  url: URL,
  kind: ModeratorQueueKind,
  forumId: string,
  number: number,
) {
  if (!activePanelTab(doc, url, "moderate", kind)) return null;
  if (kind !== "members" && selectedForum(doc) !== forumId) return null;
  const forms = panelForms(doc, url, "moderate", kind);
  const bulk = forms.filter((form) => attr(form, "id") === "moderate");
  if (!bulk.length && offeredEmpty(doc))
    return {
      fields: null,
      items: [],
      number,
      hasNext: hasNext(doc),
      structured: false,
    };
  if (bulk.length !== 1) return null;
  const form = bulk[0]!;
  const fields = hidden(form, servedFields);
  if (!fields || fields.filter !== "0") return null;
  if (kind === "members" && !formhash(fields.formhash)) {
    const tokens = forms.flatMap((form) => {
      const token = hidden(form, ["formhash"])?.formhash;
      return formhash(token) ? [token] : [];
    });
    if (new Set(tokens).size !== 1) return null;
    fields.formhash = tokens[0]!;
  }
  if (
    !formhash(fields.formhash) ||
    (kind !== "members" && fields.fid !== forumId)
  )
    return null;
  const rows = selectedRows(form, (row) =>
    kind === "members" ? row.tagName === "tr" : hasClass(row, "um"),
  );
  if (!rows) return null;
  const items = rows.map(({ id, row }) => {
    const author = descendants(row, (node) =>
      kind === "members"
        ? node.tagName === "h5"
        : hasClass(node, "xi2") && node.tagName === "span",
    )[0];
    const link =
      author && descendants(author, (node) => node.tagName === "a")[0];
    const actions = decisions.filter((action) =>
      descendants(row, (node) => node.tagName === "a").some((node) => {
        const to = panelDestination(attr(node, "href"), url, "moderate", kind);
        return (
          to?.searchParams.get("modact") === action &&
          to.searchParams.get("moderate[]") === id
        );
      }),
    );
    return freezeItem({
      id,
      title: label(descendants(row, (node) => hasClass(node, "xw1"))[0]),
      author: label(author),
      authorId: authorLink(link),
      message: label(
        descendants(row, (node) => attr(node, "id") === `list_note_${id}`)[0],
      ),
      actions,
    });
  });
  return { fields, items, number, hasNext: hasNext(doc), structured: false };
}

export function panelQueues(panel: PanelContext) {
  const bindings = new WeakMap<ModeratorQueuePage, QueueBinding>();
  async function load(
    kind: ModeratorQueueKind,
    forumId: string,
    number: number,
    owner: ActivitySession,
    structured: boolean,
    allowFallback = true,
  ): Promise<ModeratorQueueResult> {
    const url = panelRoute(panel.origin, {
      action: "moderate",
      op: kind,
      ...(kind !== "members" && { fid: forumId }),
      filter: "0",
      ...(number > 1 && { page: String(number) }),
      ...(structured && jsonV4Read),
    });
    const reply = await panel.read(url, owner);
    if (reply.kind !== "response") return reply;
    const data = reply.parsed.data;
    if (data?.type === "modcp_moderate" && data.allowed === 0)
      return { kind: "refused", code: "modcp_noperm" };
    const found =
      data?.type === "modcp_moderate"
        ? structuredQueue(data, url, owner, kind, forumId)
        : nativeQueue(reply.parsed.doc, url, kind, forumId, number);
    if (
      !found &&
      structured &&
      allowFallback &&
      data?.type !== "modcp_moderate"
    )
      return load(kind, forumId, number, owner, false, false);
    if (!found || found.number !== number) return { kind: "invalid-response" };
    const page = Object.freeze({
      kind,
      forumId,
      number,
      hasNext: found.hasNext,
      items: Object.freeze(found.items),
    });
    bindings.set(page, {
      owner,
      structured: found.structured,
      fields: found.fields,
    });
    return { kind: "queue", page };
  }
  return {
    async readQueue(
      kind: ModeratorQueueKind,
      forumId = "0",
      number = 1,
    ): Promise<ModeratorQueueResult> {
      if (
        !(["threads", "replies", "members"] as const).includes(kind) ||
        !pageNumber(number) ||
        (kind === "members" ? forumId !== "0" : !positive(forumId))
      )
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const mode = await discoverPanelMode(panel, owner, "moderate");
      return typeof mode === "boolean"
        ? load(kind, forumId, number, owner, mode)
        : mode;
    },
    async moderateQueue(
      page: ModeratorQueuePage,
      itemId: string,
      decision: ModeratorQueueAction,
      reason: string,
      confirmed: boolean,
    ): Promise<ModeratorQueueOutcome> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      const item = page.items.find((row) => row.id === itemId);
      if (!item || !decisions.includes(decision) || typeof reason !== "string")
        return { kind: "invalid-input" };
      if (!bound.fields || !item.actions.includes(decision))
        return { kind: "refused", code: "queue-action-unavailable" };
      const members = page.kind === "members";
      const url = panelRoute(panel.origin, {
        action: "moderate",
        op: page.kind,
        ...(!members && { fid: page.forumId, infloat: "yes", inajax: "1" }),
        ...(bound.structured
          ? jsonV4Write
          : members
            ? { tsdmapp: "json" }
            : {}),
      });
      const fields = members
        ? new URLSearchParams({
            formhash: bound.fields.formhash!,
            filter: "0",
            modact: decision,
            modsubmit: "1",
            "moderate[0]": itemId,
            reason: reason.trim(),
          })
        : new URLSearchParams({
            ...bound.fields,
            modact: decision,
            modsubmit: "1",
            handlekey: "mods",
            "moderate[]": itemId,
            reason: reason.trim(),
          });
      bindings.delete(page);
      const reply = await panel.write(url, bound.owner, fields);
      if (reply.kind !== "response") return reply;
      const { data, doc } = reply.parsed;
      const scripts = descendants(
        doc,
        (node) => node.tagName === "script" && !attr(node, "src"),
      ).map((node) =>
        node.childNodes
          .map((child) => ("value" in child ? child.value : ""))
          .join(""),
      );
      const acknowledged =
        data?.ok === 1 &&
        id(data.uid) === bound.owner.memberId &&
        data.type === "result" &&
        data.schema === 13 &&
        (data.kind === "message" || data.kind === "handle") &&
        data.message_key === "modcp_mod_succeed" &&
        data.alert !== "error";
      const nativeSuccess =
        !bound.structured &&
        !members &&
        scripts.some((script) => /^\s*succeedhandle_mods\('/.test(script));
      if (!acknowledged && !nativeSuccess) {
        if (scripts.some((script) => /^\s*errorhandle_mods\('/.test(script)))
          return { kind: "refused", code: "queue-action-refused" };
        return (
          panelRefusal(reply.response, reply.parsed) ??
          (data?.type === "modcp_moderate"
            ? {
                kind: "redrawn",
                confirmedIds: [],
                remainingIds: [],
                unknownIds: [itemId],
              }
            : { kind: "uncertain" })
        );
      }
      if (!members)
        return {
          kind: "acknowledged",
          id: itemId,
          code: nativeSuccess ? "succeedhandle_mods" : "modcp_mod_succeed",
        };
      for (let number = 1; number <= page.number; number++) {
        const after = await load(
          page.kind,
          page.forumId,
          number,
          bound.owner,
          bound.structured,
        );
        if (after.kind !== "queue") return { kind: "uncertain" };
        if (after.page.items.some((row) => row.id === itemId))
          return assessSelection([itemId], [itemId], true);
        if (!after.page.hasNext || number === page.number)
          return assessSelection([itemId], [], true);
      }
      return { kind: "uncertain" };
    },
  };
}
