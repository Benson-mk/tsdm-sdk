import { decodeFavorites } from "./favorites.js";
import type { ForumTransport } from "../index.js";
import {
  failure,
  first,
  integer,
  invalid,
  positive,
  receive,
  record,
  target,
  type Received,
} from "./discovery/shared.js";
import type { Context, DiscoveryFailure } from "./discovery/types.js";
import {
  nativeProfile,
  nativeProfileHeading,
  structuredProfile,
} from "./member-profile.js";
import { attr, byId, descendants, hasClass, label } from "./html.js";

import type { MemberProfile } from "./member-profile-types.js";

export interface MemberIdentity {
  id: string;
  name: string;
}
export type MemberLookup = { id: string } | { username: string };
export type MemberLookupResult =
  | DiscoveryFailure
  | (Context & {
      kind: "member";
      member: MemberIdentity;
    });

export type MemberProfileResult =
  | DiscoveryFailure
  | (Context & {
      kind: "member-profile";
      representation: "structured" | "native";
      member: MemberIdentity;
      profile: MemberProfile;
    });

export function memberIdentity(value: unknown): MemberIdentity | null {
  const row = record(value);
  const id = positive(row?.uid);
  const name = typeof row?.username === "string" ? row.username.trim() : "";
  return id && name && !/[\r\n\u2063\u2064]/.test(name) ? { id, name } : null;
}

export type FriendQuery = { page?: number } & (
  | { scope: "own"; accountId: string; groupId?: string }
  | { scope: "member"; memberId: string }
  | { scope: "visitors"; accountId: string }
  | { scope: "online" }
);
export type FavoriteQuery = {
  kind: "forum" | "thread";
  accountId: string;
  page?: number;
};
export interface FriendEntry {
  id: string | null;
  name: string;
  groupId?: string;
}
export interface FriendGroup {
  id: string;
  name: string;
}
export interface FavoriteEntry {
  recordId: string;
  targetId: string;
  title: string;
}
type ListView = Context & { page: number; nextPage: number | null };
export type FriendListResult =
  | DiscoveryFailure
  | (ListView & {
      kind: "friends";
      scope: FriendQuery["scope"];
      ownerId: string | null;
      members: FriendEntry[];
      groups: FriendGroup[];
    });
export type FavoriteListResult =
  | DiscoveryFailure
  | (ListView & {
      kind: "favorites";
      favoriteKind: FavoriteQuery["kind"];
      items: FavoriteEntry[];
    });

function actor(context: Context, expected: string) {
  if (context.account.kind === "guest")
    return failure(context, "login", "Sign in to read this account's list.");
  if (context.account.kind !== "member" || context.account.id !== expected)
    return failure(
      context,
      "stale",
      "The forum did not identify the expected member.",
    );
  return null;
}

async function readList<T>(
  url: URL,
  transport: ForumTransport,
  implicitAccountId: string | undefined,
  decode: (view: Received) => T | DiscoveryFailure | null,
): Promise<T | DiscoveryFailure> {
  const relevant = ["do", "uid", "view", "type", "group", "page"];
  const value = (u: URL, key: string) =>
    u.searchParams.get(key) ??
    { page: "1", group: "-1", view: "me" }[key] ??
    "";
  const matches = (destination: string) => {
    const actual = target(destination, url.href, "/home.php", "space");
    return (
      !!actual &&
      relevant.every(
        (key) =>
          value(actual, key) === value(url, key) ||
          (key === "uid" &&
            !value(url, key) &&
            value(actual, key) === implicitAccountId),
      )
    );
  };
  const app = new URL(url);
  app.searchParams.set("nodoc", "1");
  for (const requested of [app, url]) {
    const response = await receive(
      requested,
      transport,
      requested === app,
      matches,
    );
    if ("kind" in response) return response;
    const { context, payload, doc } = response;
    if (
      (payload?.ok === 0 && payload.error === "message") ||
      first(
        doc,
        (node) => hasClass(node, "nfl") && /隐私|隱私/.test(label(node)),
      )
    )
      return failure(context, "permission", "The forum withheld this list.");
    const result = decode(response);
    if (result) return result;
  }
  return failure(
    { account: { kind: "unknown" }, sourceURL: url.href },
    "incomplete",
    "The forum did not establish the requested list.",
  );
}

function nextPage(
  payload: Record<string, unknown>,
  page: number,
): number | null | undefined {
  const pages = integer(payload.pages);
  if (
    payload.page !== page ||
    pages === null ||
    (pages < page && !(pages === 0 && page === 1))
  )
    return undefined;
  return payload.has_next === 1 && pages > page
    ? page + 1
    : payload.has_next === 0 && pages <= page
      ? null
      : undefined;
}

function nativeNext(
  doc: Received["doc"],
  url: URL,
  page: number,
): number | null | undefined {
  const anchors = descendants(
    doc,
    (node) => node.tagName === "a" && hasClass(node, "nxt"),
  );
  if (!anchors.length) return null;
  return anchors.every((anchor) => {
    const link = target(attr(anchor, "href"), url.href, "/home.php", "space");
    return (
      !!link &&
      link.searchParams.get("page") === String(page + 1) &&
      ["do", "view", "type", "group"].every(
        (key) => link.searchParams.get(key) === url.searchParams.get(key),
      ) &&
      (!link.searchParams.has("uid") ||
        !url.searchParams.has("uid") ||
        link.searchParams.get("uid") === url.searchParams.get("uid"))
    );
  })
    ? page + 1
    : undefined;
}

function friendsFromPage(
  query: FriendQuery,
  url: URL,
  page: number,
  view: Received,
): FriendListResult | null {
  const { context, payload, doc } = view;
  const expected = "accountId" in query ? query.accountId : null;
  const owner = query.scope === "member" ? query.memberId : expected;
  if (expected) {
    const refusal = actor(context, expected);
    if (refusal) return refusal;
  }
  const result = {
    ...context,
    kind: "friends" as const,
    scope: query.scope,
    ownerId: owner,
    page,
  };
  if (
    payload?.ok === 1 &&
    payload.type === "friend" &&
    Number(payload.schema) >= 10
  ) {
    const reported = positive(record(payload.owner)?.uid);
    const next = nextPage(payload, page);
    const group = query.scope === "own" ? (query.groupId ?? "-1") : "-1";
    if (
      (owner && reported !== owner) ||
      (expected && payload.self !== 1) ||
      payload.view !== (url.searchParams.get("view") ?? "me") ||
      payload.kind !== (url.searchParams.get("type") ?? "") ||
      String(payload.group) !== group
    )
      return failure(
        context,
        "invalid",
        "The returned friend scope did not match.",
      );
    if (
      next === undefined ||
      !Array.isArray(payload.friends) ||
      !Array.isArray(payload.groups)
    )
      return null;
    const members: FriendEntry[] = [];
    for (const raw of payload.friends) {
      const row = record(raw);
      if (query.scope === "visitors" && row?.anonymous === 1) {
        members.push({ id: null, name: "Anonymous" });
        continue;
      }
      const member = memberIdentity(row);
      if (!member) return null;
      const gid = integer(row?.gid);
      members.push({
        ...member,
        ...(query.scope === "own" && gid !== null
          ? { groupId: String(gid) }
          : {}),
      });
    }
    const groups: FriendGroup[] = [];
    if (query.scope === "own")
      for (const raw of payload.groups) {
        const row = record(raw);
        const id = integer(row?.id);
        if (id === null || typeof row?.name !== "string" || !row.name.trim())
          return null;
        groups.push({ id: String(id), name: row.name });
      }
    return { ...result, nextPage: next, members, groups };
  }
  const lists = descendants(
    doc,
    (node) => node.tagName === "ul" && hasClass(node, "buddy"),
  );
  const next = nativeNext(doc, url, page);
  const zero = /当前共有\s*0\s*个好友|當前共有\s*0\s*個好友/.test(label(doc));
  if ((!lists.length && !zero) || next === undefined) return null;
  const members: FriendEntry[] = [];
  for (const list of lists)
    for (const row of descendants(
      list,
      (node) => node.tagName === "li" && node.parentNode === list,
    )) {
      if (
        query.scope === "own" &&
        first(
          row,
          (node) =>
            node.tagName === "a" &&
            /[?&]op=add(?:&|$)/.test(attr(node, "href")),
        )
      )
        continue;
      if (query.scope === "own" && zero) continue;
      const heading = first(row, (node) => node.tagName === "h4");
      if (!heading) return null;
      const link = first(
        heading,
        (node) =>
          node.tagName === "a" &&
          !!target(
            attr(node, "href"),
            url.href,
            "/home.php",
            "space",
          )?.searchParams.get("uid"),
      );
      const member =
        link &&
        memberIdentity({
          uid: target(
            attr(link, "href"),
            url.href,
            "/home.php",
            "space",
          )?.searchParams.get("uid"),
          username: label(link) || attr(link, "title"),
        });
      if (member) members.push(member);
      else if (
        query.scope === "visitors" &&
        /匿名|anonymous/i.test(label(heading))
      )
        members.push({ id: null, name: "Anonymous" });
      else return null;
    }
  const menu =
    query.scope === "own"
      ? first(doc, (node) => hasClass(node, "buddy_group"))
      : undefined;
  const groups = menu
    ? descendants(menu, (node) => node.tagName === "a").flatMap((node) => {
        const group = target(
          attr(node, "href"),
          url.href,
          "/home.php",
          "space",
        );
        const id = group?.searchParams.get("group");
        return group?.searchParams.get("do") === "friend" &&
          id &&
          /^\d+$/.test(id) &&
          label(node)
          ? [{ id, name: label(node) }]
          : [];
      })
    : [];
  return { ...result, nextPage: next, members, groups };
}

function favoritesFromPage(
  query: FavoriteQuery,
  url: URL,
  page: number,
  view: Received,
): FavoriteListResult | null {
  const { context, payload, actual, body } = view;
  const refusal = actor(context, query.accountId);
  if (refusal) return refusal;
  const result = {
    ...context,
    kind: "favorites" as const,
    favoriteKind: query.kind,
    page,
  };
  if (
    payload?.ok === 1 &&
    payload.type === "favorite" &&
    Number(payload.schema) >= 8
  ) {
    if (payload.kind !== query.kind)
      return failure(
        context,
        "invalid",
        "The forum returned a different favorite kind.",
      );
    const next = nextPage(payload, page);
    if (next === undefined || !Array.isArray(payload.items)) return null;
    const count = integer(payload.count);
    if (
      count === null ||
      count < payload.items.length ||
      (page === 1 && next === null && count !== payload.items.length) ||
      (next !== null && !payload.items.length)
    )
      return null;
    const items: FavoriteEntry[] = [];
    for (const raw of payload.items) {
      const row = record(raw);
      const recordId = positive(row?.favid),
        targetId = positive(row?.id);
      if (
        !recordId ||
        !targetId ||
        row?.kind !== query.kind ||
        row.idtype !== (query.kind === "forum" ? "fid" : "tid") ||
        typeof row.title !== "string" ||
        !row.title.trim() ||
        items.some(
          (item) => item.recordId === recordId || item.targetId === targetId,
        )
      )
        return null;
      items.push({ recordId, targetId, title: row.title });
    }
    return { ...result, nextPage: next, items };
  }
  const native = decodeFavorites(
    {
      status: 200,
      url: actual.href,
      contentType: payload ? "application/json" : "text/html",
      body,
    },
    url.href,
  );
  if (native.kind !== "favorites") return null;
  const pages = native.favorites.pages.links.map((link) =>
    Number(new URL(link.url).searchParams.get("page")),
  );
  if (pages.some((number) => number > page) && !pages.includes(page + 1))
    return null;
  return {
    ...result,
    nextPage: pages.includes(page + 1) ? page + 1 : null,
    items: native.favorites.records.map((item) => ({
      recordId: item.id,
      targetId: item.targetId,
      title: item.title,
    })),
  };
}

export function createMemberReads(origin: string, transport: ForumTransport) {
  return {
    async readFriends(query: FriendQuery): Promise<FriendListResult> {
      const url = new URL("/home.php?mod=space&do=friend", origin);
      const page = query.page ?? 1;
      const owner =
        query.scope === "own"
          ? query.accountId
          : query.scope === "member"
            ? query.memberId
            : null;
      if (
        !positive(page) ||
        (owner !== null && !positive(owner)) ||
        ("accountId" in query && !positive(query.accountId)) ||
        (query.scope === "own" &&
          query.groupId !== undefined &&
          !/^\d{1,3}$/.test(query.groupId))
      )
        return invalid(url.href, "Use a valid member, group and page.");
      if (owner) url.searchParams.set("uid", owner);
      if (query.scope === "own" && query.groupId !== undefined)
        url.searchParams.set("group", query.groupId);
      if (query.scope === "visitors") url.searchParams.set("view", "visitor");
      if (query.scope === "online") {
        url.searchParams.set("view", "online");
        url.searchParams.set("type", "member");
      }
      if (page > 1) url.searchParams.set("page", String(page));
      return readList(
        url,
        transport,
        "accountId" in query ? query.accountId : undefined,
        (view) => friendsFromPage(query, url, page, view),
      );
    },
    async readFavorites(query: FavoriteQuery): Promise<FavoriteListResult> {
      const url = new URL("/home.php?mod=space&do=favorite", origin);
      const page = query.page ?? 1;
      if (
        !positive(page) ||
        !positive(query.accountId) ||
        !["forum", "thread"].includes(query.kind)
      )
        return invalid(url.href, "Use a valid member, favorite kind and page.");
      url.searchParams.set("type", query.kind);
      if (page > 1) url.searchParams.set("page", String(page));
      return readList(url, transport, query.accountId, (view) =>
        favoritesFromPage(query, url, page, view),
      );
    },
    lookupMember: (lookup: MemberLookup) => readMember(lookup, false),
    readMemberProfile: (lookup: MemberLookup) => readMember(lookup, true),
  };

  function readMember(
    lookup: MemberLookup,
    full: false,
  ): Promise<MemberLookupResult>;
  function readMember(
    lookup: MemberLookup,
    full: true,
  ): Promise<MemberProfileResult>;
  async function readMember(
    lookup: MemberLookup,
    full: boolean,
  ): Promise<MemberLookupResult | MemberProfileResult> {
    const lookupById = "id" in lookup;
    const key = lookupById ? "uid" : "username";
    const value = lookupById ? lookup.id : lookup.username.trim();
    const url = new URL("/home.php?mod=space", origin);
    if (lookupById ? !positive(value) : !value || value.length > 100)
      return invalid(url.href, "Provide a member UID or username.");
    url.searchParams.set(key, value);
    const accepts = (destination: string) => {
      const actual = target(destination, url.href, "/home.php", "space");
      return (
        !!actual &&
        (!full || [null, "profile"].includes(actual.searchParams.get("do"))) &&
        (!actual.searchParams.has(key) ||
          (actual.searchParams.get(key) ?? "").toLowerCase() ===
            value.toLowerCase())
      );
    };
    const app = new URL(url);
    app.searchParams.set("nodoc", "1");
    for (const requested of [app, url]) {
      const view = await receive(
        requested,
        transport,
        requested === app,
        accepts,
      );
      if ("kind" in view) return view;
      const { payload, doc, context, actual } = view;
      const structured =
        payload?.ok === 1 &&
        payload.type === "profile" &&
        Number(payload.schema) >= 4;
      const native = nativeProfileHeading(doc);
      const member =
        (structured ? memberIdentity(payload.user) : null) ??
        (!structured || full ? memberIdentity(native?.user) : null);
      if (!member) continue;
      const returnedUID = actual.searchParams.get("uid");
      if (
        (returnedUID !== null && returnedUID !== member.id) ||
        (lookupById
          ? member.id !== value
          : member.name.toLowerCase() !== value.toLowerCase())
      )
        return failure(
          context,
          "invalid",
          "The returned member did not match the lookup.",
        );
      const result = { ...context, sourceURL: url.href, member };
      if (!full) return { ...result, kind: "member" };
      if (structured && typeof payload.schema === "number") {
        const profile = structuredProfile(payload, url.href);
        if (profile)
          return {
            ...result,
            kind: "member-profile",
            representation: "structured",
            profile,
          };
      }
      if (native) {
        const owner = memberIdentity(native.user);
        if (
          !owner ||
          owner.id !== member.id ||
          owner.name.toLowerCase() !== member.name.toLowerCase()
        )
          return failure(
            context,
            "invalid",
            "The returned profile identifies a different member.",
          );
        const profile = nativeProfile(
          doc,
          native.root,
          native.heading,
          member.id,
          url.href,
        );
        if (profile)
          return {
            ...result,
            kind: "member-profile",
            representation: "native",
            profile,
          };
      }
    }
    return failure(
      { sourceURL: url.href, account: { kind: "unknown" } },
      "incomplete",
      full
        ? "The response did not establish a full member profile."
        : "The response did not establish a member identity.",
    );
  }
}
