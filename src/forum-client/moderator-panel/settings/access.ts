import { id, record, string } from "../../activity-protocol.js";
import type { ActivitySession } from "../../activity-client.js";
import {
  jsonRead,
  pageNumber,
  panelRefusal,
  panelRoute,
  positive,
  type PanelContext,
} from "../protocol.js";
import type {
  PanelAccessPage,
  PanelAccessRead,
  PanelAccessRight,
  PanelSettingOutcome,
} from "../settings-types.js";
import {
  attributed,
  boundData,
  offeredForums,
  settingRefused,
  structuredForm,
  verdict,
  type SettingsForm,
} from "./common.js";

const rights = [
  "view",
  "post",
  "reply",
  "getattach",
  "getimage",
  "postattach",
  "postimage",
] as const;
const operation = "set-forum-access";
const nameOf = (value: string) =>
  typeof value === "string" ? value.trim() : "";
interface AccessBinding {
  owner: ActivitySession;
  search: SettingsForm | null;
  add: SettingsForm | null;
}

export function panelAccess(panel: PanelContext) {
  const bindings = new WeakMap<PanelAccessPage, AccessBinding>();
  function decode(
    data: Record<string, unknown> | null,
    url: URL,
    owner: ActivitySession,
    forumId: string,
  ): PanelAccessRead {
    if (
      !boundData(data, "modcp_forumaccess", 38, owner) ||
      String(data.fid) !== forumId ||
      !Array.isArray(data.list) ||
      !pageNumber(data.page) ||
      !(data.pages === 0 || pageNumber(data.pages))
    )
      return { kind: "invalid-response" };
    const items: PanelAccessPage["items"][number][] = [];
    for (const raw of data.list) {
      const row = record(raw),
        uid = id(row?.uid),
        username = string(row?.username);
      if (
        !row ||
        !uid ||
        !username ||
        id(row.fid) !== forumId ||
        items.some((item) => item.memberId === uid)
      )
        return { kind: "invalid-response" };
      const values: Partial<Record<PanelAccessRight, -1 | 0 | 1>> = {};
      for (const right of rights) {
        const value = row[right];
        if (value === -1 || value === 0 || value === 1) values[right] = value;
      }
      items.push(
        Object.freeze({
          memberId: uid,
          username,
          rights: Object.freeze(values),
        }),
      );
    }
    const query = record(data.search),
      offer = record(data.add);
    const lookup = structuredForm(query, url, "forumaccess", undefined, [
      "formhash",
      "searchsubmit",
    ]);
    const edit = structuredForm(offer, url, "forumaccess", undefined, [
      "formhash",
      "op",
      "addsubmit",
    ]);
    const deny = record(offer?.deny_fields);
    const search =
      forumId !== "0" &&
      lookup?.fields.searchsubmit === "true" &&
      query?.fid_field === "fid" &&
      query.user_field === "suser"
        ? lookup
        : null;
    const add =
      forumId !== "0" &&
      data.can_add === 1 &&
      edit?.fields.op === "" &&
      edit.fields.addsubmit === "true" &&
      offer?.fid_field === "fid" &&
      offer.user_field === "new_user" &&
      offer.restore_field === "deleteaccess" &&
      offer.restore_value === "1" &&
      offer.deny_value === "-1" &&
      rights.every((right) => deny?.[right] === `new_${right}`)
        ? edit
        : null;
    const page = Object.freeze({
      forumId,
      forums: offeredForums(data.forums),
      keyword: string(data.keyword),
      page: data.page,
      pages: data.pages || 1,
      items: Object.freeze(items),
      canSearch: !!search,
      canSet: !!add,
    });
    bindings.set(page, { owner, search, add });
    return { kind: "forum-access", page };
  }
  return {
    async readForumAccess(forumId = "0", page = 1): Promise<PanelAccessRead> {
      if ((!positive(forumId) && forumId !== "0") || !pageNumber(page))
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const url = panelRoute(panel.origin, {
        action: "forumaccess",
        ...(forumId !== "0" && { fid: forumId }),
        ...(page > 1 && { page: String(page) }),
        ...jsonRead,
      });
      const reply = await panel.read(url, owner);
      return reply.kind === "response"
        ? decode(reply.parsed.data, url, owner, forumId)
        : reply;
    },
    async searchForumAccess(
      page: PanelAccessPage,
      username: string,
    ): Promise<PanelAccessRead> {
      const bind = bindings.get(page);
      if (!bind) return { kind: "stale" };
      if (!panel.current(bind.owner)) return { kind: "session-changed" };
      if (!bind.search)
        return { kind: "refused", code: "access-search-unavailable" };
      const name = nameOf(username);
      if (!name) return { kind: "invalid-input" };
      // The panel's read-only search uses POST. Keep the host's single-attempt POST contract.
      const reply = await panel.write(
        bind.search.url,
        bind.owner,
        new URLSearchParams({
          ...bind.search.fields,
          fid: page.forumId,
          suser: name,
        }),
      );
      if (reply.kind !== "response")
        return reply.kind === "uncertain"
          ? { kind: "invalid-response" }
          : reply;
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return problem;
      const found = decode(
        reply.parsed.data,
        bind.search.url,
        bind.owner,
        page.forumId,
      );
      return found.kind !== "forum-access" ||
        (found.page.keyword === name &&
          found.page.items.every((row) => row.username === name))
        ? found
        : { kind: "invalid-response" };
    },
    async setForumAccess(
      page: PanelAccessPage,
      username: string,
      denied: readonly PanelAccessRight[],
      approved: boolean,
    ): Promise<PanelSettingOutcome> {
      if (approved !== true)
        return attributed(operation, { kind: "not-confirmed" });
      const bind = bindings.get(page);
      if (!bind) return attributed(operation, { kind: "stale" });
      if (!panel.current(bind.owner))
        return attributed(operation, { kind: "session-changed" });
      if (!bind.add)
        return settingRefused(operation, "access-change-unavailable");
      const name = nameOf(username);
      if (
        !name ||
        (page.keyword && page.keyword !== name) ||
        !Array.isArray(denied) ||
        denied.some((right) => !rights.includes(right))
      )
        return attributed(operation, { kind: "invalid-input" });
      const values = new URLSearchParams({
        ...bind.add.fields,
        fid: page.forumId,
        new_user: name,
      });
      if (!denied.length) values.set("deleteaccess", "1");
      else
        for (const right of rights)
          if (denied.includes("view") || denied.includes(right))
            values.set(`new_${right}`, "-1");
      bindings.delete(page);
      const reply = await panel.write(bind.add.url, bind.owner, values);
      if (reply.kind !== "response") return attributed(operation, reply);
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return attributed(operation, problem);
      const data = reply.parsed.data;
      if (
        !boundData(data, "modcp_forumaccess", 38, bind.owner) ||
        String(data.fid) !== page.forumId
      )
        return verdict(operation, "uncertain");
      const result = record(data.result);
      const code = string(result?.error_key);
      if (code || result?.error === 1)
        return settingRefused(operation, code || "access-change-refused");
      return verdict(
        operation,
        result?.done === 1 ? "acknowledged" : "redrawn",
      );
    },
  };
}
