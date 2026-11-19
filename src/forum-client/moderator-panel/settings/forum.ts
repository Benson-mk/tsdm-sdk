import type { ActivitySession } from "../../activity-client.js";
import { id, record, string } from "../../activity-protocol.js";
import {
  attr,
  children,
  controlDisabled,
  descendants,
  element,
  hasClass,
  label,
  text,
} from "../../html.js";
import {
  activePanelTab,
  authorLink,
  hasNext,
  panelForms,
  selectedForum,
} from "../native.js";
import {
  formhash,
  hidden,
  jsonV4Write,
  panelDestination,
  panelRefusal,
  panelRoute,
  positive,
  validSelection,
  type PanelContext,
} from "../protocol.js";
import type {
  PanelForumRulesPage,
  PanelForumRulesRead,
  PanelRecommendation,
  PanelRecommendationChange,
  PanelRecommendationEdit,
  PanelRecommendationsPage,
  PanelRecommendationsRead,
  PanelSettingOutcome,
} from "../settings-types.js";
import {
  attributed,
  boundData,
  control,
  nativeSettingForms,
  offeredForums,
  readSettingPage,
  settingRefused,
  structuredForm,
  verdict,
  type PanelReply,
  type SettingsForm,
} from "./common.js";

const readOnly = (node: ReturnType<typeof control>) =>
  !node ||
  controlDisabled(node) ||
  node.attrs.some((entry) => entry.name === "readonly");
const normalized = (value: string) => value.replace(/\r\n?/g, "\n").trimEnd();
function decodeRules(
  reply: PanelReply,
  source: URL,
  owner: ActivitySession,
  forumId: string,
) {
  const { data, doc } = reply.parsed;
  if (data?.type === "modcp_editforum") {
    if (
      !boundData(data, "modcp_editforum", 46, owner) ||
      id(data.fid) !== forumId ||
      data.need_forum === 1 ||
      typeof data.rules !== "string"
    )
      return null;
    const meta = record(data.submit);
    const form = structuredForm(
      meta,
      source,
      "forum",
      "editforum",
      ["formhash", "fid", "editsubmit"],
      jsonV4Write,
    );
    const editable =
      data.editable === 1 &&
      form?.fields.fid === forumId &&
      form.fields.editsubmit === "true" &&
      meta?.rules_field === "rulesnew";
    return {
      page: Object.freeze({
        forumId,
        forums: offeredForums(data.forums),
        rules: data.rules,
        editable,
      }),
      form: editable ? form : null,
    };
  }
  const forms = nativeSettingForms(doc, source, "forum", "editforum").filter(
    (node) =>
      descendants(
        node,
        (child) =>
          child.tagName === "textarea" && attr(child, "name") === "rulesnew",
      ).length === 1,
  );
  const node = forms.length === 1 ? forms[0] : undefined;
  const fields = node && hidden(node, ["formhash", "fid"]);
  if (!node || !fields || fields.fid !== forumId || !formhash(fields.formhash))
    return null;
  const editor = descendants(
    node,
    (child) =>
      child.tagName === "textarea" && attr(child, "name") === "rulesnew",
  )[0]!;
  const button = control(node, "editsubmit");
  const editable =
    !readOnly(editor) && !!button && attr(button, "value") === "true";
  return {
    page: Object.freeze({ forumId, forums: [], rules: text(editor), editable }),
    form: editable
      ? {
          url: panelRoute(source.origin, { action: "forum", op: "editforum" }),
          fields: { ...fields, editsubmit: "true" },
        }
      : null,
  };
}
export function panelRules(panel: PanelContext) {
  const bindings = new WeakMap<
    PanelForumRulesPage,
    { owner: ActivitySession; form: SettingsForm | null }
  >();
  return {
    async readForumRules(forumId: string): Promise<PanelForumRulesRead> {
      if (!positive(forumId)) return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const reply = await readSettingPage(
        panel,
        owner,
        { action: "forum", op: "editforum", fid: forumId },
        "editforum",
        "modcp_editforum",
      );
      if (reply.kind !== "response") return reply;
      const decoded = decodeRules(reply, reply.url, owner, forumId);
      if (!decoded) return { kind: "invalid-response" };
      bindings.set(decoded.page, { owner, form: decoded.form });
      return { kind: "forum-rules", page: decoded.page };
    },
    async saveForumRules(
      page: PanelForumRulesPage,
      rules: string,
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      const operation = "save-rules";
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const bound = bindings.get(page);
      if (!bound) return attributed(operation, { kind: "stale" });
      if (!panel.current(bound.owner))
        return attributed(operation, { kind: "session-changed" });
      if (!bound.form) return settingRefused(operation, "rules-locked");
      if (typeof rules !== "string")
        return attributed(operation, { kind: "invalid-input" });
      bindings.delete(page);
      const { owner, form } = bound;
      const reply = await panel.write(
        form.url,
        owner,
        new URLSearchParams({ ...form.fields, rulesnew: rules }),
      );
      if (reply.kind !== "response") return attributed(operation, reply);
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return attributed(operation, problem);
      const drawn = decodeRules(reply, form.url, owner, page.forumId);
      if (!drawn) return verdict(operation, "uncertain");
      if (!drawn.page.editable)
        return settingRefused(operation, "rules-locked");
      if (normalized(drawn.page.rules) === normalized(rules))
        return verdict(operation, "completed");
      return verdict(
        operation,
        reply.parsed.data?.updated === 1 ? "acknowledged" : "redrawn",
      );
    },
  };
}

function decodeRecommendations(
  reply: PanelReply,
  source: URL,
  forumId: string,
) {
  const { doc } = reply.parsed;
  if (
    !activePanelTab(doc, source, "forum", "recommend") ||
    selectedForum(doc) !== forumId
  )
    return null;
  const available = panelForms(doc, source, "forum").filter((node) => {
    const to = panelDestination(attr(node, "action"), source, "forum");
    return (
      to &&
      [...to.searchParams.keys()].every((key) =>
        ["mod", "action", "show"].includes(key),
      ) &&
      (!to.searchParams.has("show") || to.searchParams.get("show") === "") &&
      attr(control(node, "op") ?? node, "value") === "recommend"
    );
  });
  const node = available.length === 1 ? available[0] : undefined;
  if (!node) {
    if (
      available.length ||
      !descendants(doc, (part) => hasClass(part, "emp") && !!label(part)).length
    )
      return null;
    return {
      page: Object.freeze({ forumId, items: [], editable: false }),
      form: null,
      complete: !hasNext(doc),
    };
  }
  const fields = hidden(node, ["formhash", "op", "page", "fid", "check"]);
  if (
    !fields ||
    fields.fid !== forumId ||
    fields.page !== "1" ||
    fields.check !== "" ||
    !formhash(fields.formhash)
  )
    return null;
  const items: PanelRecommendation[] = [];
  const button = control(node, "editsubmit");
  let editable = !!button && attr(button, "value") === "yes";
  for (const row of descendants(node, (part) => part.tagName === "tr")) {
    const orderBox = descendants(
      row,
      (part) =>
        part.tagName === "input" && /^order\[\d+\]$/.test(attr(part, "name")),
    );
    if (!orderBox.length) continue;
    const rowId = /^order\[(\d+)\]$/.exec(attr(orderBox[0]!, "name"))?.[1];
    const cells = children(row).filter(
      (part) => element(part) && part.tagName === "td",
    );
    if (
      orderBox.length !== 1 ||
      !positive(rowId) ||
      items.some((item) => item.id === rowId) ||
      cells.length < 6
    )
      return null;
    const currentOrder = attr(orderBox[0]!, "value"),
      order = Number(currentOrder);
    const subject = control(row, `subject[${rowId}]`),
      expiry = control(row, `expirationrecommend[${rowId}]`);
    const deleteBox = descendants(
      row,
      (part) =>
        part.tagName === "input" &&
        attr(part, "name") === "delete[]" &&
        attr(part, "value") === rowId &&
        !controlDisabled(part),
    );
    if (
      !/^\d+$/.test(currentOrder) ||
      !Number.isSafeInteger(order) ||
      readOnly(orderBox[0]) ||
      readOnly(subject) ||
      readOnly(expiry)
    )
      editable = false;
    const link = (cell: typeof row | undefined) =>
      cell && descendants(cell, (part) => part.tagName === "a")[0];
    const author = cells[3],
      recommender = cells[4];
    items.push(
      Object.freeze({
        id: rowId,
        order,
        subject: subject ? attr(subject, "value") : "",
        expiration: expiry ? attr(expiry, "value") : "",
        author: label(author),
        authorId: authorLink(
          author && element(author) ? link(author) : undefined,
        ),
        recommender: label(recommender),
        recommenderId: authorLink(
          recommender && element(recommender) ? link(recommender) : undefined,
        ),
        canRemove: deleteBox.length === 1,
      }),
    );
  }
  const complete = !hasNext(doc);
  editable = editable && complete && items.length > 0;
  return {
    page: Object.freeze({ forumId, items: Object.freeze(items), editable }),
    form: editable
      ? { url: panelRoute(source.origin, { action: "forum" }), fields }
      : null,
    complete,
  };
}
function expiration(value: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2}) +(\d{1,2}):(\d{1,2})$/.exec(
    value.trim(),
  );
  if (!match) return value.trim() === "" ? "" : null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour < 24 &&
    minute < 60
    ? `${year}-${month}-${day} ${hour}:${minute}`
    : null;
}
export function panelRecommendations(panel: PanelContext) {
  const bindings = new WeakMap<
    PanelRecommendationsPage,
    { owner: ActivitySession; form: SettingsForm | null }
  >();
  return {
    async readRecommendations(
      forumId: string,
    ): Promise<PanelRecommendationsRead> {
      if (!positive(forumId)) return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const url = panelRoute(panel.origin, {
        action: "forum",
        op: "recommend",
        fid: forumId,
      });
      const reply = await panel.read(url, owner);
      if (reply.kind !== "response") return reply;
      const found = decodeRecommendations(reply, url, forumId);
      if (!found) return { kind: "invalid-response" };
      bindings.set(found.page, { owner, form: found.form });
      return { kind: "recommendations", page: found.page };
    },
    async saveRecommendations(
      page: PanelRecommendationsPage,
      change: PanelRecommendationChange,
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      const operation = "save-recommendations";
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const binding = bindings.get(page);
      if (!binding) return attributed(operation, { kind: "stale" });
      if (!panel.current(binding.owner))
        return attributed(operation, { kind: "session-changed" });
      const { owner, form } = binding;
      if (!form) return settingRefused(operation, "recommendations-locked");
      const edits = change?.edits ?? [],
        remove = change?.remove ?? [];
      if (
        !Array.isArray(edits) ||
        !Array.isArray(remove) ||
        !(edits.length || remove.length)
      )
        return attributed(operation, { kind: "invalid-input" });
      const listed = page.items.map((item) => item.id);
      if (
        (remove.length && !validSelection(remove, listed)) ||
        (edits.length &&
          !validSelection(
            edits.map((edit) => edit?.id),
            listed,
          ))
      )
        return attributed(operation, { kind: "invalid-input" });
      if (
        !remove.every((id) =>
          page.items.some((item) => item.id === id && item.canRemove),
        )
      )
        return settingRefused(operation, "recommendation-removal-unavailable");
      const changes = new Map<string, PanelRecommendationEdit>();
      for (const draft of edits) {
        if (
          remove.includes(draft.id) ||
          !Number.isInteger(draft.order) ||
          draft.order < 0 ||
          draft.order > 127 ||
          typeof draft.subject !== "string" ||
          !draft.subject.trim() ||
          typeof draft.expiration !== "string" ||
          expiration(draft.expiration) === null
        )
          return attributed(operation, { kind: "invalid-input" });
        changes.set(draft.id, {
          ...draft,
          expiration: draft.expiration.trim(),
        });
      }
      const fields = new URLSearchParams(form.fields);
      remove.forEach((id, index) => fields.set(`delete[${index}]`, id));
      for (const item of page.items) {
        const chosen = changes.get(item.id) ?? item;
        fields.set(`order[${item.id}]`, String(chosen.order));
        fields.set(`subject[${item.id}]`, chosen.subject);
        fields.set(`expirationrecommend[${item.id}]`, chosen.expiration);
      }
      fields.set("editsubmit", "yes");
      bindings.delete(page);
      const reply = await panel.write(form.url, owner, fields);
      if (reply.kind !== "response") return attributed(operation, reply);
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return attributed(operation, problem);
      const after = decodeRecommendations(reply, form.url, page.forumId);
      if (!after) return verdict(operation, "uncertain");
      const confirmedIds: string[] = [],
        remainingIds: string[] = [],
        unknownIds: string[] = [];
      for (const id of [...changes.keys(), ...remove]) {
        const row = after.page.items.find((item) => item.id === id),
          edit = changes.get(id);
        if (
          edit &&
          row &&
          (row.order !== edit.order ||
            row.subject !== edit.subject ||
            expiration(row.expiration) !== expiration(edit.expiration))
        )
          remainingIds.push(id);
        else if ((edit && row) || (!edit && !row && after.complete))
          confirmedIds.push(id);
        else if (!edit && row) remainingIds.push(id);
        else unknownIds.push(id);
      }
      return {
        kind: confirmedIds.length
          ? remainingIds.length || unknownIds.length
            ? "partial"
            : "completed"
          : remainingIds.length
            ? "redrawn"
            : "uncertain",
        operation,
        confirmedIds,
        remainingIds,
        unknownIds,
      };
    },
  };
}
