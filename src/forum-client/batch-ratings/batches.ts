import { id, record, rows, string } from "../activity-protocol.js";
import type { NoticeSession } from "../notice-transport.js";
import {
  count,
  formFrom,
  on,
  route,
  whole,
  identify,
  isId,
  jsonPage,
  jsonWrite,
  type batchHost,
} from "./protocol.js";
import { itemFrom } from "./preview.js";
import { query } from "../posts/forms.js";
import {
  progresses,
  stepBody,
  stepReceipt,
  type BatchCounters,
  type StepOperation,
} from "./steps.js";
import type {
  BatchRatingAccess,
  BatchRatingList,
  BatchRatingPage,
  BatchRatingRead,
  BatchRatingRecord,
  BatchRatingStepResult,
} from "./types.js";

const modes = ["threads", "posts", "floors"] as const;
export function recordFrom(
  data: Record<string, unknown> | null,
): BatchRatingRecord | null {
  const batchId = id(data?.batchid),
    ownerId = id(data?.uid),
    forumId = id(data?.fid);
  const total = count(data?.total),
    applied = count(data?.applied),
    skipped = count(data?.skipped),
    pending = count(data?.pending);
  const status = count(data?.status),
    modeCode = whole(data?.mode);
  const mode = modeCode && modes[modeCode - 1];
  const threadId = id(data?.tid);
  if (
    !data ||
    !batchId ||
    !ownerId ||
    !forumId ||
    !mode ||
    (mode !== "threads" && !threadId) ||
    total === null ||
    applied === null ||
    skipped === null ||
    applied + skipped > total ||
    (pending !== null && pending > total) ||
    status === null
  )
    return null;
  const source = rows(data.scores);
  const scores = source?.map((row) => {
    const creditId = id(row?.id),
      score = whole(row?.score);
    return creditId && score !== null
      ? Object.freeze({ id: creditId, name: string(row?.title), score })
      : null;
  });
  if (
    !scores?.every((row) => row !== null) ||
    new Set(scores.map((row) => row.id)).size !== scores.length
  )
    return null;
  return Object.freeze({
    id: batchId,
    ownerId,
    ownerName: string(data.username),
    forumId,
    threadId,
    forum: string(data.forum),
    mode,
    modeText: string(data.mode_text),
    floors: string(data.floors),
    scores: Object.freeze(scores),
    reason: string(data.reason),
    total,
    applied,
    skipped,
    pending,
    status,
    statusText: string(data.status_text),
    time: count(data.dateline),
    canContinue: on(data.can_continue),
    canUndo: on(data.can_undo),
    canUndoItem: on(data.can_undo_item),
  });
}
export function batchPage(
  data: Record<string, unknown>,
  base: string,
  owner: NoticeSession,
  expected?: string,
) {
  if (data.ok !== 1 || data.type !== "batchrate_batch" || data.schema !== 34)
    return null;
  const batch = recordFrom(record(data.batch));
  if (!batch || (expected && batch.id !== expected)) return null;
  const items =
    data.items === null
      ? null
      : rows(data.items)?.map((row) => itemFrom(row, base));
  if (items === undefined || (items && !items.every((item) => item !== null)))
    return null;
  if (
    items &&
    (items.some(
      (item) =>
        !item.itemId || (batch.threadId && item.threadId !== batch.threadId),
    ) ||
      new Set(items.map((item) => item.itemId)).size !== items.length)
  )
    return null;
  const forms = record(data.forms);
  const runForm = formFrom(forms?.run, base, { id: "batchrate:run" }, [
    "batchid",
  ]);
  const undoItem = formFrom(
    forms?.undo_item,
    base,
    { id: "batchrate:list", bract: "undo_item" },
    ["batchid"],
  );
  const undoBatch = formFrom(
    forms?.undo_batch,
    base,
    { id: "batchrate:list", bract: "undo_batch" },
    ["batchid"],
  );
  const result = route(
    string(forms?.result_url).replace("{batchid}", batch.id),
    base,
    { id: "batchrate:rate", brmode: "result", batchid: batch.id },
  );
  const run =
    on(data.run) && batch.canContinue && batch.status === 0 ? runForm : null;
  const page: BatchRatingPage = Object.freeze({
    record: batch,
    items: items && Object.freeze(items),
    canRun: !!run,
    canRevoke: batch.canUndo && !!undoBatch,
    resultURL: result?.href ?? null,
    chunk: count(data.chunk),
  });
  return {
    owner,
    page,
    run,
    last: null as BatchCounters | null,
    undoItem: batch.canUndoItem ? undoItem : null,
    undoBatch: batch.canUndo ? undoBatch : null,
  };
}

export interface BatchAccessAuthority {
  owner: NoticeSession;
  confirm: ReturnType<typeof formFrom>;
  list: string | null;
  detail: string;
}
export function batchOperations(
  host: ReturnType<typeof batchHost>,
  accessRecords: WeakMap<BatchRatingAccess, BatchAccessAuthority>,
  batches: WeakMap<BatchRatingPage, NonNullable<ReturnType<typeof batchPage>>>,
) {
  const inFlight = new Set<string>();
  async function listBatchRatings(
    access: BatchRatingAccess,
    page = 1,
  ): Promise<BatchRatingList> {
    const authority = accessRecords.get(access);
    if (!authority?.list || !Number.isSafeInteger(page) || page < 1)
      return { kind: "invalid-input" };
    const base =
      page === 1
        ? authority.list
        : query(authority.list, { page: String(page) });
    const reply = await host.exchange(jsonPage(base), authority.owner);
    if (reply.kind !== "answer") return reply;
    const read = identify(reply, authority.owner);
    if (read.kind !== "data") return read;
    const data = read.data;
    const pages = count(data.pages),
      total = count(data.count);
    const records = rows(data.batches)?.map(recordFrom);
    if (
      data.ok !== 1 ||
      data.type !== "batchrate_list" ||
      data.schema !== 35 ||
      count(data.page) !== page ||
      pages === null ||
      page > Math.max(pages, 1) ||
      total === null ||
      !records?.every((item) => item !== null) ||
      new Set(records.map((item) => item.id)).size !== records.length
    )
      return { kind: "invalid-response" };
    const template = string(record(data.forms)?.detail_url);
    if (template && qualifiedDetail(template, base, "1"))
      authority.detail = template;
    return {
      kind: "batch-rating-list",
      page,
      pages: Math.max(1, pages),
      count: total,
      batches: records,
    };
  }
  function qualifiedDetail(template: string, base: string, batchId: string) {
    return route(template.replace("{batchid}", batchId), base, {
      id: "batchrate:list",
      bract: "detail",
      batchid: batchId,
    });
  }
  async function readPage(
    base: string,
    owner: NoticeSession,
    batchId: string,
    redirect = false,
  ): Promise<BatchRatingRead> {
    const url = jsonPage(base);
    const reply = await host.exchange(url, owner);
    if (reply.kind !== "answer") return reply;
    if (redirect && [301, 302, 303].includes(reply.response.status)) {
      const location = route(
        reply.response.location,
        base,
        { id: "batchrate:rate", brmode: "result", batchid: batchId },
        ["tsdmapp", "nodoc"],
      );
      return location
        ? readPage(location.href, owner, batchId)
        : { kind: "invalid-response" };
    }
    const read = identify(reply, owner);
    if (read.kind !== "data") return read;
    const result = batchPage(read.data, url, owner, batchId);
    if (!result) return { kind: "invalid-response" };
    batches.set(result.page, result);
    return { kind: "batch-rating-page", batch: result.page };
  }
  async function readBatchRatingDetail(
    access: BatchRatingAccess,
    batchId: string,
  ): Promise<BatchRatingRead> {
    const authority = accessRecords.get(access);
    if (!authority?.list || !isId(batchId)) return { kind: "invalid-input" };
    const base = authority.detail
      ? qualifiedDetail(authority.detail, authority.list, batchId)?.href
      : query(authority.list, { bract: "detail", batchid: batchId });
    return base
      ? readPage(base, authority.owner, batchId)
      : { kind: "invalid-response" };
  }
  async function resumeBatchRating(
    access: BatchRatingAccess,
    batchId: string,
  ): Promise<BatchRatingRead> {
    const authority = accessRecords.get(access);
    if (!authority?.list || !isId(batchId)) return { kind: "invalid-input" };
    return readPage(
      query(authority.list, { bract: "continue", batchid: batchId }),
      authority.owner,
      batchId,
      true,
    );
  }
  async function readBatchRatingResult(
    batch: BatchRatingPage,
  ): Promise<BatchRatingRead> {
    const authority = batches.get(batch);
    return authority && batch.resultURL
      ? readPage(batch.resultURL, authority.owner, batch.record.id)
      : { kind: "invalid-input" };
  }
  async function send(
    batch: BatchRatingPage,
    operation: StepOperation,
    approved: boolean,
    itemId?: string,
  ): Promise<BatchRatingStepResult> {
    const authority = batches.get(batch);
    if (!authority) return { kind: "invalid-input" };
    const form =
      operation === "run"
        ? authority.run
        : operation === "revoke-batch"
          ? authority.undoBatch
          : authority.undoItem;
    if (
      !form ||
      (operation === "revoke-item" &&
        (!isId(itemId) ||
          !batch.items?.some((item) => item.itemId === itemId && item.canUndo)))
    )
      return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    const { owner } = authority;
    if (!host.current(owner)) return { kind: "session-changed" };
    const batchId = batch.record.id;
    const fields = stepBody(form, operation, batchId, itemId);
    if (!fields) return { kind: "invalid-response" };
    const key = JSON.stringify([owner.memberId, owner.continuity, batchId]);
    if (inFlight.has(key)) return { kind: "refused", code: "batch-in-flight" };
    inFlight.add(key);
    const prior = authority.last;
    authority.run = authority.undoItem = authority.undoBatch = null;
    const uncertain = {
      kind: "uncertain",
      operation,
      batchId,
      ...(itemId && { itemId }),
    } as const;
    try {
      const reply = await host.exchange(
        jsonWrite(form.url.href),
        owner,
        fields,
        true,
      );
      const receipt = stepReceipt(reply, owner, operation, batchId, itemId);
      if (!receipt) return uncertain;
      if (receipt.kind === "revoked")
        return itemId
          ? { kind: "revoked", operation: "revoke-item", batchId, itemId }
          : uncertain;
      if (receipt.kind !== "step") return receipt;
      if (operation === "revoke-item") return uncertain;
      const counter = receipt.counters;
      if (
        prior &&
        ((prior.total !== null &&
          counter.total !== null &&
          prior.total !== counter.total) ||
          (prior.remaining !== null &&
            counter.remaining !== null &&
            counter.remaining > prior.remaining) ||
          (operation === "run" && counter.done < prior.done))
      )
        return uncertain;
      const { done, total, remaining, finished } = counter;
      const pending =
        operation === "run" && !prior ? batch.record.pending : null;
      if (pending !== null && remaining !== null && remaining > pending)
        return uncertain;
      const progress = { operation, batchId, done, total, remaining };
      if (finished) return { kind: "finished", ...progress };
      if (
        (pending !== null && remaining === pending) ||
        !progresses(counter, prior, operation)
      )
        return { kind: "no-progress", ...progress };
      authority.last = counter;
      if (operation === "run") authority.run = form;
      else authority.undoBatch = form;
      return { kind: "advanced", ...progress };
    } finally {
      inFlight.delete(key);
    }
  }
  return {
    listBatchRatings,
    readBatchRatingDetail,
    resumeBatchRating,
    readBatchRatingResult,
    runBatchRatingStep: (batch: BatchRatingPage, approved: boolean) =>
      send(batch, "run", approved),
    revokeBatchRatingItem: (
      batch: BatchRatingPage,
      itemId: string,
      approved: boolean,
    ) => send(batch, "revoke-item", approved, itemId),
    revokeBatchRatingStep: (batch: BatchRatingPage, approved: boolean) =>
      send(batch, "revoke-batch", approved),
  };
}
