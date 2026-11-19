import { awardClaimURL, awardDetails, awardReceipt } from "./awards.js";
import { dailyPacket } from "./daily.js";
import type { NoticeSession } from "../notice-transport.js";
import { packetEffect, receiptTarget } from "./effects.js";
import { packetHost, positiveId } from "./protocol.js";
import { packetRecords } from "./records.js";
import {
  openPacket,
  threadPacket,
  type PacketAction,
  type PacketReading,
} from "./thread.js";
import type {
  DailyPacket,
  DailyPacketResult,
  PacketClientOptions,
  PacketFailure,
  PacketForm,
  PacketHandoff,
  PacketOpenResult,
  PacketPreparation,
  PacketResult,
  ThreadPacket,
} from "./types.js";

export function createPacketClient(options: PacketClientOptions) {
  const host = packetHost(options);
  const views = new WeakMap<
    ThreadPacket,
    { reading: PacketReading; session: NoticeSession }
  >();
  const dailyViews = new WeakMap<
    DailyPacket,
    { action: PacketAction; session: NoticeSession }
  >();
  const approvals = new WeakMap<
    PacketForm,
    { action: PacketAction; session: NoticeSession }
  >();
  const validThread = (threadId: string) =>
    typeof threadId === "string" && Boolean(positiveId(threadId));
  async function open(threadId: string): Promise<PacketOpenResult> {
    if (!validThread(threadId)) return { kind: "invalid-input" };
    const session = host.session();
    return session
      ? openPacket(host, threadId, session)
      : { kind: "session-changed" };
  }
  async function readThreadPacket(
    threadId: string,
  ): Promise<ThreadPacket | PacketHandoff | PacketFailure> {
    if (!validThread(threadId)) return { kind: "invalid-input" };
    const session = host.session();
    if (!session) return { kind: "session-changed" };
    const reading = await threadPacket(host, threadId, session);
    if (reading.kind !== "reading") return reading;
    const view = Object.freeze(reading.view);
    views.set(view, { reading, session });
    return view;
  }
  async function readRecords(threadId: string) {
    if (!validThread(threadId)) return { kind: "invalid-input" } as const;
    const session = host.session();
    return session
      ? packetRecords(host, threadId, session)
      : ({ kind: "session-changed" } as const);
  }
  function approval(
    action: PacketAction,
    session: NoticeSession,
    facts: Omit<PacketForm, "memberId" | "destination">,
  ): PacketPreparation {
    const form: PacketForm = Object.freeze({
      ...facts,
      memberId: session.memberId,
      destination: action.url.href,
    });
    approvals.set(form, { action, session });
    return { kind: "packet-ready", form };
  }
  function prepare(
    view: ThreadPacket,
    operation: "claim" | "withdraw",
  ): PacketPreparation {
    const saved = views.get(view);
    if (!saved) return { kind: "invalid-input" };
    if (!host.current(saved.session)) return { kind: "session-changed" };
    const action = saved.reading[operation];
    if (!action)
      return {
        kind: "refused",
        reason: saved.reading.view.why || "not-offered",
      };
    return approval(action, saved.session, {
      operation,
      threadId: view.threadId,
      ...(view.packetId && { packetId: view.packetId }),
      requiresPassword: operation === "claim" && view.requiresPassword,
    });
  }
  async function readDaily(): Promise<DailyPacketResult> {
    const session = host.session();
    if (!session) return { kind: "session-changed" };
    const reading = await dailyPacket(host, session);
    if (reading.kind !== "daily-reading") return reading;
    const view = Object.freeze(reading.view);
    dailyViews.set(view, { action: reading.action, session });
    return view;
  }
  function prepareDaily(view: DailyPacket): PacketPreparation {
    const saved = dailyViews.get(view);
    if (!saved) return { kind: "invalid-input" };
    if (!host.current(saved.session)) return { kind: "session-changed" };
    return approval(saved.action, saved.session, {
      operation: "daily",
      day: view.day,
      requiresPassword: false,
    });
  }
  async function readAwardDetails(threadId: string) {
    if (!validThread(threadId)) return { kind: "invalid-input" } as const;
    const session = host.session();
    return session
      ? awardDetails(host, threadId, session)
      : ({ kind: "session-changed" } as const);
  }
  function prepareAwardClaim(
    threadId: string,
    destination: string,
  ): PacketPreparation {
    if (!validThread(threadId)) return { kind: "invalid-input" };
    const url = awardClaimURL(host.origin, threadId, destination);
    if (!url) return { kind: "invalid-input" };
    const session = host.session();
    if (!session) return { kind: "session-changed" };
    return approval({ url, mode: "award" }, session, {
      operation: "award-claim",
      threadId,
      requiresPassword: false,
    });
  }
  async function submit(
    form: PacketForm,
    password?: string,
  ): Promise<PacketResult> {
    const saved = approvals.get(form);
    if (!saved) return { kind: "invalid-input" };
    if (!host.current(saved.session)) return { kind: "session-changed" };
    if (
      form.requiresPassword
        ? typeof password !== "string" ||
          !password.trim() ||
          password.length > 1024
        : password !== undefined
    )
      return { kind: "invalid-input" };
    const { action, session } = saved;
    const fields = action.fields && { ...action.fields };
    if (
      fields &&
      form.operation === "claim" &&
      (form.requiresPassword || action.mode === "legacy")
    )
      fields.password = password ?? "";
    approvals.delete(form);
    const reply = await host.request(
      action.url.href,
      session,
      fields && new URLSearchParams(fields).toString(),
    );
    if (reply.kind !== "response")
      return {
        kind: "unknown",
        ...receiptTarget(form),
        ...(form.operation === "award-claim" && {
          destination: form.destination,
        }),
      };
    return action.mode === "award"
      ? awardReceipt(reply.response, form)
      : packetEffect(reply.response, form, action.mode);
  }
  return {
    open,
    readThreadPacket,
    readRecords,
    prepareClaim: (view: ThreadPacket) => prepare(view, "claim"),
    prepareWithdrawal: (view: ThreadPacket) => prepare(view, "withdraw"),
    readDaily,
    prepareDaily,
    readAwardDetails,
    prepareAwardClaim,
    submit,
  };
}
