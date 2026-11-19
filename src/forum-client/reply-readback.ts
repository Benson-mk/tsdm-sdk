import { object } from "./notice-transport.js";
import type { NoticeHost } from "./notice-transport.js";
import { postPermalink } from "./post-permalink.js";
import { decodeWriting } from "./prepare-writing.js";
import { publicRead } from "./public-read.js";
import { bit, materialOptions, positive } from "./reply-forms.js";
import type {
  ReplyAttempt,
  ReplyCheck,
  ReplyClientOptions,
} from "./replies.js";
import { safeURL } from "./routes.js";
import { parseReadPayload } from "./structured-read.js";

export async function checkUncertainReply(
  host: NoticeHost,
  transport: ReplyClientOptions["transport"],
  attempt: ReplyAttempt,
  destination?: string,
): Promise<ReplyCheck> {
  const session = host.session();
  if (!session || session.memberId !== attempt.memberId)
    return { kind: "inconclusive", reason: "account" };
  if (
    !destination ||
    host.origin !== attempt.origin ||
    !positive(attempt.boardId) ||
    !positive(attempt.threadId)
  ) {
    return { kind: "inconclusive", reason: "exact-post" };
  }
  const candidate = safeURL(destination, host.origin + "/");
  const pid = positive(candidate?.searchParams.get("pid"));
  const postURL =
    candidate &&
    !candidate.hash &&
    pid &&
    postPermalink(
      candidate.href,
      `${host.origin}/forum.php?mod=viewthread&tid=${attempt.threadId}`,
      attempt.threadId,
      pid,
    );
  if (!postURL || !pid) return { kind: "inconclusive", reason: "exact-post" };
  let otherAccount = false;
  const read = await publicRead(
    postURL,
    host.origin,
    ["redirect"],
    async (url) => {
      if (otherAccount || !host.current(session))
        throw new Error("Reply check session changed.");
      const response = await transport.request(url, {
        method: "GET",
        fresh: true,
        session,
      });
      if (
        !host.current(session) ||
        safeURL(response.url)?.origin !== host.origin ||
        (response.redirect === "none" && response.url !== url)
      )
        throw new Error("Reply check response changed.");
      const viewer = parseReadPayload(response);
      if (
        viewer?.uid !== undefined &&
        positive(viewer.uid) !== session.memberId
      ) {
        otherAccount = true;
        throw new Error("The post was served to another member.");
      }
      return response;
    },
  );
  if (
    otherAccount ||
    !host.current(session) ||
    read.account.kind === "guest" ||
    (read.account.kind === "member" && read.account.id !== session.memberId)
  )
    return { kind: "inconclusive", reason: "account" };
  if (
    read.kind !== "thread" ||
    read.thread.id !== attempt.threadId ||
    read.thread.target !== pid ||
    (read.thread.parent &&
      safeURL(read.thread.parent.url)?.searchParams.get("fid") !==
        attempt.boardId)
  ) {
    return { kind: "inconclusive", reason: "exact-post" };
  }
  if (read.account.kind !== "member")
    return { kind: "inconclusive", reason: "account" };
  const posts = read.thread.posts.filter((post) => post.id === pid);
  if (posts.length !== 1 || posts[0]?.restriction)
    return { kind: "inconclusive", reason: "exact-post" };
  if (posts[0]?.authorId !== session.memberId)
    return { kind: "inconclusive", reason: "author" };
  const editURL = new URL("/forum.php", host.origin);
  for (const [name, value] of Object.entries({
    mod: "post",
    action: "edit",
    fid: attempt.boardId,
    tid: attempt.threadId,
    pid,
    tsdmapp: "json",
  }))
    editURL.searchParams.set(name, value);
  const result = await host.request(editURL.href, session);
  if (result.kind === "session-changed")
    return { kind: "inconclusive", reason: "account" };
  if (result.kind !== "response" || result.response.status !== 200)
    return { kind: "inconclusive", reason: "stored-evidence" };
  const data = parseReadPayload(result.response);
  let source: string, subject: string | null;
  let options: {
    name: string;
    checked: boolean;
    kind: string;
    value: string;
  }[];
  if (data?.type === "post" && data.schema === 16) {
    if (positive(data.uid) !== session.memberId)
      return { kind: "inconclusive", reason: "account" };
    const message = object(data.message),
      title = object(data.subject),
      savedOptions = materialOptions(data.options);
    if (
      data.ok !== 1 ||
      data.action !== "edit" ||
      data.first !== 0 ||
      positive(data.fid) !== attempt.boardId ||
      positive(data.tid) !== attempt.threadId ||
      positive(data.pid) !== pid ||
      !message ||
      message.json !== 0 ||
      typeof message.value !== "string" ||
      !title ||
      !bit(title.shown) ||
      typeof title.value !== "string" ||
      !savedOptions
    ) {
      return { kind: "inconclusive", reason: "stored-evidence" };
    }
    source = message.value;
    subject = title.shown === 1 ? title.value : null;
    options = savedOptions.map((option) => ({ ...option, kind: "checkbox" }));
  } else {
    if (data?.uid !== undefined && positive(data.uid) !== session.memberId)
      return { kind: "inconclusive", reason: "account" };
    const stored = decodeWriting(
      result.response,
      editURL.href,
      attempt.boardId,
      { threadId: attempt.threadId, postId: pid },
    );
    if (
      stored.account.kind === "guest" ||
      (stored.account.kind === "member" &&
        stored.account.id !== session.memberId)
    ) {
      return { kind: "inconclusive", reason: "account" };
    }
    if (stored.kind !== "prepared" || stored.account.kind !== "member")
      return { kind: "inconclusive", reason: "stored-evidence" };
    source = stored.prepared.source;
    subject =
      stored.prepared.titleAvailable === false ? null : stored.prepared.title;
    options = stored.prepared.options;
  }
  if (
    source !== attempt.source ||
    (attempt.subject !== null && subject !== attempt.subject)
  )
    return { kind: "inconclusive", reason: "content" };
  if (
    !object(attempt.options) ||
    Object.entries(attempt.options).some(([name, checked]) => {
      const matches = options.filter((option) => option.name === name);
      return (
        matches.length !== 1 ||
        matches[0]?.kind !== "checkbox" ||
        matches[0]?.checked !== checked ||
        (checked && matches[0]?.value !== "1")
      );
    })
  )
    return { kind: "inconclusive", reason: "options" };
  return { kind: "confirmed", postURL, attribution: "unresolved" };
}
