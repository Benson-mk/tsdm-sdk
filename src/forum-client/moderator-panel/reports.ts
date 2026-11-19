import type {
  ModeratorReportItem,
  ModeratorReportsPage,
  ModeratorReportDecision,
  ModeratorReportsResult,
  ModeratorReportResolution,
  ModeratorReportDeletionHandoff,
} from "./types.js";
import type { PanelFailure, PanelLoginOffer } from "./types.js";
import type { ActivitySession } from "../activity-client.js";
import { id, record, string } from "../activity-protocol.js";
import {
  exactFields,
  formhash,
  jsonRead,
  pageNumber,
  panelDestination,
  panelRefusal,
  panelRoute,
  positive,
  routeKeys,
  validSelection,
  type PanelContext,
  type PanelFields,
} from "./protocol.js";

export function panelReports(panel: PanelContext) {
  const bindings = new WeakMap<
    ModeratorReportsPage,
    { owner: ActivitySession; submit: { url: URL; fields: PanelFields } | null }
  >();
  return {
    async readReports(
      forumId = "0",
      page = 1,
    ): Promise<ModeratorReportsResult> {
      if ((forumId !== "0" && !positive(forumId)) || !pageNumber(page))
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const url = panelRoute(panel.origin, {
        action: "report",
        ...(forumId !== "0" && { fid: forumId }),
        ...(page > 1 && { page: String(page) }),
        ...jsonRead,
      });
      const reply = await panel.read(url, owner);
      if (reply.kind !== "response") return reply;
      const data = reply.parsed.data;
      if (
        data?.ok !== 1 ||
        id(data.uid) !== owner.memberId ||
        data.type !== "modcp_report" ||
        data.schema !== 28 ||
        String(data.fid) !== forumId ||
        !Array.isArray(data.reports) ||
        !pageNumber(data.page) ||
        !(data.pages === 0 || pageNumber(data.pages))
      )
        return { kind: "invalid-response" };
      const items: ModeratorReportItem[] = [];
      for (const raw of data.reports) {
        const row = record(raw);
        const itemId = id(row?.id);
        if (
          !row ||
          !itemId ||
          id(row.fid) !== forumId ||
          items.some((item) => item.id === itemId)
        )
          return { kind: "invalid-response" };
        items.push(
          Object.freeze({
            id: itemId,
            postId: id(row.pid),
            threadId: id(row.tid),
            reporterId: id(row.uid),
            message: string(row.message),
          }),
        );
      }
      const forums = (Array.isArray(data.forums) ? data.forums : []).flatMap(
        (raw) => {
          const row = record(raw);
          const forumId = id(row?.fid);
          return forumId
            ? [Object.freeze({ id: forumId, name: string(row?.name) })]
            : [];
        },
      );
      const value = record(data.reward);
      const reward =
        value?.enabled === 1 &&
        typeof value.min === "number" &&
        typeof value.max === "number" &&
        Number.isSafeInteger(value.min) &&
        Number.isSafeInteger(value.max) &&
        value.min <= value.max
          ? Object.freeze({ min: value.min, max: value.max })
          : null;
      const offered = record(data.submit);
      const target = panelDestination(string(offered?.url), url, "report");
      const fields = exactFields(offered?.fields, ["formhash", "reportsubmit"]);
      const submit =
        forumId !== "0" &&
        data.need_forum !== 1 &&
        target &&
        routeKeys(target, ["fid", "lpp", "tsdmapp"]) &&
        target.searchParams.get("fid") === forumId &&
        !target.searchParams.has("op") &&
        offered?.method === "POST" &&
        offered.ids_field === "reportids[]" &&
        offered.uid_field === "reportuids[{id}]" &&
        offered.credit_field === "creditsvalue[{id}]" &&
        offered.msg_field === "msg[{id}]" &&
        fields?.reportsubmit === "true" &&
        formhash(fields.formhash)
          ? { url: target, fields }
          : null;
      const offeredPage = Object.freeze({
        forumId,
        items: Object.freeze(items),
        forums: Object.freeze(forums),
        page: data.page,
        pages: data.pages || 1,
        canResolve: !!submit,
        canDelete: false as const,
        reward,
      });
      bindings.set(offeredPage, { owner, submit });
      return { kind: "reports", page: offeredPage };
    },
    async resolveReport(
      page: ModeratorReportsPage,
      decision: ModeratorReportDecision,
      confirmed: boolean,
    ): Promise<ModeratorReportResolution> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      if (!bound.submit)
        return { kind: "refused", code: "report-resolution-unavailable" };
      const item = page.items.find((item) => item.id === decision?.id);
      const { credit = 0, message = "" } = decision ?? {};
      if (
        !item?.reporterId ||
        !Number.isSafeInteger(credit) ||
        typeof message !== "string" ||
        (!page.reward && (credit !== 0 || message.trim())) ||
        (page.reward &&
          credit !== 0 &&
          (credit < page.reward.min || credit > page.reward.max))
      )
        return { kind: "invalid-input" };
      const fields = new URLSearchParams(bound.submit.fields);
      fields.set("reportids[0]", item.id);
      fields.set(`reportuids[${item.id}]`, item.reporterId);
      if (credit !== 0) fields.set(`creditsvalue[${item.id}]`, String(credit));
      if (message.trim()) fields.set(`msg[${item.id}]`, message.trim());
      bindings.delete(page);
      const reply = await panel.write(bound.submit.url, bound.owner, fields);
      if (reply.kind !== "response") return reply;
      const { data } = reply.parsed;
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return problem;
      if (
        data?.ok === 1 &&
        id(data.uid) === bound.owner.memberId &&
        data.type === "result" &&
        data.schema === 13 &&
        (data.kind === "message" || data.kind === "handle") &&
        data.message_key === "modcp_report_success"
      )
        return {
          kind: "acknowledged",
          id: item.id,
          code: "modcp_report_success",
        };
      return { kind: "uncertain" };
    },
    async prepareReportDeletion(
      page: ModeratorReportsPage,
      ids: readonly string[],
      confirmed: boolean,
    ): Promise<PanelFailure | ModeratorReportDeletionHandoff> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      if (
        !positive(page.forumId) ||
        !validSelection(
          ids,
          page.items.map((item) => item.id),
        )
      )
        return { kind: "invalid-input" };
      return Object.freeze({
        kind: "admin-report-deletion",
        origin: panel.origin,
        forumId: page.forumId,
        reportIds: Object.freeze([...ids]),
      });
    },
    async deleteReports(
      page: ModeratorReportsPage,
      ids: readonly string[],
      confirmed: boolean,
    ): Promise<PanelFailure> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => !page.items.some((item) => item.id === id))
      )
        return { kind: "invalid-input" };
      return { kind: "refused", code: "panel-report-delete-unavailable" };
    },
  };
}
