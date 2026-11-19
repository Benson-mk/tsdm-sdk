import {
  batchPage,
  batchOperations,
  type BatchAccessAuthority,
} from "./batches.js";
import { previewFrom, selectionFields, settingsFields } from "./preview.js";
import { id, record, string } from "../activity-protocol.js";
import type { NoticeSession } from "../notice-transport.js";
import {
  antispam,
  batchHost,
  count,
  creditRows,
  formFrom,
  identify,
  isId,
  jsonWrite,
  on,
  pluginURL,
  route,
} from "./protocol.js";
import type {
  BatchRatingAccess,
  BatchRatingClient,
  BatchRatingClientOptions,
  BatchRatingDiscovery,
  BatchRatingMode,
  BatchRatingScope,
  BatchRatingPreview,
  BatchRatingPreviewResult,
  BatchRatingCreation,
  BatchRatingPage,
  BatchRatingSelection,
  BatchRatingSettings,
} from "./types.js";

export function createBatchRatingClient(
  options: BatchRatingClientOptions,
): BatchRatingClient {
  const host = batchHost(options);
  const accessRecords = new WeakMap<BatchRatingAccess, BatchAccessAuthority>();
  const batches = new WeakMap<
    BatchRatingPage,
    NonNullable<ReturnType<typeof batchPage>>
  >();
  const previews = new WeakMap<
    BatchRatingPreview,
    {
      owner: NoticeSession;
      access: BatchRatingAccess;
      record: NonNullable<ReturnType<typeof previewFrom>>;
    }
  >();
  async function discoverBatchRating(
    scope: BatchRatingScope = {},
  ): Promise<BatchRatingDiscovery> {
    if (
      !scope ||
      (scope.forumId !== undefined && !isId(scope.forumId)) ||
      (scope.threadId !== undefined &&
        (!scope.forumId || !isId(scope.threadId)))
    )
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const { forumId, threadId } = scope;
    const api = (action: string, target: Record<string, string> = {}) =>
      pluginURL(host.origin, { id: "tsdmapp:api", action, ...target });
    const status = await host.exchange(api("status"), owner);
    if (status.kind !== "answer") return status;
    const checked = identify(status, owner);
    if (checked.kind !== "data") return checked;
    if (checked.data.ok !== 1 || !on(checked.data.batchrate))
      return { kind: "unavailable" };
    const url = api("batchrate", {
      ...(forumId && { fid: forumId }),
      ...(threadId && { tid: threadId }),
    });
    const reply = await host.exchange(url, owner);
    if (reply.kind !== "answer") return reply;
    const read = identify(reply, owner);
    if (read.kind !== "data") return read;
    const data = read.data;
    if (
      data.type !== "batchrate" ||
      data.schema !== 32 ||
      data.ok !== 1 ||
      id(data.fid) !== (forumId ?? null)
    )
      return { kind: "invalid-response" };
    if (!on(data.installed) || !on(data.supported))
      return { kind: "unavailable" };
    const thread = record(data.thread);
    if (threadId && id(thread?.tid) !== threadId && on(data.can))
      return { kind: "invalid-response" };
    const limits = record(data.limits);
    const maxTotal = count(limits?.max_total),
      chunk = count(limits?.chunk);
    const maxMultiplier = count(limits?.mult_max ?? 99),
      floorSegments = count(limits?.floor_segments ?? 50);
    const credits = creditRows(data.credits ?? []);
    if (!maxTotal || !chunk || !maxMultiplier || !floorSegments || !credits)
      return { kind: "invalid-response" };
    const forms = record(data.forms);
    const confirm = formFrom(forms?.confirm, url, { id: "batchrate:rate" }, [
      "brmode",
    ]);
    const list =
      on(data.can_list) &&
      route(forms?.list_url, url, { id: "batchrate:list" });
    const entry = record(data.entry);
    const modes: BatchRatingMode[] = [];
    const modeMap = record(confirm?.meta.modes);
    if (confirm && on(data.can) && forumId) {
      if (on(entry?.list) && (!modeMap || Object.hasOwn(modeMap, "list")))
        modes.push("threads");
      if (threadId && on(entry?.thread)) {
        if (!modeMap || Object.hasOwn(modeMap, "check")) modes.push("posts");
        if (!modeMap || Object.hasOwn(modeMap, "range")) modes.push("floors");
      }
    }
    const reason = record(data.reason);
    const reasonChoices = Array.isArray(reason?.choices)
      ? reason.choices.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const access: BatchRatingAccess = Object.freeze({
      forumId: forumId ?? null,
      threadId: threadId ?? null,
      version: string(data.batchrate_version) || string(data.version),
      modes: Object.freeze(modes),
      canList: !!list,
      why: string(data.why),
      limits: Object.freeze({ maxTotal, chunk, maxMultiplier, floorSegments }),
      credits,
      reasonRequired: on(reason?.required),
      notifyForced: on(reason?.notify_forced),
      reasonChoices: Object.freeze(reasonChoices),
      antispam: antispam(data.antispam),
    });
    accessRecords.set(access, {
      owner,
      confirm,
      list: list ? list.href : null,
      detail: string(forms?.detail_url),
    });
    return { kind: "batch-rating-access", access };
  }
  function previewResult(
    data: Record<string, unknown>,
    url: string,
    access: BatchRatingAccess,
    selection: BatchRatingSelection,
    owner: NoticeSession,
  ): BatchRatingPreviewResult {
    const record = previewFrom(data, url, access, selection);
    if (!record) return { kind: "invalid-response" };
    previews.set(record.preview, { owner, access, record });
    return { kind: "batch-rating-preview", preview: record.preview };
  }
  async function previewBatchRating(
    access: BatchRatingAccess,
    selection: BatchRatingSelection,
  ): Promise<BatchRatingPreviewResult> {
    const authority = accessRecords.get(access);
    const chosen =
      authority?.confirm &&
      selectionFields(access, authority.confirm, selection);
    if (!authority?.confirm || !chosen) return { kind: "invalid-input" };
    const url = jsonWrite(authority.confirm.url.href);
    const reply = await host.exchange(url, authority.owner, chosen.fields);
    if (reply.kind !== "answer") return reply;
    const read = identify(reply, authority.owner);
    return read.kind === "data"
      ? previewResult(read.data, url, access, chosen.selection, authority.owner)
      : read;
  }
  async function recalculateBatchRating(
    preview: BatchRatingPreview,
    settings: BatchRatingSettings,
  ): Promise<BatchRatingPreviewResult> {
    const offered = previews.get(preview);
    if (!offered) return { kind: "invalid-input" };
    if (!host.current(offered.owner)) return { kind: "session-changed" };
    const request = settingsFields(
      offered.record,
      offered.access,
      settings,
      false,
    );
    if (!request) return { kind: "invalid-input" };
    previews.delete(preview);
    const url = jsonWrite(offered.record.form.url.href);
    const reply = await host.exchange(url, offered.owner, request.fields);
    if (reply.kind !== "answer") return reply;
    const read = identify(reply, offered.owner);
    return read.kind === "data"
      ? previewResult(
          read.data,
          url,
          offered.access,
          request.selection,
          offered.owner,
        )
      : read;
  }
  async function createBatchRating(
    preview: BatchRatingPreview,
    approved: boolean,
  ): Promise<BatchRatingCreation> {
    const offered = previews.get(preview);
    if (!offered) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    if (!host.current(offered.owner)) return { kind: "session-changed" };
    if (!preview.canCreate) return { kind: "refused", code: "preview-blocked" };
    const request = settingsFields(offered.record, offered.access, {}, true);
    if (!request) return { kind: "invalid-response" };
    previews.delete(preview);
    const uncertain = { kind: "uncertain", operation: "create" } as const;
    const url = jsonWrite(offered.record.form.url.href);
    const reply = await host.exchange(url, offered.owner, request.fields, true);
    if (reply.kind !== "answer") return uncertain;
    const read = identify(reply, offered.owner);
    if (read.kind !== "data") return read.kind === "refused" ? read : uncertain;
    if (read.data.type === "batchrate_confirm") {
      const refreshed = previewResult(
        read.data,
        url,
        offered.access,
        request.selection,
        offered.owner,
      );
      return refreshed.kind === "batch-rating-preview" ? refreshed : uncertain;
    }
    const batch = batchPage(read.data, url, offered.owner);
    if (!batch) return uncertain;
    const created = batch.page.record;
    if (
      created.ownerId !== offered.owner.memberId ||
      created.forumId !== preview.forumId ||
      created.threadId !== preview.threadId ||
      created.mode !== preview.selection.mode ||
      (preview.selection.mode === "floors" &&
        created.floors !== preview.selection.floors) ||
      created.reason.trim() !== preview.settings.reason.trim()
    )
      return uncertain;
    const expected = Object.entries(preview.settings.scores).filter(
      ([, score]) => score !== 0,
    );
    if (
      expected.length !== created.scores.length ||
      expected.some(
        ([id, score]) =>
          !created.scores.some(
            (entry) => entry.id === id && entry.score === score,
          ),
      )
    )
      return uncertain;
    batches.set(batch.page, batch);
    return { kind: "batch-rating-created", batch: batch.page };
  }
  return {
    discoverBatchRating,
    previewBatchRating,
    recalculateBatchRating,
    createBatchRating,
    ...batchOperations(host, accessRecords, batches),
  };
}
