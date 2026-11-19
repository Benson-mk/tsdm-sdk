import { answer, urlAt } from "../credits/protocol.js";
import {
  noticeHost,
  numericId,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import type { PacketClientOptions, PacketFailure } from "./types.js";

export const positiveId = (value: unknown) => {
  const id = numericId(value);
  return id === "0" ? null : id;
};
export const yes = (value: unknown) =>
  value === 1 || value === "1" || value === true;
export const no = (value: unknown) =>
  value === 0 || value === "0" || value === false;
export const textValue = (value: unknown) =>
  typeof value === "string" ? value : "";
export const amount = (value: unknown) => {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : textValue(value);
  return /^\d+(?:\.\d+)?$/.test(text) ? text : null;
};
export const packetURL = (
  origin: string,
  id: string,
  query: Record<string, string> = {},
) => urlAt(origin, "/plugin.php", { id, ...query });
export function packetHost(options: PacketClientOptions) {
  return noticeHost({
    ...options,
    transport: {
      request(url, request) {
        const target = new URL(url);
        const effect =
          request.method === "POST" ||
          (target.pathname === "/plugin.php" &&
            target.searchParams.get("id") === "tsdmbet:awardPacket" &&
            target.searchParams.get("action") !== "showaward");
        return options.transport.request(url, { ...request, effect });
      },
    },
  });
}
export async function readPacketReply(
  host: NoticeHost,
  url: URL,
  session: NoticeSession,
) {
  const reply = await host.request(url.href, session);
  if (reply.kind !== "response") return reply;
  const { response } = reply;
  const { data, html } = answer(response);
  const failure = (
    kind: PacketFailure["kind"],
    message?: string,
  ): PacketFailure => ({ kind, ...(message ? { message } : {}) });
  if (response.status === 429 || data?.error === "busy") {
    const wait = Number(data?.retry_after);
    return {
      ...failure("rate-limited"),
      ...(Number.isSafeInteger(wait) && wait >= 0
        ? { retryAfterSeconds: wait }
        : {}),
    };
  }
  if (
    [401, 403].includes(response.status) ||
    yes(data?.login) ||
    yes(data?.need_login) ||
    data?.error === "login" ||
    numericId(data?.uid) === "0"
  )
    return failure("refused", textValue(data?.message ?? data?.error));
  if (data?.uid !== undefined && numericId(data.uid) !== session.memberId)
    return failure("session-changed");
  if (response.status !== 200) return failure("invalid-response");
  return { kind: "decoded" as const, data, html };
}

export const hash = (value: unknown) =>
  /^[a-zA-Z0-9]{8}$/.test(textValue(value)) ? textValue(value) : null;
export function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
