import type { NoticeSession } from "../notice-transport.js";
import type { HostResponse } from "../types.js";

export type AdminRequest = {
  readonly fresh: true;
  readonly session: NoticeSession;
  readonly headers: Readonly<Record<string, string>>;
} & (
  | { readonly method: "GET"; readonly effect: false; readonly body?: never }
  | { readonly method: "POST"; readonly effect: true; readonly body: string }
);
export interface AdminClientOptions {
  origin: string;
  session(): NoticeSession | null;
  now?(): number;
  transport: {
    request(
      url: string,
      request: AdminRequest,
    ): Promise<HostResponse & { redirect: "none" | "opaque" | "followed" }>;
  };
}
export type AdminAction =
  "admincredit" | "admingroup" | "adminban" | "adminreport";
export interface AdminLoginState {
  readonly locked: boolean;
  readonly retryAfter: number;
  readonly triesLeft: number;
  readonly securityQuestion: boolean;
}
export interface AdminAccess {
  readonly kind: "admin-access";
  readonly enabled: boolean;
  readonly eligible: boolean;
  readonly founder: boolean;
  readonly why?: string;
  readonly capabilities: Readonly<
    Partial<
      Record<AdminAction, { readonly read: boolean; readonly write: boolean }>
    >
  >;
  readonly login: AdminLoginState | null;
  readonly sessionActive: boolean;
}
export interface AdminCredentials {
  readonly password: string;
  readonly question?: { readonly id: number; readonly answer: string };
}
export type AdminFailure =
  | {
      readonly kind:
        | "invalid-input"
        | "invalid-response"
        | "network"
        | "session-changed"
        | "not-confirmed"
        | "in-flight";
    }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly why?: string;
      readonly retryAfter?: number;
      readonly login?: AdminLoginState;
      readonly action?: AdminAction;
    }
  | {
      readonly kind: "uncertain";
      readonly operation: string;
      readonly operationId?: string;
    };
export type AdminSessionResult =
  AdminFailure | { readonly kind: "admin-opened" | "admin-closed" };

export interface AdminMember {
  readonly memberId: string;
  readonly username: string;
  readonly groupId: string | null;
  readonly group: string;
  readonly adminId: number;
  readonly locked: boolean;
  readonly self: boolean;
  readonly founder: boolean;
}
export interface AdminCreditType {
  readonly id: string;
  readonly title: string;
  readonly unit: string;
}
export interface AdminCreditMember {
  readonly member: AdminMember;
  readonly balances: Readonly<Record<string, number>>;
}
export interface AdminCreditLookup {
  readonly memberIds?: readonly string[];
  readonly usernames?: readonly string[];
}
export interface AdminCredits {
  readonly kind: "admin-credits";
  readonly members: readonly AdminCreditMember[];
  readonly creditTypes: readonly AdminCreditType[];
  readonly missing: readonly string[];
  readonly limits: {
    readonly users: number;
    readonly delta: number;
    readonly reason: number;
  };
  readonly reasonRequired: boolean;
}
export interface AdminWriteIntent {
  readonly operationId: string;
  readonly reason?: string;
  readonly notify?: boolean;
}
export interface AdminCreditAdjustment extends AdminWriteIntent {
  readonly memberIds: readonly string[];
  readonly deltas: Readonly<Record<string, number>>;
}
export interface AdminDuplicate {
  readonly kind: "duplicate";
  readonly operation: string;
  readonly operationId: string;
}
export interface AdminCreditsAdjusted {
  readonly kind: "credits-adjusted";
  readonly operationId: string;
  readonly changed: Readonly<Record<string, number>>;
  readonly notified: number;
  readonly members: readonly AdminCreditMember[];
}

export type AdminMemberLookup =
  { readonly memberId: string } | { readonly username: string };
export interface AdminGroupChoice {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly adminId: number;
  readonly relatedAdmin: boolean;
  readonly allowed: boolean;
}
export interface AdminGroupExpiry {
  readonly date: string;
  readonly groupId: string;
  readonly adminId?: number;
}
export interface AdminExtendedGroup {
  readonly groupId: string;
  readonly expiresOn?: string;
}
export interface AdminGroup {
  readonly kind: "admin-group";
  readonly member: AdminMember;
  readonly credits: number;
  readonly expiry: AdminGroupExpiry | null;
  readonly extendedGroups: readonly AdminExtendedGroup[];
  readonly groups: readonly AdminGroupChoice[];
  readonly extensionChoices: readonly AdminGroupChoice[];
  readonly expiryChoices: readonly AdminGroupChoice[];
  readonly adminIds: readonly number[];
  readonly canChange: boolean;
  readonly adminGrant: boolean;
  readonly why?: string;
  readonly maxExtensionLength: number;
  readonly maxReason: number;
  readonly reasonRequired: boolean;
}
export interface AdminGroupChange extends AdminWriteIntent {
  readonly groupId: string;
  readonly adminId?: number;
  readonly expiry?: AdminGroupExpiry | null;
  readonly extendedGroups: readonly AdminExtendedGroup[];
}
export interface AdminGroupAcknowledged {
  readonly kind: "group-acknowledged";
  readonly memberId: string;
  readonly operationId: string;
}

export type AdminReportScope = "pending" | "resolved";
export interface AdminReportResolution {
  readonly operatorId: string | null;
  readonly operator: string;
  readonly time: number;
  readonly value: number;
  readonly creditTitle: string;
}
export interface AdminReport {
  readonly id: string;
  readonly reporterId: string | null;
  readonly reporter: string;
  readonly message: string;
  readonly excerpt: string;
  readonly time: number;
  readonly count: number;
  readonly forum: string;
  readonly forumId: string | null;
  readonly threadId: string | null;
  readonly postId: string | null;
  readonly destination: string | null;
  readonly resolution: AdminReportResolution | null;
}
export interface AdminReportReward {
  readonly credit: AdminCreditType;
  readonly min: number;
  readonly max: number;
  readonly options: readonly number[];
}
export interface AdminReports {
  readonly kind: "admin-reports";
  readonly scope: AdminReportScope;
  readonly page: number;
  readonly pages: number;
  readonly count: number;
  readonly reports: readonly AdminReport[];
  readonly reward: AdminReportReward | null;
  readonly maxMessage: number;
}
export interface AdminReportDecision {
  readonly reportId: string;
  readonly reward?: number;
  readonly message?: string;
}
export type AdminReportEffect =
  | {
      readonly kind: "reports-resolved";
      readonly operationId: string;
      readonly resolved: readonly string[];
      readonly skipped: readonly string[];
      readonly unreported: readonly string[];
    }
  | {
      readonly kind: "reports-deleted";
      readonly operationId: string;
      readonly deleted: readonly string[];
      readonly unreported: readonly string[];
    };

export type AdminBan = "" | "post" | "visit" | "status";
export type AdminCleanup = "post" | "postcomment" | "avatar" | "profile";
export interface AdminCrime {
  readonly action: string;
  readonly text: string;
  readonly time: number;
  readonly reason: string;
  readonly operator: string;
}
export interface AdminMemberState {
  readonly kind: "admin-member-state";
  readonly member: AdminMember;
  readonly banned: AdminBan;
  readonly banExpiry: number;
  readonly posts: number;
  readonly threads: number;
  readonly postRows: number;
  readonly postLeft: number | null;
  readonly clearPending: boolean;
  readonly canChange: boolean;
  readonly why?: string;
  readonly bans: readonly AdminBan[];
  readonly days: readonly number[];
  readonly cleanupChoices: readonly AdminCleanup[];
  readonly batchSize: number;
  readonly maxDays: number;
  readonly maxReason: number;
  readonly reasonRequired: boolean;
  readonly crimes: readonly AdminCrime[];
}
export interface AdminBanChange extends Omit<AdminWriteIntent, "notify"> {
  readonly ban: AdminBan;
  readonly days?: number;
  readonly clear?: readonly AdminCleanup[];
}
export interface AdminCleanupCheckpoint {
  readonly kind: "cleanup-checkpoint";
  readonly memberId: string;
  readonly cursor: string;
  readonly remaining: number;
}
export interface AdminBanAcknowledged {
  readonly kind: "ban-acknowledged";
  readonly memberId: string;
  readonly operationId: string;
  readonly cleared: readonly AdminCleanup[];
  readonly cleanup: AdminCleanupCheckpoint | null;
}
export type AdminCleanupEffect = {
  readonly memberId: string;
  readonly posts: number;
  readonly threads: number;
} & (
  | { readonly kind: "cleanup-complete"; readonly remaining: 0 }
  | {
      readonly kind: "cleanup-progress";
      readonly remaining: number;
      readonly next: AdminCleanupCheckpoint;
    }
);
