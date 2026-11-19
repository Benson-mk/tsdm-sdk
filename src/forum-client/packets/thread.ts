import { nativeIdentity } from "../account-forms.js";
import { forumURL, urlAt } from "../credits/protocol.js";
import { attr, descendants, documentFrom, hasClass } from "../html.js";
import {
  numericId,
  object,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import { structured } from "../posts/forms.js";
import {
  amount,
  count,
  hash,
  no,
  packetURL,
  positiveId,
  readPacketReply,
  textValue,
  yes,
} from "./protocol.js";
import type {
  PacketOpenResult,
  PacketFailure,
  PacketHandoff,
  PacketState,
  ThreadPacket,
} from "./types.js";

type Data = Record<string, unknown>;
export interface PacketAction {
  url: URL;
  fields?: Record<string, string>;
  mode: "structured" | "legacy" | "daily" | "award";
}

const states = new Set<PacketState>([
  "open",
  "claimed",
  "done",
  "withdrawn",
  "expired",
  "closed",
  "unknown",
]);
export async function openPacket(
  host: NoticeHost,
  threadId: string,
  session: NoticeSession,
): Promise<PacketOpenResult> {
  const reply = await readPacketReply(
    host,
    packetURL(host.origin, "hongbao:open", { tid: threadId }),
    session,
  );
  if (reply.kind !== "decoded") return reply;
  const data = reply.data;
  if (no(data?.ok)) {
    const message = textValue(data?.error);
    if (message === "這裡沒有紅包" || message === "这里没有红包")
      return { kind: "packet-absent", threadId };
    return { kind: "refused", message };
  }
  if (!data || !yes(data.ok) || positiveId(data.tid) !== threadId)
    return { kind: "invalid-response" };
  const state = textValue(data.state) as PacketState;
  if (!states.has(state)) return { kind: "invalid-response" };
  const mine = object(data.mine);
  return {
    kind: "packet-open",
    threadId,
    memberId: session.memberId,
    state,
    sender: textValue(data.from),
    blessing: textValue(data.bless),
    requiresPassword: yes(data.haspw),
    requiresReply: yes(data.cond),
    designatedRecipients: yes(data.appoint),
    isSender: yes(data.is_sender),
    split:
      Number(data.splitmode) === 1
        ? "random"
        : Number(data.splitmode) === 2
          ? "equal"
          : null,
    unit: textValue(data.unit),
    mine: yes(mine?.claimed)
      ? { amount: amount(mine?.amount), best: yes(mine?.best) }
      : null,
  };
}

export function nativeHash(html: string, page: URL) {
  const doc = documentFrom(html);
  const values = descendants(
    doc,
    (node) =>
      node.tagName === "input" &&
      attr(node, "name") === "formhash" &&
      attr(node, "type") === "hidden",
  )
    .map((node) => hash(attr(node, "value")))
    .filter(Boolean);
  for (const anchor of descendants(doc, (node) => node.tagName === "a")) {
    const url = forumURL(attr(anchor, "href"), page, "/member.php");
    const token =
      url &&
      url.searchParams.get("mod") === "logging" &&
      url.searchParams.get("action") === "logout" &&
      hash(url.searchParams.get("formhash"));
    if (token) values.push(token);
  }
  return new Set(values).size === 1 ? values[0]! : null;
}

function packetForm(
  block: Data,
  data: Data,
  page: URL,
  threadId: string,
  operation: "grab" | "withdraw",
): PacketAction | null {
  const source = object(block[operation]);
  const fields = object(source?.fields);
  const action = forumURL(source?.action, page, "/plugin.php");
  const token = hash(data.formhash);
  if (
    !action ||
    action.searchParams.size !== 1 ||
    action.searchParams.get("id") !== `hongbao:${operation}` ||
    source?.method !== "POST" ||
    !fields ||
    Object.keys(fields).length !== 1 ||
    positiveId(fields.tid) !== threadId ||
    !token ||
    (operation === "grab" &&
      !["", "password"].includes(textValue(source.password))) ||
    (operation === "grab" &&
      yes(block.has_password) &&
      source.password !== "password")
  )
    return null;
  action.searchParams.set("tsdmapp", "json");
  return {
    url: action,
    fields: { tid: threadId, formhash: token },
    mode: "structured",
  };
}
export interface PacketReading {
  kind: "reading";
  view: ThreadPacket;
  claim: PacketAction | null;
  withdraw: PacketAction | null;
}
export async function threadPacket(
  host: NoticeHost,
  threadId: string,
  session: NoticeSession,
): Promise<PacketReading | PacketFailure | PacketHandoff> {
  const page = urlAt(host.origin, "/forum.php", {
    mod: "viewthread",
    tid: threadId,
  });
  const reply = await readPacketReply(
    host,
    new URL(structured(page.href)),
    session,
  );
  if (reply.kind !== "decoded") return reply;
  const data = reply.data;
  const handoff: PacketHandoff = {
    kind: "packet-handoff",
    destination: page.href,
  };
  if (
    no(data?.ok) &&
    !["off", "action", "unknown", "unsupported"].includes(
      textValue(data?.error),
    )
  )
    return { kind: "refused", message: textValue(data?.message) };
  if (
    data?.type === "thread" &&
    object(data.special)?.type === "hongbao" &&
    yes(data.ok)
  ) {
    const block = object(data.special)!;
    const thread = object(data.thread);
    const packetId = positiveId(block.packetid);
    if (
      positiveId(thread?.tid) !== threadId ||
      numericId(data.uid) !== session.memberId ||
      !packetId
    )
      return { kind: "invalid-response" };
    const status =
      block.status === "active"
        ? object(block.mine)
          ? "claimed"
          : "open"
        : (textValue(block.status) as PacketState);
    if (!states.has(status)) return handoff;
    const sender = object(block.sender);
    const claim =
      status === "open" && !yes(block.expired) && yes(block.can_grab)
        ? packetForm(block, data, page, threadId, "grab")
        : null;
    const withdraw =
      (status === "open" || status === "claimed") &&
      !yes(block.expired) &&
      yes(block.can_withdraw) &&
      yes(block.is_sender) &&
      positiveId(sender?.uid) === session.memberId
        ? packetForm(block, data, page, threadId, "withdraw")
        : null;
    const mine = object(block.mine);
    return {
      kind: "reading",
      claim,
      withdraw,
      view: {
        kind: "thread-packet",
        threadId,
        packetId,
        memberId: session.memberId,
        state: status,
        sender: textValue(sender?.username),
        blessing: textValue(block.blessing),
        requiresPassword: yes(block.has_password),
        requiresReply: yes(block.need_reply),
        designatedRecipients: yes(block.appoint),
        isSender: yes(block.is_sender),
        split:
          block.split === "even"
            ? "equal"
            : block.split === "lucky"
              ? "random"
              : null,
        unit: textValue(object(block.credit)?.title),
        mine: mine
          ? { amount: amount(mine.amount), best: yes(mine.best) }
          : null,
        shares: count(block.shares),
        claimedShares: count(block.claimed_shares),
        remainingShares: count(block.remain_shares),
        canClaim: Boolean(claim),
        canWithdraw: Boolean(withdraw),
        canReadRecords: yes(block.can_view_records),
        why: textValue(block.why),
      },
    };
  }
  if (
    data?.type === "thread" &&
    data.thread &&
    positiveId(object(data.thread)?.tid) !== threadId
  )
    return { kind: "invalid-response" };
  let html = reply.html;
  const markers = (body: string) =>
    descendants(
      documentFrom(body),
      (node) =>
        hasClass(node, "hb-entry") && attr(node, "data-tid") === threadId,
    );
  if (!markers(html).length) {
    const native = await readPacketReply(host, page, session);
    if (native.kind !== "decoded") return native;
    html = native.html;
  }
  const viewer = nativeIdentity(html, page);
  if (viewer && viewer !== session.memberId)
    return { kind: viewer === "0" ? "refused" : "session-changed" };
  if (viewer !== session.memberId || markers(html).length !== 1) return handoff;
  const token = nativeHash(html, page);
  const opened = await openPacket(host, threadId, session);
  if (opened.kind !== "packet-open")
    return opened.kind === "packet-absent" ? handoff : opened;
  const claim: PacketAction | null =
    opened.state === "open" && !opened.mine && token
      ? {
          url: packetURL(host.origin, "hongbao:grab"),
          fields: { tid: threadId, formhash: token },
          mode: "legacy",
        }
      : null;
  return {
    kind: "reading",
    claim,
    withdraw: null,
    view: {
      ...opened,
      kind: "thread-packet",
      packetId: null,
      shares: null,
      claimedShares: null,
      remainingShares: null,
      canClaim: Boolean(claim),
      canWithdraw: false,
      canReadRecords: null,
      why: "",
    },
  };
}
