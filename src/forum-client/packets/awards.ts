import { nativeIdentity } from "../account-forms.js";
import { forumURL } from "../credits/protocol.js";
import {
  attr,
  byId,
  children,
  descendants,
  documentFrom,
  element,
  hasClass,
  label,
} from "../html.js";
import type { NoticeHost, NoticeSession } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import { packetURL, positiveId, readPacketReply } from "./protocol.js";
import type {
  AwardDetails,
  AwardRecord,
  PacketFailure,
  PacketForm,
  PacketResult,
} from "./types.js";

const plugin = "tsdmbet:awardPacket";
export function awardClaimURL(
  origin: string,
  threadId: string,
  destination: string,
) {
  const url = forumURL(destination, new URL(origin), "/plugin.php");
  return url &&
    url.searchParams.get("id") === plugin &&
    url.searchParams.get("tid") === threadId &&
    url.searchParams.get("action")?.toLowerCase() !== "showaward"
    ? url
    : null;
}
export async function awardDetails(
  host: NoticeHost,
  threadId: string,
  session: NoticeSession,
): Promise<AwardDetails | PacketFailure> {
  const target = packetURL(host.origin, plugin, {
    action: "showaward",
    tid: threadId,
  });
  const reply = await readPacketReply(host, target, session);
  if (reply.kind !== "decoded") return reply;
  const viewer = nativeIdentity(reply.html, target);
  if (viewer && viewer !== session.memberId)
    return { kind: viewer === "0" ? "refused" : "session-changed" };
  const doc = documentFrom(reply.html);
  const box = byId(doc, "messagetext");
  if (box && hasClass(box, "alert_error"))
    return { kind: "refused", message: label(box) };
  const tables = descendants(
    doc,
    (node) => node.tagName === "table" && hasClass(node, "pure-table"),
  );
  if (tables.length !== 1) return { kind: "invalid-response" };
  const table = tables[0]!;
  if (attr(table, "data-tid") && attr(table, "data-tid") !== threadId)
    return { kind: "invalid-response" };
  const bodies = children(table).filter(
    (node) => element(node) && node.tagName === "tbody",
  );
  if (!bodies.length) return { kind: "invalid-response" };
  const records: AwardRecord[] = [];
  for (const row of bodies
    .flatMap(children)
    .filter((node) => element(node) && node.tagName === "tr")) {
    const [id, memberId, username, coins, serverTime, ...extra] = children(row)
      .filter((node) => element(node) && node.tagName === "td")
      .map(label);
    if (!id && !memberId && !username && !coins && !serverTime && !extra.length)
      continue;
    if (
      !id ||
      !positiveId(id) ||
      !memberId ||
      !positiveId(memberId) ||
      !username ||
      coins === undefined ||
      !/^\d+$/.test(coins) ||
      !serverTime ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(serverTime) ||
      extra.length
    )
      return { kind: "invalid-response" };
    records.push({ id, memberId, username, coins, serverTime });
  }
  return { kind: "award-details", threadId, records };
}
export function awardReceipt(
  response: HostResponse,
  form: PacketForm,
): PacketResult {
  const target = {
    operation: "award-claim",
    threadId: form.threadId!,
    destination: form.destination,
  } as const;
  if (response.status === 401 || response.status === 403)
    return { kind: "refused", ...target, reason: "login-or-permission" };
  if (
    response.status !== 200 ||
    !/html|xml/i.test(response.contentType) ||
    !response.body.trim()
  )
    return { kind: "unknown", ...target };
  const viewer = nativeIdentity(response.body, new URL(form.destination));
  if (viewer === "0") return { kind: "refused", ...target, reason: "login" };
  if (viewer && viewer !== form.memberId) return { kind: "unknown", ...target };
  const box = byId(documentFrom(response.body), "messagetext");
  const paragraph = box && descendants(box, (node) => node.tagName === "p")[0];
  const message = label(paragraph);
  if (/err_packet_has_gone_away/.test(message))
    return { kind: "refused", ...target, reason: "taken-away" };
  if (box && hasClass(box, "alert_error"))
    return { kind: "refused", ...target, ...(message && { message }) };
  if (/^(?:您|你)?(?:已经领取过|已經領取過)/.test(message))
    return { kind: "already-claimed", ...target, message };
  if (/^(?:恭喜[，！! ]*)?(?:领取成功|領取成功)/.test(message))
    return { kind: "claimed", ...target, message };
  return { kind: "award-arrived", ...target, effect: "unknown" };
}
