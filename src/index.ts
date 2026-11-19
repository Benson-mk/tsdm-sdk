import { createDiscoveryOperations } from "./forum-client/discovery.js";
export type {
  DiscoveryFailure,
  DiscoveryThread,
  GuideModule,
  GuideResult,
  GuideView,
  SearchPage,
  SearchQuery,
  SearchResult,
  MemberActivityOptions,
  MemberActivityResult,
  RankingsResult,
  TagResult,
  StatisticsCell,
  StatisticsTable,
  StatisticsPage,
  StatisticsResult,
  TrendData,
  TrendResult,
} from "./forum-client/discovery.js";

import { publicRead } from "./forum-client/public-read.js";

import type {
  Account,
  Board,
  FailureKind,
  Homepage,
  HostResponse as HistoricalResponse,
  Post as HistoricalPost,
  Thread as HistoricalThread,
} from "./forum-client/types.js";

export type {
  Account,
  Attachment,
  Board,
  BoardLink,
  DirectoryGroup,
  ThreadRow,
  ThreadSpecial,
  ContentNode,
  ForumLink,
  Pagination,
  ThreadHistory,
} from "./forum-client/types.js";

export interface HostResponse extends HistoricalResponse {
  redirect: "opaque" | "followed" | "none";
}

export interface ForumTransport {
  request(url: string, options: { fresh: boolean }): Promise<HostResponse>;
}

export type Post = Omit<
  HistoricalPost,
  "rateURL" | "reportURL" | "redPacketThreadId"
>;
export type Thread = Omit<HistoricalThread, "posts"> & { posts: Post[] };

export type { Homepage } from "./forum-client/types.js";

export interface ReadOptions {
  representation?: "structured" | "native";
}

export interface BoardReadOptions extends ReadOptions {
  previews?: boolean;
}

type ReadContext = { account: Account; sourceURL: string };
type ReadFailure =
  | { kind: "document-navigation"; message: string; destination: string }
  | { kind: FailureKind; message: string };
export type ThreadReadResult = ReadContext &
  ({ kind: "thread"; thread: Thread } | ReadFailure);
export type BoardReadResult = ReadContext &
  ({ kind: "board"; board: Board } | ReadFailure);
export type HomepageReadResult = ReadContext &
  ({ kind: "homepage"; homepage: Homepage } | ReadFailure);

export interface ForumClient extends ReturnType<
  typeof createDiscoveryOperations
> {
  readHomepage(
    destination?: string,
    options?: ReadOptions,
  ): Promise<HomepageReadResult>;
  readBoard(
    destination: string,
    options?: BoardReadOptions,
  ): Promise<BoardReadResult>;
  readThread(
    destination: string,
    options?: ReadOptions,
  ): Promise<ThreadReadResult>;
}

export function createForumClient({
  origin,
  transport,
}: {
  origin: string;
  transport: ForumTransport;
}): ForumClient {
  const request = (url: string) => transport.request(url, { fresh: true });
  return {
    ...createDiscoveryOperations(origin, transport),
    async readHomepage(destination = `${origin}/forum.php`, options) {
      const result = await publicRead(
        destination,
        origin,
        ["directory"],
        request,
        options,
      );
      if (result.kind === "homepage" || "message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected homepage result.",
      };
    },
    async readBoard(destination, options) {
      const result = await publicRead(
        destination,
        origin,
        ["board"],
        request,
        options,
      );
      if (result.kind === "board" || "message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected board result.",
      };
    },
    async readThread(destination, options) {
      const result = await publicRead(
        destination,
        origin,
        ["thread", "redirect"],
        request,
        options,
      );
      if (result.kind === "thread") {
        const posts = result.thread.posts.map(
          ({ rateURL, reportURL, redPacketThreadId, ...post }) => post,
        );
        return { ...result, thread: { ...result.thread, posts } };
      }
      if ("message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected thread result.",
      };
    },
  };
}

export { createAccountClient } from "./forum-client/account-client.js";
export type {
  AccountBrowserHandoff,
  AccountChange,
  AccountChangeField,
  AccountChangeForm,
  AccountVerificationForm,
  AccountChangeOpenResult,
  AccountChangeResult,
  AccountClientOptions,
  AccountEffectFailure,
  AccountFailure,
  AccountRequest,
  AccountStatus,
  LoginCredentials,
  LoginForm,
  LoginResult,
  LogoutResult,
  SessionIdentity,
} from "./forum-client/account-client.js";
