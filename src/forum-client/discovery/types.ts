import type { Account, FailureKind, ForumLink, Pagination } from "../types.js";

export type Context = { account: Account; sourceURL: string };
export type DiscoveryFailure = Context &
  (
    | { kind: FailureKind; message: string }
    | { kind: "document-navigation"; message: string; destination: string }
  );
export interface DiscoveryThread extends ForumLink {
  id: string;
  postId: string | null;
  board: (ForumLink & { id: string }) | null;
  author: { id: string | null; name: string; url: string | null } | null;
  summary: string | null;
}
export interface PageLinks {
  pages: Pagination;
  nextURL: string | null;
}
