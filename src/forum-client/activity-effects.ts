import type { ActivityFailure } from "./activity-read-types.js";

export type ActivityTarget = { threadURL: string } & (
  | { action: "rate" | "report" | "comment"; postId: string }
  | { action: "recommend" | "subtract"; postId?: never }
);
export type ActivityIntent =
  | {
      action: "rate";
      scores: Readonly<Record<string, number>>;
      reason: string;
      notify: boolean;
    }
  | { action: "report"; message: string }
  | {
      action: "comment";
      message: string;
      items?: Readonly<Record<string, string>>;
    }
  | { action: "recommend" | "subtract" };
export interface ActivityRatingChoice {
  name: string;
  label: string;
  minimum: number;
  maximum: number;
  remaining: number;
  choices?: number[];
}
export interface ActivityCommentItem {
  name: string;
  label: string;
  choices: { value: string; label: string }[];
  defaultValue: string;
}
export interface PreparedActivity {
  readonly target: ActivityTarget;
  readonly rating?: ActivityRatingChoice[];
  readonly reasons?: string[];
  readonly notifyDefault?: boolean;
  readonly selfDeduct?: boolean;
  readonly commentItems?: ActivityCommentItem[];
  readonly maxLength?: number;
  readonly evaluation?: { label: string; count?: number };
}
export type ActivityPreparation =
  | ActivityFailure
  | { kind: "handoff"; destination: string; message: string }
  | { kind: "prepared"; prepared: PreparedActivity };

type Effect =
  | {
      kind: "accepted";
      message: string;
      delta?: number;
      index?: number;
      destination?: string;
    }
  | { kind: "refused"; code: string; message: string }
  | { kind: "redrawn"; destination: string; message: string }
  | { kind: "handoff"; destination: string; message: string; effect: "unknown" }
  | { kind: "unknown"; message: string };
export type ActivityEffect =
  | Extract<ActivityFailure, { message: string }>
  | (Effect & { target: ActivityTarget; intent: ActivityIntent });
export type ActivityVerdict = Effect;
