import type { ActivityClientOptions } from "../activity-client.js";

export type ModerationClientOptions = ActivityClientOptions;
import type { ModerationOperation } from "./operations.js";
export type { ModerationOperation } from "./operations.js";
export interface ModerationTarget {
  readonly operation: ModerationOperation;
  readonly forumId: string;
  readonly threadIds: readonly string[];
  readonly postId?: string;
  readonly commentId?: string;
  readonly undo?: true;
  readonly attachmentId?: string;
  readonly splitPages?: readonly number[];
  readonly page?: number;
}
export interface ModerationChoice {
  readonly value: string;
  readonly label: string;
}
export interface ModerationField {
  readonly name: string;
  readonly value: string;
  readonly choices: readonly ModerationChoice[];
  readonly required: boolean;
  readonly multiple: boolean;
}
export interface ModerationForm {
  readonly target: ModerationTarget;
  readonly method: "POST" | "GET";
  readonly fields: readonly ModerationField[];
  readonly context: readonly string[];
}
export type ModerationValues = Readonly<
  Record<string, string | readonly string[]>
>;
export type ModerationFailure =
  | {
      kind:
        | "invalid-input"
        | "invalid-response"
        | "session-changed"
        | "network"
        | "unsupported";
    }
  | { kind: "refused"; code: string; message?: string };
export type ModerationPreparation =
  | ModerationFailure
  | { kind: "moderation-form"; form: ModerationForm }
  | {
      kind: "selection-changed";
      target: ModerationTarget;
      offeredThreadIds: readonly string[];
    };
export type ModerationEffect =
  | ModerationFailure
  | { kind: "not-confirmed" }
  | { kind: "uncertain" | "redrawn"; target: ModerationTarget }
  | { kind: "acknowledged"; target: ModerationTarget; code: string };

export interface ModerationPostTarget {
  readonly forumId: string;
  readonly threadId: string;
  readonly postId: string;
  readonly page?: number;
}
export type PosterIpResult =
  | ModerationFailure
  | {
      kind: "poster-ip";
      forumId: string;
      threadId: string;
      postId: string;
      ip: string;
      port: number | null;
      location: string;
    };
