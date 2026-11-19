import { createFavoriteEffects } from "./member-favorites.js";
import { createFriendEffects } from "./member-effects.js";
import {
  createAccountClient,
  type AccountClientOptions,
  type AccountRequest,
} from "./account-client.js";
import { unwrap } from "./account-forms.js";
import { positive } from "./discovery/shared.js";
import { documentFrom } from "./html.js";
import {
  memberIdentity,
  type MemberIdentity,
  type FavoriteQuery,
} from "./member-reads.js";
import { accountFrom } from "./read-thread.js";
import { parseReadPayload } from "./structured-read.js";
import type { HostResponse } from "../index.js";

export type MemberRequest =
  | AccountRequest
  | {
      fresh: true;
      session: string;
      method: "POST";
      effect: false;
      body: string;
    };
export interface MemberClientOptions extends Omit<
  AccountClientOptions,
  "transport"
> {
  transport: {
    request(url: string, request: MemberRequest): Promise<HostResponse>;
  };
}
export type MemberFailure = {
  kind: "invalid" | "login" | "stale" | "unavailable" | "limited";
};
export type NativeMentions = { kind: "native"; names: string[] };
export type MentionCandidates =
  | MemberFailure
  | NativeMentions
  | { kind: "atplus"; recent: MemberIdentity[]; friends: MemberIdentity[] };
export type MentionSearch =
  MemberFailure | { kind: "members"; members: MemberIdentity[] };

export interface SendFriendRequest {
  accountId: string;
  memberId: string;
  groupId?: string;
  note?: string;
}
export interface ApproveFriendRequest {
  accountId: string;
  noticeURL: string;
  groupId?: string;
}
export type MemberEffectResult =
  | MemberFailure
  | {
      kind:
        | "request-sent"
        | "approved"
        | "pending"
        | "already-friends"
        | "refused"
        | "uncertain";
    };
export type FavoriteTarget = Omit<FavoriteQuery, "page"> & { targetId: string };
export interface AddFavorite extends FavoriteTarget {
  description?: string;
}
export interface RemoveFavorite extends FavoriteTarget {
  recordId: string;
}
export type FavoriteEffectResult =
  | MemberFailure
  | { kind: "uncertain" | "refused" | "already-absent" }
  | { kind: "added" | "already-saved" | "removed"; recordId: string };

export interface MemberClient {
  loadMentionCandidates(accountId: string): Promise<MentionCandidates>;
  searchMentionMembers(
    accountId: string,
    query: string,
  ): Promise<MentionSearch>;
  readNativeMentionNames(
    accountId: string,
  ): Promise<MemberFailure | NativeMentions>;
  sendFriendRequest(input: SendFriendRequest): Promise<MemberEffectResult>;
  approveFriendRequest(
    input: ApproveFriendRequest,
  ): Promise<MemberEffectResult>;
  addFavorite(input: AddFavorite): Promise<FavoriteEffectResult>;
  removeFavorite(input: RemoveFavorite): Promise<FavoriteEffectResult>;
}

function people(value: unknown): MemberIdentity[] | null {
  if (!Array.isArray(value)) return null;
  const members = new Map<string, MemberIdentity>();
  for (const row of value) {
    const member = memberIdentity(row);
    if (
      !member ||
      (members.has(member.id) && members.get(member.id)?.name !== member.name)
    )
      return null;
    members.set(member.id, member);
  }
  return [...members.values()];
}

export function createMemberClient(options: MemberClientOptions): MemberClient {
  const { origin, session, transport } = options;
  const accountClient = createAccountClient(options);
  const stale = { kind: "stale" } as const;
  const unavailable = { kind: "unavailable" } as const;
  const invalid = { kind: "invalid" } as const;
  const login = { kind: "login" } as const;
  const limited = { kind: "limited" } as const;
  const path = (route: string) => new URL(route, origin);

  async function request(
    url: URL,
    continuity: string,
    body?: URLSearchParams,
    effect = false,
  ): Promise<HostResponse | MemberFailure> {
    if (session() !== continuity) return stale;
    try {
      const common = { fresh: true as const, session: continuity, effect };
      const response = await transport.request(
        url.href,
        body
          ? { ...common, method: "POST", body: body.toString() }
          : { ...common, method: "GET" },
      );
      if (session() !== continuity) return stale;
      return response.url === url.href && response.redirect === "none"
        ? response
        : unavailable;
    } catch {
      return session() === continuity ? unavailable : stale;
    }
  }

  async function identity(accountId: string, continuity: string) {
    if (session() !== continuity) return stale;
    const status = await accountClient.readStatus();
    if (session() !== continuity || status.kind === "session-changed")
      return stale;
    if (status.kind === "rate-limited") return limited;
    if (status.kind === "status") {
      if (status.identity.kind === "guest") return login;
      return status.identity.id === accountId ? status : stale;
    }
    if (status.kind === "invalid") return invalid;
    const url = path("/forum.php");
    const response = await request(url, continuity);
    if ("kind" in response) return response;
    if (response.status === 429) return limited;
    if (response.status !== 200) return unavailable;
    const viewer = accountFrom(documentFrom(response.body), url.href);
    if (viewer.kind === "guest") return login;
    return viewer.kind === "member" && viewer.id === accountId
      ? { kind: "native-status" as const }
      : stale;
  }

  async function mention(
    accountId: string,
    continuity: string,
    native: boolean,
    body?: URLSearchParams,
  ) {
    if (!positive(accountId)) return invalid;
    const before = await identity(accountId, continuity);
    if (before.kind !== "status" && before.kind !== "native-status")
      return before;
    const url = path(
      native
        ? "/misc.php?mod=getatuser&inajax=1"
        : "/plugin.php?id=atplus%3Asearch",
    );
    const response = await request(url, continuity, body);
    if ("kind" in response) return response;
    if (response.status === 429) return limited;
    if (response.status === 401) return login;
    if (response.status === 403) return unavailable;
    if (!native && [404, 410].includes(response.status))
      return { kind: "unsupported" as const };
    if (response.status !== 200) return unavailable;
    const after = await identity(accountId, continuity);
    return after.kind === "status" || after.kind === "native-status"
      ? response
      : after;
  }

  async function nativeMentions(
    accountId: string,
    continuity: string,
  ): Promise<MemberFailure | NativeMentions> {
    const response = await mention(accountId, continuity, true);
    if ("kind" in response)
      return response.kind === "unsupported" ? unavailable : response;
    const body = unwrap(response.body);
    if (body === response.body || /[<>]/.test(body)) return unavailable;
    const names = new Map<string, string>();
    for (const entry of body.split(",")) {
      const name = entry.trim();
      if (!name || /[\r\n]/.test(name)) continue;
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return { kind: "native", names: [...names.values()] };
  }

  return {
    ...createFriendEffects({ origin, session, identity, request }),
    ...createFavoriteEffects({ origin, session, identity, request }),
    async loadMentionCandidates(accountId: string): Promise<MentionCandidates> {
      const continuity = session();
      if (!continuity) return stale;
      const response = await mention(
        accountId,
        continuity,
        false,
        new URLSearchParams({ op: "init" }),
      );
      if ("kind" in response)
        return response.kind === "unsupported"
          ? nativeMentions(accountId, continuity)
          : response;
      const payload = parseReadPayload(response);
      if (payload?.login === 1) return login;
      if (payload?.uid !== undefined && positive(payload.uid) !== accountId)
        return stale;
      if (payload?.ok !== 1 && payload?.ok !== true) return unavailable;
      const recent = people(payload.recent),
        friends = people(payload.friends);
      return recent && friends
        ? { kind: "atplus", recent, friends }
        : unavailable;
    },
    async searchMentionMembers(
      accountId: string,
      query: string,
    ): Promise<MentionSearch> {
      const continuity = session();
      const q = query.trim();
      if (!continuity) return stale;
      if (!q || q.length > 100) return invalid;
      const response = await mention(
        accountId,
        continuity,
        false,
        new URLSearchParams({ op: "search", q }),
      );
      if ("kind" in response)
        return response.kind === "unsupported" ? unavailable : response;
      const payload = parseReadPayload(response);
      if (payload?.login === 1) return login;
      if (payload?.uid !== undefined && positive(payload.uid) !== accountId)
        return stale;
      const members =
        payload?.ok === 1 || payload?.ok === true ? people(payload.list) : null;
      return members ? { kind: "members", members } : unavailable;
    },
    async readNativeMentionNames(
      accountId: string,
    ): Promise<MemberFailure | NativeMentions> {
      const continuity = session();
      return continuity ? nativeMentions(accountId, continuity) : stale;
    },
  };
}
