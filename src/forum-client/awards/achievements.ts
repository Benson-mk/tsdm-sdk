import { nativeIdentity } from "../account-forms.js";
import {
  attr,
  byId,
  children,
  descendants,
  documentFrom,
  element,
  hasClass,
  label,
  type Node,
} from "../html.js";
import {
  numericId,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import {
  answer,
  readIssue,
  pluginURL,
  publicRecord,
  readReply,
  rows,
} from "./protocol.js";
import type { AwardsFailure, AwardsView } from "./types.js";

const ignored = new Set([
  "script",
  "style",
  "input",
  "select",
  "textarea",
  "iframe",
]);
const blocks = new Set([
  "p",
  "div",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "br",
  "dt",
  "dd",
]);
function achievementText(node: Node): string {
  if ("value" in node) return node.value;
  if (
    !element(node) ||
    ignored.has(node.tagName) ||
    node.attrs.some(({ name }) => name === "hidden") ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(node, "style"))
  )
    return "";
  if (node.tagName === "progress") {
    const value = attr(node, "value"),
      max = attr(node, "max");
    return value && `${value}${max ? ` / ${max}` : ""}\n`;
  }
  const content = children(node).map(achievementText).join("");
  if (node.tagName === "td" || node.tagName === "th") return `${content}  `;
  return blocks.has(node.tagName) ? `\n${content}\n` : content;
}

function nativeAchievements(
  html: string,
  url: URL,
  memberId: string,
): AwardsView | AwardsFailure {
  const viewer = nativeIdentity(html, url);
  if (viewer === "0") return { kind: "refused" };
  if (!viewer) return { kind: "invalid-response" };
  if (viewer !== memberId) return { kind: "session-changed" };
  const doc = documentFrom(html);
  const container = byId(doc, "ct");
  const heading =
    container &&
    descendants(
      container,
      (n) =>
        n.tagName === "h2" &&
        label(n) === "成就列表" &&
        !!n.parentNode &&
        hasClass(n.parentNode, "bm_h"),
    )[0];
  const header = heading?.parentNode;
  const section = header && element(header) ? header.parentNode : null;
  const body = section && descendants(section, (n) => hasClass(n, "bm_c"))[0];
  if (!body)
    return {
      kind: "invalid-response",
      message: label(byId(doc, "messagetext")) || "Achievement list missing.",
    };
  const content = achievementText(body)
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");
  if (!content) return { kind: "invalid-response" };
  const marker = descendants(body, (n) => hasClass(n, "emp"))[0];
  const empty =
    (content === "暂无成就" || content === "暫無成就") &&
    label(marker) === content;
  return {
    kind: "awards-view",
    catalogue: "achievements",
    memberId,
    records: empty ? [] : [publicRecord({ text: content })],
    metadata: publicRecord({ representation: "native", empty }),
  };
}

export async function readAchievements(
  host: NoticeHost,
  session: NoticeSession,
  structured: URL,
  native: URL,
): Promise<AwardsView | AwardsFailure> {
  const statusURL = pluginURL(host.origin, "tsdmapp:api", { action: "status" });
  const status = await host.request(statusURL.href, session);
  if (status.kind !== "response") return status;
  const flags = answer(status.response).data;
  if (status.response.status !== 404) {
    const issue = readIssue(status.response, flags, session.memberId);
    if (issue) return issue;
  }
  if (
    status.response.status === 200 &&
    flags?.ok === 1 &&
    numericId(flags.uid) === session.memberId &&
    flags.v4 === 1 &&
    flags.achievement === 1
  ) {
    const reply = await readReply(host, structured, session);
    if (reply.kind !== "decoded") return reply;
    const data = reply.data;
    if (
      data?.ok === 1 &&
      data.type === "achievement" &&
      data.schema === 68 &&
      numericId(data.uid) === session.memberId &&
      Array.isArray(data.list)
    ) {
      const records = rows(data.list);
      if (records.length !== data.list.length)
        return { kind: "invalid-response" };
      return {
        kind: "awards-view",
        catalogue: "achievements",
        memberId: session.memberId,
        records: records.map(publicRecord),
        metadata: publicRecord(
          Object.fromEntries(
            ["activated", "achitype", "types"]
              .filter((key) => data[key] !== undefined)
              .map((key) => [key, data[key]]),
          ),
        ),
      };
    }
    if (reply.html && nativeIdentity(reply.html, native) !== null)
      return nativeAchievements(reply.html, native, session.memberId);
  }
  const reply = await readReply(host, native, session);
  return reply.kind === "decoded"
    ? nativeAchievements(reply.html, native, session.memberId)
    : reply;
}
