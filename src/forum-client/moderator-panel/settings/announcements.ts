import type { ActivitySession } from "../../activity-client.js";
import { id, record, string } from "../../activity-protocol.js";
import {
  attr,
  children,
  controlDisabled,
  descendants,
  element,
  label,
  text,
} from "../../html.js";
import { hasNext } from "../native.js";
import {
  assessSelection,
  formhash,
  hidden,
  jsonV4Read,
  jsonV4Write,
  panelRefusal,
  panelRoute,
  positive,
  validSelection,
  type PanelContext,
} from "../protocol.js";
import type {
  PanelAnnouncementDraft,
  PanelAnnouncementItem,
  PanelAnnouncementForm,
  PanelAnnouncementRead,
  PanelAnnouncementsPage,
  PanelAnnouncementsRead,
  PanelSettingOutcome,
} from "../settings-types.js";
import {
  attributed,
  boundData,
  control,
  nativeSettingForms,
  readSettingPage,
  settingRefused,
  structuredForm,
  verdict,
  type PanelReply,
  type SettingsForm,
} from "./common.js";

const typeOf = (value: unknown) =>
  value === 0 || value === "0"
    ? "text"
    : value === 1 || value === "1"
      ? "link"
      : null;
const dateCell = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : typeof value === "string"
      ? value
      : null;
const fixed = ["formhash", "id", "displayorder", "submit"];
const selector = (op: string) => ({ action: "announcement", op });
function announcementForm(
  reply: PanelReply,
  url: URL,
  owner: ActivitySession,
  target: string,
) {
  const op = target === "0" ? "add" : "edit";
  const { data, doc } = reply.parsed;
  if (data?.type === "modcp_announcement") {
    if (
      !boundData(data, "modcp_announcement", 47, owner) ||
      (op === "edit" ? data.op !== "edit" : data.op === "edit")
    )
      return null;
    const offer = record(data.form),
      meta = record(offer?.submit);
    const type = typeOf(offer?.type);
    if (!offer || String(offer.id) !== target || !type) return null;
    const form = structuredForm(
      meta,
      url,
      "announcement",
      op,
      fixed,
      jsonV4Write,
    );
    const msg = record(meta?.message_fields);
    const editable =
      !!form &&
      form.fields.id === (op === "add" ? "" : target) &&
      form.fields.submit === "true" &&
      typeof form.fields.displayorder === "string" &&
      form.fields.displayorder === String(offer.displayorder ?? "") &&
      meta?.subject_field === "subject" &&
      meta.type_field === "type" &&
      meta.start_field === "starttime" &&
      meta.end_field === "endtime" &&
      msg?.["0"] === "message[0]" &&
      msg["1"] === "message[1]";
    const page: PanelAnnouncementForm = Object.freeze({
      id: target,
      subject: string(offer.subject),
      type,
      start: string(offer.starttime),
      end: string(offer.endtime),
      message: string(offer.message),
      editable,
    });
    return { page, form: editable ? form : null };
  }
  const forms = nativeSettingForms(doc, url, "announcement", op);
  const node = forms.length === 1 ? forms[0] : undefined;
  if (!node) return null;
  const fields = hidden(node, ["formhash", "id", "displayorder"]);
  if (
    !fields ||
    !formhash(fields.formhash) ||
    fields.id !== (op === "add" ? "" : target) ||
    typeof fields.displayorder !== "string"
  )
    return null;
  const select = control(node, "type", "select");
  const types = select
    ? descendants(
        select,
        (part) => part.tagName === "option" && !controlDisabled(part),
      )
    : [];
  const defaultType =
    types.find((part) =>
      part.attrs.some((entry) => entry.name === "selected"),
    ) ?? types[0];
  const type = defaultType && typeOf(attr(defaultType, "value"));
  const subject = control(node, "subject", "input"),
    start = control(node, "starttime", "input"),
    end = control(node, "endtime", "input");
  const body = control(node, "message[0]", "textarea"),
    link = control(node, "message[1]", "input"),
    submit = control(node, "submit");
  if (!type || !subject || !start || !end || !body || !link) return null;
  const editable =
    !!submit &&
    attr(submit, "value") === "true" &&
    [subject, start, end, body, link].every(
      (part) => !part.attrs.some((entry) => entry.name === "readonly"),
    ) &&
    types.some((part) => attr(part, "value") === "0") &&
    types.some((part) => attr(part, "value") === "1");
  const page: PanelAnnouncementForm = Object.freeze({
    id: target,
    subject: attr(subject, "value"),
    type,
    start: attr(start, "value"),
    end: attr(end, "value"),
    message: type === "text" ? text(body) : attr(link, "value"),
    editable,
  });
  return {
    page,
    form: editable
      ? {
          url: panelRoute(url.origin, selector(op)),
          fields: { ...fields, submit: "true" },
        }
      : null,
  };
}
function announcementList(reply: PanelReply, url: URL, owner: ActivitySession) {
  const { data, doc } = reply.parsed;
  const items: PanelAnnouncementItem[] = [];
  let remove: SettingsForm | null = null;
  let complete = true;
  if (data?.type === "modcp_announcement") {
    if (
      !boundData(data, "modcp_announcement", 47, owner) ||
      !Array.isArray(data.list) ||
      data.op === "edit"
    )
      return null;
    for (const raw of data.list) {
      const row = record(raw),
        rowId = id(row?.id),
        type = typeOf(row?.type);
      if (!row || !rowId || !type || items.some((item) => item.id === rowId))
        return null;
      items.push(
        Object.freeze({
          id: rowId,
          subject: string(row.subject),
          type,
          author: string(row.author),
          start: dateCell(row.starttime),
          end: dateCell(row.endtime),
          canDelete: row.editable === 1,
        }),
      );
    }
    const meta = record(data.manage);
    const form = structuredForm(
      meta,
      url,
      "announcement",
      "manage",
      ["formhash", "submit"],
      jsonV4Write,
    );
    if (form?.fields.submit === "true" && meta?.ids_field === "delete[]")
      remove = form;
    if (typeof data.pages === "number" && data.pages > 1) complete = false;
  } else {
    const forms = nativeSettingForms(doc, url, "announcement", "manage");
    const node = forms.length === 1 ? forms[0] : undefined;
    const fixed = node && hidden(node, ["formhash"]);
    if (!node || !fixed || !formhash(fixed.formhash)) return null;
    for (const row of descendants(node, (part) => part.tagName === "tr")) {
      const boxes = descendants(
        row,
        (part) =>
          part.tagName === "input" &&
          attr(part, "type") === "checkbox" &&
          attr(part, "name") === "delete[]",
      );
      if (!boxes.length) continue;
      const cells = children(row).filter(
          (part) => element(part) && part.tagName === "td",
        ),
        rowId = attr(boxes[0]!, "value");
      if (
        boxes.length !== 1 ||
        !positive(rowId) ||
        cells.length < 7 ||
        items.some((item) => item.id === rowId)
      )
        return null;
      const type = label(cells[4]);
      items.push(
        Object.freeze({
          id: rowId,
          subject: label(cells[3]),
          type: /链接|連結|link/i.test(type)
            ? "link"
            : /文字|text/i.test(type)
              ? "text"
              : type,
          author: label(cells[2]),
          start: label(cells[5]),
          end: label(cells[6]),
          canDelete: !controlDisabled(boxes[0]!),
        }),
      );
    }
    const submit = control(node, "submit");
    if (submit && attr(submit, "value") === "true")
      remove = {
        url: panelRoute(url.origin, selector("manage")),
        fields: { ...fixed, submit: "true" },
      };
    complete = !hasNext(doc);
  }
  const create = announcementForm(reply, url, owner, "0");
  return {
    page: Object.freeze({
      items: Object.freeze(items),
      createForm: create?.page ?? null,
      canDelete: !!remove,
    }),
    create: create?.form ?? null,
    remove,
    complete,
  };
}

function normalizedDate(text: string) {
  const value = text.trim();
  if (!value) return "";
  const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year}-${month}-${day}`
    : null;
}
function draftValues(value: PanelAnnouncementDraft) {
  if (
    !value ||
    typeof value.subject !== "string" ||
    !value.subject.trim() ||
    (value.type !== "text" && value.type !== "link") ||
    typeof value.start !== "string" ||
    typeof value.end !== "string" ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    normalizedDate(value.start) === null ||
    normalizedDate(value.end) === null
  )
    return null;
  const message = value.type === "link" ? value.message.trim() : value.message;
  if (value.type === "link") {
    try {
      const url = new URL(message);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        /[\n\r\t]/.test(message)
      )
        return null;
    } catch {
      return null;
    }
  }
  return {
    subject: value.subject.trim(),
    type: value.type,
    start: value.start.trim(),
    end: value.end.trim(),
    message,
  };
}
function holds(stored: PanelAnnouncementForm, value: PanelAnnouncementDraft) {
  const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd();
  return (
    stored.subject === value.subject &&
    stored.type === value.type &&
    normalize(stored.message) === normalize(value.message) &&
    (!value.start ||
      normalizedDate(stored.start) === normalizedDate(value.start)) &&
    (!value.end || normalizedDate(stored.end) === normalizedDate(value.end))
  );
}

export function panelAnnouncements(panel: PanelContext) {
  const lists = new WeakMap<
    PanelAnnouncementsPage,
    {
      owner: ActivitySession;
      create: SettingsForm | null;
      remove: SettingsForm | null;
    }
  >();
  const edits = new WeakMap<
    PanelAnnouncementForm,
    { owner: ActivitySession; form: SettingsForm | null }
  >();
  async function editReadback(
    owner: ActivitySession,
    entry: string,
    structured: boolean,
  ) {
    const url = panelRoute(panel.origin, {
      ...selector("edit"),
      id: entry,
      ...(structured && jsonV4Read),
    });
    const checked = await panel.read(url, owner);
    return checked.kind === "response"
      ? announcementForm(checked, url, owner, entry)?.page
      : null;
  }
  async function submit(
    owner: ActivitySession,
    form: SettingsForm,
    operation: "create-announcement" | "edit-announcement",
    value: PanelAnnouncementDraft,
    target: string,
    before: readonly string[],
  ): Promise<PanelSettingOutcome> {
    const values = new URLSearchParams({
      ...form.fields,
      subject: value.subject,
      type: value.type === "text" ? "0" : "1",
      starttime: value.start,
      endtime: value.end,
      "message[0]": value.type === "text" ? value.message : "",
      "message[1]": value.type === "link" ? value.message : "",
    });
    const reply = await panel.write(form.url, owner, values);
    if (reply.kind !== "response") return attributed(operation, reply);
    const problem = panelRefusal(reply.response, reply.parsed);
    if (problem) return attributed(operation, problem);
    const structured = form.url.searchParams.has("tsdmv");
    const { data } = reply.parsed;
    const state = record(data?.result);
    const error = string(state?.error_key);
    if (error) return settingRefused(operation, error);
    if (operation === "edit-announcement") {
      const redraw = announcementForm(reply, form.url, owner, target);
      if (!redraw) return verdict(operation, "uncertain");
      if (structured && holds(redraw.page, value))
        return verdict(operation, "completed");
      if (structured && state?.edited === 1)
        return verdict(operation, "acknowledged");
      const checked = await editReadback(owner, target, structured);
      return verdict(
        operation,
        checked
          ? holds(checked, value)
            ? "completed"
            : "redrawn"
          : "uncertain",
      );
    }
    const redraw = announcementList(reply, form.url, owner);
    if (!redraw) return verdict(operation, "uncertain");
    if (structured && state?.added === 1)
      return verdict(operation, "acknowledged");
    const candidates = redraw.page.items.filter(
      (item) =>
        !before.includes(item.id) &&
        item.subject === value.subject &&
        item.type === value.type,
    );
    if (candidates.length !== 1)
      return verdict(operation, candidates.length ? "uncertain" : "redrawn");
    const entry = candidates[0]!.id;
    const checked = await editReadback(owner, entry, structured);
    return checked && holds(checked, value)
      ? { kind: "completed", operation, confirmedIds: [entry] }
      : verdict(operation, "uncertain");
  }
  return {
    async readPanelAnnouncements(): Promise<PanelAnnouncementsRead> {
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const reply = await readSettingPage(
        panel,
        owner,
        { action: "announcement" },
        "announcement",
        "modcp_announcement",
      );
      if (reply.kind !== "response") return reply;
      const decoded = announcementList(reply, reply.url, owner);
      if (!decoded) return { kind: "invalid-response" };
      lists.set(decoded.page, {
        owner,
        create: decoded.create,
        remove: decoded.remove,
      });
      return { kind: "announcements", page: decoded.page };
    },
    async readPanelAnnouncement(id: string): Promise<PanelAnnouncementRead> {
      if (!positive(id)) return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const reply = await readSettingPage(
        panel,
        owner,
        { ...selector("edit"), id },
        "announcement",
        "modcp_announcement",
      );
      if (reply.kind !== "response") return reply;
      const decoded = announcementForm(reply, reply.url, owner, id);
      if (!decoded) return { kind: "invalid-response" };
      edits.set(decoded.page, { owner, form: decoded.form });
      return { kind: "announcement-form", form: decoded.page };
    },
    async createPanelAnnouncement(
      page: PanelAnnouncementsPage,
      draft: PanelAnnouncementDraft,
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      const operation = "create-announcement";
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const bound = lists.get(page);
      if (!bound) return attributed(operation, { kind: "stale" });
      if (!panel.current(bound.owner))
        return attributed(operation, { kind: "session-changed" });
      if (!bound.create)
        return settingRefused(operation, "announcement-create-unavailable");
      const values = draftValues(draft);
      if (!values) return attributed(operation, { kind: "invalid-input" });
      lists.delete(page);
      return submit(
        bound.owner,
        bound.create,
        operation,
        values,
        "0",
        page.items.map((item) => item.id),
      );
    },
    async editPanelAnnouncement(
      page: PanelAnnouncementForm,
      draft: PanelAnnouncementDraft,
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      const operation = "edit-announcement";
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const bound = edits.get(page);
      if (!bound) return attributed(operation, { kind: "stale" });
      if (!panel.current(bound.owner))
        return attributed(operation, { kind: "session-changed" });
      if (!bound.form)
        return settingRefused(operation, "announcement-edit-unavailable");
      const values = draftValues(draft);
      if (!values) return attributed(operation, { kind: "invalid-input" });
      edits.delete(page);
      return submit(bound.owner, bound.form, operation, values, page.id, []);
    },
    async deletePanelAnnouncements(
      page: PanelAnnouncementsPage,
      ids: readonly string[],
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      const operation = "delete-announcements";
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const bound = lists.get(page);
      if (!bound) return attributed(operation, { kind: "stale" });
      if (!panel.current(bound.owner))
        return attributed(operation, { kind: "session-changed" });
      if (
        !validSelection(
          ids,
          page.items.map((item) => item.id),
        )
      )
        return attributed(operation, { kind: "invalid-input" });
      if (
        !bound.remove ||
        !ids.every((id) =>
          page.items.some((item) => item.id === id && item.canDelete),
        )
      )
        return settingRefused(operation, "announcement-delete-unavailable");
      const selected = [...ids],
        body = new URLSearchParams(bound.remove.fields);
      selected.forEach((id, index) => body.set(`delete[${index}]`, id));
      lists.delete(page);
      const reply = await panel.write(bound.remove.url, bound.owner, body);
      if (reply.kind !== "response") return attributed(operation, reply);
      const issue = panelRefusal(reply.response, reply.parsed);
      if (issue) return attributed(operation, issue);
      const decoded = announcementList(reply, bound.remove.url, bound.owner);
      return decoded
        ? {
            ...assessSelection(
              selected,
              decoded.page.items.map((item) => item.id),
              decoded.complete,
            ),
            operation,
          }
        : verdict(operation, "uncertain");
    },
  };
}
