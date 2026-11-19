import type { ActivitySession } from "../../activity-client.js";
import { id, record, string } from "../../activity-protocol.js";
import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  text,
} from "../../html.js";
import { hasNext } from "../native.js";
import {
  assessSelection,
  jsonRead,
  pageNumber,
  panelDestination,
  panelRefusal,
  panelRoute,
  validSelection,
  type PanelContext,
} from "../protocol.js";
import type {
  PanelLogEntry,
  PanelLogRead,
  PanelNewNote,
  PanelNote,
  PanelNotesPage,
  PanelNotesRead,
  PanelSettingOutcome,
} from "../settings-types.js";
import {
  attributed,
  boundData,
  control,
  settingRefused,
  structuredForm,
  verdict,
  type SettingsForm,
} from "./common.js";

const numeric = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const ids = (value: unknown) =>
  Object.freeze(
    Array.isArray(value) ? value.flatMap((value) => id(value) ?? []) : [],
  );
export function panelLog(panel: PanelContext) {
  return {
    async readPanelLog(keyword = "", page = 1): Promise<PanelLogRead> {
      if (typeof keyword !== "string" || !pageNumber(page))
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const filter = keyword.trim();
      const path = {
        action: "log",
        ...(filter && { keyword: filter }),
        ...(page > 1 && { page: String(page) }),
      };
      let url = panelRoute(panel.origin, { ...path, ...jsonRead });
      let reply = await panel.read(url, owner);
      if (reply.kind === "refused" && reply.code === "modcp_log_storage") {
        url = panelRoute(panel.origin, path);
        reply = await panel.read(url, owner);
      }
      if (reply.kind !== "response") return reply;
      const { data, doc } = reply.parsed;
      const entries: PanelLogEntry[] = [];
      if (data?.type === "modcp_log") {
        if (
          !boundData(data, "modcp_log", 24, owner) ||
          !Array.isArray(data.entries) ||
          data.page !== page ||
          string(data.keyword) !== filter ||
          numeric(data.pages) === null
        )
          return { kind: "invalid-response" };
        for (const value of data.entries) {
          const row = record(value);
          if (!row || !string(row.action)) return { kind: "invalid-response" };
          entries.push(
            Object.freeze({
              id: id(row.id),
              time: numeric(row.dateline),
              operator: string(row.username),
              operatorId: id(row.uid),
              action: string(row.action),
              operation: string(row.op),
              forum: string(row.forum),
              forumId: id(row.fid),
              ip: data.show_ip === 1 ? string(row.ip) || null : null,
              reason: string(row.reason),
              other: string(row.other),
              threadIds: ids(row.tids),
              postIds: ids(row.pids),
              memberIds: ids(row.uids),
            }),
          );
        }
        return {
          kind: "panel-log",
          page: {
            page,
            keyword: filter,
            hasNext: page < Number(data.pages),
            enabled: data.enabled === 1,
            entries: Object.freeze(entries),
          },
        };
      }
      const forms = descendants(
        doc,
        (node) =>
          node.tagName === "form" &&
          panelDestination(attr(node, "action"), url, "log") !== null &&
          !!control(node, "keyword", "input"),
      );
      const table = byId(doc, "list_modcp_logs");
      if (forms.length !== 1) return { kind: "invalid-response" };
      const rows = table
        ? descendants(table, (node) => node.tagName === "tr")
        : [];
      for (const row of rows) {
        const cells = children(row).filter(
          (node) => element(node) && node.tagName === "td",
        );
        const actionCell = cells[3];
        if (cells.length < 6 || !actionCell) continue;
        const parts = [""];
        for (const node of children(actionCell)) {
          if (element(node) && node.tagName === "br") parts.push("");
          else parts[parts.length - 1] += text(node);
        }
        const operator =
          cells[1] && descendants(cells[1], (node) => hasClass(node, "xi2"))[0];
        entries.push(
          Object.freeze({
            id: null,
            time: label(cells[0]),
            operator: label(operator ?? cells[1]),
            operatorId: null,
            action: parts[0]!.trim(),
            operation: parts.slice(1).join(" ").trim(),
            forum: label(cells[4]),
            forumId: null,
            ip: label(cells[2]) || null,
            reason: "",
            other: label(cells[5]),
            threadIds: [],
            postIds: [],
            memberIds: [],
          }),
        );
      }
      return {
        kind: "panel-log",
        page: {
          page,
          keyword: filter,
          hasNext: hasNext(doc),
          enabled: null,
          entries: Object.freeze(entries),
        },
      };
    },
  };
}

interface NotesBinding {
  owner: ActivitySession;
  add: SettingsForm | null;
  remove: SettingsForm | null;
}
function decodeNotes(
  data: Record<string, unknown> | null,
  url: URL,
  owner: ActivitySession,
) {
  if (!boundData(data, "modcp_home", 39, owner) || !Array.isArray(data.notes))
    return null;
  const items: PanelNote[] = [];
  for (const raw of data.notes) {
    const row = record(raw),
      noteId = id(row?.id);
    if (!row || !noteId || items.some((item) => item.id === noteId))
      return null;
    items.push(
      Object.freeze({
        id: noteId,
        message: string(row.message).trim(),
        operator: string(row.admin),
        expires: numeric(row.expiration),
        toSupermod: row.to_supermod === 1,
        toModerator: row.to_moderator === 1,
        canDelete: row.can_delete === 1,
      }),
    );
  }
  const addOffer = record(data.add),
    removeOffer = record(data.delete);
  const put = structuredForm(addOffer, url, "home", undefined, [
    "formhash",
    "op",
    "submit",
  ]);
  const take = structuredForm(removeOffer, url, "home", undefined, [
    "formhash",
    "op",
    "notlistsubmit",
  ]);
  const add =
    put?.fields.op === "addnote" &&
    put.fields.submit === "true" &&
    addOffer?.message_field === "newmessage" &&
    addOffer.supermod_field === "newaccess[2]" &&
    addOffer.moderator_field === "newaccess[3]" &&
    addOffer.days_field === "newexpiration"
      ? put
      : null;
  const remove =
    take?.fields.op === "delete" &&
    take.fields.notlistsubmit === "yes" &&
    removeOffer?.ids_field === "delete[]"
      ? take
      : null;
  return {
    page: Object.freeze({
      items: Object.freeze(items),
      defaultDays: pageNumber(addOffer?.days_default)
        ? addOffer.days_default
        : 30,
      canAdd: !!add,
      canDelete: !!remove,
    }),
    add,
    remove,
  };
}
export function panelNotes(panel: PanelContext) {
  const bindings = new WeakMap<PanelNotesPage, NotesBinding>();
  async function submit(
    page: PanelNotesPage,
    operation: "add-note" | "delete-notes",
    change: PanelNewNote | readonly string[],
    approved: boolean,
  ): Promise<PanelSettingOutcome> {
    if (approved !== true)
      return attributed(operation, { kind: "not-confirmed" });
    const bound = bindings.get(page);
    if (!bound) return attributed(operation, { kind: "stale" });
    if (!panel.current(bound.owner))
      return attributed(operation, { kind: "session-changed" });
    const form = operation === "add-note" ? bound.add : bound.remove;
    if (!form) return settingRefused(operation, "notes-action-unavailable");
    const fields = new URLSearchParams(form.fields);
    let selected: readonly string[] = [];
    let note: PanelNewNote | undefined;
    if ("message" in change) {
      const message = string(change.message).trim(),
        days = change.days ?? page.defaultDays;
      if (
        !message ||
        !pageNumber(days) ||
        typeof change.toSupermod !== "boolean" ||
        typeof change.toModerator !== "boolean"
      )
        return attributed(operation, { kind: "invalid-input" });
      note = { ...change, message, days };
      fields.set("newmessage", message);
      if (note.toSupermod) fields.set("newaccess[2]", "1");
      if (note.toModerator) fields.set("newaccess[3]", "1");
      fields.set("newexpiration", String(days));
    } else {
      if (
        !validSelection(
          change,
          page.items.map((note) => note.id),
        )
      )
        return attributed(operation, { kind: "invalid-input" });
      if (
        !change.every((id) =>
          page.items.some((note) => note.id === id && note.canDelete),
        )
      )
        return settingRefused(operation, "note-delete-unavailable");
      selected = [...change];
      selected.forEach((id, index) => fields.set(`delete[${index}]`, id));
    }
    bindings.delete(page);
    const reply = await panel.write(form.url, bound.owner, fields);
    if (reply.kind !== "response") return attributed(operation, reply);
    const issue = panelRefusal(reply.response, reply.parsed);
    if (issue) return attributed(operation, issue);
    const drawn = decodeNotes(reply.parsed.data, form.url, bound.owner);
    if (!drawn) return verdict(operation, "uncertain");
    if (!note)
      return {
        ...assessSelection(
          selected,
          drawn.page.items.map((note) => note.id),
          true,
        ),
        operation,
      };
    const keyed = drawn.page.items.filter(
      (item) =>
        !page.items.some((before) => before.id === item.id) &&
        item.message === note.message &&
        item.toSupermod === note.toSupermod &&
        item.toModerator === note.toModerator,
    );
    return keyed.length === 1
      ? { kind: "completed", operation, confirmedIds: [keyed[0]!.id] }
      : verdict(operation, "uncertain");
  }
  return {
    async readManagementNotes(): Promise<PanelNotesRead> {
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const url = panelRoute(panel.origin, { action: "home", ...jsonRead });
      const reply = await panel.read(url, owner);
      if (reply.kind !== "response") return reply;
      const found = decodeNotes(reply.parsed.data, url, owner);
      if (!found) return { kind: "invalid-response" };
      bindings.set(found.page, { owner, add: found.add, remove: found.remove });
      return { kind: "panel-notes", page: found.page };
    },
    addManagementNote: (
      page: PanelNotesPage,
      note: PanelNewNote,
      approved: boolean,
    ) => submit(page, "add-note", note, approved),
    deleteManagementNotes: (
      page: PanelNotesPage,
      ids: readonly string[],
      approved: boolean,
    ) => submit(page, "delete-notes", ids, approved),
  };
}
