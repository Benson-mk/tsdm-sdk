import type {
  NoticeClientOptions,
  NoticeRequest,
} from "../notice-transport.js";

export type PacketRequest = NoticeRequest & { readonly effect: boolean };
export interface PacketClientOptions extends Omit<
  NoticeClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: PacketRequest,
    ): ReturnType<NoticeClientOptions["transport"]["request"]>;
  };
}
export type PacketFailure = {
  kind:
    | "invalid-input"
    | "invalid-response"
    | "network"
    | "session-changed"
    | "refused"
    | "rate-limited";
  reason?: string;
  message?: string;
  retryAfterSeconds?: number;
};
export type PacketState =
  "open" | "claimed" | "done" | "withdrawn" | "expired" | "closed" | "unknown";
export interface OpenPacket {
  kind: "packet-open";
  threadId: string;
  memberId: string;
  state: PacketState;
  sender: string;
  blessing: string;
  requiresPassword: boolean;
  requiresReply: boolean;
  designatedRecipients: boolean;
  isSender: boolean;
  split: "random" | "equal" | null;
  unit: string;
  mine: { amount: string | null; best: boolean } | null;
}

export type PacketOpenResult =
  OpenPacket | PacketFailure | { kind: "packet-absent"; threadId: string };

export interface ThreadPacket extends Omit<OpenPacket, "kind"> {
  readonly kind: "thread-packet";
  readonly packetId: string | null;
  readonly shares: number | null;
  readonly claimedShares: number | null;
  readonly remainingShares: number | null;
  readonly canClaim: boolean;
  readonly canWithdraw: boolean;
  readonly canReadRecords: boolean | null;
  readonly why: string;
}
export type PacketOperation = "claim" | "withdraw" | "daily" | "award-claim";
export interface PacketForm {
  readonly operation: PacketOperation;
  readonly memberId: string;
  readonly threadId?: string;
  readonly packetId?: string;
  readonly day?: string;
  readonly destination: string;
  readonly requiresPassword: boolean;
}
export type PacketHandoff = { kind: "packet-handoff"; destination: string };
export type PacketPreparation =
  { kind: "packet-ready"; form: PacketForm } | PacketFailure;
export type PacketResult =
  | PacketFailure
  | {
      kind:
        | "claimed"
        | "already-claimed"
        | "withdrawn"
        | "refused"
        | "redrawn"
        | "unknown"
        | "award-arrived";
      operation: PacketOperation;
      threadId?: string;
      packetId?: string;
      day?: string;
      amount?: string;
      unit?: string;
      best?: boolean;
      refunded?: string;
      reason?: string;
      message?: string;
      destination?: string;
      effect?: "unknown";
    };
export interface PacketRecord {
  memberId: string | null;
  username: string;
  amount: string;
  best: boolean;
  epochSeconds: number | null;
  serverTime: string | null;
}
export interface PacketRecords {
  kind: "packet-records";
  threadId: string;
  packetId: string | null;
  unit: string;
  shares: number;
  claimed: number;
  complete: boolean;
  records: PacketRecord[];
}

export interface DailyPacket {
  readonly kind: "daily-packet";
  readonly memberId: string;
  readonly day: string;
  readonly sender: string;
  readonly blessing: string;
  readonly unit: string;
}
export type DailyPacketResult =
  DailyPacket | { kind: "daily-unavailable" } | PacketFailure;
export interface AwardRecord {
  id: string;
  memberId: string;
  username: string;
  coins: string;
  serverTime: string;
}
export interface AwardDetails {
  kind: "award-details";
  threadId: string;
  records: AwardRecord[];
}
