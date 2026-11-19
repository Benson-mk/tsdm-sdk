import { createPostEditorClient } from "./editor-client.js";
import type {
  NoticeClientOptions,
  NoticeRequest,
} from "../notice-transport.js";
import type {
  ReplyVerification,
  ReplyVerificationCheck,
  ReplyVerificationPrompt,
} from "../reply-verification.js";

export type PostVerification = ReplyVerification;
export type PostVerificationPrompt = ReplyVerificationPrompt;
export type PostVerificationCheck = ReplyVerificationCheck;
export type PostRequest = NoticeRequest & { readonly referer?: string };
export interface PostClientOptions extends Omit<
  NoticeClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: PostRequest,
    ): Promise<
      Awaited<ReturnType<NoticeClientOptions["transport"]["request"]>> & {
        location?: string;
      }
    >;
  };
}
export type PostEditorTarget =
  | { kind: "new-thread"; boardId: string }
  | {
      kind: "edit-first" | "edit-reply" | "draft";
      boardId: string;
      threadId: string;
      postId: string;
    };
export interface PostEditorForm {
  readonly target: Readonly<PostEditorTarget>;
  readonly subject: string | null;
  readonly message: string;
  readonly canSaveDraft: boolean;
  readonly canPublishDraft: boolean;
  readonly canSchedule: boolean;
  readonly categories: readonly Readonly<{ id: string; label: string }>[];
  readonly verification: readonly PostVerification[];
}
export interface PostInput {
  message: string;
  subject?: string;
  intent?: "publish" | "save-draft" | "schedule";
  forumDate?: string;
  categoryId?: string;
  answers?: Partial<Record<PostVerification, string>>;
}
export interface WrittenPost {
  threadId: string;
  postId: string;
  url: string;
}
export type PostOpenResult =
  | { kind: "post-form"; form: PostEditorForm }
  | { kind: "browser-handoff"; destination: string }
  | {
      kind:
        | "invalid-input"
        | "invalid-response"
        | "refused"
        | "session-changed"
        | "network";
    };
export type PostWriteResult =
  | { kind: "published" | "edited" | "draft-saved"; post: WrittenPost }
  | { kind: "scheduled"; post: WrittenPost; forumDate: string }
  | { kind: "redisplayed"; destination: string }
  | { kind: "verification-required"; verification: readonly PostVerification[] }
  | {
      kind:
        | "invalid-input"
        | "refused"
        | "session-changed"
        | "uncertain"
        | "moderation"
        | "conflict"
        | "challenge-refused";
    };

export function createPostClient(options: PostClientOptions) {
  const client = createPostEditorClient<never>(options);
  return {
    ...client,
    submitPost: (form: PostEditorForm, input: PostInput) =>
      client.submitPost(form, input),
  };
}
