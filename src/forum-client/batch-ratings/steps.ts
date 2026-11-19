import { id, record, string } from "../activity-protocol.js";
import type { NoticeSession } from "../notice-transport.js";
import {
  count,
  formFrom,
  identify,
  on,
  refusal,
  type Exchange,
} from "./protocol.js";
import type { BatchRatingFailure } from "./types.js";

export type StepOperation = "run" | "revoke-item" | "revoke-batch";
const handles: Record<StepOperation, string> = {
  run: "batchrate_run",
  "revoke-item": "batchrate_undo_item",
  "revoke-batch": "batchrate_undo_batch",
};
export interface BatchCounters {
  done: number;
  total: number | null;
  remaining: number | null;
  finished: boolean;
}
export function stepBody(
  form: NonNullable<ReturnType<typeof formFrom>>,
  operation: StepOperation,
  batchId: string,
  itemId?: string,
) {
  const field = operation === "revoke-item" ? "itemid" : "batchid";
  const value = operation === "revoke-item" ? itemId : batchId;
  const offeredName =
    form.meta[operation === "revoke-item" ? "item_field" : "batch_field"];
  if (
    !value ||
    (offeredName !== undefined && offeredName !== field) ||
    (form.url.searchParams.has("batchid") &&
      form.url.searchParams.get("batchid") !== batchId) ||
    [...form.fields.keys()].some(
      (key) => key !== "formhash" && key !== field,
    ) ||
    (form.fields.has(field) && form.fields.get(field) !== value)
  )
    return null;
  const body = new URLSearchParams(form.fields);
  body.set(field, value);
  return body;
}
export function stepReceipt(
  reply: Exchange,
  owner: NoticeSession,
  operation: StepOperation,
  batchId: string,
  itemId?: string,
):
  | { kind: "step"; counters: BatchCounters }
  | { kind: "revoked" }
  | BatchRatingFailure
  | null {
  if (reply.kind !== "answer") return null;
  const read = identify(reply, owner, true);
  if (read.kind !== "data") return read.kind === "refused" ? read : null;
  const data = read.data;
  const raw = data.type === undefined && typeof data.ok === "boolean";
  if (
    !raw &&
    (data.type !== "result" ||
      data.schema !== 13 ||
      data.kind !== "handle" ||
      data.handlekey !== handles[operation] ||
      data.uid === undefined)
  )
    return null;
  const values = raw ? data : record(data.values);
  if (
    !values ||
    [data.batchid, values.batchid].some(
      (value) => value !== undefined && id(value) !== batchId,
    ) ||
    [data.itemid, values.itemid].some(
      (value) => value !== undefined && id(value) !== itemId,
    )
  )
    return null;
  if (data.ok === 0 || data.ok === false || data.alert === "error") {
    return raw ? refusal({ message: string(data.error) }) : refusal(data);
  }
  if (data.ok !== 1 && data.ok !== true) return null;
  if (operation === "revoke-item") return { kind: "revoked" };
  const done = count(values.done),
    total = count(values.total),
    remaining = count(values.remaining);
  const finished = on(values.finished) || values.finished === "true";
  if (
    done === null ||
    ![0, 1, "0", "1", "true", "false", false, true].some(
      (flag) => flag === values.finished,
    ) ||
    (values.total !== undefined && total === null) ||
    (values.remaining !== undefined && remaining === null) ||
    (operation === "run" && total === null) ||
    (operation === "revoke-batch" && remaining === null) ||
    (total !== null &&
      (done > total || (remaining !== null && remaining > total))) ||
    (finished && (remaining !== null ? remaining !== 0 : done !== total)) ||
    (!finished && remaining === 0)
  )
    return null;
  return { kind: "step", counters: { done, total, remaining, finished } };
}
export function progresses(
  next: BatchCounters,
  prior: BatchCounters | null,
  operation: Exclude<StepOperation, "revoke-item">,
) {
  if (next.finished) return true;
  if (!prior)
    return (
      next.done > 0 ||
      (next.total !== null &&
        next.remaining !== null &&
        next.remaining < next.total)
    );
  if (prior.remaining !== null && next.remaining !== null)
    return next.remaining < prior.remaining;
  return operation === "run" && next.done > prior.done;
}
