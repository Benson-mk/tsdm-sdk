import { decodeHTML } from "entities";
import { documentFrom, label } from "./html.js";
import { object } from "./notice-transport.js";
import { safeURL } from "./routes.js";
import type { NoticeSession } from "./notice-transport.js";

export type ReplyVerification = "image" | "question";
export type ReplyVerificationPrompt =
  | {
      kind: "image";
      destination: string;
      referer: string;
      session: NoticeSession;
    }
  | { kind: "question"; text: string }
  | { kind: "browser-handoff"; destination: string; message: string }
  | { kind: "unavailable" };
export type ReplyVerificationCheck = {
  kind: "accepted" | "rejected" | "inconclusive";
};

export type VerificationField =
  | { kind: "image"; hash: string; modid: string }
  | { kind: "question"; hash: string };
export function verificationFields(value: unknown): VerificationField[] | null {
  if (value == null) return [];
  const data = object(value);
  if (!data) return null;
  const fields: VerificationField[] = [];
  for (const [key, kind] of [
    ["seccode", "image"],
    ["secqaa", "question"],
  ] as const) {
    const requested = data[key];
    if (requested === undefined || requested === 0 || requested === false)
      continue;
    const hash = data[`${key}_hash`];
    if (
      (requested !== 1 && requested !== true) ||
      typeof hash !== "string" ||
      !/^\w+$/.test(hash)
    )
      return null;
    if (kind === "image") {
      if (typeof data.modid !== "string" || !/^[\w:]+$/.test(data.modid))
        return null;
      fields.push({ kind, hash, modid: data.modid });
    } else fields.push({ kind, hash });
  }
  return fields;
}
export function verificationURL(
  origin: string,
  field: VerificationField,
  answer?: string,
) {
  const url = new URL("/misc.php", origin);
  const query = url.searchParams;
  query.set("mod", field.kind === "image" ? "seccode" : "secqaa");
  query.set("action", answer === undefined ? "update" : "check");
  query.set("idhash", field.hash);
  if (field.kind === "image") query.set("modid", field.modid);
  if (answer !== undefined || field.kind === "question")
    query.set("inajax", "1");
  if (answer === undefined) query.set(String(Date.now()), "");
  else query.set("secverify", answer);
  return url.href;
}
export function ajaxText(body: string) {
  const inner =
    /^\s*(?:<\?xml[^?]*\?>\s*)?<root>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/root>\s*$/.exec(
      body,
    )?.[1];
  return label(documentFrom(inner ?? body));
}
export function verificationImage(
  body: string,
  origin: string,
  field: VerificationField,
) {
  const matches = [
    ...body.matchAll(/\bsrc=\\?["'](misc\.php\?mod=seccode[^"'\\]*)\\?["']/g),
  ];
  const candidate = matches.length === 1 ? matches[0]?.[1] : undefined;
  const url = candidate && safeURL(decodeHTML(candidate), origin + "/");
  if (!url || url.origin !== origin || url.pathname !== "/misc.php" || url.hash)
    return null;
  const query = url.searchParams;
  if (
    query.get("idhash") !== field.hash ||
    query.get("mod") !== "seccode" ||
    !query.get("update") ||
    [...query.keys()].some(
      (key) =>
        !["mod", "action", "idhash", "update"].includes(key) ||
        query.getAll(key).length !== 1,
    ) ||
    (query.has("action") && query.get("action") !== "image")
  )
    return null;
  return url.href;
}
