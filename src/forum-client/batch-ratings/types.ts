import type { NoticeSession } from "../notice-transport.js";
import type { HostResponse } from "../types.js";

export type BatchRatingRequest = {
  readonly fresh: true;
  readonly session: NoticeSession;
} & (
  | { readonly method: "GET"; readonly effect: false; readonly body?: never }
  | { readonly method: "POST"; readonly effect: boolean; readonly body: string }
);
export interface BatchRatingClientOptions {
  origin: string;
  session(): NoticeSession | null;
  transport: {
    request(
      url: string,
      request: BatchRatingRequest,
    ): Promise<
      HostResponse & {
        redirect: "none" | "opaque" | "followed";
        location?: string;
      }
    >;
  };
}
export type BatchRatingFailure =
  | {
      kind:
        | "invalid-input"
        | "invalid-response"
        | "unavailable"
        | "network"
        | "session-changed";
    }
  | { kind: "refused"; code?: string; message?: string };
export type BatchRatingMode = "threads" | "posts" | "floors";
export interface BatchRatingScope {
  forumId?: string;
  threadId?: string;
}
export interface BatchRatingLimits {
  readonly maxTotal: number;
  readonly chunk: number;
  readonly maxMultiplier: number;
  readonly floorSegments: number;
}
export interface BatchRatingCredit {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly left: number | null;
  readonly score: number;
  readonly condition: string;
}
export interface BatchRatingAntispam {
  readonly rated: boolean;
  readonly same: boolean;
  readonly locked: boolean;
}
export interface BatchRatingAccess {
  readonly forumId: string | null;
  readonly threadId: string | null;
  readonly version: string;
  readonly modes: readonly BatchRatingMode[];
  readonly canList: boolean;
  readonly why: string;
  readonly limits: BatchRatingLimits;
  readonly credits: readonly BatchRatingCredit[];
  readonly reasonRequired: boolean;
  readonly notifyForced: boolean;
  readonly reasonChoices: readonly string[];
  readonly antispam: BatchRatingAntispam;
}
export type BatchRatingDiscovery =
  | { kind: "batch-rating-access"; access: BatchRatingAccess }
  | BatchRatingFailure;

export type BatchRatingSelection =
  | { readonly mode: "threads"; readonly threadIds: readonly string[] }
  | { readonly mode: "posts"; readonly postIds: readonly string[] }
  | { readonly mode: "floors"; readonly floors: string };
export interface BatchRatingSettings {
  readonly scores?: Readonly<Record<string, number>>;
  readonly conditions?: Readonly<Record<string, string>>;
  readonly multipliers?: Readonly<Record<string, number>>;
  readonly reason?: string;
  readonly notify?: boolean;
  readonly exclude?: string;
  readonly rated?: boolean;
  readonly same?: boolean;
  readonly floors?: string;
}
export interface BatchRatingItem {
  readonly itemId: string | null;
  readonly threadId: string;
  readonly postId: string;
  readonly position: number;
  readonly authorId: string | null;
  readonly author: string;
  readonly subject: string;
  readonly status: string;
  readonly statusText: string;
  readonly multiplier: number;
  readonly url: string | null;
  readonly canUndo: boolean;
}
export interface BatchRatingQuota {
  readonly id: string;
  readonly need: number;
  readonly left: number | null;
  readonly ok: boolean;
}
export interface BatchRatingIssue {
  readonly code: string;
  readonly creditId: string | null;
  readonly message: string;
}
export interface BatchRatingPreview {
  readonly forumId: string;
  readonly threadId: string | null;
  readonly selection: BatchRatingSelection;
  readonly items: readonly BatchRatingItem[];
  readonly credits: readonly BatchRatingCredit[];
  readonly conditionCredits: readonly Readonly<{ id: string; name: string }>[];
  readonly quota: readonly BatchRatingQuota[];
  readonly issues: readonly BatchRatingIssue[];
  readonly total: number;
  readonly eligible: number;
  readonly multiplierSum: number;
  readonly chunks: number;
  readonly blocked: boolean;
  readonly canCreate: boolean;
  readonly reasonRequired: boolean;
  readonly notifyForced: boolean;
  readonly antispam: BatchRatingAntispam;
  readonly ratedOverridden: boolean;
  readonly settings: Readonly<Required<Omit<BatchRatingSettings, "floors">>>;
}
export type BatchRatingPreviewResult =
  | { kind: "batch-rating-preview"; preview: BatchRatingPreview }
  | BatchRatingFailure;

export interface BatchRatingRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly forumId: string;
  readonly threadId: string | null;
  readonly forum: string;
  readonly mode: BatchRatingMode;
  readonly modeText: string;
  readonly floors: string;
  readonly scores: readonly Readonly<{
    id: string;
    name: string;
    score: number;
  }>[];
  readonly reason: string;
  readonly total: number;
  readonly applied: number;
  readonly skipped: number;
  readonly pending: number | null;
  readonly status: number;
  readonly statusText: string;
  readonly time: number | null;
  readonly canContinue: boolean;
  readonly canUndo: boolean;
  readonly canUndoItem: boolean;
}
export interface BatchRatingPage {
  readonly record: BatchRatingRecord;
  readonly items: readonly BatchRatingItem[] | null;
  readonly canRun: boolean;
  readonly canRevoke: boolean;
  readonly resultURL: string | null;
  readonly chunk: number | null;
}
export type BatchRatingEffect =
  "create" | "run" | "revoke-item" | "revoke-batch";
export type BatchRatingUncertain = {
  kind: "uncertain";
  operation: BatchRatingEffect;
  batchId?: string;
  itemId?: string;
};
export type BatchRatingCreation =
  | { kind: "batch-rating-created"; batch: BatchRatingPage }
  | BatchRatingPreviewResult
  | { kind: "not-confirmed" }
  | BatchRatingUncertain;

export type BatchRatingList =
  | {
      kind: "batch-rating-list";
      page: number;
      pages: number;
      count: number;
      batches: readonly BatchRatingRecord[];
    }
  | BatchRatingFailure;
export type BatchRatingRead =
  { kind: "batch-rating-page"; batch: BatchRatingPage } | BatchRatingFailure;
export type BatchRatingStepResult =
  | {
      kind: "advanced" | "finished" | "no-progress";
      operation: "run" | "revoke-batch";
      batchId: string;
      done: number;
      total: number | null;
      remaining: number | null;
    }
  | {
      kind: "revoked";
      operation: "revoke-item";
      batchId: string;
      itemId: string;
    }
  | { kind: "not-confirmed" }
  | BatchRatingFailure
  | BatchRatingUncertain;
export interface BatchRatingClient {
  discoverBatchRating(scope?: BatchRatingScope): Promise<BatchRatingDiscovery>;
  previewBatchRating(
    access: BatchRatingAccess,
    selection: BatchRatingSelection,
  ): Promise<BatchRatingPreviewResult>;
  recalculateBatchRating(
    preview: BatchRatingPreview,
    settings: BatchRatingSettings,
  ): Promise<BatchRatingPreviewResult>;
  createBatchRating(
    preview: BatchRatingPreview,
    approved: boolean,
  ): Promise<BatchRatingCreation>;
  listBatchRatings(
    access: BatchRatingAccess,
    page?: number,
  ): Promise<BatchRatingList>;
  readBatchRatingDetail(
    access: BatchRatingAccess,
    batchId: string,
  ): Promise<BatchRatingRead>;
  resumeBatchRating(
    access: BatchRatingAccess,
    batchId: string,
  ): Promise<BatchRatingRead>;
  readBatchRatingResult(batch: BatchRatingPage): Promise<BatchRatingRead>;
  runBatchRatingStep(
    batch: BatchRatingPage,
    approved: boolean,
  ): Promise<BatchRatingStepResult>;
  revokeBatchRatingItem(
    batch: BatchRatingPage,
    itemId: string,
    approved: boolean,
  ): Promise<BatchRatingStepResult>;
  revokeBatchRatingStep(
    batch: BatchRatingPage,
    approved: boolean,
  ): Promise<BatchRatingStepResult>;
}
