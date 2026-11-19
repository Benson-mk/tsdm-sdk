import { nativeIdentity } from "../account-forms.js";
import { descendants, documentFrom, text } from "../html.js";
import {
  numericId,
  object,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import { structured } from "../posts/forms.js";
import {
  count,
  hash,
  no,
  packetURL,
  readPacketReply,
  textValue,
  yes,
} from "./protocol.js";
import { nativeHash, type PacketAction } from "./thread.js";
import type { DailyPacket, PacketFailure } from "./types.js";

type DailyReading = {
  kind: "daily-reading";
  view: DailyPacket;
  action: PacketAction;
};
function nativeConfig(html: string) {
  const matches = descendants(
    documentFrom(html),
    (node) => node.tagName === "script",
  ).flatMap((node) => [
    ...node.childNodes
      .map(text)
      .join("")
      .matchAll(/\bhongbaoDailyInit\(\s*(\{[\s\S]*?\})\s*\)/g),
  ]);
  if (!matches.length) return null;
  if (matches.length !== 1) return undefined;
  try {
    return object(JSON.parse(matches[0]![1]!)) ?? undefined;
  } catch {
    return undefined;
  }
}
function validDay(day: string) {
  if (!/^\d{8}$/.test(day)) return false;
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
  const epoch = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(epoch.getTime()) &&
    epoch.toISOString().slice(0, 10) === date
  );
}
export async function dailyPacket(
  host: NoticeHost,
  session: NoticeSession,
): Promise<DailyReading | { kind: "daily-unavailable" } | PacketFailure> {
  const page = new URL("/forum.php", host.origin);
  const reply = await readPacketReply(
    host,
    new URL(structured(page.href)),
    session,
  );
  if (reply.kind !== "decoded") return reply;
  const data = reply.data;
  let config: Record<string, unknown> | null | undefined;
  let token: string | null;
  if (
    yes(data?.ok) &&
    data?.type === "index" &&
    (count(data.schema) ?? 0) >= 5 &&
    numericId(data.uid) === session.memberId
  ) {
    config =
      data.red_packet == null ? null : (object(data.red_packet) ?? undefined);
    token = hash(data.formhash);
  } else {
    if (
      no(data?.ok) &&
      !["action", "off", "unknown", "unsupported"].includes(
        textValue(data?.error),
      )
    )
      return { kind: "refused", message: textValue(data?.message) };
    let html = reply.html;
    if (!nativeIdentity(html, page)) {
      const native = await readPacketReply(host, page, session);
      if (native.kind !== "decoded") return native;
      html = native.html;
    }
    const viewer = nativeIdentity(html, page);
    if (!viewer) return { kind: "invalid-response" };
    if (viewer !== session.memberId)
      return { kind: viewer === "0" ? "refused" : "session-changed" };
    config = nativeConfig(html);
    token = nativeHash(html, page);
  }
  if (config === null) return { kind: "daily-unavailable" };
  const day = textValue(config?.dateflag);
  if (
    !config ||
    ![1, 2].includes(Number(config.entry)) ||
    !token ||
    !validDay(day)
  )
    return { kind: "invalid-response" };
  return {
    kind: "daily-reading",
    view: {
      kind: "daily-packet",
      memberId: session.memberId,
      day,
      sender: textValue(config.from),
      blessing: textValue(config.bless),
      unit: textValue(config.unit),
    },
    action: {
      url: packetURL(host.origin, "hongbao:daily"),
      fields: { formhash: token },
      mode: "daily",
    },
  };
}
