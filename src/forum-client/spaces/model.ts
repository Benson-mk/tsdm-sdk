import type { Account, ContentNode } from "../types.js";
import type { HostResponse } from "../../index.js";

export type SpaceView =
  | "member"
  | "statuses"
  | "status-replies"
  | "timeline"
  | "following"
  | "followers"
  | "blogs"
  | "blog"
  | "albums"
  | "photos"
  | "wall"
  | "greetings";
export interface SpaceMember {
  id: string;
  name: string | null;
}
export interface SpaceEntry {
  id: string;
  author: SpaceMember | null;
  title: string | null;
  text: string | null;
  content: ContentNode[];
  privacy: string | null;
  parentId: string | null;
  pending: boolean;
  deleted: boolean;
  timestamp: number | null;
  url: string | null;
  image: string | null;
  links: { relation: string; url: string }[];
}
export interface SpacePage {
  kind: "page";
  view: SpaceView;
  url: string;
  account: Account;
  owner: SpaceMember | null;
  entries: SpaceEntry[];
  hidden: number | null;
  next: string | null;
  links: SpaceEntry["links"];
}
export type SpaceRead =
  | SpacePage
  | {
      kind:
        | "invalid"
        | "incomplete"
        | "login"
        | "permission"
        | "missing"
        | "limited"
        | "unavailable"
        | "session-changed";
      url: string;
      message: string;
    }
  | {
      kind: "document-navigation";
      url: string;
      destination: string;
      message: string;
    };
export type SpaceRequest = { fresh: true; session: string } & (
  | { method: "GET"; effect: false }
  | { method: "POST"; effect: true; body: string }
);
export interface SpaceClientOptions {
  origin: string;
  session(): string | null;
  transport: {
    request(url: string, request: SpaceRequest): Promise<HostResponse>;
  };
}

export type SpaceCommand =
  | { action: "post-status"; message: string }
  | {
      action: "reply-status";
      statusId: string;
      replyId?: string;
      message: string;
    }
  | { action: "delete-status"; statusId: string; replyId?: string }
  | {
      action: "publish-blog";
      subject: string;
      message: string;
      privacy: string;
      password?: string;
      category?: string;
      newCategory?: string;
      systemCategory?: string;
    }
  | { action: "post-wall"; memberId: string; message: string }
  | { action: "reply-wall"; commentId: string; message: string }
  | { action: "delete-wall"; commentId: string }
  | {
      action: "send-greeting" | "reply-greeting";
      memberId: string;
      iconId: string;
      note: string;
    }
  | { action: "ignore-greeting"; memberId: string }
  | { action: "ignore-all-greetings" }
  | { action: "follow" | "unfollow"; memberId: string }
  | { action: "rename-follow"; memberId: string; name: string }
  | { action: "relay"; feedId: string; note: string; reply: boolean }
  | { action: "delete-feed"; feedId: string };
export interface PrepareSpaceWrite {
  accountId: string;
  source: string | null;
  command: SpaceCommand;
}
export interface PreparedSpaceWrite {
  kind: "prepared";
  action: SpaceCommand["action"];
  accountId: string;
  targetId: string | null;
}
export type SpacePreparation =
  PreparedSpaceWrite | Exclude<SpaceRead, SpacePage> | { kind: "stale" };
export type SpaceEffect =
  | {
      kind: "confirmed";
      action: SpaceCommand["action"];
      messageKey: string | null;
      destination: string | null;
      savedName: string | null;
    }
  | {
      kind: "invalid" | "stale" | "uncertain" | "refused" | "login" | "limited";
      messageKey?: string;
      message?: string;
    };
