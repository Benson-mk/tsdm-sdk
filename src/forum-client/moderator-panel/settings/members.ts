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
import { authorLink } from "../native.js";
import {
  assessSelection,
  formhash,
  hidden,
  jsonV4Write,
  pageNumber,
  panelRefusal,
  panelRoute,
  positive,
  validSelection,
  type PanelContext,
  type PanelFields,
} from "../protocol.js";
import type {
  PanelBanChoice,
  PanelIpBanPage,
  PanelIpBanRead,
  PanelMemberEdit,
  PanelMemberMode,
  PanelMemberPage,
  PanelMemberQuery,
  PanelMemberRead,
  PanelSettingOutcome,
} from "../settings-types.js";
import {
  attributed,
  boundData,
  control,
  jsonWrite,
  nativeSettingForms,
  readSettingPage,
  resultKey,
  settingRefused,
  structuredForm,
  verdict,
  type PanelReply,
  type SettingsForm,
} from "./common.js";

const choices = ["0", "4", "5"] as const;
const isChoice = (value: unknown): value is PanelBanChoice =>
  choices.some((choice) => choice === value);
const memberFixed = ["formhash", "uid", "username"];
const isText = (value: unknown): value is string => typeof value === "string";
const forbidden = (code: string) => ({ kind: "refused", code }) as const;

function decodeMember(
  reply: PanelReply,
  source: URL,
  owner: ActivitySession,
  mode: PanelMemberMode,
) {
  const { data, doc } = reply.parsed;
  const submitFlag = mode === "ban" ? "bansubmit" : "editsubmit";
  if (data?.type === "modcp_member") {
    if (!boundData(data, "modcp_member", 43, owner) || data.op !== mode)
      return null;
    const row = record(data.member),
      memberId = id(row?.uid),
      username = string(row?.username),
      fields = record(data[mode]);
    if (!memberId || !username) return null;
    const meta = record(fields?.submit);
    const url = structuredForm(
      meta,
      source,
      "member",
      mode,
      [...memberFixed, submitFlag],
      jsonV4Write,
    );
    const valid =
      url?.fields.uid === memberId &&
      url.fields[submitFlag] === "true" &&
      (mode === "ban"
        ? meta?.status_field === "bannew" &&
          meta.days_field === "banexpirynew" &&
          meta.reason_field === "reason"
        : meta?.bio_field === "bionew" &&
          meta.signature_field === "signaturenew" &&
          isText(fields?.bio) &&
          isText(fields.signature));
    const offered =
      mode === "ban" && valid && Array.isArray(fields?.choices)
        ? fields.choices.flatMap((raw) => {
            const entry = record(raw);
            return isChoice(entry?.value)
              ? [
                  Object.freeze({
                    value: entry.value,
                    label: string(entry.label),
                  }),
                ]
              : [];
          })
        : [];
    const history = Array.isArray(fields?.crimes)
      ? fields.crimes.flatMap((raw) => {
          const entry = record(raw);
          return entry
            ? [
                Object.freeze({
                  action: string(entry.action_text),
                  reason: string(entry.reason),
                  operator: string(entry.operator),
                  time:
                    typeof entry.dateline === "number" ? entry.dateline : null,
                }),
              ]
            : [];
        })
      : [];
    if (valid) delete url.fields[submitFlag];
    const page: PanelMemberPage = Object.freeze({
      mode,
      memberId,
      username,
      status: string(row?.status),
      choices: Object.freeze(offered),
      history: Object.freeze(history),
      ...(mode === "edit" && {
        bio: string(fields?.bio),
        signature: string(fields?.signature),
      }),
      reasonRequired: fields?.reason_required === 1,
      canEdit: mode === "edit" && !!valid,
      canClearAvatar:
        mode === "edit" &&
        !!valid &&
        meta?.clearavatar_field === "clearavatar" &&
        meta.clearavatar_value === "1",
    });
    return { page, form: valid ? url : null };
  }
  for (const node of nativeSettingForms(doc, source, "member", mode)) {
    const fields = hidden(node, memberFixed);
    const memberId = fields?.uid;
    if (!fields || !positive(memberId) || !formhash(fields.formhash)) continue;
    const name = descendants(
      node,
      (child) => child.tagName === "a" && authorLink(child) === memberId,
    )[0];
    const username = label(name);
    if (!username) continue;
    const bio = control(node, "bionew", "textarea"),
      signature = control(node, "signaturenew", "textarea");
    const offered =
      mode === "ban"
        ? descendants(
            node,
            (child) =>
              child.tagName === "input" &&
              attr(child, "type") === "radio" &&
              attr(child, "name") === "bannew" &&
              !controlDisabled(child),
          ).flatMap((child) => {
            const value = attr(child, "value");
            return isChoice(value)
              ? [
                  Object.freeze({
                    value,
                    label: label(child.parentNode ?? child),
                  }),
                ]
              : [];
          })
        : [];
    const canEdit =
      mode === "edit" && !!bio && !!signature && !!control(node, submitFlag);
    const canBan = offered.length > 0 && !!control(node, submitFlag);
    const history = descendants(
      node,
      (child) => child.tagName === "tbody" && !!attr(child, "id"),
    ).flatMap((section) =>
      descendants(section, (child) => child.tagName === "tr").flatMap((row) => {
        const cells = descendants(row, (child) => child.tagName === "td");
        return cells.length >= 4
          ? [
              Object.freeze({
                action: label(cells[0]),
                time: label(cells[1]),
                reason: label(cells[2]),
                operator: label(cells[3]),
              }),
            ]
          : [];
      }),
    );
    const page: PanelMemberPage = Object.freeze({
      mode,
      memberId,
      username,
      status: "",
      choices: Object.freeze(canBan ? offered : []),
      history: Object.freeze(history),
      reasonRequired: false,
      canEdit,
      canClearAvatar:
        canEdit && attr(control(node, "clearavatar") ?? node, "value") === "1",
      ...(bio && signature && { bio: text(bio), signature: text(signature) }),
    });
    return {
      page,
      form:
        canEdit || canBan
          ? {
              url: panelRoute(source.origin, {
                action: "member",
                op: mode,
                ...jsonWrite,
              }),
              fields,
            }
          : null,
    };
  }
  return null;
}

export function panelMembers(panel: PanelContext) {
  const memberForms = new WeakMap<
    PanelMemberPage,
    { owner: ActivitySession; form: SettingsForm | null }
  >();
  type MemberEffect = "edit-member" | "ban-member";
  async function commit(
    page: PanelMemberPage,
    operation: MemberEffect,
    fields: PanelFields | null,
    approved: boolean,
  ): Promise<PanelSettingOutcome> {
    if (approved !== true)
      return attributed(operation, { kind: "not-confirmed" });
    const bound = memberForms.get(page);
    if (!bound) return attributed(operation, { kind: "stale" });
    if (!panel.current(bound.owner))
      return attributed(operation, { kind: "session-changed" });
    if (
      !bound.form ||
      (operation === "edit-member" ? !page.canEdit : !page.choices.length)
    )
      return settingRefused(operation, "member-action-unavailable");
    if (!fields) return attributed(operation, { kind: "invalid-input" });
    const { owner, form } = bound;
    memberForms.delete(page);
    const reply = await panel.write(
      form.url,
      owner,
      new URLSearchParams({ ...form.fields, ...fields }),
    );
    if (reply.kind !== "response") return attributed(operation, reply);
    const { data } = reply.parsed;
    const problem = panelRefusal(reply.response, reply.parsed);
    if (problem) return attributed(operation, problem);
    const key =
      operation === "edit-member"
        ? "members_edit_succeed"
        : "modcp_member_ban_succeed";
    const legacy =
      operation === "edit-member"
        ? "用户信息成功更新，请继续操作"
        : "用户资料成功更新";
    const uid = id(record(data?.member)?.uid ?? data?.target_uid);
    if (uid && uid !== page.memberId) return verdict(operation, "uncertain");
    if (
      resultKey(data, owner) === key ||
      (!form.url.searchParams.has("tsdmv") &&
        boundData(data, "result", 13, owner) &&
        data.kind === "message" &&
        string(data.message).trim() === legacy)
    )
      return { kind: "acknowledged", operation, code: key };
    return verdict(
      operation,
      data?.type === "modcp_member" || data?.kind === "page"
        ? "redrawn"
        : "uncertain",
    );
  }
  return {
    async lookupPanelMember(
      mode: PanelMemberMode,
      query: PanelMemberQuery,
    ): Promise<PanelMemberRead> {
      if (mode !== "ban" && mode !== "edit") return { kind: "invalid-input" };
      const operation =
        mode === "ban" ? "lookup-member-ban" : "lookup-member-edit";
      const owner = panel.session();
      if (!owner) return { ...forbidden("login"), operation };
      const memberId = query?.uid,
        username = string(query?.username).trim();
      if (
        (memberId !== undefined && !positive(memberId)) ||
        !!memberId === !!username
      )
        return { kind: "invalid-input" };
      const reply = await readSettingPage(
        panel,
        owner,
        {
          action: "member",
          op: mode,
          ...(memberId ? { uid: memberId } : { username }),
        },
        "member",
        "modcp_member",
      );
      if (reply.kind !== "response")
        return reply.kind === "refused" ? { ...reply, operation } : reply;
      const error = string(reply.parsed.data?.error_key);
      if (error) return { ...forbidden(error), operation };
      const found = decodeMember(reply, reply.url, owner, mode);
      if (!found) return { kind: "invalid-response" };
      if (
        memberId
          ? memberId !== found.page.memberId
          : username !== found.page.username
      )
        return { kind: "invalid-response" };
      memberForms.set(found.page, { owner, form: found.form });
      return { kind: "panel-member", page: found.page };
    },
    editPanelMember(
      page: PanelMemberPage,
      chosen: PanelMemberEdit,
      approved: boolean,
    ) {
      const valid =
        chosen &&
        isText(chosen.bio) &&
        isText(chosen.signature) &&
        (chosen.clearAvatar === undefined ||
          typeof chosen.clearAvatar === "boolean") &&
        (!chosen.clearAvatar || page?.canClearAvatar);
      return commit(
        page,
        "edit-member",
        valid
          ? {
              bionew: chosen.bio,
              signaturenew: chosen.signature,
              ...(chosen.clearAvatar && { clearavatar: "1" }),
              editsubmit: "true",
            }
          : null,
        approved,
      );
    },
    changeMemberBan(
      page: PanelMemberPage,
      choice: PanelBanChoice,
      days: number | null,
      reason: string,
      approved: boolean,
    ) {
      const valid =
        page?.choices.some((entry) => entry.value === choice) &&
        isText(reason) &&
        (!page.reasonRequired || !!reason.trim()) &&
        (days === null || (choice !== "0" && pageNumber(days)));
      return commit(
        page,
        "ban-member",
        valid
          ? {
              bannew: choice,
              banexpirynew: choice === "0" || days === null ? "" : String(days),
              reason: reason.trim(),
              bansubmit: "true",
            }
          : null,
        approved,
      );
    },
  };
}

function decodeBans(reply: PanelReply, source: URL, owner: ActivitySession) {
  const { data, doc } = reply.parsed;
  const items: PanelIpBanPage["items"][number][] = [];
  let form: SettingsForm | null = null;
  let cidrAllowed: boolean | null = null;
  let nativeRefusal: string | null = null;
  if (data?.type === "modcp_ipban") {
    if (!boundData(data, "modcp_ipban", 44, owner) || !Array.isArray(data.list))
      return null;
    for (const raw of data.list) {
      const row = record(raw),
        entry = id(row?.id);
      if (
        !entry ||
        !row ||
        !string(row.ip) ||
        items.some((item) => item.id === entry)
      )
        return null;
      items.push(
        Object.freeze({
          id: entry,
          ip: string(row.ip),
          operator: string(row.admin),
          canDelete: row.can_delete === 1,
        }),
      );
    }
    const submit = record(data.submit);
    const offer = structuredForm(
      submit,
      source,
      "member",
      "ipban",
      ["formhash", "ipbansubmit"],
      jsonV4Write,
    );
    if (
      offer?.fields.ipbansubmit === "true" &&
      submit?.ip_field === "ipnew" &&
      submit.days_field === "validitynew" &&
      submit.ids_field === "delete[]"
    )
      form = offer;
    cidrAllowed = data.cidr === 0 ? false : data.cidr === 1 ? true : null;
  } else {
    const forms = nativeSettingForms(doc, source, "member", "ipban").filter(
      (node) => !!control(node, "ipnew", "input"),
    );
    const node = forms.length === 1 ? forms[0] : undefined;
    const fields = node && hidden(node, ["formhash"]);
    if (!node || !fields || !formhash(fields.formhash)) return null;
    const submits = descendants(
      node,
      (child) =>
        ["button", "input"].includes(child.tagName) &&
        attr(child, "name") === "ipbansubmit" &&
        attr(child, "value") === "true" &&
        !controlDisabled(child),
    );
    for (const row of descendants(node, (child) => child.tagName === "tr")) {
      const box = descendants(
        row,
        (child) =>
          child.tagName === "input" &&
          attr(child, "name") === "delete[]" &&
          attr(child, "type") === "checkbox",
      );
      if (!box.length) continue;
      const cells = descendants(row, (child) => child.tagName === "td"),
        entry = attr(box[0]!, "value");
      if (
        box.length !== 1 ||
        !positive(entry) ||
        cells.length < 6 ||
        items.some((item) => item.id === entry)
      )
        return null;
      items.push(
        Object.freeze({
          id: entry,
          ip: label(cells[1]),
          operator: label(cells[3]),
          canDelete: !controlDisabled(box[0]!),
        }),
      );
    }
    const addButton = submits[0],
      ipBox = control(node, "ipnew", "input");
    if (addButton?.parentNode && ipBox) {
      const line = children(addButton.parentNode)
        .filter(
          (child) =>
            child !== addButton &&
            (!element(child) || !["button", "script"].includes(child.tagName)),
        )
        .map(text)
        .join(" ")
        .trim();
      if (
        /请输入标准 IP 地址|請輸入標準 IP 地址|CIDR|已经禁止|已經禁止|新增 IP 地址失败|新增 IP 地址失敗/.test(
          line,
        )
      )
        nativeRefusal = attr(ipBox, "value").trim();
    }
    if (submits.length && control(node, "validitynew", "input"))
      form = {
        url: panelRoute(source.origin, { action: "member", op: "ipban" }),
        fields: { ...fields, ipbansubmit: "true" },
      };
  }
  return {
    page: Object.freeze({
      items: Object.freeze(items),
      canAdd: !!form,
      cidrAllowed,
    }),
    form,
    nativeRefusal,
  };
}

export function panelIpBans(panel: PanelContext) {
  const bindings = new WeakMap<
    PanelIpBanPage,
    { owner: ActivitySession; form: SettingsForm | null }
  >();
  async function submit(
    page: PanelIpBanPage,
    operation: "add-ip-ban" | "delete-ip-bans",
    approved: boolean,
    change: { ip: string; days: number } | readonly string[],
  ): Promise<PanelSettingOutcome> {
    if (approved !== true)
      return attributed(operation, { kind: "not-confirmed" });
    const bound = bindings.get(page);
    if (!bound) return attributed(operation, { kind: "stale" });
    if (!panel.current(bound.owner))
      return attributed(operation, { kind: "session-changed" });
    const { owner, form } = bound;
    if (!form) return settingRefused(operation, "ip-ban-form-unavailable");
    const values = new URLSearchParams(form.fields);
    let targets: readonly string[] = [];
    let ip = "";
    if ("ip" in change) {
      ip = isText(change.ip) ? change.ip.trim() : "";
      if (!ip || !pageNumber(change.days))
        return attributed(operation, { kind: "invalid-input" });
      if (ip.includes("/") && page.cidrAllowed === false)
        return settingRefused(operation, "cidr");
      values.set("ipnew", ip);
      values.set("validitynew", String(change.days));
    } else {
      if (
        !validSelection(
          change,
          page.items.map((item) => item.id),
        )
      )
        return attributed(operation, { kind: "invalid-input" });
      if (
        !change.every((id) =>
          page.items.some((item) => item.id === id && item.canDelete),
        )
      )
        return settingRefused(operation, "ip-ban-delete-unavailable");
      targets = [...change];
      targets.forEach((id, index) => values.set(`delete[${index}]`, id));
    }
    bindings.delete(page);
    const reply = await panel.write(form.url, owner, values);
    if (reply.kind !== "response") return attributed(operation, reply);
    const problem = panelRefusal(reply.response, reply.parsed);
    if (problem) return attributed(operation, problem);
    const now = decodeBans(reply, form.url, owner);
    if (!now) return verdict(operation, "uncertain");
    const result = record(reply.parsed.data?.result),
      key = string(result?.error_key);
    if (key) return settingRefused(operation, key);
    if (ip && now.nativeRefusal === ip)
      return settingRefused(operation, "ip-ban-refused");
    if (targets.length)
      return {
        ...assessSelection(
          targets,
          now.page.items.map((item) => item.id),
          true,
        ),
        operation,
      };
    const added = now.page.items.some(
      (item) =>
        item.ip.toLowerCase() === ip.toLowerCase() &&
        !page.items.some((before) => before.id === item.id),
    );
    return verdict(
      operation,
      added ? "completed" : result?.added === 1 ? "acknowledged" : "redrawn",
    );
  }
  return {
    async readIpBans(): Promise<PanelIpBanRead> {
      const owner = panel.session();
      if (!owner) return forbidden("login");
      const reply = await readSettingPage(
        panel,
        owner,
        { action: "member", op: "ipban" },
        "ipban",
        "modcp_ipban",
      );
      if (reply.kind !== "response") return reply;
      const decoded = decodeBans(reply, reply.url, owner);
      if (!decoded) return { kind: "invalid-response" };
      bindings.set(decoded.page, { owner, form: decoded.form });
      return { kind: "ip-bans", page: decoded.page };
    },
    addIpBan: (
      page: PanelIpBanPage,
      ip: string,
      days: number,
      approved: boolean,
    ) => submit(page, "add-ip-ban", approved, { ip, days }),
    deleteIpBans: (
      page: PanelIpBanPage,
      ids: readonly string[],
      approved: boolean,
    ) => submit(page, "delete-ip-bans", approved, ids),
  };
}
