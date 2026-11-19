import { panelForms } from "../native.js";
import {
  attr,
  controlDisabled,
  descendants,
  type Node,
  type Element,
} from "../../html.js";
import type { ActivitySession } from "../../activity-client.js";
import { id, record, string } from "../../activity-protocol.js";
import {
  addQuery,
  exactFields,
  formhash,
  panelDestination,
  discoverPanelMode,
  jsonV4Read,
  panelRoute,
  type PanelContext,
  type PanelFields,
} from "../protocol.js";
import type { PanelFailure } from "../types.js";
import type {
  PanelSettingOperation,
  PanelSettingOutcome,
} from "../settings-types.js";

export type Data = Record<string, unknown>;
export type PanelReply = Extract<
  Awaited<ReturnType<PanelContext["read"]>>,
  { kind: "response" }
>;
export const boundData = (
  data: Data | null,
  type: string,
  schema: number,
  owner: ActivitySession,
): data is Data =>
  data?.ok === 1 &&
  data.type === type &&
  data.schema === schema &&
  id(data.uid) === owner.memberId;
export interface SettingsForm {
  url: URL;
  fields: PanelFields;
}
export function structuredForm(
  value: unknown,
  source: URL,
  action: string,
  op: string | undefined,
  fixed: readonly string[],
  query: Readonly<Record<string, string>> = { tsdmapp: "json" },
): SettingsForm | null {
  const data = record(value);
  const url = panelDestination(string(data?.url), source, action, op);
  const fields = exactFields(data?.fields, fixed);
  const allowed = new Set([
    "mod",
    "action",
    ...(op === undefined ? [] : ["op"]),
  ]);
  if (
    data?.method !== "POST" ||
    !url ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    !fields ||
    !formhash(fields.formhash)
  )
    return null;
  return { url: addQuery(url, { ...query }), fields };
}
export const attributed = (
  operation: PanelSettingOperation,
  result: PanelFailure,
): PanelSettingOutcome => ({ ...result, operation });
export const verdict = (
  operation: PanelSettingOperation,
  kind: "acknowledged" | "completed" | "redrawn" | "uncertain",
): PanelSettingOutcome => ({ kind, operation });
export const settingRefused = (
  operation: PanelSettingOperation,
  code: string,
): PanelSettingOutcome => ({ kind: "refused", operation, code });
export function offeredForums(value: unknown) {
  return Object.freeze(
    (Array.isArray(value) ? value : []).flatMap((raw) => {
      const row = record(raw),
        fid = id(row?.fid);
      return fid ? [Object.freeze({ id: fid, name: string(row?.name) })] : [];
    }),
  );
}

export async function readSettingPage(
  panel: PanelContext,
  owner: ActivitySession,
  path: PanelFields,
  capability: string,
  type: string,
) {
  const supported = await discoverPanelMode(panel, owner, capability);
  if (typeof supported !== "boolean") return supported;
  const url = panelRoute(panel.origin, {
    ...path,
    ...(supported && jsonV4Read),
  });
  const reply = await panel.read(url, owner);
  if (reply.kind !== "response") return reply;
  if (!supported || reply.parsed.data?.type === type || reply.parsed.html)
    return {
      ...reply,
      url,
      structured: supported && reply.parsed.data?.type === type,
    };
  const native = panelRoute(panel.origin, path);
  const fallback = await panel.read(native, owner);
  return fallback.kind === "response"
    ? { ...fallback, url: native, structured: false }
    : fallback;
}
export function nativeSettingForms(
  doc: Node,
  source: URL,
  action: string,
  op?: string,
): Element[] {
  return panelForms(doc, source, action, op).filter((form) => {
    const url = panelDestination(attr(form, "action"), source, action, op);
    return url?.searchParams.size === (op === undefined ? 2 : 3);
  });
}
export function control(
  form: Node,
  name: string,
  tag?: string,
): Element | undefined {
  const nodes = descendants(
    form,
    (node) =>
      attr(node, "name") === name &&
      (!tag || node.tagName === tag) &&
      !controlDisabled(node),
  );
  return nodes.length === 1 ? nodes[0] : undefined;
}
export function resultKey(data: Data | null, owner: ActivitySession) {
  return boundData(data, "result", 13, owner) &&
    (data.kind === "message" || data.kind === "handle") &&
    data.alert !== "error"
    ? string(data.message_key)
    : "";
}
export const jsonWrite = { tsdmapp: "json" } as const;
