import type { HostResponse } from "../index.js";
import { token } from "./account-forms.js";
import { positive, record, target } from "./discovery/shared.js";
import {
  ajaxText,
  dialogMessage,
  fieldsFromObject,
  nativeForm,
  nativeReceipt,
  qualifiedURL,
  usableForm,
  type CheckedForm,
  type MemberSession,
} from "./member-forms.js";
import type {
  ApproveFriendRequest,
  MemberEffectResult,
  SendFriendRequest,
} from "./member-client.js";
import { parseReadPayload } from "./structured-read.js";

interface Action {
  accountId: string;
  id: string;
  mode: "add" | "approve";
  dialog: URL;
  route: Record<string, string>;
  groupId?: string;
  note?: string;
}
const invalid = { kind: "invalid" } as const;
const refused = { kind: "refused" } as const;
const uncertain = { kind: "uncertain" } as const;

function friendRefusal(
  key: unknown,
  message: string,
): MemberEffectResult | null {
  if (
    key === "waiting_for_the_other_test" ||
    /正在等待[验证驗證]/.test(message)
  )
    return { kind: "pending" };
  if (
    (key === "friends_add" && /已经|已經/.test(message)) ||
    /你們已成為好友|你们已成为好友/.test(message)
  )
    return { kind: "already-friends" };
  if (
    key === "friend_self_error" ||
    /不能加自己為好友|不能加自己为好友/.test(message)
  )
    return refused;
  return null;
}

function structuredFriendForm(
  payload: Record<string, unknown>,
  action: Action,
): CheckedForm | null {
  const submit = record(payload.submit),
    group = record(payload.gid);
  if (
    payload.type !== "form" ||
    !(typeof payload.schema === "number" && payload.schema >= 17) ||
    payload.form !== "friendadd" ||
    payload.mode !== action.mode ||
    positive(payload.touid) !== action.id ||
    !usableForm(payload) ||
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    group?.name !== "gid" ||
    !Array.isArray(group.choices)
  )
    return null;
  const url = qualifiedURL(submit.url, action.dialog, action.route);
  const fields = fieldsFromObject(submit.fields);
  const groups = group.choices.map((choice) => record(choice)?.value);
  if (
    !url ||
    !fields ||
    !groups.every(
      (id): id is string => typeof id === "string" && /^\d{1,3}$/.test(id),
    )
  )
    return null;
  return {
    url,
    fields,
    groups,
    selected:
      typeof group.value === "string" && groups.includes(group.value)
        ? group.value
        : (groups[0] ?? ""),
    structured: true,
  };
}

function readyFriendForm(form: CheckedForm, action: Action): boolean {
  const { fields } = form;
  const approving = action.mode === "approve";
  const submit = approving ? "add2submit" : "addsubmit";
  const group = action.groupId ?? form.selected;
  if (
    ![...fields.keys()].every((name) =>
      [
        "formhash",
        "handlekey",
        "referer",
        submit,
        ...(approving ? ["from"] : []),
      ].includes(name),
    ) ||
    fields.get(submit) !== "true" ||
    !token(fields.get("formhash")) ||
    !token(fields.get("handlekey")) ||
    !form.groups.includes(group) ||
    (approving && !["", "notice"].includes(fields.get("from") ?? ""))
  )
    return false;
  fields.set("gid", group);
  if (!approving) fields.set("note", action.note ?? "");
  return true;
}

function friendResult(
  response: HostResponse,
  action: Action,
  form: CheckedForm,
): MemberEffectResult {
  if (response.status === 429) return { kind: "limited" };
  const payload = parseReadPayload(response);
  if (payload && positive(payload.uid) !== action.accountId) return uncertain;
  if (response.status !== 200) return uncertain;
  const approving = action.mode === "approve";
  const outcome = { kind: approving ? "approved" : "request-sent" } as const;
  if (payload?.type === "result" && Number(payload.schema) >= 13) {
    if (payload.login === 1) return { kind: "login" };
    const values = record(payload.values);
    if (values?.uid !== undefined && positive(values.uid) !== action.id)
      return uncertain;
    const expected = approving ? "friends_add" : "request_has_been_sent";
    if (
      payload.ok === 1 &&
      payload.message_key === expected &&
      ["handle", "message"].includes(String(payload.kind))
    )
      return outcome;
    if (payload.ok === 0)
      return (
        friendRefusal(payload.message_key, String(payload.message ?? "")) ??
        refused
      );
  }
  if (
    payload?.type === "form" &&
    payload.form === "friendadd" &&
    structuredFriendForm(payload, action)
  )
    return refused;
  const html = ajaxText(response, payload);
  const receipt = nativeReceipt(html, form.fields.get("handlekey")!);
  if (receipt) {
    if (
      approving &&
      receipt.fields.get("uid") === action.id &&
      /成[為为]好友/.test(receipt.message)
    )
      return outcome;
    if (!approving && /好友[请求請求]+已[发發]送/.test(receipt.message))
      return outcome;
    return uncertain;
  }
  return friendRefusal(null, dialogMessage(html)) ?? uncertain;
}

export function createFriendEffects(host: MemberSession) {
  async function change(action: Action): Promise<MemberEffectResult> {
    const continuity = host.session();
    if (!continuity) return { kind: "stale" };
    const before = await host.identity(action.accountId, continuity);
    if (before.kind !== "status" && before.kind !== "native-status")
      return before;
    const dialog = action.dialog;
    dialog.searchParams.set("tsdmapp", "json");
    if (
      before.kind === "status" &&
      before.switches.v4 &&
      before.lists.forms?.includes("friendadd")
    ) {
      for (const [key, value] of Object.entries({
        tsdmv: "4",
        tsdmform: "1",
        nodoc: "1",
      }))
        dialog.searchParams.set(key, value);
    }
    let response = await host.request(dialog, continuity);
    if ("kind" in response) return response;
    const payload = parseReadPayload(response);
    if (payload?.login === 1 || response.status === 401)
      return { kind: "login" };
    if (
      payload?.uid !== undefined &&
      positive(payload.uid) !== action.accountId
    )
      return { kind: "stale" };
    if (response.status === 429) return { kind: "limited" };
    if (response.status === 403) return refused;
    if (response.status !== 200) return { kind: "unavailable" };
    const known = friendRefusal(
      payload?.message_key,
      String(payload?.message ?? dialogMessage(ajaxText(response, payload))),
    );
    if (known) return known;
    if (payload?.ok === 0 && payload.error === "message") return refused;
    let form = payload && structuredFriendForm(payload, action);
    if (!form && payload?.type === "form" && payload.form === "friendadd")
      return refused;
    if (!form)
      form = nativeForm(
        ajaxText(response, payload),
        dialog,
        action.route,
        action.mode === "approve" ? ["gid"] : ["gid", "note"],
      );
    if (
      !form ||
      (form.structured && positive(payload?.uid) !== action.accountId) ||
      !readyFriendForm(form, action)
    )
      return invalid;
    const verified = await host.identity(action.accountId, continuity);
    if (verified.kind !== "status" && verified.kind !== "native-status")
      return verified;
    form.url.searchParams.set("inajax", "1");
    form.url.searchParams.set("tsdmapp", "json");
    if (form.structured) form.url.searchParams.set("tsdmv", "4");
    response = await host.request(form.url, continuity, form.fields, true);
    if ("kind" in response) return uncertain;
    const after = await host.identity(action.accountId, continuity);
    if (after.kind !== "status" && after.kind !== "native-status")
      return uncertain;
    return friendResult(response, action, form);
  }

  return {
    async sendFriendRequest(
      input: SendFriendRequest,
    ): Promise<MemberEffectResult> {
      const id = positive(input.memberId);
      if (
        !id ||
        !positive(input.accountId) ||
        input.accountId === id ||
        (input.note && [...input.note].length > 30)
      )
        return invalid;
      const route = { mod: "spacecp", ac: "friend", op: "add", uid: id };
      const dialog = new URL(
        `/home.php?${new URLSearchParams({ ...route, handlekey: `addfriendhk_${id}`, inajax: "1" })}`,
        host.origin,
      );
      return change({ ...input, id, mode: "add", dialog, route });
    },
    async approveFriendRequest(
      input: ApproveFriendRequest,
    ): Promise<MemberEffectResult> {
      const notice = target(
        input.noticeURL,
        host.origin,
        "/home.php",
        "spacecp",
      );
      const id = positive(notice?.searchParams.get("uid"));
      if (
        !notice ||
        !id ||
        !positive(input.accountId) ||
        input.accountId === id ||
        notice.username ||
        notice.password
      )
        return invalid;
      const route = { mod: "spacecp", ac: "friend", op: "add", uid: id };
      const q = notice.searchParams;
      if (
        q.size !== 5 ||
        q.get("from") !== "notice" ||
        !Object.entries(route).every(([key, value]) => q.get(key) === value)
      )
        return invalid;
      const dialog = new URL(
        `/home.php?${new URLSearchParams({ ...route, from: "notice", infloat: "yes", handlekey: `afr_${id}`, inajax: "1" })}`,
        host.origin,
      );
      return change({ ...input, id, mode: "approve", dialog, route });
    },
  };
}
