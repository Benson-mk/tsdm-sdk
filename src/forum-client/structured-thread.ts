import { integer, object } from "./notice-transport.js";

export function decodeStructuredThread(value: unknown) {
  const payload = object(value);
  return payload?.ok === 1 &&
    payload.type === "thread" &&
    integer(payload.schema, 3)
    ? payload
    : null;
}
