import type {
  AdminAction,
  AdminClientOptions,
  AdminCreditAdjustment,
  AdminCreditLookup,
  AdminCredits,
  AdminCreditsAdjusted,
  AdminDuplicate,
  AdminFailure,
  AdminGroup,
  AdminGroupChange,
  AdminGroupAcknowledged,
  AdminMemberLookup,
  AdminReportScope,
  AdminReports,
  AdminReportEffect,
  AdminReportDecision,
  AdminMemberState,
  AdminBanChange,
  AdminBanAcknowledged,
  AdminCleanupCheckpoint,
  AdminCleanupEffect,
} from "./types.js";
import {
  creditQuery,
  decodeCredits,
  rewardForm,
  rewardReceipt,
} from "./credits.js";
import {
  decodeGroup,
  groupForm,
  groupTargetMatches,
  targetQuery,
} from "./groups.js";
import {
  decodeReports,
  deleteForm,
  reportQuery,
  reportReceipt,
  resolveForm,
} from "./reports.js";
import {
  banForm,
  banReceipt,
  cleanupReceipt,
  cleanupSource,
  decodeMemberState,
} from "./bans.js";
import { createAdminWire, type Data } from "./wire.js";

type Wire = ReturnType<typeof createAdminWire>;
type Active = Exclude<ReturnType<Wire["state"]>, AdminFailure>;
const invalid = { kind: "invalid-input" } as const;
const malformed = { kind: "invalid-response" } as const;
const declined = { kind: "not-confirmed" } as const;
const deny = (
  action: AdminAction,
  code: string,
  why?: string,
): AdminFailure => ({ kind: "refused", code, action, ...(why && { why }) });

export function createAdminClient(options: AdminClientOptions) {
  const wire = createAdminWire(options);
  const origin = options.origin;
  const { discoverAdmin, openAdminSession, closeAdminSession } = wire;
  const snapshots = new WeakMap<
    object,
    { action: AdminAction; grant: NonNullable<Active["grant"]> }
  >();
  const opIds = new WeakMap<Active, Map<string, string>>();
  function permission(current: Active, action: AdminAction, write: boolean) {
    const access = current.access;
    if (!access) return deny(action, "discover-required");
    if (!access.enabled) return deny(action, "admin_off");
    const cap = access.capabilities[action];
    if (!access.eligible || !cap?.[write ? "write" : "read"])
      return deny(action, "admin_noperm", "perm");
    if (!current.grant) return deny(action, "admin_login");
    return null;
  }
  function withAction(
    error: AdminFailure,
    action: AdminAction,
    current: Active,
    write: boolean,
  ): AdminFailure {
    if (error.kind !== "refused") return error;
    if (
      error.code === "admin_noperm" &&
      current.access &&
      ["perm", "allowpost"].includes(error.why ?? "")
    ) {
      const prior = current.access.capabilities[action];
      const cap = Object.freeze({
        read: Boolean(prior?.read && (write || error.why === "allowpost")),
        write: false,
      });
      current.access = Object.freeze({
        ...current.access,
        capabilities: Object.freeze({
          ...current.access.capabilities,
          [action]: cap,
        }),
      });
    }
    return { ...error, action };
  }
  function read<T extends object>(
    action: AdminAction,
    query: Record<string, string>,
    decode: (data: Data) => T | null,
  ): Promise<T | AdminFailure> {
    return wire.exclusive(async () => {
      const current = wire.state();
      if ("kind" in current) return current;
      const fault = permission(current, action, false);
      if (fault) return fault;
      const grant = current.grant!;
      const result = await wire.request(
        current,
        action,
        query,
        undefined,
        grant,
      );
      if (result.kind !== "answer")
        return withAction(result, action, current, false);
      const page = decode(result.data);
      if (!page) return malformed;
      if (current.grant === grant) snapshots.set(page, { action, grant });
      return page;
    });
  }
  async function mutate<T>(
    action: AdminAction,
    operation: string,
    source: object,
    approved: boolean,
    form: () => Record<string, string> | AdminFailure | null,
    operationId: string | undefined,
    decode: (
      data: Data,
      fields: Record<string, string>,
      grant: NonNullable<Active["grant"]> | null,
    ) => T | null,
  ): Promise<T | AdminDuplicate | AdminFailure> {
    if (approved !== true) return declined;
    return wire.exclusive(async () => {
      const current = wire.state();
      if ("kind" in current) return current;
      const fault = permission(current, action, true);
      if (fault) return fault;
      const scope = snapshots.get(source);
      if (!scope || scope.action !== action || scope.grant !== current.grant)
        return invalid;
      if (!current.hash) return deny(action, "refresh-required");
      const fields = form();
      if (!fields) return invalid;
      // Builders only return an error object for a target-specific refusal.
      if ("kind" in fields) return fields as AdminFailure;
      if (
        operation !== "clear" &&
        (typeof operationId !== "string" || !/^[\w-]{8,64}$/.test(operationId))
      )
        return invalid;
      if (operationId !== undefined) {
        let ids = opIds.get(current);
        if (!ids) {
          ids = new Map();
          opIds.set(current, ids);
        }
        const signature = JSON.stringify([
          action,
          operation,
          Object.entries(fields).sort(),
        ]);
        const existing = ids.get(operationId);
        if (existing && existing !== signature) return invalid;
        ids.set(operationId, signature);
      }
      snapshots.delete(source);
      const result = await wire.request(
        current,
        action,
        {},
        { ...fields, ...(operationId !== undefined && { opid: operationId }) },
        current.grant!,
      );
      if (result.kind === "refused") {
        if (result.code === "duplicate" && operationId !== undefined)
          return { kind: "duplicate" as const, operation, operationId };
        return withAction(result, action, current, true);
      }
      const outcome =
        result.kind === "answer"
          ? decode(result.data, fields, current.grant)
          : null;
      return (
        outcome ?? {
          kind: "uncertain" as const,
          operation,
          ...(operationId !== undefined && { operationId }),
        }
      );
    });
  }
  function readAdminCredits(
    target: AdminCreditLookup = {},
  ): Promise<AdminCredits | AdminFailure> {
    const query = creditQuery(target);
    return query
      ? read("admincredit", query, (data) => decodeCredits(data, query))
      : Promise.resolve(invalid);
  }
  function adjustAdminCredits(
    source: AdminCredits,
    intent: AdminCreditAdjustment,
    approved: boolean,
  ): Promise<AdminCreditsAdjusted | AdminDuplicate | AdminFailure> {
    const operationId = intent?.operationId;
    return mutate(
      "admincredit",
      "reward",
      source,
      approved,
      () => rewardForm(source, intent),
      operationId,
      (data, fields) => rewardReceipt(data, fields, operationId),
    );
  }
  function readAdminGroup(
    target: AdminMemberLookup,
  ): Promise<AdminGroup | AdminFailure> {
    const query = targetQuery(target);
    return query
      ? read("admingroup", query, (data) => decodeGroup(data, query))
      : Promise.resolve(invalid);
  }
  function changeAdminGroup(
    source: AdminGroup,
    intent: AdminGroupChange,
    approved: boolean,
  ): Promise<AdminGroupAcknowledged | AdminDuplicate | AdminFailure> {
    const operationId = intent?.operationId;
    return mutate(
      "admingroup",
      "group",
      source,
      approved,
      () =>
        source.canChange
          ? groupForm(source, intent)
          : deny("admingroup", "admin_noperm", source.why),
      operationId,
      (data) =>
        data.type === "admingroup" &&
        data.schema === 27 &&
        data.op === "group" &&
        groupTargetMatches(data, source.member.memberId)
          ? {
              kind: "group-acknowledged",
              memberId: source.member.memberId,
              operationId,
            }
          : null,
    );
  }
  function readAdminReports(
    scope: AdminReportScope,
    page = 1,
  ): Promise<AdminReports | AdminFailure> {
    const query = reportQuery(scope, page);
    return query
      ? read("adminreport", query, (data) => decodeReports(data, scope, origin))
      : Promise.resolve(invalid);
  }
  function resolveAdminReports(
    source: AdminReports,
    decisions: readonly AdminReportDecision[],
    operationId: string,
    approved: boolean,
  ): Promise<AdminReportEffect | AdminDuplicate | AdminFailure> {
    return mutate(
      "adminreport",
      "resolve",
      source,
      approved,
      () => resolveForm(source, decisions),
      operationId,
      (data, fields) => reportReceipt(data, fields, operationId),
    );
  }
  function deleteAdminReports(
    source: AdminReports,
    reportIds: readonly string[],
    operationId: string,
    approved: boolean,
  ): Promise<AdminReportEffect | AdminDuplicate | AdminFailure> {
    return mutate(
      "adminreport",
      "delete",
      source,
      approved,
      () => deleteForm(source, reportIds),
      operationId,
      (data, fields) => reportReceipt(data, fields, operationId),
    );
  }
  function readAdminMemberState(
    target: AdminMemberLookup,
  ): Promise<AdminMemberState | AdminFailure> {
    const query = targetQuery(target);
    return query
      ? read("adminban", query, (data) => decodeMemberState(data, query))
      : Promise.resolve(invalid);
  }
  function changeAdminBan(
    source: AdminMemberState,
    intent: AdminBanChange,
    approved: boolean,
  ): Promise<AdminBanAcknowledged | AdminDuplicate | AdminFailure> {
    const operationId = intent?.operationId;
    return mutate(
      "adminban",
      "ban",
      source,
      approved,
      () =>
        source.canChange
          ? banForm(source, intent)
          : deny("adminban", "admin_noperm", source.why),
      operationId,
      (data, fields, grant) => {
        const result = banReceipt(data, fields, operationId);
        if (result?.cleanup && grant)
          snapshots.set(result.cleanup, { action: "adminban", grant });
        return result;
      },
    );
  }
  async function stepAdminCleanup(
    source: AdminMemberState | AdminCleanupCheckpoint,
    approved: boolean,
  ): Promise<AdminCleanupEffect | AdminFailure> {
    let selected: AdminCleanupCheckpoint | null = null;
    const result = await mutate(
      "adminban",
      "clear",
      source,
      approved,
      () => {
        if (source.kind === "admin-member-state" && !source.canChange)
          return deny("adminban", "admin_noperm", source.why);
        selected = cleanupSource(source);
        return selected
          ? { op: "clear", uid: selected.memberId, cursor: selected.cursor }
          : null;
      },
      undefined,
      (data, _fields, grant) => {
        const step = selected && cleanupReceipt(data, selected);
        if (step?.kind === "cleanup-progress" && grant)
          snapshots.set(step.next, { action: "adminban", grant });
        return step;
      },
    );
    return result.kind === "duplicate"
      ? { kind: "uncertain", operation: "clear" }
      : result;
  }
  return {
    discoverAdmin,
    openAdminSession,
    closeAdminSession,
    readAdminCredits,
    adjustAdminCredits,
    readAdminGroup,
    changeAdminGroup,
    readAdminReports,
    resolveAdminReports,
    deleteAdminReports,
    readAdminMemberState,
    changeAdminBan,
    stepAdminCleanup,
  };
}
