import { numericId, object } from "./notice-transport.js";
import type { HostResponse } from "./types.js";

export function v4StatusURL(origin: string) {
  return new URL("/plugin.php?id=tsdmapp%3Aapi&action=status", origin).href;
}

export type V4CapabilityGroup =
  | "forms"
  | "space_pages"
  | "task_pages"
  | "magic_pages"
  | "credit_pages"
  | "thread_lists"
  | "block_pages"
  | "announce";

export function selectV4(
  response: HostResponse,
  url: string,
  group: V4CapabilityGroup,
  operation: string,
  memberId?: string,
) {
  if (response.redirect !== "none" || response.url !== url)
    return { kind: "legacy" } as const;
  let data;
  try {
    data = object(JSON.parse(response.body));
  } catch {
    data = null;
  }
  if (response.status === 429 || data?.error === "busy")
    return { kind: "limited" } as const;
  if (response.status !== 200 || data?.ok !== 1)
    return { kind: "legacy" } as const;
  const viewer = numericId(data.uid);
  if (viewer === null) return { kind: "legacy" } as const;
  if (memberId !== undefined && viewer !== memberId)
    return { kind: "session-changed" } as const;
  const names = data[group];
  return {
    kind:
      data.v4 === 1 &&
      (group === "announce"
        ? names === 1
        : Array.isArray(names) && names.includes(operation))
        ? ("v4" as const)
        : ("legacy" as const),
    viewer,
  };
}

export async function v4ForMember(
  origin: string,
  group: V4CapabilityGroup,
  operation: string,
  memberId: string,
  exchange: (
    url: string,
  ) => Promise<
    | { kind: "response"; response: HostResponse }
    | { kind: "session-changed" | "network" | "invalid-response" }
  >,
) {
  const url = v4StatusURL(origin);
  const reply = await exchange(url);
  if (reply.kind === "session-changed")
    return { kind: "session-changed" } as const;
  if (reply.kind !== "response") return { kind: "legacy" } as const;
  const selected = selectV4(reply.response, url, group, operation, memberId);
  return selected.kind === "limited"
    ? ({ kind: "refused", code: "rate-limited" } as const)
    : selected;
}

export function unsupportedV4(data: Record<string, unknown> | null) {
  return (
    data?.ok === 0 &&
    ["off", "action", "unknown", "internal"].includes(String(data.error))
  );
}
