import { noticeHost, numericId, object } from "../notice-transport.js";
import {
  ajaxText,
  verificationFields,
  verificationImage,
  verificationURL,
  type VerificationField,
} from "../reply-verification.js";
import { nativeIdentity } from "../account-forms.js";
import { descendants, fragmentFrom, hasClass, type Node } from "../html.js";
import { decodeStructuredThread } from "../structured-thread.js";
import { writeOutcome } from "./results.js";
import {
  documentBody,
  memberOf,
  nativeEditor,
  nativeNeedsBrowser,
  nativeThread,
} from "./native.js";
import {
  editorURL,
  json,
  positive,
  specialEditor,
  query,
  structured,
  structuredEditor,
  safeFields,
  validText,
  type Editor,
  type Pair,
} from "./forms.js";

import type {
  PostClientOptions,
  PostEditorForm,
  PostEditorTarget,
  PostInput,
  PostOpenResult,
  PostVerification,
  PostVerificationCheck,
  PostVerificationPrompt,
  PostWriteResult,
} from "./client.js";

function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{3}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  )
    return false;
  const date = new Date(value.replace(" ", "T") + ":00Z");
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 16).replace("T", " ") === value
  );
}

export interface PostEditorExtension<T> {
  query: Record<string, string>;
  accepts(data: Record<string, unknown>, source: string): boolean;
  needsNative: boolean;
  prepare(
    data: Record<string, unknown>,
    native: Node | null,
    source: string,
  ): {
    fields: Pair[];
    edits(settings: T): Record<string, string | null> | null;
  } | null;
  matches(page: Record<string, unknown>, body: URLSearchParams): boolean;
}

export function createPostEditorClient<T>(
  options: PostClientOptions,
  extension?: PostEditorExtension<T>,
) {
  const host = noticeHost(options);
  type Session = NonNullable<ReturnType<typeof host.session>>;
  const forms = new WeakMap<
    PostEditorForm,
    {
      editor: Editor;
      session: Session;
      checks: VerificationField[];
      source: string;
      edits?: (settings: T) => Record<string, string | null> | null;
    }
  >();
  const checking = new WeakSet<PostEditorForm>();

  async function openPost(target: PostEditorTarget): Promise<PostOpenResult> {
    if (
      !target ||
      typeof target.boardId !== "string" ||
      !positive(target.boardId) ||
      (target.kind !== "new-thread" &&
        (!["edit-first", "edit-reply", "draft"].includes(target.kind) ||
          typeof target.threadId !== "string" ||
          !positive(target.threadId) ||
          typeof target.postId !== "string" ||
          !positive(target.postId)))
    )
      return { kind: "invalid-input" };
    const selected =
      target.kind === "new-thread"
        ? Object.freeze({ kind: target.kind, boardId: target.boardId })
        : Object.freeze({ ...target });
    const session = host.session();
    if (!session) return { kind: "refused" };
    const nativeSource = editorURL(host.origin, selected);
    const source = extension
      ? query(nativeSource, extension.query)
      : nativeSource;
    const response = await host.request(structured(source), session);
    if (response.kind !== "response") return response;
    const { status, body } = response.response;
    if ([401, 403, 429].includes(status)) return { kind: "refused" };
    if (status !== 200) return { kind: "invalid-response" };
    const handoff = { kind: "browser-handoff", destination: source } as const;
    const data = json(body);
    if (data?.uid !== undefined && numericId(data.uid) !== session.memberId)
      return { kind: "session-changed" };
    if (
      data?.ok === 0 &&
      !["action", "off", "unknown"].includes(String(data.error))
    )
      return { kind: "refused" };
    const isStructured = data?.type === "post" && data.schema === 16;
    let doc = documentBody(body, data);
    let editor: Editor | null;
    let checks: VerificationField[] = [];
    let edits:
      ((settings: T) => Record<string, string | null> | null) | undefined;
    if (isStructured) {
      if (data.ok !== 1 || numericId(data.uid) !== session.memberId)
        return { kind: "invalid-response" };
      const fields = verificationFields(data.seccheck);
      if (
        (extension ? !extension.accepts(data, source) : specialEditor(data)) ||
        !fields ||
        (Array.isArray(data.unsupported) &&
          data.unsupported.includes("seccheck") &&
          !fields.length)
      )
        return handoff;
      checks = fields;
      editor = structuredEditor(data, source, selected);
      if (editor && (editor.hooks.length || extension?.needsNative)) {
        const native = await host.request(source, session);
        if (native.kind !== "response") return native;
        doc =
          native.response.status === 200
            ? documentBody(native.response.body, null)
            : null;
        if (!doc) return handoff;
        const viewer = extension
          ? nativeIdentity(native.response.body, new URL(source))
          : memberOf(doc, source);
        if (viewer !== session.memberId) return handoff;
      }
      if (editor?.hooks.length && doc) {
        const supplement = nativeEditor(doc, source, selected);
        if (!supplement) return handoff;
        const fieldNames = new Set(editor.fields.map(([name]) => name));
        const hooks = new Set(editor.hooks);
        if (
          editor.hooks.some(
            (name) =>
              fieldNames.has(name) ||
              /^(?:subject|message|save|cronpublish|cronpublishdate|delete|fid|tid|pid|special|sortid|seccode|secqaa)/.test(
                name,
              ) ||
              !supplement.fields.some(([field]) => field === name),
          )
        )
          return handoff;
        editor.fields.push(
          ...supplement.fields.filter(([name]) => hooks.has(name)),
        );
      }
      if (extension && editor) {
        const special = extension.prepare(data, doc, source);
        if (!special) return handoff;
        if (
          special.fields.some(
            ([name, value]) =>
              (name === "fid" && value !== selected.boardId) ||
              /^(?:mod|action|tid|pid|special|specialextra|sortid|formhash|topicsubmit|editsubmit|save|cronpublish|delete)(?:$|\[)/i.test(
                name,
              ),
          )
        )
          return handoff;
        editor.fields.push(...special.fields);
        if (!safeFields(editor.fields)) return handoff;
        edits = special.edits;
      }
    } else {
      if (extension) return handoff;
      if (!doc) {
        const native = await host.request(source, session);
        if (native.kind !== "response") return native;
        doc =
          native.response.status === 200
            ? documentBody(native.response.body, null)
            : null;
      }
      if (!doc || nativeNeedsBrowser(doc) || selected.kind === "draft")
        return handoff;
      if (memberOf(doc, source) !== session.memberId)
        return { kind: "session-changed" };
      editor = nativeEditor(doc, source, selected);
    }
    if (
      !editor ||
      editor.first !== (selected.kind !== "edit-reply") ||
      editor.isDraft !== (selected.kind === "draft")
    )
      return { kind: "invalid-response" };
    if (
      editor.scheduledDate !== undefined ||
      (editor.categoryRequired && !editor.categories.length)
    )
      return handoff;
    const form = Object.freeze({
      target: selected,
      subject: editor.subject?.value ?? null,
      message: editor.message.value,
      canSaveDraft: !extension && editor.canSave,
      canPublishDraft: editor.canPublish,
      canSchedule:
        !extension &&
        selected.kind === "new-thread" &&
        editor.scheduleValue !== undefined,
      categories: Object.freeze(
        editor.categories.map((category) => Object.freeze(category)),
      ),
      verification: Object.freeze(checks.map(({ kind }) => kind)),
    });
    forms.set(form, {
      editor,
      session,
      checks,
      source,
      ...(edits && { edits }),
    });
    return { kind: "post-form", form };
  }

  async function verificationResponse(
    form: PostEditorForm,
    kind: PostVerification,
    answer?: string,
  ) {
    const record = forms.get(form);
    const field = record?.checks.find((field) => field.kind === kind);
    if (
      !record ||
      !field ||
      checking.has(form) ||
      !host.current(record.session)
    )
      return null;
    const url = verificationURL(host.origin, field, answer);
    checking.add(form);
    try {
      const response = await options.transport.request(url, {
        method: "GET",
        fresh: true,
        session: record.session,
        referer: record.source,
      });
      if (
        !host.current(record.session) ||
        response.redirect !== "none" ||
        response.url !== url ||
        response.status !== 200
      )
        return null;
      return { body: response.body, record, field };
    } catch {
      return null;
    } finally {
      checking.delete(form);
    }
  }

  async function refreshPostVerification(
    form: PostEditorForm,
    kind: PostVerification,
  ): Promise<PostVerificationPrompt> {
    const result = await verificationResponse(form, kind);
    if (!result) return { kind: "unavailable" };
    const { record, body, field } = result;
    if (kind === "question") {
      const text = /^\s*(?:<\?xml[^?]*\?>\s*)?<root>\s*<!\[CDATA\[/.test(body)
        ? ajaxText(body)
        : "";
      if (text) return { kind, text };
    } else {
      const destination = verificationImage(body, host.origin, field);
      if (destination)
        return {
          kind,
          destination,
          referer: record.source,
          session: record.session,
        };
    }
    return {
      kind: "browser-handoff",
      destination: record.source,
      message: "Complete verification in the forum editor.",
    };
  }

  async function checkPostVerification(
    form: PostEditorForm,
    kind: PostVerification,
    answer: string,
  ): Promise<PostVerificationCheck> {
    const value = typeof answer === "string" && answer.trim();
    const response =
      value &&
      value.length <= 256 &&
      (await verificationResponse(form, kind, value));
    const result = response && ajaxText(response.body);
    return {
      kind:
        result === "succeed"
          ? "accepted"
          : result === "invalid"
            ? "rejected"
            : "inconclusive",
    };
  }

  async function submitPost(
    form: PostEditorForm,
    input: PostInput,
    settings?: T,
  ): Promise<PostWriteResult> {
    const record = forms.get(form);
    if (!record || !input || checking.has(form))
      return { kind: "invalid-input" };
    let { editor } = record;
    const { session } = record;
    if (!host.current(session)) return { kind: "session-changed" };
    const subject = input.subject ?? editor.subject?.value;
    const message = input.message;
    if (
      !validText(message, editor.message) ||
      (editor.subject
        ? !validText(subject, editor.subject, true)
        : input.subject !== undefined)
    )
      return { kind: "invalid-input" };
    const target = form.target;
    const { forumDate, categoryId } = input;
    const selectedCategory =
      categoryId ?? new URLSearchParams(editor.fields).get("typeid");
    if (
      (categoryId !== undefined || (editor.categoryRequired && editor.first)) &&
      !editor.categories.some(({ id }) => id === selectedCategory)
    )
      return { kind: "invalid-input" };
    const writtenAnswers: [string, string][] = [];
    for (const field of record.checks) {
      const raw = input.answers?.[field.kind];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value || value.length > 256 || /[\r\n\0]/.test(value))
        return {
          kind: "verification-required",
          verification: form.verification,
        };
      if (field.kind === "image")
        writtenAnswers.push(
          ["seccodehash", field.hash],
          ["seccodemodid", field.modid!],
          ["seccodeverify", value],
        );
      else
        writtenAnswers.push(["secqaahash", field.hash], ["secanswer", value]);
    }
    const intent =
      input.intent ?? (target.kind !== "draft" ? "publish" : undefined);
    if (
      (intent !== "publish" &&
        intent !== "save-draft" &&
        intent !== "schedule") ||
      (intent === "publish" && target.kind === "draft" && !editor.canPublish) ||
      (intent === "save-draft" &&
        (!editor.canSave ||
          (target.kind !== "new-thread" && target.kind !== "draft"))) ||
      (intent === "schedule" && (!form.canSchedule || !validDate(forumDate))) ||
      (intent !== "schedule" && forumDate !== undefined)
    )
      return { kind: "invalid-input" };
    const changes = settings === undefined ? null : record.edits?.(settings);
    if (extension && !changes) return { kind: "invalid-input" };
    forms.delete(form);
    if (target.kind !== "new-thread") {
      const refreshed = await openPost(target);
      if (refreshed.kind !== "post-form")
        return { kind: host.current(session) ? "conflict" : "session-changed" };
      const refreshedRecord = forms.get(refreshed.form)!;
      const latest = refreshedRecord.editor;
      const baseline = (value: Editor) =>
        JSON.stringify({
          ...value,
          fields: value.fields.filter(
            ([name]) => name !== "formhash" && name !== "posttime",
          ),
        });
      if (!host.current(session)) return { kind: "session-changed" };
      if (
        baseline(latest) !== baseline(editor) ||
        JSON.stringify(refreshedRecord.checks) !== JSON.stringify(record.checks)
      )
        return { kind: "conflict" };
      editor = latest;
    }
    const body = new URLSearchParams(editor.fields);
    for (const [name, value] of Object.entries(changes ?? {})) {
      if (value === null) body.delete(name);
      else body.set(name, value);
    }
    if (categoryId !== undefined) body.set("typeid", categoryId);
    if (subject !== undefined) body.set("subject", subject);
    else if (editor.replySubject !== undefined)
      body.set("subject", editor.replySubject);
    body.set("message", message);
    if (intent === "save-draft") body.set("save", "1");
    if (intent === "schedule" && forumDate !== undefined) {
      body.set("cronpublish", editor.scheduleValue!);
      body.set("cronpublishdate", forumDate);
    }
    for (const [name, value] of writtenAnswers) body.set(name, value);
    let outcome;
    try {
      const response = await options.transport.request(editor.url, {
        method: "POST",
        fresh: true,
        body: body.toString(),
        session,
      });
      if (
        !host.current(session) ||
        response.redirect !== "none" ||
        response.url !== editor.url
      )
        return { kind: "uncertain" };
      outcome = writeOutcome(response, editor.url, session.memberId);
    } catch {
      return { kind: "uncertain" };
    }
    if (outcome.kind === "redisplayed")
      return {
        kind: outcome.kind,
        destination: record.source,
      };
    if (outcome.kind !== "candidate") return { kind: outcome.kind };
    const { destination: location, threadId } = outcome;
    const queryPost = location.searchParams.get("pid");
    const anchorPost = /^#pid([1-9]\d*)$/.exec(location.hash)?.[1];
    const receiptPost = queryPost ?? anchorPost;
    if (
      (target.kind !== "new-thread" && target.threadId !== threadId) ||
      (queryPost !== null && !positive(queryPost)) ||
      (location.hash.startsWith("#pid") && !anchorPost) ||
      (queryPost && anchorPost && queryPost !== anchorPost) ||
      (target.kind !== "new-thread" &&
        receiptPost &&
        receiptPost !== target.postId)
    )
      return { kind: "uncertain" };
    let threadURL = `${host.origin}/forum.php?mod=viewthread&tid=${threadId}`;
    const resultPage =
      positive(location.searchParams.get("page")) ?? positive(body.get("page"));
    if (resultPage && resultPage !== "1")
      threadURL = query(threadURL, { page: resultPage });
    const read = await host.request(structured(threadURL), session);
    if (read.kind !== "response" || read.response.status !== 200)
      return { kind: "uncertain" };
    const data = json(read.response.body);
    if (
      data?.login === 1 ||
      (data?.uid !== undefined && numericId(data.uid) !== session.memberId)
    )
      return { kind: "uncertain" };
    const page = decodeStructuredThread(data);
    let postId: string | null;
    let isDraft: boolean;
    let readEditor: "structured" | "native" | null = null;
    if (page) {
      const thread = object(page.thread);
      if (
        numericId(page.uid) !== session.memberId ||
        positive(thread?.tid) !== threadId ||
        positive(thread?.fid) !== target.boardId
      )
        return { kind: "uncertain" };
      if (extension && !extension.matches(page, body))
        return { kind: "uncertain" };
      if (thread?.displayorder === -2) return { kind: "moderation" };
      isDraft = thread?.draft === 1 && thread.displayorder === -4;
      if (
        !isDraft &&
        (thread?.draft !== 0 ||
          typeof thread.displayorder !== "number" ||
          thread.displayorder < 0)
      )
        return { kind: "uncertain" };
      const posts = Array.isArray(page.posts) ? page.posts.map(object) : [];
      const matching = posts.filter((post) =>
        target.kind === "edit-reply"
          ? positive(post?.pid) === target.postId
          : post?.first === 1,
      );
      const found = matching.length === 1 ? matching[0] : null;
      postId = positive(found?.pid);
      if (
        !found ||
        !postId ||
        (target.kind !== "new-thread" && postId !== target.postId) ||
        (receiptPost && receiptPost !== postId) ||
        posts.filter((post) => positive(post?.pid) === postId).length !== 1 ||
        found.first !== Number(editor.first) ||
        numericId(found.authorid) !== session.memberId ||
        (found.deleted != null && found.deleted !== 0) ||
        (editor.first &&
          (thread?.subject !== subject || object(thread?.pay)?.need_pay === 1)) ||
        (found.invisible !== 0 &&
          !(isDraft && (found.invisible === -4 || found.invisible === -3))) ||
        (typeof found.body_html === "string" &&
          descendants(fragmentFrom(found.body_html), (node) =>
            hasClass(node, "locked"),
          ).length)
      )
        return { kind: "uncertain" };
      const reason = found.message_reason;
      const missingSource = found.message == null;
      if (
        reason != null &&
        reason !== "" &&
        !(missingSource && (reason === "bbcodeoff" || reason === "html"))
      )
        return { kind: "uncertain" };
      if (missingSource) {
        const canEdit = object(found.can)?.edit;
        if (canEdit !== undefined && canEdit !== 1)
          return { kind: "uncertain" };
        readEditor = "structured";
      } else if (found.message !== message) return { kind: "uncertain" };
    } else {
      if (extension || data?.type === "thread") return { kind: "uncertain" };
      const unsupported =
        data?.ok === 0 &&
        ["off", "action", "unknown"].includes(String(data.error));
      if (data?.ok === 0 && !unsupported) return { kind: "uncertain" };
      let doc = documentBody(read.response.body, data);
      if (!doc && unsupported) {
        const native = await host.request(threadURL, session);
        if (native.kind === "response" && native.response.status === 200)
          doc = documentBody(native.response.body, null);
      }
      const observed =
        doc && nativeThread(doc, threadURL, threadId, session.memberId, target);
      if (!observed || (editor.first && observed.subject !== subject))
        return { kind: "uncertain" };
      if (observed.moderated) return { kind: "moderation" };
      isDraft = observed.draft;
      postId = observed.postId;
      if (receiptPost && receiptPost !== postId) return { kind: "uncertain" };
      readEditor = "native";
    }
    const scheduled = isDraft && intent === "schedule" && forumDate !== undefined;
    if (readEditor || scheduled) {
      const selected = { boardId: target.boardId, threadId, postId };
      const source = editorURL(host.origin, selected);
      const structuredRead = readEditor === "structured" || scheduled;
      const result = await host.request(
        structuredRead ? structured(source) : source,
        session,
      );
      if (result.kind !== "response" || result.response.status !== 200)
        return { kind: "uncertain" };
      let stored: Editor | null;
      if (structuredRead) {
        const data = json(result.response.body);
        const messageFormat = object(data?.message)?.json;
        if (
          data?.ok !== 1 ||
          data.type !== "post" ||
          data.schema !== 16 ||
          data.login === 1 ||
          numericId(data.uid) !== session.memberId ||
          data.first !== Number(editor.first) ||
          (messageFormat != null && messageFormat !== 0)
        )
          return { kind: "uncertain" };
        stored = structuredEditor(data, source, selected);
      } else {
        const doc = documentBody(result.response.body, null);
        stored =
          doc && memberOf(doc, source) === session.memberId
            ? nativeEditor(doc, source, selected)
            : null;
      }
      if (
        !stored ||
        stored.first !== editor.first ||
        (structuredRead && stored.isDraft !== isDraft) ||
        (editor.first && stored.subject?.value !== subject) ||
        stored.message.value !== message ||
        (scheduled && stored.scheduledDate !== forumDate)
      )
        return { kind: "uncertain" };
    }
    const post = {
      threadId,
      postId,
      url: `${host.origin}/forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${postId}`,
    };
    if (isDraft) {
      if (intent === "save-draft") return { kind: "draft-saved", post };
      if (scheduled) return { kind: "scheduled", post, forumDate };
      return { kind: "uncertain" };
    }
    if (intent === "save-draft") return { kind: "uncertain" };
    return {
      kind:
        target.kind === "edit-first" || target.kind === "edit-reply"
          ? "edited"
          : "published",
      post,
    };
  }
  return {
    openPost,
    refreshPostVerification,
    checkPostVerification,
    submitPost,
  };
}
