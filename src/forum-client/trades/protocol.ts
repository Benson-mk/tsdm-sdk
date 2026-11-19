import { numericId, object } from "../notice-transport.js";
import { operationURL } from "../account-forms.js";
import { query } from "../posts/forms.js";

export const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
export const id = (value: unknown): string | null => {
  const normalized = numericId(value);
  return normalized && normalized !== "0" ? normalized : null;
};
export const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
export const forumURL = (origin: string, fields: Record<string, string>) =>
  query(`${origin}/forum.php`, fields);
export const threadURL = (origin: string, threadId: string) =>
  forumURL(origin, { mod: "viewthread", tid: threadId });
export const writeURL = (url: string) => query(url, { tsdmapp: "json" });

export function parsed(body: string) {
  try {
    return object(JSON.parse(body));
  } catch {
    return null;
  }
}

export function forumRoute(
  raw: string,
  source: string,
  required: Record<string, string>,
  extra: readonly string[] = [],
) {
  const url = operationURL(raw, new URL(source), "/forum.php", required);
  return url &&
    [...url.searchParams.keys()].every(
      (key) => Object.hasOwn(required, key) || extra.includes(key),
    )
    ? url
    : null;
}

export function formFields(value: unknown): URLSearchParams | null {
  const fields = object(value);
  if (!fields) return null;
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (!name || typeof value !== "string" || /[\0\r\n]/.test(name))
      return null;
    result.set(name, value);
  }
  return result;
}

export function token(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function refusal(
  data: Record<string, unknown> | null,
  includeMessage = true,
) {
  const code = text(data?.message_key);
  const message = includeMessage ? text(data?.message) : "";
  return {
    kind: "refused" as const,
    ...(code && { code }),
    ...(message && { message }),
  };
}
