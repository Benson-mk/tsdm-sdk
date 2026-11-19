import type { PanelFailure, PanelLoginOffer } from "./types.js";

export type PanelSettingOperation =
  | "set-forum-access"
  | "edit-member"
  | "ban-member"
  | "add-ip-ban"
  | "delete-ip-bans"
  | "add-note"
  | "delete-notes"
  | "save-rules"
  | "save-recommendations"
  | "create-announcement"
  | "edit-announcement"
  | "delete-announcements";
export type PanelSettingOutcome =
  | (PanelFailure & { operation: PanelSettingOperation })
  | { kind: "acknowledged"; operation: PanelSettingOperation; code?: string }
  | {
      kind: "completed" | "partial" | "redrawn" | "uncertain";
      operation: PanelSettingOperation;
      confirmedIds?: readonly string[];
      remainingIds?: readonly string[];
      unknownIds?: readonly string[];
    };
export type SettingsRead<T> = PanelFailure | PanelLoginOffer | T;
export type PanelAccessRight =
  | "view"
  | "post"
  | "reply"
  | "getattach"
  | "getimage"
  | "postattach"
  | "postimage";
export interface PanelAccessPage {
  readonly forumId: string;
  readonly forums: readonly { id: string; name: string }[];
  readonly keyword: string;
  readonly page: number;
  readonly pages: number;
  readonly items: readonly {
    memberId: string;
    username: string;
    rights: Readonly<Partial<Record<PanelAccessRight, -1 | 0 | 1>>>;
  }[];
  readonly canSearch: boolean;
  readonly canSet: boolean;
}
export type PanelAccessRead = SettingsRead<{
  kind: "forum-access";
  page: PanelAccessPage;
}>;
export type PanelMemberMode = "ban" | "edit";
export type PanelMemberQuery =
  { uid: string; username?: never } | { username: string; uid?: never };
export type PanelBanChoice = "0" | "4" | "5";
export interface PanelMemberPage {
  readonly mode: PanelMemberMode;
  readonly memberId: string;
  readonly username: string;
  readonly status: string;
  readonly bio?: string;
  readonly signature?: string;
  readonly canClearAvatar: boolean;
  readonly canEdit: boolean;
  readonly choices: readonly { value: PanelBanChoice; label: string }[];
  readonly reasonRequired: boolean;
  readonly history: readonly {
    action: string;
    reason: string;
    operator: string;
    time: string | number | null;
  }[];
}
export type PanelMemberRead = SettingsRead<
  | { kind: "panel-member"; page: PanelMemberPage }
  | {
      kind: "refused";
      code: string;
      operation: "lookup-member-ban" | "lookup-member-edit";
    }
>;
export interface PanelMemberEdit {
  readonly bio: string;
  readonly signature: string;
  readonly clearAvatar?: boolean;
}
export interface PanelIpBanPage {
  readonly items: readonly {
    id: string;
    ip: string;
    operator: string;
    canDelete: boolean;
  }[];
  readonly canAdd: boolean;
  readonly cidrAllowed: boolean | null;
}
export type PanelIpBanRead = SettingsRead<{
  kind: "ip-bans";
  page: PanelIpBanPage;
}>;
export interface PanelLogEntry {
  readonly id: string | null;
  readonly time: string | number | null;
  readonly operator: string;
  readonly operatorId: string | null;
  readonly action: string;
  readonly operation: string;
  readonly forum: string;
  readonly forumId: string | null;
  readonly ip: string | null;
  readonly reason: string;
  readonly other: string;
  readonly threadIds: readonly string[];
  readonly postIds: readonly string[];
  readonly memberIds: readonly string[];
}
export interface PanelLogPage {
  readonly page: number;
  readonly keyword: string;
  readonly hasNext: boolean;
  readonly enabled: boolean | null;
  readonly entries: readonly PanelLogEntry[];
}
export type PanelLogRead = SettingsRead<{
  kind: "panel-log";
  page: PanelLogPage;
}>;
export interface PanelNote {
  readonly id: string;
  readonly message: string;
  readonly operator: string;
  readonly expires: number | null;
  readonly toSupermod: boolean;
  readonly toModerator: boolean;
  readonly canDelete: boolean;
}
export interface PanelNotesPage {
  readonly items: readonly PanelNote[];
  readonly defaultDays: number;
  readonly canAdd: boolean;
  readonly canDelete: boolean;
}
export type PanelNotesRead = SettingsRead<{
  kind: "panel-notes";
  page: PanelNotesPage;
}>;
export interface PanelNewNote {
  readonly message: string;
  readonly toSupermod: boolean;
  readonly toModerator: boolean;
  readonly days?: number;
}
export interface PanelForumRulesPage {
  readonly forumId: string;
  readonly forums: readonly { id: string; name: string }[];
  readonly rules: string;
  readonly editable: boolean;
}
export type PanelForumRulesRead = SettingsRead<{
  kind: "forum-rules";
  page: PanelForumRulesPage;
}>;
export interface PanelRecommendationEdit {
  readonly id: string;
  readonly order: number;
  readonly subject: string;
  readonly expiration: string;
}
export interface PanelRecommendation extends PanelRecommendationEdit {
  readonly author: string;
  readonly authorId: string | null;
  readonly recommender: string;
  readonly recommenderId: string | null;
  readonly canRemove: boolean;
}
export interface PanelRecommendationsPage {
  readonly forumId: string;
  readonly items: readonly PanelRecommendation[];
  readonly editable: boolean;
}
export type PanelRecommendationsRead = SettingsRead<{
  kind: "recommendations";
  page: PanelRecommendationsPage;
}>;
export interface PanelRecommendationChange {
  readonly edits?: readonly PanelRecommendationEdit[];
  readonly remove?: readonly string[];
}
export interface PanelAnnouncementDraft {
  readonly subject: string;
  readonly type: "text" | "link";
  readonly start: string;
  readonly end: string;
  readonly message: string;
}
export interface PanelAnnouncementForm extends PanelAnnouncementDraft {
  readonly id: string;
  readonly editable: boolean;
}
export interface PanelAnnouncementItem {
  readonly id: string;
  readonly subject: string;
  readonly type: string;
  readonly author: string;
  readonly start: string | number | null;
  readonly end: string | number | null;
  readonly canDelete: boolean;
}
export interface PanelAnnouncementsPage {
  readonly items: readonly PanelAnnouncementItem[];
  readonly createForm: PanelAnnouncementForm | null;
  readonly canDelete: boolean;
}
export type PanelAnnouncementsRead = SettingsRead<{
  kind: "announcements";
  page: PanelAnnouncementsPage;
}>;
export type PanelAnnouncementRead = SettingsRead<{
  kind: "announcement-form";
  form: PanelAnnouncementForm;
}>;
export interface ModeratorSettings {
  readPanelAnnouncements(): Promise<PanelAnnouncementsRead>;
  readPanelAnnouncement(id: string): Promise<PanelAnnouncementRead>;
  createPanelAnnouncement(
    page: PanelAnnouncementsPage,
    draft: PanelAnnouncementDraft,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  editPanelAnnouncement(
    form: PanelAnnouncementForm,
    draft: PanelAnnouncementDraft,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  deletePanelAnnouncements(
    page: PanelAnnouncementsPage,
    ids: readonly string[],
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  readForumRules(forumId: string): Promise<PanelForumRulesRead>;
  saveForumRules(
    page: PanelForumRulesPage,
    rules: string,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  readRecommendations(forumId: string): Promise<PanelRecommendationsRead>;
  saveRecommendations(
    page: PanelRecommendationsPage,
    change: PanelRecommendationChange,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  readPanelLog(keyword?: string, page?: number): Promise<PanelLogRead>;
  readManagementNotes(): Promise<PanelNotesRead>;
  addManagementNote(
    page: PanelNotesPage,
    note: PanelNewNote,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  deleteManagementNotes(
    page: PanelNotesPage,
    ids: readonly string[],
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  lookupPanelMember(
    mode: PanelMemberMode,
    query: PanelMemberQuery,
  ): Promise<PanelMemberRead>;
  changeMemberBan(
    page: PanelMemberPage,
    choice: PanelBanChoice,
    days: number | null,
    reason: string,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  editPanelMember(
    page: PanelMemberPage,
    choices: PanelMemberEdit,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  readIpBans(): Promise<PanelIpBanRead>;
  addIpBan(
    page: PanelIpBanPage,
    ip: string,
    days: number,
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  deleteIpBans(
    page: PanelIpBanPage,
    ids: readonly string[],
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
  readForumAccess(forumId?: string, page?: number): Promise<PanelAccessRead>;
  searchForumAccess(
    page: PanelAccessPage,
    username: string,
  ): Promise<PanelAccessRead>;
  setForumAccess(
    page: PanelAccessPage,
    username: string,
    denied: readonly PanelAccessRight[],
    approved: boolean,
  ): Promise<PanelSettingOutcome>;
}
