import { answer } from "../credits/protocol.js";
import { numericId, object } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import { amount, no, positiveId, textValue, yes } from "./protocol.js";
import type { PacketAction } from "./thread.js";
import type { PacketForm, PacketResult } from "./types.js";

export function receiptTarget(form: PacketForm) {
  return {
    operation: form.operation,
    ...(form.threadId && { threadId: form.threadId }),
    ...(form.packetId && { packetId: form.packetId }),
    ...(form.day && { day: form.day }),
  };
}
export function packetEffect(
  response: HostResponse,
  form: PacketForm,
  mode: PacketAction["mode"],
): PacketResult {
  const target = receiptTarget(form);
  const unknown = { kind: "unknown", ...target } as const;
  const { data } = answer(response);
  const login = yes(data?.login) || yes(data?.need_login);
  if (response.status === 401 || response.status === 403)
    return { kind: "refused", ...target, reason: "login-or-permission" };
  if (
    response.status !== 200 ||
    !data ||
    (data.uid !== undefined &&
      numericId(data.uid) !== form.memberId &&
      !(numericId(data.uid) === "0" && login)) ||
    (form.threadId &&
      data.tid !== undefined &&
      positiveId(data.tid) !== form.threadId) ||
    (form.packetId &&
      data.packetid !== undefined &&
      positiveId(data.packetid) !== form.packetId)
  )
    return unknown;
  if (mode === "daily") {
    if (login || data.alert === "error")
      return {
        kind: "refused",
        ...target,
        reason: login ? "login" : "plugin-refused",
      };
    if (data.dateflag !== undefined && data.dateflag !== form.day)
      return unknown;
    const received = amount(data.amount);
    if (yes(data.already))
      return {
        kind: "already-claimed",
        ...target,
        ...(received !== null && { amount: received }),
        ...(textValue(data.unit) && { unit: textValue(data.unit) }),
      };
    if (no(data.ok))
      return { kind: "refused", ...target, message: textValue(data.error) };
    return yes(data.ok) && received !== null && textValue(data.unit)
      ? {
          kind: "claimed",
          ...target,
          amount: received,
          unit: textValue(data.unit),
        }
      : unknown;
  }
  let values = data;
  if (mode === "structured") {
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      (numericId(data.uid) !== form.memberId && !login)
    )
      return unknown;
    if (data.kind === "page") return { kind: "redrawn", ...target };
    if (
      data.kind !== "handle" ||
      data.handlekey !==
        (form.operation === "withdraw" ? "hongbao_withdraw" : "hongbao_grab")
    )
      return unknown;
    const result = object(data.values);
    if (!result) return unknown;
    values = result;
  }
  if (no(data.ok) || login || data.alert === "error") {
    const raw = textValue(values.reason ?? values.state);
    const reason = /^[a-z_]+$/.test(raw)
      ? raw
      : login
        ? "login"
        : "plugin-refused";
    return { kind: "refused", ...target, reason };
  }
  if (!yes(data.ok)) return unknown;
  if (form.operation === "withdraw") {
    const refunded = amount(values.refunded);
    return refunded === null
      ? unknown
      : { kind: "withdrawn", ...target, refunded };
  }
  const received = amount(values.amount);
  if (received === null || typeof values.unit !== "string" || !values.unit)
    return unknown;
  return {
    kind: yes(values.already) ? "already-claimed" : "claimed",
    ...target,
    amount: received,
    unit: values.unit,
    best: yes(values.best),
  };
}
