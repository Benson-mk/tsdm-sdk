import {
  object,
  numericId,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import {
  amount,
  count,
  no,
  packetURL,
  positiveId,
  readPacketReply,
  textValue,
  yes,
} from "./protocol.js";
import type { PacketFailure, PacketRecord, PacketRecords } from "./types.js";

export async function packetRecords(
  host: NoticeHost,
  threadId: string,
  session: NoticeSession,
): Promise<PacketRecords | PacketFailure> {
  const url = packetURL(host.origin, "hongbao:record", {
    tid: threadId,
    tsdmapp: "json",
    nodoc: "1",
  });
  let reply = await readPacketReply(host, url, session);
  if (
    reply.kind === "decoded" &&
    ["off", "action", "unsupported"].includes(textValue(reply.data?.error))
  ) {
    reply = await readPacketReply(
      host,
      packetURL(host.origin, "hongbao:record", { tid: threadId }),
      session,
    );
  }
  if (reply.kind !== "decoded") return reply;
  const data = reply.data;
  if (no(data?.ok))
    return {
      kind: "refused",
      message: textValue(data?.message ?? data?.error),
    };
  if (
    !data ||
    !yes(data.ok) ||
    (data.tid !== undefined && positiveId(data.tid) !== threadId)
  )
    return { kind: "invalid-response" };
  const lean = data.type === "hongbao_record" && data.schema === 19;
  const packetId = lean ? positiveId(data.packetid) : null;
  if (
    lean &&
    (!packetId ||
      positiveId(data.tid) !== threadId ||
      numericId(data.uid) !== session.memberId)
  )
    return { kind: "invalid-response" };
  const rows = lean ? data.records : data.recs;
  const shares = count(data.shares);
  const claimed = count(data.claimed);
  if (
    shares === null ||
    claimed === null ||
    claimed > shares ||
    !Array.isArray(rows) ||
    rows.length > claimed
  )
    return { kind: "invalid-response" };
  const records: PacketRecord[] = [];
  for (const raw of rows) {
    const row = object(raw);
    const username = textValue(row?.username);
    const received = amount(row?.amount);
    if (!username || received === null) return { kind: "invalid-response" };
    records.push({
      username,
      memberId: positiveId(row?.uid),
      amount: received,
      best: yes(lean ? row?.best : row?.isbest),
      epochSeconds: lean ? count(row?.dateline) : null,
      serverTime: lean ? null : textValue(row?.time) || null,
    });
  }
  return {
    kind: "packet-records",
    threadId,
    packetId,
    unit: textValue(lean ? object(data.credit)?.title : data.unit),
    shares,
    claimed,
    complete: claimed === records.length,
    records,
  };
}
