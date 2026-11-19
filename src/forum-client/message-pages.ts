import { documentFrom, fragmentFrom, content } from "./html.js";
import { object } from "./notice-transport.js";
import type { ContentNode, HostResponse } from "./types.js";

export function messageJSON(body: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(body));
  } catch {
    return null;
  }
}

export function pageSource(
  response: HostResponse,
  data: Record<string, unknown> | null,
): string {
  if (!data) return response.body;
  return `${typeof data.head === "string" ? data.head : ""}${typeof data.document === "string" ? data.document : ""}`;
}

export function pageDocument(
  response: HostResponse,
  data: Record<string, unknown> | null,
): ReturnType<typeof documentFrom> {
  return documentFrom(pageSource(response, data));
}

export function messageBody(html: string, base: URL): ContentNode[] {
  return content(fragmentFrom(html), base.href);
}
