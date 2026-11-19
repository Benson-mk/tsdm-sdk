import { createForumClient, editBaseline, unresolvedWritingAttachments, type ForumClient, type ReadResult, type SearchForm, type SearchCriteria, type AttachmentRequest, type PrepareWritingResult, type Account, type Notice, type Notices, type Messages, type PrivateConversation, type ThreadSubmission, type ThreadAttempt, type PublicationPreparationResult, type ThreadVerification, type PreparedWriting, type WritingBaseline, type DraftList, type DraftListResult, type DraftRow, type DraftAttempt, type UploadFile, type UploadCancellation, type UploadResult, type AttachmentRemovalResult } from '@tsdm/forum-client';
const client: ForumClient = createForumClient({ origin: 'https://fixture.example', transport: { async request(url) { return { status: 200, url, contentType: 'text/html', body: '' }; } } });
const result: ReadResult = await client.readThread('https://fixture.example/forum.php?mod=viewthread&tid=42');
const serialized: string = JSON.stringify(result);
const prepared: PrepareWritingResult = await client.prepareNewThread("5");
const references: string[] = unresolvedWritingAttachments({ source: "[attach]51[/attach]", uploadedReferences: [] });
void [prepared, references];
void serialized;
const search: (criteria: SearchCriteria, form: SearchForm, account: Account) => Promise<ReadResult> = client.search;
const returnedPage: (url: string, prior: Extract<ReadResult, { kind: 'search' }>['search'], account: Account) => Promise<ReadResult> = client.readSearchPage;
const attachment = (request: AttachmentRequest) => client.downloadAttachment(request);
const privateHistory: (url: string, prior?: PrivateConversation, account?: Account) => Promise<ReadResult> = client.readPrivateConversation;
const messages: (url: string, prior?: Messages, account?: Account) => Promise<ReadResult> = client.readMessages;
const notices: (url: string, prior?: Notices, account?: Account) => Promise<ReadResult> = client.readNotices;
const notice: Notice = { id: '73', time: '2026-10-20 21:40:00', body: [{ kind: 'text', text: 'Portable notice' }] };
const publication: (submission: ThreadSubmission) => Promise<PublicationPreparationResult> = client.prepareThreadPublication;
const publish: (attempt: ThreadAttempt) => Promise<ThreadAttempt> = client.publishThread;
const check: (attempt: ThreadAttempt, url?: string) => Promise<ThreadAttempt> = client.checkThreadResult;
const prepareEdit: (threadURL: string, postId: string) => Promise<PrepareWritingResult> = client.preparePostEdit;
const reviewEdit: (submission: ThreadSubmission) => Promise<PublicationPreparationResult> = client.prepareEditPublication;
const saveEdit: (attempt: ThreadAttempt) => Promise<ThreadAttempt> = client.savePostEdit;
const checkEdit: (attempt: ThreadAttempt) => Promise<ThreadAttempt> = client.checkEditResult;
const actions: Record<PreparedWriting["action"], string> = { "new-thread": "create", reply: "reply", "quick-quote": "quote", "edit-post": "edit" };
const baseline: (writing: PreparedWriting) => WritingBaseline = editBaseline;
void [search, returnedPage, attachment, privateHistory, messages, notices, notice, publication, publish, check, prepareEdit, reviewEdit, saveEdit, checkEdit, actions, baseline];
const verification: ThreadVerification = { stored: 'verified', normalizations: [{ name: 'price', submitted: '', stored: '0' }], creationEffects: [{ name: 'addfeed', requested: true, included: false, outcome: 'unknown' }] };
const evidence = (attempt: ThreadAttempt): ThreadVerification | undefined => attempt.result?.verification;
const attachmentVerification: ThreadVerification = { stored: 'verified', normalizations: [], attachmentNormalizations: [{ name: 'attachnew[88][price]', submitted: '', stored: '0' }], creationEffects: [] };
void [verification, attachmentVerification, evidence];
const drafts: Promise<DraftListResult> = client.readDrafts();
const resume = (row: DraftRow, account: Account) => client.resumeDraft(row, account);
const prepareSave = (attempt: DraftAttempt): Promise<DraftAttempt> => client.prepareDraftSave(attempt);
const draftRows = (list: DraftList) => list.rows;
void [drafts, resume, prepareSave, draftRows];
const cancellation: UploadCancellation = { aborted: false, addEventListener() {}, removeEventListener() {} };
const transfer: (writing: PreparedWriting, file: UploadFile, progress: (loaded: number) => void, signal: UploadCancellation) => Promise<UploadResult> = client.uploadAttachment;
const removal: (writing: PreparedWriting, id: string, checkOnly?: boolean) => Promise<AttachmentRemovalResult> = client.removeUploadedAttachment;
void [cancellation, transfer, removal];
import type * as Frontier from "@tsdm/forum-client";
import { createForumClient as createFrontierTypeClient } from "@tsdm/forum-client";
const frontierClient: Frontier.ForumClient = createFrontierTypeClient({
  origin: "https://fixture.example",
  transport: {
    async request(url) {
      return { status: 200, url, contentType: "text/html", body: "" };
    },
  },
});
const replyContract: (
  boardId: string,
  target: Frontier.ReplyTarget,
) => Promise<Frontier.PrepareWritingResult> = frontierClient.prepareReply;
const loadEditContract: (
  url: string,
  postId: string,
) => Promise<Frontier.PrepareWritingResult> = frontierClient.preparePostEdit;
const reviewEditContract: (
  submission: Frontier.ThreadSubmission,
) => Promise<Frontier.PublicationPreparationResult> =
  frontierClient.prepareEditPublication;
const saveEditContract: (
  attempt: Frontier.ThreadAttempt,
) => Promise<Frontier.ThreadAttempt> = frontierClient.savePostEdit;
const checkEditContract: (
  attempt: Frontier.ThreadAttempt,
) => Promise<Frontier.ThreadAttempt> = frontierClient.checkEditResult;
const prepareDraftContract: (
  attempt: Frontier.DraftAttempt,
) => Promise<Frontier.DraftAttempt> = frontierClient.prepareDraftSave;
const saveDraftContract: (
  attempt: Frontier.DraftAttempt,
) => Promise<Frontier.DraftAttempt> = frontierClient.saveDraft;
const publishDraftContract: (
  attempt: Frontier.DraftAttempt,
) => Promise<Frontier.DraftAttempt> = frontierClient.publishDraft;
const checkDraftContract: (
  attempt: Frontier.DraftAttempt,
  row?: Frontier.DraftRow,
) => Promise<Frontier.DraftAttempt> = frontierClient.checkDraft;
const prepareFavoriteContract: (
  intent: Frontier.FavoriteIntent,
  previousAttemptId?: string,
) => Promise<Frontier.FavoritePreparation> = frontierClient.prepareFavorite;
const changeFavoriteContract: (
  attempt: Frontier.FavoriteAttempt,
) => Promise<Frontier.FavoriteAttempt> = frontierClient.changeFavorite;
const checkFavoriteContract: (
  attempt: Frontier.FavoriteAttempt,
) => Promise<Frontier.FavoriteAttempt> = frontierClient.checkFavoriteResult;
void [
  replyContract,
  loadEditContract,
  reviewEditContract,
  saveEditContract,
  checkEditContract,
  prepareDraftContract,
  saveDraftContract,
  publishDraftContract,
  checkDraftContract,
  prepareFavoriteContract,
  changeFavoriteContract,
  checkFavoriteContract,
];

const packetPreparation: (
  boardId: string,
  redPacket?: boolean,
) => Promise<Frontier.PrepareWritingResult> = frontierClient.prepareNewThread;
const packetObservation: Frontier.RedPacketObservation = {
  state: "unknown",
  conditions: [],
  credit: "unknown",
  ledger: { state: "unavailable", rows: [] },
};
const fundedConsent: Pick<
  Frontier.DraftAttempt,
  "fundingReviewed" | "redPacket" | "observation"
> = {
  fundingReviewed: true,
  redPacket: packetObservation,
  observation: {
    state: "draft",
    content: "confirmed",
    attachments: "confirmed",
    packetMarker: true,
  },
};
void [packetPreparation, fundedConsent];

const legacyBoard: Frontier.Board = { id: "5", title: "Legacy", url: "https://fixture.example/forum.php?mod=forumdisplay&fid=5", boards: [], threads: [], filters: [], criteria: [], pages: { current: "1", links: [] }, empty: "" };
const sourceGroup: Frontier.BoardFilterGroup = { kind: "category", sourceId: "thread_types", sourceLabel: "原生分類:", links: [{ label: "Native choice", url: legacyBoard.url }] };
const groupedBoard: Frontier.Board = { ...legacyBoard, filterGroups: [sourceGroup] };
void [legacyBoard, groupedBoard];

const validationIssueContract: Frontier.WritingValidationIssue = { field: "option", name: "hb_total", code: "native-limit" };
const legacyPreparationFailure: Frontier.PublicationPreparationResult = { kind: "validation", message: "Legacy refusal", account: { kind: "unknown" }, generation: 0 };
const currentPreparationFailure: Frontier.PublicationPreparationResult = { ...legacyPreparationFailure, validation: { source: "local", issues: [validationIssueContract] }, accountVerified: false };
void currentPreparationFailure;

const privatePrepareContract: (destination:string, account:Frontier.Account)=>Promise<Frontier.PrivateWritingPreparation> = frontierClient.preparePrivateWriting;
const privateReviewContract: (submission:Frontier.PrivateSubmission)=>Promise<Frontier.PrivateReviewPreparation> = frontierClient.preparePrivateReview;
const privateSendContract: (review:Frontier.PrivateReview, attempt:Frontier.PrivateAttempt, retain:(pending:Frontier.PrivateAttempt)=>Promise<boolean>)=>Promise<Frontier.PrivateAttempt> = frontierClient.sendPrivateMessage;
const privateCheckContract: (attempt:Frontier.PrivateAttempt)=>Promise<Frontier.PrivateAttempt> = frontierClient.checkPrivateMessage;
void [privatePrepareContract,privateReviewContract,privateSendContract,privateCheckContract];

const legacyDirectoryGroup: Frontier.Directory["groups"][number] = { title: "Legacy", boards: [] };
const sourcedDirectoryGroup: Frontier.Directory["groups"][number] = { title: "Source", boards: [], sourceId: "category_11", sourceURL: "https://fixture.example/forum.php?gid=11" };
const optionalSourceId: string | undefined = legacyDirectoryGroup.sourceId;
const optionalSourceURL: string | undefined = sourcedDirectoryGroup.sourceURL;
void [optionalSourceId, optionalSourceURL];

import type { ReportTarget, ReportForm, ReportPreparation, ReportIntent, ReportResult } from '@tsdm/forum-client';
const prepareReport: (target: ReportTarget) => Promise<ReportPreparation> = client.prepareReport;
const submitReport: (form: ReportForm, intent: ReportIntent) => Promise<ReportResult> = client.submitReport;
const reportOutcomes: Record<ReportResult['kind'], string> = { rejected: 'refused', uncertain: 'unknown', 'not-sent': 'no request' };
void [prepareReport, submitReport, reportOutcomes];

import type { EffectGuard } from '@tsdm/forum-client';
const effectGuard: EffectGuard = { check: async () => true, current: () => true };
const guardedReply = (attempt: ThreadAttempt) => client.publishThread(attempt, effectGuard);
const guardedUpload = (writing: PreparedWriting, file: UploadFile) => client.uploadAttachment(writing, file, () => {}, cancellation, effectGuard);
const guardedRemoval = (writing: PreparedWriting, id: string) => client.removeUploadedAttachment(writing, id, false, effectGuard);
void [guardedReply, guardedUpload, guardedRemoval];

// Optional 0.26 read-only attachment proof preserves old structural clients.
const withoutAttachmentCheck: Omit<ForumClient, "checkReplyAttachments"> = client;
const legacyStructuralClient: ForumClient = withoutAttachmentCheck;
const replyAttachmentCheck = (writing: PreparedWriting): Promise<import("@tsdm/forum-client").ReplyAttachmentCheck> | undefined => client.checkReplyAttachments?.(writing);
const legacyUpload: import("@tsdm/forum-client").WritingUpload = { key: "legacy", name: "file.txt", type: "text/plain", size: 4, status: "uploaded", message: "", loaded: 4 };
const unknownOwnerUpload: import("@tsdm/forum-client").WritingUpload = { ...legacyUpload, ownerId: null };
const knownOwnerUpload: import("@tsdm/forum-client").WritingUpload = { ...legacyUpload, ownerId: "8" };
void [legacyStructuralClient, replyAttachmentCheck, unknownOwnerUpload, knownOwnerUpload];
