import { token } from "./account-forms.js";
import { positive, record } from "./discovery/shared.js";
import {
  ajaxText,
  dialogMessage,
  fieldsFromObject,
  nativeForm,
  nativeReceipt,
  qualifiedURL,
  usableForm,
  type MemberSession,
} from "./member-forms.js";
import { createMemberReads, type FavoriteEntry } from "./member-reads.js";
import type {
  AddFavorite,
  FavoriteEffectResult,
  FavoriteTarget,
  RemoveFavorite,
} from "./member-client.js";
import { parseReadPayload } from "./structured-read.js";
import type { HostResponse } from "../index.js";

type FavoriteAction = AddFavorite | RemoveFavorite;
const invalid = { kind: "invalid" } as const;
const refused = { kind: "refused" } as const;
const uncertain = { kind: "uncertain" } as const;
const unavailable = { kind: "unavailable" } as const;
const stale = { kind: "stale" } as const;

function verdict(payload: Record<string, unknown> | null, html: string) {
  const key = payload?.message_key;
  const message = String(payload?.message ?? dialogMessage(html));
  if (
    key === "favorite_repeat" ||
    /[您你]已收藏.*[请請]勿重[复複覆]收藏/.test(message)
  )
    return "repeat";
  if (key === "favorite_does_not_exist" || /指定的收藏不存在/.test(message))
    return "missing";
  if (key === "favorite_status_off" || /收藏功能尚未[开開][启啟]/.test(message))
    return "refused";
  return null;
}

function receipt(
  response: HostResponse,
  action: FavoriteAction,
  handle: string,
) {
  const remove = "recordId" in action;
  const payload = parseReadPayload(response);
  if (
    response.status !== 200 ||
    (payload && positive(payload.uid) !== action.accountId)
  )
    return uncertain;
  const html = ajaxText(response, payload);
  const explicit = verdict(payload, html);
  if (explicit === "repeat" && !remove) return { kind: "repeat" } as const;
  if (explicit === "missing" && remove) return { kind: "missing" } as const;
  if (explicit === "refused" || payload?.login === 1) return refused;
  let fields: Record<string, unknown> | null;
  if (
    payload?.type === "result" &&
    Number(payload.schema) >= 13 &&
    ["handle", "message"].includes(String(payload.kind))
  ) {
    if (payload.ok === 0) return refused;
    if (
      payload.ok !== 1 ||
      payload.message_key !== (remove ? "do_success" : "favorite_do_success")
    )
      return uncertain;
    fields = record(payload.values);
  } else {
    const native = nativeReceipt(html, handle);
    if (!native || !(remove ? /操作成功/ : /收藏成功/).test(native.message))
      return uncertain;
    fields = Object.fromEntries(native.fields);
  }
  if (
    (fields?.id !== undefined && positive(fields.id) !== action.targetId) ||
    (fields?.favid !== undefined &&
      (!positive(fields.favid) ||
        (remove && positive(fields.favid) !== action.recordId)))
  )
    return uncertain;
  return { kind: "accepted" as const, recordId: positive(fields?.favid) };
}

export function createFavoriteEffects(host: MemberSession) {
  async function locate(
    action: FavoriteTarget,
    continuity: string,
    recordId?: string,
  ) {
    const read = createMemberReads(host.origin, {
      async request(url) {
        const result = await host.request(new URL(url), continuity);
        if ("kind" in result) throw Error(result.kind);
        return result;
      },
    });
    const seen = new Set<string>();
    let page = 1;
    while (page <= 20) {
      const result = await read.readFavorites({ ...action, page });
      if (host.session() !== continuity) return stale;
      if (result.kind !== "favorites")
        return result.kind === "stale" ? stale : unavailable;
      let found: FavoriteEntry | undefined;
      for (const item of result.items) {
        if (seen.has(item.recordId)) return unavailable;
        seen.add(item.recordId);
        if (item.recordId === recordId && item.targetId !== action.targetId)
          return invalid;
        if (item.targetId === action.targetId) found = item;
      }
      if (found) return { kind: "present" as const, item: found };
      if (result.nextPage === null) return { kind: "absent" as const };
      page = result.nextPage;
    }
    return unavailable;
  }

  async function change(action: FavoriteAction): Promise<FavoriteEffectResult> {
    const remove = "recordId" in action;
    if (
      !positive(action.accountId) ||
      !positive(action.targetId) ||
      !["thread", "forum"].includes(action.kind) ||
      (remove
        ? !positive(action.recordId)
        : (action.description ?? "").length > 200)
    )
      return invalid;
    const active = host.session();
    if (!active) return stale;
    const continuity: string = active;
    const before = await host.identity(action.accountId, continuity);
    if (before.kind !== "status" && before.kind !== "native-status")
      return before;
    if (remove) {
      const existing = await locate(action, continuity, action.recordId);
      if (existing.kind === "absent") return { kind: "already-absent" };
      if (existing.kind !== "present") return existing;
      if (existing.item.recordId !== action.recordId) return invalid;
    }
    const route: Record<string, string> = {
      mod: "spacecp",
      ac: "favorite",
      type: action.kind,
    };
    if (remove) {
      route.op = "delete";
      route.favid = action.recordId;
    } else route.id = action.targetId;
    const dialog = new URL(
      `/home.php?${new URLSearchParams({ ...route, infloat: "yes", handlekey: remove ? "favdelete" : "k_favorite", inajax: "1", tsdmapp: "json" })}`,
      host.origin,
    );
    if (
      !remove &&
      before.kind === "status" &&
      before.switches.v4 &&
      before.lists.forms?.includes("favorite")
    ) {
      for (const [key, value] of Object.entries({
        tsdmv: "4",
        tsdmform: "1",
        nodoc: "1",
      }))
        dialog.searchParams.set(key, value);
    }
    async function verify(
      outcome: "accepted" | "repeat" | "missing",
      receiptId?: string | null,
    ): Promise<FavoriteEffectResult> {
      const readback = await locate(
        action,
        continuity,
        remove ? action.recordId : undefined,
      );
      if (remove) {
        if (readback.kind !== "absent") return uncertain;
        return outcome === "missing"
          ? { kind: "already-absent" }
          : { kind: "removed", recordId: action.recordId };
      }
      if (
        readback.kind !== "present" ||
        (receiptId && readback.item.recordId !== receiptId)
      )
        return uncertain;
      return {
        kind: outcome === "repeat" ? "already-saved" : "added",
        recordId: readback.item.recordId,
      };
    }
    const opening = await host.request(dialog, continuity);
    if ("kind" in opening) return opening;
    const payload = parseReadPayload(opening);
    if (payload?.login === 1 || opening.status === 401)
      return { kind: "login" };
    if (
      payload?.uid !== undefined &&
      positive(payload.uid) !== action.accountId
    )
      return stale;
    if (opening.status === 429) return { kind: "limited" };
    if (opening.status === 403) return refused;
    if (opening.status !== 200) return unavailable;
    const html = ajaxText(opening, payload);
    const explicit = verdict(payload, html);
    if (explicit === "repeat" && !remove) return verify("repeat");
    if (explicit === "missing" && remove) return verify("missing");
    if (
      explicit === "refused" ||
      (payload?.ok === 0 && payload.error === "message")
    )
      return refused;
    const structured = payload?.type === "form" && payload.form === "favorite";
    let form: { url: URL; fields: URLSearchParams } | null;
    if (structured) {
      const submit = record(payload.submit);
      if (
        remove ||
        payload.ok !== 1 ||
        !(typeof payload.schema === "number" && payload.schema >= 17) ||
        positive(payload.uid) !== action.accountId ||
        payload.favtype !== action.kind ||
        positive(payload.id) !== action.targetId ||
        !usableForm(payload) ||
        submit?.method !== "POST" ||
        submit.enctype !== "application/x-www-form-urlencoded"
      )
        return invalid;
      const url = qualifiedURL(submit.url, dialog, route);
      const fields = fieldsFromObject(submit.fields);
      form = url && fields && { url, fields };
    } else {
      form = nativeForm(html, dialog, route, remove ? [] : ["description"]);
    }
    if (!form) return invalid;
    const submit = remove ? "deletesubmit" : "favoritesubmit";
    const handle = token(form.fields.get("handlekey"));
    if (
      !handle ||
      !token(form.fields.get("formhash")) ||
      form.fields.get(submit) !== "true" ||
      ![...form.fields.keys()].every((name) =>
        [submit, "formhash", "handlekey", "referer"].includes(name),
      )
    )
      return invalid;
    if (!remove) form.fields.set("description", action.description ?? "");
    const verified = await host.identity(action.accountId, continuity);
    if (verified.kind !== "status" && verified.kind !== "native-status")
      return verified;
    form.url.searchParams.set("inajax", "1");
    form.url.searchParams.set("tsdmapp", "json");
    if (structured) form.url.searchParams.set("tsdmv", "4");
    const sent = await host.request(form.url, continuity, form.fields, true);
    if ("kind" in sent) return uncertain;
    const after = await host.identity(action.accountId, continuity);
    if (after.kind !== "status" && after.kind !== "native-status")
      return uncertain;
    const result = receipt(sent, action, handle);
    if (result.kind === "accepted") return verify("accepted", result.recordId);
    if (result.kind === "repeat" || result.kind === "missing")
      return verify(result.kind);
    return result;
  }
  return {
    addFavorite(input: AddFavorite) {
      return change(input);
    },
    removeFavorite(input: RemoveFavorite) {
      return change(input);
    },
  };
}
