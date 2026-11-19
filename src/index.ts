import { createForumClient as createHistoricalClient } from "./forum-client/index.js";
import { threadURL } from "./forum-client/routes.js";
import type {
  Account,
  FailureKind,
  HostResponse as HistoricalResponse,
  Post as HistoricalPost,
  Thread as HistoricalThread,
} from "./forum-client/types.js";

export type {
  Account,
  Attachment,
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

type ReadContext = { account: Account; sourceURL: string };
export type ThreadReadResult = ReadContext &
  (
    | { kind: "thread"; thread: Thread }
    | { kind: "document-navigation"; message: string; destination: string }
    | { kind: FailureKind; message: string }
  );

export interface ForumClient {
  readThread(destination: string): Promise<ThreadReadResult>;
}

export function createForumClient({
  origin,
  transport,
}: {
  origin: string;
  transport: ForumTransport;
}): ForumClient {
  const historical = createHistoricalClient({
    origin,
    transport: {
      async request(url) {
        const response = await transport.request(url, { fresh: true });
        // An opaque redirect has no destination the thread decoder can verify.
        if (response.redirect === "opaque") return { ...response, url: "" };
        return response;
      },
    },
  });

  return {
    async readThread(destination) {
      if (threadURL(destination)?.origin === origin) {
        const result = await historical.readThread(destination);
        const { account, sourceURL } = result;
        if (result.kind === "thread") {
          const posts = result.thread.posts.map(
            ({ rateURL, reportURL, redPacketThreadId, ...post }) => post,
          );
          return {
            kind: "thread",
            account,
            sourceURL,
            thread: { ...result.thread, posts },
          };
        }
        if (result.kind === "document-navigation") {
          return {
            kind: result.kind,
            account,
            sourceURL,
            message: result.message,
            destination: result.destination,
          };
        }
        if ("message" in result) {
          return {
            kind: result.kind,
            account,
            sourceURL,
            message: result.message,
          };
        }
      }
      return {
        kind: "invalid",
        account: { kind: "unknown" },
        sourceURL: destination,
        message: "This is not a supported thread destination for this origin.",
      };
    },
  };
}
