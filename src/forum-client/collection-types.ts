import type { HostResponse } from "../index.js";

export interface CollectionSession {
  readonly memberId: string;
  readonly continuity: string;
}

export type CollectionRequest = {
  readonly fresh: true;
  readonly session: CollectionSession | null;
} & (
  | { readonly method: "GET"; readonly effect: boolean }
  | { readonly method: "POST"; readonly effect: true; readonly body: string }
);

export interface CollectionClientOptions {
  origin: string;
  session(): CollectionSession | null;
  transport: {
    request(url: string, request: CollectionRequest): Promise<HostResponse>;
  };
}

export type CollectionFailure = {
  kind:
    | "invalid"
    | "invalid-response"
    | "login"
    | "refused"
    | "rate-limited"
    | "session-changed"
    | "unavailable";
  message?: string;
  retryAfterSeconds?: number;
};
export type CollectionOrder =
  "dateline" | "threadnum" | "commentnum" | "follownum";
export type CollectionListQuery =
  | { tab: "recommended"; page?: number }
  | { tab: "all"; order?: CollectionOrder; page?: number }
  | { tab: "owned" | "subscribed" };
export type CollectionRelation = "created" | "team" | "subscribed";

interface CollectionPage {
  page: number;
  totalPages: number | null;
  nextPage: number | null;
}
interface Member {
  id: string;
  name: string;
}
interface ThreadRef {
  id: string;
  subject: string;
}
export interface CollectionSummary {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  threadCount: number | null;
  followCount: number | null;
  commentCount: number | null;
  creator: Member | null;
  lastUpdate: string;
  latestThread: ThreadRef | null;
  relation: CollectionRelation | null;
  updated: boolean;
}
export interface CollectionThread extends ThreadRef {
  reason: string;
  author: Member | null;
  authorName: string;
  date: string;
  replies: number | null;
  views: number | null;
}
export interface CollectionList extends CollectionPage {
  kind: "list";
  tab: CollectionListQuery["tab"] | "related";
  items: CollectionSummary[];
  canCreate: boolean;
}
export interface CollectionDetail extends CollectionPage {
  kind: "detail";
  id: string;
  name: string;
  description: string;
  keywords: string[];
  creator: Member | null;
  maintainers: Member[];
  followCount: number | null;
  threadCount: number | null;
  commentCount: number | null;
  averageRating: number | null;
  ratingCount: number | null;
  followState: "can-follow" | "following" | "unavailable";
  threads: CollectionThread[];
  canManage: boolean;
}
export interface CollectionComment {
  author: Member | null;
  time: string;
  message: string;
  rating: number | null;
}
export interface CollectionComments extends CollectionPage {
  kind: "comments";
  id: string;
  name: string;
  comments: CollectionComment[];
  canComment: boolean;
  canRate: boolean;
  myRating: number | null;
}
export interface CollectionAddDialog {
  kind: "add-dialog";
  threadId: string;
  choices: { id: string; name: string }[];
  remainingCreate: number;
  canCreate: boolean;
}
export interface CollectionMetadata {
  title: string;
  description?: string;
  keywords?: string;
}
export type CollectionWrite =
  | CollectionFailure
  | { kind: "uncertain" }
  | { kind: "confirmed"; message: string };
export type CollectionCreate =
  | Exclude<CollectionWrite, { kind: "confirmed" }>
  | {
      kind: "confirmed";
      message: string;
      collectionId: string;
      collectionURL: string;
    };
