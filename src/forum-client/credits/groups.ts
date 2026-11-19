import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  type Node,
} from "../html.js";
import type { NoticeHost } from "../notice-transport.js";
import {
  answer,
  creditPageAvailable,
  bit,
  failure,
  forumURL,
  nativeIdentity,
  nativeMessage,
  numericId,
  positive,
  readIssue,
  record,
  string,
  urlAt,
  whole,
} from "./protocol.js";
import type {
  CreditsFailure,
  CreditsSession,
  GroupDetail,
  GroupMenu,
  GroupPermissionSection,
  GroupProgress,
  GroupSummary,
  Groups,
} from "./types.js";

const invalid = (message: string) => failure("invalid-response", message);
const categories = {
  my: "我的用户组",
  upgrade: "会员用户组",
  user: "普通用户组",
  admin: "站点管理组",
};
const all = <T>(v: unknown, f: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(v)) return null;
  const mapped = v.map(f);
  return mapped.every((item): item is T => item !== null) ? mapped : null;
};
function apiSummary(value: unknown): GroupSummary | null {
  const row = record(value),
    id = positive(row?.gid),
    title = string(row?.title);
  if (!row || !id || !title) return null;
  const stars = whole(row.stars),
    credits = whole(row.credits);
  const permissions = all(row.perms, (raw) => {
    const section = record(raw),
      key = string(section?.key),
      name = string(section?.name);
    const rows = all(section?.rows, (value) => {
      const item = record(value),
        key = string(item?.key),
        label = string(item?.label),
        valueCell = item?.value;
      if (
        !key ||
        !label ||
        !(
          typeof valueCell === "string" ||
          typeof valueCell === "boolean" ||
          typeof valueCell === "number"
        )
      )
        return null;
      return {
        key,
        label,
        value:
          item?.type === "bool" && bit(valueCell) ? valueCell === 1 : valueCell,
      };
    });
    return key && name && rows
      ? ({ key, name, rows } satisfies GroupPermissionSection)
      : null;
  });
  if (row.perms !== undefined && !permissions) return null;
  return {
    id,
    title,
    ...(stars !== null ? { stars } : {}),
    ...(credits !== null ? { credits } : {}),
    ...(permissions ? { permissions } : {}),
  };
}
function apiDetail(raw: unknown): GroupDetail | null {
  const summary = apiSummary(raw),
    row = record(raw);
  if (!summary || !row) return null;
  const threshold = whole(row.threshold),
    remaining = whole(row.credits_left),
    expiry = whole(row.expiry),
    category = string(row.category);
  return {
    ...summary,
    ...(threshold !== null ? { threshold } : {}),
    ...(remaining !== null ? { remaining } : {}),
    ...(expiry !== null ? { expiry } : {}),
    ...(category ? { category } : {}),
  };
}
function apiGroups(
  data: Record<string, unknown>,
  memberId: string,
  requested?: string,
): Groups | CreditsFailure | null {
  if (
    data.ok !== 1 ||
    data.type !== "usergroup_info" ||
    data.schema !== 54 ||
    numericId(data.uid) !== memberId
  )
    return null;
  const current = apiSummary(data.main);
  const menus = all(data.menus, (raw) => {
    const row = record(raw),
      key = string(row?.key),
      name = string(row?.name);
    const groups = all(row?.groups, (g) => {
      const group = record(g),
        id = positive(group?.gid),
        title = string(group?.title);
      return id && title && bit(group?.active)
        ? { id, title, active: group?.active === 1 }
        : null;
    });
    return key && name && groups ? { key, name, groups } : null;
  });
  if (!current || !menus?.length) return null;
  const viewed = apiDetail(data.viewed);
  if (requested && viewed?.id !== requested)
    return data.viewed === undefined
      ? null
      : invalid("The forum returned a different group detail.");
  if (!requested && data.viewed != null && !viewed) return null;
  return {
    kind: "groups",
    source: "plugin",
    memberId,
    current,
    menus,
    ...(viewed ? { viewed } : {}),
  };
}
export function groupInfoURL(raw: unknown, source: URL) {
  const url = forumURL(raw, source, "/home.php");
  const q = url?.searchParams;
  return url &&
    q?.get("mod") === "spacecp" &&
    q?.get("ac") === "usergroup" &&
    [...q.keys()].every((k) => ["mod", "ac", "gid"].includes(k)) &&
    (!q.has("gid") || positive(q.get("gid")))
    ? url
    : null;
}
function titleAfterDash(raw: string) {
  return /\s[-–—]\s(.+)$/u.exec(raw)?.[1] ?? "";
}
function nativeGroups(
  doc: Node,
  source: URL,
  memberId: string,
  requested?: string,
): Groups | CreditsFailure | null {
  const tables = descendants(doc, (n) => hasClass(n, "tdats"));
  const root = tables[0];
  if (tables.length !== 1 || !root) return null;
  const title = titleAfterDash(
    label(descendants(root, (n) => n.tagName === "h4")[0]),
  );
  const notices = descendants(root, (n) => hasClass(n, "notice")).map(label);
  const earned = /积分\s*[:：]\s*([+-]?\d+)/.exec(notices[0] ?? "");
  if (!title || !earned || !Number.isSafeInteger(Number(earned[1])))
    return null;
  const credits = Number(earned[1]);
  const menus: GroupMenu[] = [];
  for (const [key, name] of Object.entries(categories)) {
    const menu = byId(doc, `g${key}_menu`);
    if (!menu) continue;
    const groups = descendants(menu, (n) => n.tagName === "a").flatMap((n) => {
      const url = groupInfoURL(attr(n, "href"), source),
        title = label(n),
        id = url?.searchParams.get("gid");
      return url && title
        ? [{ title, ...(id ? { id } : {}), active: hasClass(n, "xi1") }]
        : [];
    });
    menus.push({ key, name, groups });
  }
  if (!menus.length) return null;
  const members = menus.flatMap((m) => m.groups.filter((g) => Boolean(g.id)));
  const matching = members.filter((g) => g.title === title);
  const id = matching.length === 1 ? matching[0]?.id : undefined;
  const current = { title, credits, ...(id ? { id } : {}) };
  const titleBar = byId(root, "tba"),
    viewedTitle = titleAfterDash(label(titleBar));
  const viewMatches = members.filter(
    (g) => g.title === viewedTitle && g.active,
  );
  const viewedId = viewMatches.length === 1 ? viewMatches[0]?.id : undefined;
  if (requested && viewedId !== requested)
    return invalid("The native page did not identify the requested group.");
  const gap = /还需\s*(\d+)\s*积分/.exec(notices.slice(1).join(" "));
  const remaining = gap ? Number(gap[1]) : undefined;
  const viewed =
    viewedTitle && viewedId
      ? {
          id: viewedId,
          title: viewedTitle,
          ...(remaining !== undefined &&
          Number.isSafeInteger(credits + remaining)
            ? { remaining, threshold: credits + remaining }
            : {}),
        }
      : undefined;
  return {
    kind: "groups",
    source: "native",
    memberId,
    current,
    menus,
    ...(viewed ? { viewed } : {}),
  };
}
export function createGroupReads(host: NoticeHost) {
  async function read(
    owner: CreditsSession,
    gid?: string,
  ): Promise<Groups | CreditsFailure> {
    const native = urlAt(host.origin, "/home.php", {
      mod: "spacecp",
      ac: "usergroup",
      ...(gid ? { gid } : {}),
    });
    const lean = new URL(native.href);
    lean.searchParams.set("tsdmapp", "json");
    lean.searchParams.set("tsdmv", "4");
    lean.searchParams.set("nodoc", "1");
    const available = await creditPageAvailable(host, owner, "usergroup_info");
    if (typeof available !== "boolean") return available;
    for (const source of available ? [lean, native] : [native]) {
      const sent = await host.request(source.href, owner);
      if (sent.kind !== "response")
        return failure(sent.kind, "Group view unavailable.");
      const { data, html } = answer(sent.response),
        issue = readIssue(sent.response, data, owner.memberId);
      if (issue) return issue;
      const structured = data && apiGroups(data, owner.memberId, gid);
      if (structured) return structured;
      if (!html) continue;
      const identity = nativeIdentity(html, source);
      if (identity !== null && identity !== owner.memberId)
        return failure(
          identity === "0" ? "refused" : "session-changed",
          "The group page did not use this member's session.",
        );
      const { doc, message, isError } = nativeMessage(html);
      if (isError && message) return failure("refused", message);
      if (
        identity === owner.memberId ||
        numericId(data?.uid) === owner.memberId
      ) {
        const parsed = nativeGroups(doc, source, owner.memberId, gid);
        if (parsed) return parsed;
      }
    }
    return invalid("The forum did not establish a group view.");
  }
  const login = () =>
    failure("refused", "Sign in to read your group membership.", "login");
  return {
    async readGroups(): Promise<Groups | CreditsFailure> {
      const owner = host.session();
      return owner ? read(owner) : login();
    },
    async readGroupDetail(gid: string): Promise<Groups | CreditsFailure> {
      if (positive(gid) !== gid)
        return failure("invalid-input", "Choose a valid group ID.");
      const owner = host.session();
      return owner ? read(owner, gid) : login();
    },
    async readGroupProgress(): Promise<GroupProgress | CreditsFailure> {
      const owner = host.session();
      if (!owner) return login();
      const result = await read(owner);
      if (result.kind !== "groups") return result;
      const { memberId, source, current, viewed } = result;
      return {
        kind: "group-progress",
        memberId,
        source,
        current,
        ...(viewed?.remaining !== undefined && viewed.remaining > 0
          ? { next: viewed }
          : {}),
      };
    },
  };
}
