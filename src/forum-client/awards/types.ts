import type { NoticeClientOptions } from "../notice-transport.js";

export type AwardsClientOptions = NoticeClientOptions;
export type AwardsCatalogue =
  | "medals"
  | "mymedals"
  | "medalgrant"
  | "achievements"
  | "titles"
  | "titleshop"
  | "titleexchange"
  | "titleissue"
  | "bggrant";
export interface AwardsQuery {
  page?: number;
  typeid?: number;
  filter?: string;
  sort?: string;
  q?: string;
  keyword?: string;
}
export type AwardsValue =
  string | number | boolean | null | AwardsRecord | readonly AwardsValue[];
export interface AwardsRecord {
  readonly [key: string]: AwardsValue | undefined;
}
export interface AwardsView {
  readonly kind: "awards-view";
  readonly catalogue: AwardsCatalogue;
  readonly memberId: string;
  readonly records: readonly AwardsRecord[];
  readonly metadata: AwardsRecord;
}
export type AwardsFailure = {
  kind:
    | "refused"
    | "invalid-input"
    | "invalid-response"
    | "session-changed"
    | "network"
    | "rate-limited";
  message?: string;
  retryAfterSeconds?: number;
};
export interface AwardsHandoff {
  kind: "awards-handoff";
  url: string;
  catalogue: AwardsCatalogue;
  reason: string;
  choice?: AwardsChoice;
}

export type AwardsChoice =
  | {
      kind: "acquire-medal";
      id: number;
      method: 1 | 2 | 5 | 6;
      reason?: string;
    }
  | { kind: "hide-medals"; changes: readonly { id: number; hidden: boolean }[] }
  | {
      kind: "grant-medals";
      recipients: readonly number[];
      medals: readonly number[];
      reason: string;
    }
  | { kind: "revoke-medal" | "revoke-medal-batch"; id: number }
  | { kind: "wear-title" | "buy-title" | "exchange-title"; id: number }
  | { kind: "remove-title" }
  | {
      kind: "issue-title" | "revoke-title";
      titles: readonly number[];
      recipients: readonly string[];
      days: number;
      note: string;
    }
  | ({
      kind: "grant-background";
      recipients: readonly number[];
      expiry: string;
      notify: boolean;
    } & ({ id: number; image?: never } | { image: string; id?: never }));
export interface AwardsForm {
  readonly choice: AwardsChoice;
  readonly memberId: string;
  readonly terms: AwardsRecord;
}
export type AwardsPreparation =
  { kind: "awards-ready"; form: AwardsForm } | AwardsHandoff | AwardsFailure;
export type AwardsResult =
  | AwardsFailure
  | {
      kind:
        | "acknowledged"
        | "observed"
        | "partial"
        | "pending-review"
        | "redrawn"
        | "unknown"
        | "refused";
      choice: AwardsChoice;
      message?: string;
      grantedCount?: number;
    };
export interface AwardLookup {
  readonly kind: "awards-lookup";
  readonly records: readonly AwardsRecord[];
  readonly metadata: AwardsRecord;
}
export interface MedalThreadQuery {
  tid: number;
  from?: number;
  to?: number;
  noOwner?: boolean;
}
