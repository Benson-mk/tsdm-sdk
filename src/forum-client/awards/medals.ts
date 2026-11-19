import {
  attr,
  controlDisabled,
  descendants,
  documentFrom,
  hasClass,
  label,
} from "../html.js";
import { integer, numericId, object } from "../notice-transport.js";
import {
  endpoint,
  ids,
  limit,
  medalPlugin,
  pluginURL,
  postPlan,
  publicRecord,
  readReply,
  rows,
  selected,
} from "./protocol.js";
import { nativeIdentity } from "../account-forms.js";
import { hiddenFields, medalLink } from "./native-medals.js";
import type { NoticeHost, NoticeSession } from "../notice-transport.js";
import type {
  AwardLookup,
  AwardsCatalogue,
  AwardsChoice,
  AwardsFailure,
  MedalThreadQuery,
} from "./types.js";

type Data = Record<string, unknown>;
export function medalPlan(
  base: URL,
  data: Data,
  catalogue: AwardsCatalogue,
  choice: AwardsChoice,
) {
  if (catalogue === "medals" && choice.kind === "acquire-medal") {
    const item = selected(data.medals, choice.id);
    const offered = selected(item?.actions, choice.method, "method");
    if (
      !item ||
      !offered ||
      item.owned !== 0 ||
      item.pending !== 0 ||
      offered.ok !== true ||
      ![1, 2, 5, 6].includes(choice.method) ||
      (choice.reason !== undefined &&
        (choice.method !== 2 ||
          typeof choice.reason !== "string" ||
          choice.reason.length > 200))
    )
      return null;
    const terms = publicRecord({ item, offered });
    if (data.representation === "native") {
      if (choice.method === 2) return null;
      if (offered.native_form)
        return postPlan(
          offered.native_form,
          base,
          medalPlugin,
          "claim",
          {},
          terms,
        );
      const link =
        typeof offered.native_url === "string" &&
        medalLink(offered.native_url, base, choice.id);
      return link && link.method === choice.method
        ? { url: link.url, terms }
        : null;
    }
    if (!integer(offered.credit, 0)) return null;
    return postPlan(
      data.claim_form,
      base,
      medalPlugin,
      "claim",
      {
        medalid: String(choice.id),
        method: String(choice.method),
        credit: String(offered.credit),
        ...(choice.method === 2 ? { reason: choice.reason ?? "" } : {}),
      },
      publicRecord({ item, offered }),
    );
  }
  if (catalogue === "mymedals" && choice.kind === "hide-medals") {
    if (
      !Array.isArray(choice.changes) ||
      !choice.changes.every(
        (item) => item && typeof item.hidden === "boolean",
      ) ||
      !ids(
        choice.changes.map((item) => item.id),
        1000,
      )
    )
      return null;
    const items = choice.changes.map(({ id }) => selected(data.medals, id));
    if (items.some((item) => !item)) return null;
    return postPlan(
      data.hide_form,
      base,
      medalPlugin,
      "sethide",
      Object.fromEntries(
        choice.changes.map(({ id, hidden }) => [
          `myMedalHide[${id}]`,
          hidden ? "1" : "2",
        ]),
      ),
      publicRecord({ items, warning: data.hide_warning }),
    );
  }
  if (catalogue !== "medalgrant" || data.supported !== 1) return null;
  if (choice.kind === "grant-medals") {
    if (
      data.can_grant !== 1 ||
      !ids(choice.recipients, limit(data.limits, "users", 200)) ||
      !ids(choice.medals, limit(data.limits, "medals", 50)) ||
      choice.medals.length * choice.recipients.length >
        limit(data.limits, "pairs", 1000) ||
      typeof choice.reason !== "string" ||
      choice.reason.length > limit(data.limits, "reason", 100)
    )
      return null;
    const items = choice.medals.map((id) => selected(data.medals, id));
    if (items.some((item) => !item)) return null;
    return postPlan(
      data.grant_form,
      base,
      medalPlugin,
      "grantgrid",
      {
        grant_users: choice.recipients.join(","),
        grant_medalids: choice.medals.join(","),
        grant_reason: choice.reason,
      },
      publicRecord({ items }),
    );
  }
  const records = object(data.records);
  const batches = rows(records?.batches);
  if (choice.kind === "revoke-medal" || choice.kind === "revoke-medal-batch") {
    const batch = choice.kind === "revoke-medal-batch";
    const record = batch
      ? selected(batches, choice.id, "batch")
      : selected(
          batches.flatMap((row) => rows(row.items)),
          choice.id,
        );
    if (
      !record ||
      !(batch
        ? integer(record.can_revoke, 1)
        : record.can_revoke === 1 && record.revoked === 0)
    )
      return null;
    return postPlan(
      batch ? data.revoke_batch_form : data.revoke_form,
      base,
      medalPlugin,
      batch ? "grantrevokebatch" : "grantrevoke",
      { [batch ? "batch" : "logid"]: String(choice.id) },
      publicRecord({ record }),
    );
  }
  return null;
}

export async function medalLookup(
  host: NoticeHost,
  session: NoticeSession,
  data: Data,
  selection:
    | { recipients: readonly number[]; medals: readonly number[] }
    | { thread: MedalThreadQuery },
): Promise<AwardLookup | AwardsFailure> {
  if (data.supported !== 1 || data.can_grant !== 1) return { kind: "refused" };
  const thread = "thread" in selection;
  const url = endpoint(
    thread ? data.thread_url : data.lookup_url,
    new URL(host.origin),
    medalPlugin,
    thread ? "grantthread" : "grantlookup",
  );
  if (!url) return { kind: "invalid-response" };
  if (thread) {
    const { tid, from = 0, to = 0, noOwner = true } = selection.thread;
    if (
      !integer(tid, 1) ||
      !integer(from, 0) ||
      !integer(to, 0) ||
      (to && to < from) ||
      typeof noOwner !== "boolean"
    )
      return { kind: "invalid-input" };
    for (const [key, field] of Object.entries({
      tid,
      from,
      to,
      noowner: noOwner ? 1 : 0,
    }))
      url.searchParams.set(key, String(field));
  } else {
    if (
      !ids(selection.recipients, limit(data.limits, "users", 200)) ||
      !ids(selection.medals, limit(data.limits, "medals", 50)) ||
      selection.medals.some((id) => !selected(data.medals, id))
    )
      return { kind: "invalid-input" };
    url.searchParams.set("uids", selection.recipients.join(","));
    url.searchParams.set("mids", selection.medals.join(","));
  }
  const reply = await readReply(host, url, session);
  if (reply.kind !== "decoded") return reply;
  const found = reply.data;
  if (found?.ok !== 1) return { kind: "invalid-response" };
  if (thread) {
    if (
      !Array.isArray(found.uids) ||
      found.uids.some((id) => !integer(id, 1)) ||
      !integer(found.total, 0) ||
      typeof found.subject !== "string" ||
      (found.tid !== undefined &&
        numericId(found.tid) !== String(selection.thread.tid))
    )
      return { kind: "invalid-response" };
    return {
      kind: "awards-lookup",
      records: [],
      metadata: publicRecord({
        uids: found.uids,
        total: found.total,
        subject: found.subject,
      }),
    };
  }
  const users = rows(found.users);
  if (
    !Array.isArray(found.users) ||
    users.length !== found.users.length ||
    !Array.isArray(found.missing) ||
    users.some(
      (row) =>
        !selection.recipients.some((id) => String(id) === numericId(row.uid)),
    ) ||
    found.missing.some(
      (id) =>
        !selection.recipients.some((uid) => String(uid) === numericId(id)),
    )
  )
    return { kind: "invalid-response" };
  return {
    kind: "awards-lookup",
    records: users.map(publicRecord),
    metadata: publicRecord({ missing: found.missing }),
  };
}

export async function openApplication(
  host: NoticeHost,
  session: NoticeSession,
  data: Data,
  id: number,
  reason: string,
) {
  const item = selected(data.medals, id);
  const offered = selected(item?.actions, 2, "method");
  if (
    !item ||
    item.owned !== 0 ||
    item.pending !== 0 ||
    offered?.ok !== true ||
    typeof reason !== "string" ||
    reason.length > 200
  )
    return { kind: "refused" } as const;
  const base = new URL(host.origin);
  const link =
    typeof offered.native_url === "string" &&
    medalLink(offered.native_url, base, id);
  const url =
    link && link.method === 2
      ? link.url
      : pluginURL(host.origin, medalPlugin, {
          action: "apply",
          medalid: String(id),
        });
  const reply = await readReply(host, url, session);
  if (reply.kind !== "decoded") return reply;
  const viewer = nativeIdentity(reply.html, url);
  if (viewer && viewer !== session.memberId)
    return { kind: "session-changed" } as const;
  const doc = documentFrom(reply.html);
  const panels = descendants(doc, (node) => hasClass(node, "applybox"));
  const controls =
    panels.length === 1
      ? descendants(panels[0]!, (node) => node.tagName === "form")
      : [];
  if (!controls.length && panels.length === 1) {
    const message = label(
      descendants(panels[0]!, (node) => hasClass(node, "emp"))[0],
    );
    if (message) return { kind: "refused", message } as const;
  }
  if (controls.length === 1) {
    const control = controls[0]!;
    const inputs = descendants(control, (node) =>
      ["input", "textarea", "select"].includes(node.tagName),
    );
    const hidden = inputs.filter(
      (node) =>
        node.tagName === "input" &&
        attr(node, "type") === "hidden" &&
        !controlDisabled(node),
    );
    const reasonBox = inputs.find(
      (node) =>
        node.tagName === "textarea" &&
        attr(node, "name") === "reason" &&
        !controlDisabled(node),
    );
    const fields = Object.fromEntries(
      hidden.map((node) => [attr(node, "name"), attr(node, "value")]),
    );
    if (
      reasonBox &&
      inputs.length === hidden.length + 1 &&
      Object.keys(fields).length === hidden.length &&
      attr(control, "method").toLowerCase() === "post" &&
      fields.medalid === String(id) &&
      fields.method === "2" &&
      fields.dsumcsubmit === "1" &&
      reason.length <= (Number(attr(reasonBox, "maxlength")) || 200)
    ) {
      const plan = postPlan(
        { url: attr(control, "action"), fields },
        url,
        medalPlugin,
        "claim",
        { reason },
        publicRecord({ item }),
      );
      if (plan) return { kind: "plan", plan } as const;
    }
  }
  if (url.searchParams.get("action") === "newapply") {
    const legacy = descendants(
      doc,
      (node) =>
        node.tagName === "form" &&
        attr(node, "method").toLowerCase() === "post" &&
        medalLink(attr(node, "action"), url, id)?.url.href === url.href,
    );
    if (legacy.length === 1) {
      const control = legacy[0]!;
      const inputs = hiddenFields(control);
      const reasons = descendants(
        control,
        (node) =>
          node.tagName === "textarea" &&
          attr(node, "name") === "applyreason" &&
          !controlDisabled(node),
      );
      if (
        inputs &&
        Object.keys(inputs).length === 1 &&
        /^[a-zA-Z0-9]{8}$/.test(inputs.formhash ?? "") &&
        reasons.length === 1 &&
        !descendants(control, (node) => node.tagName === "select").length
      ) {
        return {
          kind: "plan",
          plan: {
            url,
            fields: { ...inputs, applyreason: reason },
            terms: publicRecord({ item }),
          },
        } as const;
      }
    }
  }
  return {
    kind: "awards-handoff",
    catalogue: "medals",
    url: url.href,
    reason: "Review the native application form.",
    choice: Object.freeze({ kind: "acquire-medal", id, method: 2, reason }),
  } as const;
}
