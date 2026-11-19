import {
  addQuery,
  nativeDocument,
  nativeForm,
  positive,
  replyTarget,
  structuredForm,
} from "./reply-forms.js";
import type { ReplyTarget } from "./reply-forms.js";
import { noticeHost, object } from "./notice-transport.js";
import type {
  NoticeClientOptions,
  NoticeRequest,
  NoticeSession,
} from "./notice-transport.js";
import {
  parseReadPayload,
  structuredFailure,
  readAccount,
} from "./structured-read.js";
import { safeURL } from "./routes.js";
import { attr, byId, descendants, hasClass, label } from "./html.js";
import { checkUncertainReply } from "./reply-readback.js";
import { postCallback } from "./post-response.js";
import { postPermalink } from "./post-permalink.js";

import {
  ajaxText,
  verificationImage,
  verificationURL,
} from "./reply-verification.js";
import type {
  ReplyVerification,
  ReplyVerificationCheck,
  ReplyVerificationPrompt,
} from "./reply-verification.js";

export type ReplyRequest = NoticeRequest & { readonly referer?: string };
export interface ReplyClientOptions extends Omit<
  NoticeClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: ReplyRequest,
    ): ReturnType<NoticeClientOptions["transport"]["request"]>;
  };
}
export type ReplyOptionName =
  | "usesig"
  | "htmlon"
  | "parseurloff"
  | "smileyoff"
  | "bbcodeoff"
  | "imgcontent";
export interface ReplyOption {
  readonly name: ReplyOptionName;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
}
export interface ReplyForm {
  readonly destination: string;
  readonly message: string;
  readonly subject: string | null;
  readonly quote: string;
  readonly verification: readonly ReplyVerification[];
  readonly options: readonly ReplyOption[];
}
export interface ReplyDraft {
  message: string;
  answers?: Partial<Record<ReplyVerification, string>>;
  subject?: string;
  options?: Partial<Record<ReplyOptionName, boolean>>;
}
export interface ReplyAttempt {
  readonly origin: string;
  readonly memberId: string;
  readonly boardId: string;
  readonly threadId: string;
  readonly source: string;
  readonly subject: string | null;
  readonly options: Readonly<Partial<Record<ReplyOptionName, boolean>>>;
}
export type ReplyCheck =
  | { kind: "confirmed"; postURL: string; attribution: "unresolved" }
  | {
      kind: "inconclusive";
      reason:
        | "account"
        | "exact-post"
        | "author"
        | "stored-evidence"
        | "content"
        | "options";
    };
export type ReplyPreparation =
  | { kind: "prepared"; form: ReplyForm }
  | { kind: "refused" | "unavailable"; message: string }
  | { kind: "browser-handoff"; destination: string; message: string };
export type ReplyPublication =
  | {
      kind: "verification-required";
      verification: readonly ReplyVerification[];
    }
  | { kind: "published"; postURL: string }
  | {
      kind: "moderation" | "redisplayed" | "refused" | "unavailable";
      message: string;
    }
  | { kind: "uncertain"; attempt: ReplyAttempt; postURL?: string }
  | { kind: "browser-handoff"; destination: string; message: string };

function permalink(origin: string, threadId: string, postId: string) {
  return `${origin}/forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${postId}`;
}
function acknowledgedPost(data: Record<string, unknown>, target: ReplyTarget) {
  const values = object(data.values);
  const url =
    typeof data.url === "string" && safeURL(data.url, target.url.href);
  const tid = target.threadId;
  const origin = target.url.origin;
  let linkedId: string | null = null;
  if (url) {
    const q = url.searchParams;
    if (url.origin !== origin || (q.has("tid") && q.get("tid") !== tid))
      return null;
    if (q.get("mod") === "redirect") {
      const pid = positive(q.get("pid"));
      if (
        pid &&
        postPermalink(
          url.href,
          `${origin}/forum.php?mod=viewthread&tid=${tid}`,
          tid,
          pid,
        )
      )
        linkedId = pid;
    } else if (
      url.pathname === "/forum.php" &&
      q.get("mod") === "viewthread" &&
      q.get("tid") === tid &&
      ["mod", "tid", "pid"].every((key) => q.getAll(key).length <= 1)
    ) {
      const pid = positive(q.get("pid"));
      const anchor = /^#pid([1-9]\d*)$/.exec(url.hash)?.[1];
      if (pid && anchor && pid !== anchor) return null;
      linkedId = pid ?? anchor ?? null;
    }
  }
  const fieldId = positive(values?.pid);
  if (values?.tid !== undefined && positive(values.tid) !== tid) return null;
  if (values?.fid !== undefined && positive(values.fid) !== target.boardId)
    return null;
  if (fieldId && linkedId && fieldId !== linkedId) return null;
  const pid = linkedId ?? (positive(values?.tid) === tid ? fieldId : null);
  return pid ? permalink(origin, tid, pid) : null;
}

export function createReplyClient(config: ReplyClientOptions) {
  const host = noticeHost(config);
  const forms = new WeakMap<
    ReplyForm,
    {
      decoded: NonNullable<ReturnType<typeof structuredForm>>;
      target: ReplyTarget;
      session: NoticeSession;
    }
  >();
  const updating = new WeakSet<ReplyForm>();
  async function prepareReply(destination: string): Promise<ReplyPreparation> {
    const target = replyTarget(destination, host.origin),
      session = host.session();
    if (!target || !session)
      return {
        kind: "unavailable",
        message: "A supported reply page and signed-in session are required.",
      };
    const result = await host.request(
      addQuery(target.url, "tsdmapp", "json").href,
      session,
    );
    if (result.kind !== "response")
      return {
        kind: "unavailable",
        message: "The reply form could not be read in this session.",
      };
    const data = parseReadPayload(result.response);
    const document = nativeDocument(
      typeof data?.document === "string" ? data.document : result.response.body,
    );
    if (
      byId(document, "challenge-form") ||
      byId(document, "cf-challenge-running") ||
      /Just a moment|Checking your browser|安全验证|驗證您的瀏覽器/i.test(
        label(descendants(document, (node) => node.tagName === "title")[0]),
      )
    ) {
      return {
        kind: "browser-handoff",
        destination: target.url.href,
        message: "Continue verification on the native reply page.",
      };
    }
    if (
      result.response.status !== 200 ||
      (data?.uid !== undefined && positive(data.uid) !== session.memberId)
    ) {
      return {
        kind: "refused",
        message: "The forum did not provide the form for the current member.",
      };
    }
    if (data && structuredFailure(data, result.response, readAccount(data))) {
      return { kind: "refused", message: "The forum refused the reply form." };
    }
    const structured = data?.type === "post" && data.schema === 16;
    let decoded =
      structured && positive(data.uid) === session.memberId
        ? structuredForm(data, target)
        : null;
    if (!structured) {
      decoded = nativeForm(result.response, target, session.memberId);
      if (!decoded && !byId(document, "messagetext")) {
        const native = await host.request(target.url.href, session);
        if (native.kind !== "response")
          return {
            kind: "unavailable",
            message: "The native reply form could not be read in this session.",
          };
        if (native.response.status === 200)
          decoded = nativeForm(native.response, target, session.memberId);
        if ([401, 429].includes(native.response.status))
          return {
            kind: "refused",
            message: "The forum refused the reply form.",
          };
      }
    }
    if (!decoded)
      return {
        kind: "browser-handoff",
        destination: target.url.href,
        message: "Open the native reply page to continue.",
      };
    const form: ReplyForm = Object.freeze({
      destination: target.url.href,
      message: decoded.message,
      subject: decoded.subject,
      quote: decoded.fields.noticetrimstr ?? "",
      verification: Object.freeze(
        decoded.verification.map((field) => field.kind),
      ),
      options: Object.freeze(
        decoded.options.map(({ value, ...option }) => Object.freeze(option)),
      ),
    });
    forms.set(form, { decoded, target, session });
    return { kind: "prepared", form };
  }
  async function verificationResponse(
    form: ReplyForm,
    kind: ReplyVerification,
    answer?: string,
  ) {
    const prepared = forms.get(form);
    const field = prepared?.decoded.verification.find(
      (item) => item.kind === kind,
    );
    if (
      !prepared ||
      !field ||
      updating.has(form) ||
      !host.current(prepared.session)
    )
      return null;
    const { session } = prepared;
    const url = verificationURL(host.origin, field, answer);
    updating.add(form);
    try {
      const response = await config.transport.request(url, {
        fresh: true,
        session,
        method: "GET",
        referer: form.destination,
      });
      if (
        !host.current(session) ||
        !forms.has(form) ||
        response.status !== 200 ||
        response.redirect !== "none" ||
        response.url !== url
      )
        return null;
      return { field, session, body: response.body };
    } catch {
      return null;
    } finally {
      updating.delete(form);
    }
  }
  async function refreshReplyVerification(
    form: ReplyForm,
    kind: ReplyVerification,
  ): Promise<ReplyVerificationPrompt> {
    const result = await verificationResponse(form, kind);
    if (!result) return { kind: "unavailable" };
    if (kind === "question") {
      const text = ajaxText(result.body);
      if (text) return { kind, text };
    } else {
      const destination = verificationImage(
        result.body,
        host.origin,
        result.field,
      );
      if (destination)
        return {
          kind,
          destination,
          referer: form.destination,
          session: result.session,
        };
    }
    return {
      kind: "browser-handoff",
      destination: form.destination,
      message: "Continue verification on the native reply page.",
    };
  }
  async function checkReplyVerification(
    form: ReplyForm,
    kind: ReplyVerification,
    answer: string,
  ): Promise<ReplyVerificationCheck> {
    const result =
      answer.trim() && (await verificationResponse(form, kind, answer.trim()));
    const text = result ? ajaxText(result.body) : "";
    return {
      kind:
        text === "succeed"
          ? "accepted"
          : text === "invalid"
            ? "rejected"
            : "inconclusive",
    };
  }
  async function publishReply(
    form: ReplyForm,
    draft: ReplyDraft,
  ): Promise<ReplyPublication> {
    const prepared = forms.get(form);
    if (
      !prepared ||
      updating.has(form) ||
      !host.current(prepared.session) ||
      !draft.message.trim() ||
      (form.subject === null && draft.subject !== undefined) ||
      Object.entries(draft.options ?? {}).some(
        ([name, checked]) =>
          typeof checked !== "boolean" ||
          !form.options.some(
            (option) => option.name === name && !option.disabled,
          ),
      )
    ) {
      return {
        kind: "unavailable",
        message:
          "An unused form for the current session and supported reply fields are required.",
      };
    }
    const { session, target, decoded } = prepared;
    if (
      decoded.verification.some((field) => !draft.answers?.[field.kind]?.trim())
    ) {
      return { kind: "verification-required", verification: form.verification };
    }
    const body = new URLSearchParams(decoded.fields);
    for (const field of decoded.verification) {
      const answer = draft.answers?.[field.kind]?.trim() ?? "";
      if (field.kind === "image") {
        body.set("seccodehash", field.hash);
        body.set("seccodemodid", field.modid);
        body.set("seccodeverify", answer);
      } else {
        body.set("secqaahash", field.hash);
        body.set("secanswer", answer);
      }
    }
    const options: Partial<Record<ReplyOptionName, boolean>> = {};
    for (const option of decoded.options) {
      if (option.disabled) {
        if (Object.hasOwn(decoded.fields, option.name))
          options[option.name] = option.checked;
        continue;
      }
      const checked = draft.options?.[option.name] ?? option.checked;
      options[option.name] = checked;
      if (checked) body.set(option.name, option.value);
      else body.delete(option.name);
    }
    const subject = draft.subject ?? form.subject;
    if (subject !== null) body.set("subject", subject);
    body.set("message", draft.message);
    const attempt: ReplyAttempt = Object.freeze({
      origin: host.origin,
      memberId: session.memberId,
      boardId: target.boardId,
      threadId: target.threadId,
      subject,
      source: form.quote ? `${form.quote}\n${draft.message}` : draft.message,
      options: Object.freeze(options),
    });
    const url = addQuery(
      addQuery(decoded.action, "inajax", "1"),
      "tsdmapp",
      "json",
    );
    forms.delete(form);
    const result = await host.request(url.href, session, body.toString());
    if (result.kind !== "response" || result.response.status !== 200)
      return { kind: "uncertain", attempt };
    const data = parseReadPayload(result.response);
    if (!data) {
      const handler = decoded.fields.handlekey;
      const callback =
        handler === "reply" || handler === "fastpost"
          ? postCallback(result.response, handler)
          : null;
      if (callback) {
        const message = callback.values[callback.success ? 1 : 0] ?? "";
        if (!callback.success) return { kind: "refused", message };
        if (callback.fields.reply_mod === "1")
          return { kind: "moderation", message };
        const postURL = acknowledgedPost(
          { url: callback.values[0], values: callback.fields },
          target,
        );
        return postURL
          ? { kind: "published", postURL }
          : { kind: "uncertain", attempt };
      }
      const doc = nativeDocument(result.response.body);
      if (
        descendants(
          doc,
          (node) => node.tagName === "form" && attr(node, "id") === "postform",
        ).length === 1
      ) {
        return {
          kind: "redisplayed",
          message: "The forum redisplayed the reply form.",
        };
      }
      const refusal = descendants(doc, (node) =>
        hasClass(node, "alert_error"),
      )[0];
      if (refusal) return { kind: "refused", message: label(refusal) };
      return { kind: "uncertain", attempt };
    }
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      positive(data.uid) !== session.memberId
    )
      return { kind: "uncertain", attempt };
    const message =
      typeof data.message === "string"
        ? data.message
        : "The forum returned a reply result.";
    if (
      data.login !== 1 &&
      ["handle", "redirect", "message"].includes(String(data.kind)) &&
      (data.message_key === "post_reply_mod_succeed" ||
        (data.ok === 1 && object(data.values)?.reply_mod === "1"))
    ) {
      return { kind: "moderation", message };
    }
    if (
      data.message_key === "submit_seccode_invalid" ||
      data.message_key === "submit_secqaa_invalid"
    ) {
      return {
        kind: "browser-handoff",
        destination: form.destination,
        message,
      };
    }
    if (data.kind === "page") return { kind: "redisplayed", message };
    if (
      data.login === 1 ||
      (data.ok === 0 &&
        ["handle", "message"].includes(String(data.kind)) &&
        (data.alert === "error" || data.message_key === "post_flood_ctrl"))
    ) {
      return { kind: "refused", message };
    }
    const postURL = acknowledgedPost(data, target);
    if (
      data.ok === 1 &&
      ["handle", "redirect", "message"].includes(String(data.kind)) &&
      data.message_key === "post_reply_succeed" &&
      postURL
    )
      return { kind: "published", postURL };
    return postURL
      ? { kind: "uncertain", attempt, postURL }
      : { kind: "uncertain", attempt };
  }

  return {
    prepareReply,
    publishReply,
    refreshReplyVerification,
    checkReplyVerification,
    checkUncertainReply(
      attempt: ReplyAttempt,
      destination?: string,
    ): Promise<ReplyCheck> {
      return checkUncertainReply(host, config.transport, attempt, destination);
    },
  };
}
