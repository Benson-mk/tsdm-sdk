import { createPostEditorClient } from "../posts/editor-client.js";
import {
  type PostClientOptions,
  type PostEditorForm,
  type PostInput,
  type PostOpenResult,
  type PostVerification,
  type PostWriteResult,
  type WrittenPost,
} from "../posts/client.js";
import {
  createSpecialParticipation,
  type SpecialThreadClientOptions,
} from "./participation.js";
export type {
  SpecialThreadClientOptions,
  SpecialThreadRequest,
  SpecialActionForm,
  SpecialActivityInput,
  SpecialActionInput,
  SpecialActionPreparation,
  SpecialActionResult,
  SpecialActionTarget,
} from "./participation.js";
import { specialEditorExtension } from "./creation.js";
import type { SpecialThreadKind, SpecialThreadSettings } from "./types.js";

export type { SpecialThreadKind, SpecialThreadSettings } from "./types.js";
export type SpecialThreadInput = Omit<PostInput, "intent" | "forumDate"> & {
  settings: SpecialThreadSettings;
};
export type SpecialThreadWriteResult =
  | Exclude<PostWriteResult, { post: WrittenPost }>
  | { kind: "created"; threadType: SpecialThreadKind; post: WrittenPost };

export function createSpecialThreadClient(options: SpecialThreadClientOptions) {
  const editorOptions: PostClientOptions = {
    ...options,
    transport: {
      request: (url, request) =>
        options.transport.request(url, {
          ...request,
          effect: request.method === "POST",
        }),
    },
  };
  const clients = {
    poll: createPostEditorClient(editorOptions, specialEditorExtension("poll")),
    bounty: createPostEditorClient(
      editorOptions,
      specialEditorExtension("bounty"),
    ),
    activity: createPostEditorClient(
      editorOptions,
      specialEditorExtension("activity"),
    ),
    debate: createPostEditorClient(
      editorOptions,
      specialEditorExtension("debate"),
    ),
    "red-packet": createPostEditorClient(
      editorOptions,
      specialEditorExtension("red-packet"),
    ),
  };
  const forms = new WeakMap<PostEditorForm, SpecialThreadKind>();
  async function openSpecialThread(
    boardId: string,
    threadType: SpecialThreadKind,
  ): Promise<PostOpenResult> {
    if (!Object.hasOwn(clients, threadType)) return { kind: "invalid-input" };
    const result = await clients[threadType].openPost({
      kind: "new-thread",
      boardId,
    });
    if (result.kind === "post-form") forms.set(result.form, threadType);
    return result;
  }
  async function createSpecialThread(
    form: PostEditorForm,
    input: SpecialThreadInput,
  ): Promise<SpecialThreadWriteResult> {
    const threadType = forms.get(form);
    if (!threadType || input?.settings?.kind !== threadType)
      return { kind: "invalid-input" };
    const { settings, ...writing } = input;
    const result = await clients[threadType].submitPost(
      form,
      writing,
      settings,
    );
    if (result.kind === "published")
      return { kind: "created", threadType, post: result.post };
    return "post" in result ? { kind: "uncertain" } : result;
  }
  async function refreshSpecialVerification(
    form: PostEditorForm,
    kind: PostVerification,
  ) {
    const threadType = forms.get(form);
    return threadType
      ? clients[threadType].refreshPostVerification(form, kind)
      : { kind: "unavailable" as const };
  }
  async function checkSpecialVerification(
    form: PostEditorForm,
    kind: PostVerification,
    answer: string,
  ) {
    const threadType = forms.get(form);
    return threadType
      ? clients[threadType].checkPostVerification(form, kind, answer)
      : { kind: "inconclusive" as const };
  }
  return {
    ...createSpecialParticipation(options, editorOptions),
    openSpecialThread,
    createSpecialThread,
    refreshSpecialVerification,
    checkSpecialVerification,
  };
}
