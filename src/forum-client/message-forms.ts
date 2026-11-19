import { routeFor } from "./routes.js";
import { operationURL, scripts, token, unwrap } from "./account-forms.js";
import {
  attr,
  children,
  content,
  controlDisabled,
  descendants,
  fragmentFrom,
  hasClass,
  label,
  type Element,
  type Node,
} from "./html.js";
import { numericId, object } from "./notice-transport.js";

const sendQuery = { mod: "spacecp", ac: "pm", op: "send" };
export const chatQuery = { mod: "spacecp", ac: "pm", op: "showmsg" };

export interface MessageForm {
  url: URL;
  fields: Record<string, string>;
  handler: string;
  maxLength: number | null;
}

function parseForm(
  doc: Node,
  id: string,
  hidden: readonly string[],
  history = false,
) {
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === id,
  );
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    attr(form, "method").toLowerCase() !== "post" ||
    descendants(doc, (node) => attr(node, "form") === id).length
  )
    return null;
  const inputs = descendants(form, (node) =>
    ["input", "textarea", "select", "button"].includes(node.tagName),
  );
  const fields: Record<string, string> = Object.create(null);
  let message: Element | undefined;
  for (const input of inputs) {
    const name = attr(input, "name");
    if (input.tagName === "button" && !name) continue;
    if (
      controlDisabled(input) ||
      attr(input, "form") ||
      input.attrs.some(({ name }) => name.startsWith("form"))
    )
      return null;
    if (
      history &&
      name === "pmsubmit" &&
      !(name in fields) &&
      ((input.tagName === "button" && attr(input, "type") === "submit") ||
        (input.tagName === "input" &&
          ["hidden", "submit"].includes(attr(input, "type")))) &&
      ["true", "yes"].includes(attr(input, "value"))
    ) {
      fields[name] = attr(input, "value");
      continue;
    }
    if (
      input.tagName === "textarea" &&
      name === "message" &&
      !message &&
      !input.attrs.some(({ name }) => name === "readonly")
    ) {
      message = input;
    } else if (
      input.tagName === "input" &&
      attr(input, "type").toLowerCase() === "hidden" &&
      hidden.includes(name) &&
      !(name in fields)
    ) {
      fields[name] = attr(input, "value");
    } else return null;
  }
  const length = message && attr(message, "maxlength");
  if (
    !message ||
    hidden.some((name) => !(name in fields)) ||
    !token(fields.formhash) ||
    (length &&
      (!/^[1-9]\d*$/.test(length) || !Number.isSafeInteger(Number(length))))
  )
    return null;
  return {
    action: attr(form, "action"),
    fields,
    maxLength: length ? Number(length) : null,
  };
}

export function dialogForm(
  doc: Node,
  peer: string,
  base: URL,
): MessageForm | null {
  const form = parseForm(doc, `pmform_${peer}`, [
    "pmsubmit",
    "touid",
    "formhash",
    "handlekey",
    "messageappend",
  ]);
  const handler = `showmsg_${peer}`;
  if (
    !form ||
    form.fields.touid !== peer ||
    form.fields.handlekey !== handler ||
    form.fields.pmsubmit !== "true"
  )
    return null;
  const url = operationURL(form.action, base, "/home.php", {
    ...sendQuery,
    touid: peer,
  });
  if (!url || [...url.searchParams].length !== 4) return null;
  url.searchParams.set("inajax", "1");
  return { url, fields: form.fields, handler, maxLength: form.maxLength };
}

function historyURL(action: string, base: URL, peer: string, pmid: string) {
  const query = {
    ...sendQuery,
    pmid,
    daterange: "0",
    handlekey: "pmsend",
    pmsubmit: "yes",
  };
  const url = operationURL(action, base, "/home.php", query);
  if (
    !url ||
    [...url.searchParams.keys()].some(
      (key) => !(key in query) && key !== "topmuid",
    ) ||
    (url.searchParams.has("topmuid") &&
      url.searchParams.get("topmuid") !== peer)
  )
    return null;
  url.searchParams.set("topmuid", peer);
  return url;
}

export function historyForm(args: {
  doc?: Node;
  data?: Record<string, unknown>;
  peer: string;
  base: URL;
  ids: ReadonlySet<string>;
}): MessageForm | null {
  const { doc, data, peer, base, ids } = args;
  if (data) {
    const reply = object(data.reply);
    const pmid = numericId(reply?.pmid);
    const formhash = token(data.formhash);
    if (
      !reply ||
      !pmid ||
      !ids.has(pmid) ||
      numericId(reply.topmuid) !== peer ||
      typeof reply.action !== "string" ||
      !formhash
    )
      return null;
    const url = historyURL(reply.action, base, peer, pmid);
    return (
      url && { url, fields: { formhash }, handler: "pmsend", maxLength: null }
    );
  }
  if (!doc) return null;
  const form = parseForm(doc, "pmform", ["formhash", "topmuid"], true);
  if (!form || form.fields.topmuid !== peer) return null;
  const action = operationURL(form.action, base, "/home.php", sendQuery);
  const pmid = action?.searchParams.get("pmid");
  if (!pmid || !ids.has(pmid)) return null;
  const url = historyURL(form.action, base, peer, pmid);
  return (
    url && {
      url,
      fields: { formhash: form.fields.formhash! },
      handler: "pmsend",
      maxLength: form.maxLength,
    }
  );
}

export function chatDocument(body: string): Node | null {
  const markup = unwrap(body);
  return markup === body ? null : fragmentFrom(markup);
}

export function chatMessages(root: Node, base: URL) {
  const messages = [];
  let date: string | null = null;
  for (const row of children(root)) {
    if ("value" in row && row.value.trim() === "") continue;
    if (row.nodeName === "#comment") continue;
    if (!(row.nodeName === "li")) return null;
    const heading = children(row).find((node) => node.nodeName === "h4");
    if (heading) {
      date = label(heading);
      continue;
    }
    const bodies = descendants(row, (node) => hasClass(node, "pmd"));
    const names = descendants(row, (node) => hasClass(node, "pmt"));
    if (bodies.length !== 1 || names.length !== 1) return null;
    messages.push({
      date,
      senderLabel: label(names[0]),
      body: content(bodies[0]!, base.href),
    });
  }
  return messages;
}

export function matchesSendDestination(
  destination: unknown,
  base: URL,
  peer: string,
) {
  if (destination === undefined || destination === "") return true;
  if (typeof destination !== "string") return false;
  try {
    const route = routeFor(new URL(destination, base).href);
    return (
      route?.kind === "private-conversation" &&
      route.url.origin === base.origin &&
      route.url.searchParams.get("touid") === peer
    );
  } catch {
    return false;
  }
}

export function nativeSendResult(
  body: string,
  handler: string,
  base: URL,
  peer: string,
) {
  if (!chatDocument(body)) return null;
  const source = scripts(body);
  // Capture literal handler calls in the XML response. Never evaluate the script.
  const accepted = [
    ...source.matchAll(
      /\bsucceedhandle_(\w+)\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2\s*,\s*(['"])(?:\\.|(?!\4)[^\\])*\4\s*,\s*\{([^{}]*)\}\s*\)/g,
    ),
  ];
  const rejected = [...source.matchAll(/\berrorhandle_(\w+)\(\s*['"]/g)];
  if (
    accepted.length === 0 &&
    rejected.length === 1 &&
    rejected[0]?.[1] === handler
  )
    return { kind: "refused", code: null } as const;
  if (
    accepted.length !== 1 ||
    rejected.length ||
    ![handler, "pmsend"].includes(accepted[0]?.[1] ?? "")
  )
    return null;
  if (!matchesSendDestination(accepted[0]?.[3], base, peer)) return null;
  const messageId =
    /(?:^|,)\s*['"]?pmid['"]?\s*:\s*['"]?([1-9]\d*)['"]?\s*(?:,|$)/.exec(
      accepted[0]?.[5] ?? "",
    )?.[1] ?? null;
  return { kind: "accepted", messageId } as const;
}
