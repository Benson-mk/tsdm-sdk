export { createActivityClient } from "./forum-client/activity-client.js";
export type {
  ActivityClientOptions,
  ActivityRequest,
  ActivitySession,
} from "./forum-client/activity-client.js";
export type {
  ActivityFailure,
  ActivityQuery,
  ActivityRead,
} from "./forum-client/activity-read-types.js";
export type {
  ActivityCommentItem,
  ActivityEffect,
  ActivityIntent,
  ActivityPreparation,
  ActivityRatingChoice,
  ActivityTarget,
  PreparedActivity,
} from "./forum-client/activity-effects.js";

export { createMediaClient } from "./forum-client/media/client.js";
export type {
  AlbumFiling,
  AlbumOpen,
  AlbumOption,
  AlbumPicture,
  AlbumTarget,
  AlbumUpload,
  AlbumUploadForm,
  AttachmentCredit,
  AttachmentCreditOffer,
  AttachmentRead,
  AttachmentResume,
  ExternalMediaHandoff,
  MediaBrowserHandoff,
  MediaClientOptions,
  MediaDelivery,
  MediaFailure,
  MediaFile,
  MediaRead,
  MediaRequest,
  MediaResponse,
  MediaSession,
  PostImageForm,
  PostImageOpen,
  PostImageUpload,
  Smiley,
  SmileyCatalogue,
  SmileyGroup,
  SmileyScript,
} from "./forum-client/media/types.js";

export { createCreditsClient } from "./forum-client/credits/client.js";
export type {
  Attendance,
  AttendanceCalendar,
  AttendanceResult,
  CheckInChoice,
  CheckInFeeling,
  CheckInForm,
  CheckInPreparation,
  CheckInResult,
  CreditBalance,
  CreditChange,
  CreditLog,
  CreditLogQuery,
  CreditValue,
  CreditsClientOptions,
  CreditsFailure,
  CreditsHandoff,
  CreditsRequest,
  CreditsSession,
  ExpiringGroup,
  GroupDetail,
  GroupExpiry,
  GroupMenu,
  GroupPermissionSection,
  GroupProgress,
  GroupSummary,
  GroupSwitchForm,
  GroupSwitchPreparation,
  GroupSwitchResult,
  Groups,
} from "./forum-client/credits/types.js";

export { createReplyClient } from "./forum-client/replies.js";
export type {
  ReplyClientOptions,
  ReplyRequest,
  ReplyCheck,
  ReplyForm,
  ReplyDraft,
  ReplyOption,
  ReplyOptionName,
  ReplyAttempt,
  ReplyPreparation,
  ReplyPublication,
} from "./forum-client/replies.js";
export type {
  ReplyVerification,
  ReplyVerificationCheck,
  ReplyVerificationPrompt,
} from "./forum-client/reply-verification.js";

import { createMemberReads } from "./forum-client/member-reads.js";
export type {
  MemberIdentity,
  MemberLookup,
  MemberLookupResult,
} from "./forum-client/member-reads.js";
import { createDiscoveryOperations } from "./forum-client/discovery.js";
export type {
  DiscoveryFailure,
  DiscoveryThread,
  GuideModule,
  GuideResult,
  GuideView,
  SearchPage,
  SearchQuery,
  SearchResult,
  MemberActivityOptions,
  MemberActivityResult,
  RankingsResult,
  TagResult,
  StatisticsCell,
  StatisticsTable,
  StatisticsPage,
  StatisticsResult,
  TrendData,
  TrendResult,
} from "./forum-client/discovery.js";

import { publicRead } from "./forum-client/public-read.js";

import type {
  Account,
  Board,
  FailureKind,
  Homepage,
  HostResponse as HistoricalResponse,
  Post as HistoricalPost,
  Thread as HistoricalThread,
} from "./forum-client/types.js";

export type {
  Account,
  Attachment,
  Board,
  BoardLink,
  DirectoryGroup,
  ThreadRow,
  ThreadSpecial,
  ContentNode,
  ForumLink,
  Pagination,
  ThreadHistory,
} from "./forum-client/types.js";

export interface HostResponse extends HistoricalResponse {
  redirect: "opaque" | "followed" | "none";
}

export interface ForumTransport {
  request(url: string, options: { fresh: boolean }): Promise<HostResponse>;
}

export type Post = Omit<
  HistoricalPost,
  "rateURL" | "reportURL" | "redPacketThreadId"
>;
export type Thread = Omit<HistoricalThread, "posts"> & { posts: Post[] };

export type { Homepage } from "./forum-client/types.js";

export interface ReadOptions {
  representation?: "structured" | "native";
}

export interface BoardReadOptions extends ReadOptions {
  previews?: boolean;
}

type ReadContext = { account: Account; sourceURL: string };
type ReadFailure =
  | { kind: "document-navigation"; message: string; destination: string }
  | { kind: FailureKind; message: string };
export type ThreadReadResult = ReadContext &
  ({ kind: "thread"; thread: Thread } | ReadFailure);
export type BoardReadResult = ReadContext &
  ({ kind: "board"; board: Board } | ReadFailure);
export type HomepageReadResult = ReadContext &
  ({ kind: "homepage"; homepage: Homepage } | ReadFailure);

export interface ForumClient
  extends
    ReturnType<typeof createDiscoveryOperations>,
    ReturnType<typeof createMemberReads> {
  readHomepage(
    destination?: string,
    options?: ReadOptions,
  ): Promise<HomepageReadResult>;
  readBoard(
    destination: string,
    options?: BoardReadOptions,
  ): Promise<BoardReadResult>;
  readThread(
    destination: string,
    options?: ReadOptions,
  ): Promise<ThreadReadResult>;
}

export function createForumClient({
  origin,
  transport,
}: {
  origin: string;
  transport: ForumTransport;
}): ForumClient {
  const request = (url: string) => transport.request(url, { fresh: true });
  return {
    ...createDiscoveryOperations(origin, transport),
    ...createMemberReads(origin, transport),
    async readHomepage(destination = `${origin}/forum.php`, options) {
      const result = await publicRead(
        destination,
        origin,
        ["directory"],
        request,
        options,
      );
      if (result.kind === "homepage" || "message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected homepage result.",
      };
    },
    async readBoard(destination, options) {
      const result = await publicRead(
        destination,
        origin,
        ["board"],
        request,
        options,
      );
      if (result.kind === "board" || "message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected board result.",
      };
    },
    async readThread(destination, options) {
      const result = await publicRead(
        destination,
        origin,
        ["thread", "redirect"],
        request,
        options,
      );
      if (result.kind === "thread") {
        const posts = result.thread.posts.map(
          ({ rateURL, reportURL, redPacketThreadId, ...post }) => post,
        );
        return { ...result, thread: { ...result.thread, posts } };
      }
      if ("message" in result) return result;
      return {
        kind: "invalid",
        account: result.account,
        sourceURL: destination,
        message: "Unexpected thread result.",
      };
    },
  };
}

export { createAccountClient } from "./forum-client/account-client.js";
export type {
  AccountBrowserHandoff,
  AccountChange,
  AccountChangeField,
  AccountChangeForm,
  AccountVerificationForm,
  AccountChangeOpenResult,
  AccountChangeResult,
  AccountClientOptions,
  AccountEffectFailure,
  AccountFailure,
  AccountRequest,
  AccountStatus,
  LoginCredentials,
  LoginForm,
  LoginResult,
  LogoutResult,
  SessionIdentity,
} from "./forum-client/account-client.js";

export { createProfileClient } from "./forum-client/profile-client.js";
export type {
  AvatarSettings,
  AvatarUploadHandoff,
  BlacklistMember,
  ForumDevice,
  ForumSyncDocument,
  PrivacyTab,
  ProfileClientOptions,
  ProfileFailure,
  ProfileRequest,
  RegisterForumDevice,
  SettingsEditor,
  SettingsField,
} from "./forum-client/profile-client.js";

export { createMemberClient } from "./forum-client/member-client.js";
export type {
  MemberClient,
  MemberClientOptions,
  SendFriendRequest,
  ApproveFriendRequest,
  MemberEffectResult,
  AddFavorite,
  RemoveFavorite,
  FavoriteEffectResult,
  MemberRequest,
  MemberFailure,
  MentionCandidates,
  MentionSearch,
  NativeMentions,
} from "./forum-client/member-client.js";
export type {
  FriendQuery,
  FriendEntry,
  FriendGroup,
  FriendListResult,
  FavoriteQuery,
  FavoriteEntry,
  FavoriteListResult,
} from "./forum-client/member-reads.js";

export { createNoticeClient } from "./forum-client/notice-client.js";
export type {
  NoticeAcknowledgement,
  PollUnreadNoticesOptions,
  UnreadNotice,
  UnreadNoticePoll,
} from "./forum-client/notice-poll.js";
export type {
  NoticeIgnoreChange,
  NoticeIgnoreFormResult,
  NoticeIgnoreRule,
  NoticeIgnoreRulesResult,
  NoticeIgnoreScope,
} from "./forum-client/notice-ignore.js";
export type { NoticeIgnoreTarget } from "./forum-client/notice-links.js";
export type {
  NativeNoticeHandoff,
  NativeNoticePage,
  NativeNoticeResult,
  NoticeHandoff,
} from "./forum-client/native-notices.js";
export type { NativeNoticeEntry } from "./forum-client/notices.js";
export type {
  NoticeClientOptions,
  NoticeRequest,
  NoticeSession,
} from "./forum-client/notice-transport.js";

export { createMessageClient } from "./forum-client/message-client.js";
export type { PrivateMessageForm } from "./forum-client/message-client.js";
export type { HomepageMessageCheck, PrivateMessagePrompt } from "./forum-client/message-effects.js";

export { createSpaceClient } from "./forum-client/spaces/client.js";
export type {
  PreparedSpaceWrite,
  PrepareSpaceWrite,
  SpaceClient,
  SpaceClientOptions,
  SpaceCommand,
  SpaceEffect,
  SpaceEntry,
  SpaceMember,
  SpacePage,
  SpacePreparation,
  SpaceRead,
  SpaceRequest,
  SpaceView,
} from "./forum-client/spaces/client.js";

export { createCollectionClient } from "./forum-client/collection-client.js";
export type {
  CollectionAddDialog,
  CollectionClientOptions,
  CollectionComment,
  CollectionComments,
  CollectionCreate,
  CollectionDetail,
  CollectionFailure,
  CollectionList,
  CollectionListQuery,
  CollectionMetadata,
  CollectionOrder,
  CollectionRelation,
  CollectionRequest,
  CollectionSession,
  CollectionSummary,
  CollectionThread,
  CollectionWrite,
} from "./forum-client/collection-types.js";

export { createPostClient } from "./forum-client/posts/client.js";
export type {
  PostClientOptions,
  PostRequest,
  PostEditorTarget,
  PostEditorForm,
  PostInput,
  WrittenPost,
  PostOpenResult,
  PostWriteResult,
  PostVerification,
  PostVerificationCheck,
  PostVerificationPrompt,
} from "./forum-client/posts/client.js";

export { createSpecialThreadClient } from "./forum-client/special/client.js";
export type {
  SpecialThreadClientOptions,
  SpecialThreadRequest,
  SpecialActionForm,
  SpecialActivityInput,
  SpecialActionInput,
  SpecialActionPreparation,
  SpecialActionResult,
  SpecialActionTarget,
  SpecialThreadInput,
  SpecialThreadKind,
  SpecialThreadSettings,
  SpecialThreadWriteResult,
} from "./forum-client/special/client.js";

export { createTradeClient } from "./forum-client/trades/client.js";
export type {
  TradeClientOptions, TradeFailure, PaidThread, PaidThreadRead, PaidThreadTerms,
  PaidThreadForm, PaidThreadPreparation, PaidThreadConfirmation, TradeHandoff,
  TradeItemTarget, TradeGoods, TradeGoodsRead, TradeRecipientField, TradeOrderTerms,
  TradeOrderForm, TradeOrderInput, TradeOrderReference, TradeOrderPreparation,
  TradeOrderCreation, TradeOrder, TradeOrderRead, TradePaymentForm,
  TradePaymentInput, TradePaymentPreparation, TradePaymentResult,
} from "./forum-client/trades/client.js";
export { createTaskMagicClient } from "./forum-client/tasks/client.js";
export type {
  ForumTaskListResult, ForumTaskDetailResult, ForumTaskParticipantsResult,
  ForumTaskPreparation, ForumTaskEffectResult, ForumTask, ForumTaskTab,
  ForumTaskAction, ForumTaskOutcome, ForumTaskParticipant, PreparedForumTaskAction,
  TaskMagicClient, TaskMagicClientOptions, TaskMagicFailure, TaskMagicHandoff,
  MagicCapacity, MagicItem, MagicShopItem, MagicInventoryItem, MagicPage,
  MagicShopResult, MagicInventoryResult, MagicLogDirection, MagicLogEntry,
  MagicLogResult, MagicOperation, MagicField, MagicPurchaseTerms, PreparedMagicForm,
  MagicPreparation, MagicEffectResult,
} from "./forum-client/tasks/types.js";

export { createAwardsClient } from "./forum-client/awards/client.js";
export type {
  AwardLookup,
  AwardsCatalogue,
  AwardsChoice,
  AwardsClientOptions,
  AwardsFailure,
  AwardsForm,
  AwardsHandoff,
  AwardsPreparation,
  AwardsQuery,
  AwardsRecord,
  AwardsResult,
  AwardsValue,
  AwardsView,
  MedalThreadQuery,
} from "./forum-client/awards/types.js";

export { createBatchRatingClient } from "./forum-client/batch-ratings/client.js";
export type {
  BatchRatingAccess, BatchRatingAntispam, BatchRatingClient,
  BatchRatingClientOptions, BatchRatingCreation, BatchRatingCredit,
  BatchRatingDiscovery, BatchRatingEffect, BatchRatingFailure,
  BatchRatingIssue, BatchRatingItem, BatchRatingLimits, BatchRatingList,
  BatchRatingMode, BatchRatingPage, BatchRatingPreview, BatchRatingPreviewResult,
  BatchRatingQuota, BatchRatingRead, BatchRatingRecord, BatchRatingRequest,
  BatchRatingScope, BatchRatingSelection, BatchRatingSettings,
  BatchRatingStepResult, BatchRatingUncertain,
} from "./forum-client/batch-ratings/types.js";

export { createPacketClient } from "./forum-client/packets/client.js";
export type {
  AwardDetails,
  AwardRecord,
  DailyPacket,
  DailyPacketResult,
  OpenPacket,
  PacketClientOptions,
  PacketFailure,
  PacketForm,
  PacketHandoff,
  PacketOpenResult,
  PacketOperation,
  PacketPreparation,
  PacketRecord,
  PacketRecords,
  PacketRequest,
  PacketResult,
  PacketState,
  ThreadPacket,
} from "./forum-client/packets/types.js";

export { createBankClient } from "./forum-client/bank/client.js";
export type {
  BankBlock, BankBrowserHandoff, BankClient, BankClientOptions,
  BankConfirmationResult, BankDirectoryResult, BankEffectResult, BankFailure,
  BankField, BankForm, BankInput, BankLogEntry, BankLogQuery, BankLogsResult,
  BankOperation, BankService, BankServicePage, BankServiceResult, BankValues,
  BankWithdrawal, ForumBank,
} from "./forum-client/bank/types.js";

export { createPokemonClient, type PokemonClient } from "./forum-client/pokemon/client.js";
export type {
  PokemonAccount,
  PokemonBadge,
  PokemonBootstrapResult,
  PokemonClientOptions,
  PokemonConfig,
  PokemonData,
  PokemonEquipment,
  PokemonEvolution,
  PokemonFailure,
  PokemonHeal,
  PokemonInventory,
  PokemonPet,
  PokemonPetDetail,
  PokemonProfile,
  PokemonRequest,
  PokemonResult,
  PokemonSession,
  PokemonSkills,
  PokemonTransport,
  PokemonValue,
  PokemonBattleItemResult,
  PokemonBattleScene,
  PokemonBattleSkillSelection,
  PokemonGameRow,
  PokemonShopItemPurchase,
  PokemonShopPage,
  PokemonShopPetPurchase,
  PokemonShopPetsPage,
} from "./forum-client/pokemon/types.js";
export { createModerationClient } from "./forum-client/moderation/client.js";
export type {
  ModerationChoice,
  ModerationClientOptions,
  ModerationEffect,
  ModerationFailure,
  ModerationField,
  ModerationForm,
  ModerationOperation,
  ModerationPostTarget,
  ModerationPreparation,
  ModerationTarget,
  ModerationValues,
  PosterIpResult,
} from "./forum-client/moderation/types.js";

export { createModeratorPanelClient } from "./forum-client/moderator-panel/client.js";
export type {
  ModeratorDashboard,
  ModeratorDashboardResult,
  ModeratorPanelClient,
  ModeratorPanelLoginForm,
  ModeratorPanelOptions,
  ModeratorQueueAction,
  ModeratorQueueItem,
  ModeratorQueueKind,
  ModeratorQueueOutcome,
  ModeratorQueuePage,
  ModeratorQueueResult,
  ModeratorRecycleBinKind,
  ModeratorRecycleBinPage,
  ModeratorRecycleItem,
  ModeratorRecycleMode,
  ModeratorRecycleResult,
  ModeratorReportDecision,
  ModeratorReportDeletionHandoff,
  ModeratorReportItem,
  ModeratorReportResolution,
  ModeratorReportsPage,
  ModeratorReportsResult,
  ModeratorSearchItem,
  ModeratorSearchKind,
  ModeratorSearchPage,
  ModeratorSearchResult,
  PanelFailure,
  PanelSelectionOutcome,
} from "./forum-client/moderator-panel/types.js";
export { createAdminClient } from "./forum-client/admin/client.js";
export type {
  AdminAccess, AdminAction, AdminBan, AdminBanAcknowledged, AdminBanChange,
  AdminCleanup, AdminCleanupCheckpoint, AdminCleanupEffect, AdminClientOptions,
  AdminCredentials, AdminCreditAdjustment, AdminCreditLookup, AdminCreditMember,
  AdminCredits, AdminCreditsAdjusted, AdminCreditType, AdminCrime, AdminDuplicate,
  AdminExtendedGroup, AdminFailure, AdminGroup, AdminGroupAcknowledged,
  AdminGroupChange, AdminGroupChoice, AdminGroupExpiry, AdminLoginState,
  AdminMember, AdminMemberLookup, AdminMemberState, AdminReport,
  AdminReportDecision, AdminReportEffect, AdminReportResolution, AdminReportReward,
  AdminReports, AdminReportScope, AdminRequest, AdminSessionResult, AdminWriteIntent,
} from "./forum-client/admin/types.js";

export type {
  ModeratorSettings,
  PanelAccessPage,
  PanelAccessRead,
  PanelAccessRight,
  PanelAnnouncementDraft,
  PanelAnnouncementForm,
  PanelAnnouncementItem,
  PanelAnnouncementRead,
  PanelAnnouncementsPage,
  PanelAnnouncementsRead,
  PanelBanChoice,
  PanelForumRulesPage,
  PanelForumRulesRead,
  PanelIpBanPage,
  PanelIpBanRead,
  PanelLogEntry,
  PanelLogPage,
  PanelLogRead,
  PanelMemberEdit,
  PanelMemberMode,
  PanelMemberPage,
  PanelMemberQuery,
  PanelMemberRead,
  PanelNewNote,
  PanelNote,
  PanelNotesPage,
  PanelNotesRead,
  PanelRecommendation,
  PanelRecommendationChange,
  PanelRecommendationEdit,
  PanelRecommendationsPage,
  PanelRecommendationsRead,
  PanelSettingOperation,
  PanelSettingOutcome,
  SettingsRead,
} from "./forum-client/moderator-panel/settings-types.js";
