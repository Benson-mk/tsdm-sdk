import type { ActivityClientOptions } from "../activity-client.js";

export type PanelFailure =
  | {
      kind:
        | "invalid-input"
        | "invalid-response"
        | "session-changed"
        | "network"
        | "stale"
        | "uncertain"
        | "not-confirmed"
        | "unsupported";
    }
  | { kind: "refused"; code: string };
export type ModeratorPanelOptions = ActivityClientOptions;
export type ModeratorPanelLoginForm = Readonly<{ forumId: string }>;
export interface ModeratorDashboard {
  readonly counts: Readonly<Record<string, unknown>>;
  readonly forums: readonly Readonly<Record<string, unknown>>[];
  readonly notes: readonly Readonly<Record<string, unknown>>[];
  readonly isModerator: boolean;
}
export type PanelLoginOffer = {
  kind: "panel-login";
  form: ModeratorPanelLoginForm;
};
export type PanelSelectionOutcome = {
  kind: "completed" | "partial" | "redrawn" | "uncertain";
  confirmedIds: string[];
  remainingIds: string[];
  unknownIds: string[];
};

export type ModeratorQueueKind = "threads" | "replies" | "members";
export type ModeratorQueueAction = "validate" | "ignore" | "delete";
export interface ModeratorQueueItem {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly author: string;
  readonly authorId: string | null;
  readonly actions: readonly ModeratorQueueAction[];
}
export interface ModeratorQueuePage {
  readonly kind: ModeratorQueueKind;
  readonly forumId: string;
  readonly number: number;
  readonly hasNext: boolean;
  readonly items: readonly ModeratorQueueItem[];
}
export type ModeratorQueueResult =
  PanelFailure | PanelLoginOffer | { kind: "queue"; page: ModeratorQueuePage };
export type ModeratorQueueOutcome =
  | PanelFailure
  | PanelSelectionOutcome
  | { kind: "acknowledged"; id: string; code: string };

export type ModeratorSearchKind = "threads" | "posts";
export interface ModeratorSearchPage {
  readonly kind: ModeratorSearchKind;
  readonly forumId: string;
  readonly page: number;
  readonly pages: number;
  readonly items: readonly ModeratorSearchItem[];
  readonly canSearch: boolean;
  readonly canDelete: boolean;
}
export interface ModeratorSearchItem {
  readonly id: string;
  readonly forumId: string;
  readonly threadId: string;
  readonly subject: string;
  readonly message: string;
  readonly author: string;
  readonly authorId: string | null;
}
export type ModeratorSearchResult =
  | PanelFailure
  | PanelLoginOffer
  | { kind: "search-page"; page: ModeratorSearchPage };

export interface ModeratorReportItem {
  readonly id: string;
  readonly postId: string | null;
  readonly threadId: string | null;
  readonly reporterId: string | null;
  readonly message: string;
}
export interface ModeratorReportsPage {
  readonly forumId: string;
  readonly items: readonly ModeratorReportItem[];
  readonly forums: readonly { readonly id: string; readonly name: string }[];
  readonly page: number;
  readonly pages: number;
  readonly canResolve: boolean;
  readonly canDelete: false;
  readonly reward: Readonly<{ min: number; max: number }> | null;
}
export interface ModeratorReportDecision {
  readonly id: string;
  readonly credit?: number;
  readonly message?: string;
}
export type ModeratorReportsResult =
  | PanelFailure
  | PanelLoginOffer
  | { kind: "reports"; page: ModeratorReportsPage };
export type ModeratorReportResolution =
  | PanelFailure
  | { kind: "acknowledged"; id: string; code: "modcp_report_success" };

export type ModeratorRecycleBinKind = "threads" | "posts";
export type ModeratorRecycleMode = "auto" | "native";
export interface ModeratorRecycleItem {
  readonly id: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly author: string;
  readonly authorId: string | null;
}
export interface ModeratorRecycleBinPage {
  readonly kind: ModeratorRecycleBinKind;
  readonly forumId: string;
  readonly number: number;
  readonly hasNext: boolean;
  readonly items: readonly ModeratorRecycleItem[];
  readonly canSearch: boolean;
  readonly canRestore: boolean;
  readonly canPermanentlyDelete: boolean;
}
export type ModeratorRecycleResult =
  | PanelFailure
  | PanelLoginOffer
  | { kind: "recycle-bin"; page: ModeratorRecycleBinPage };

export type ModeratorDashboardResult =
  | PanelFailure
  | { kind: "panel-login"; form: ModeratorPanelLoginForm }
  | { kind: "dashboard"; page: ModeratorDashboard };

export interface ModeratorReportDeletionHandoff {
  readonly kind: "admin-report-deletion";
  readonly origin: string;
  readonly forumId: string;
  readonly reportIds: readonly string[];
}

export interface ModeratorPanelClient {
  readDashboard(): Promise<ModeratorDashboardResult>;
  login(
    form: ModeratorPanelLoginForm,
    password: string,
    confirmed: boolean,
  ): Promise<ModeratorDashboardResult>;
  readSearch(
    kind: ModeratorSearchKind,
    forumId?: string,
  ): Promise<ModeratorSearchResult>;
  search(
    page: ModeratorSearchPage,
    conditions: Readonly<Record<string, string>>,
    confirmed: boolean,
  ): Promise<ModeratorSearchResult>;
  readSearchResults(
    page: ModeratorSearchPage,
    number: number,
  ): Promise<ModeratorSearchResult>;
  deleteSelectedPosts(
    page: ModeratorSearchPage,
    ids: readonly string[],
    keepCredits: boolean,
    confirmed: boolean,
  ): Promise<PanelFailure | PanelSelectionOutcome>;
  readQueue(
    kind: ModeratorQueueKind,
    forumId?: string,
    number?: number,
  ): Promise<ModeratorQueueResult>;
  moderateQueue(
    page: ModeratorQueuePage,
    itemId: string,
    decision: ModeratorQueueAction,
    reason: string,
    confirmed: boolean,
  ): Promise<ModeratorQueueOutcome>;
  readReports(forumId?: string, page?: number): Promise<ModeratorReportsResult>;
  resolveReport(
    page: ModeratorReportsPage,
    decision: ModeratorReportDecision,
    confirmed: boolean,
  ): Promise<ModeratorReportResolution>;
  prepareReportDeletion(
    page: ModeratorReportsPage,
    ids: readonly string[],
    confirmed: boolean,
  ): Promise<PanelFailure | ModeratorReportDeletionHandoff>;
  deleteReports(
    page: ModeratorReportsPage,
    ids: readonly string[],
    confirmed: boolean,
  ): Promise<PanelFailure>;
  readRecycleBin(
    kind: ModeratorRecycleBinKind,
    forumId: string,
    number?: number,
    mode?: ModeratorRecycleMode,
  ): Promise<ModeratorRecycleResult>;
  searchRecycleBin(
    page: ModeratorRecycleBinPage,
    conditions: Readonly<Record<string, string>>,
    confirmed: boolean,
  ): Promise<ModeratorRecycleResult>;
  restoreFromRecycleBin(
    page: ModeratorRecycleBinPage,
    ids: readonly string[],
    confirmed: boolean,
  ): Promise<PanelFailure | PanelSelectionOutcome>;
  permanentlyDeleteFromRecycleBin(
    page: ModeratorRecycleBinPage,
    ids: readonly string[],
    confirmed: boolean,
  ): Promise<PanelFailure | PanelSelectionOutcome>;
}
