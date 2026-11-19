import {
  attr,
  controlDisabled,
  descendants,
  documentFrom,
  hasClass,
  label,
  text,
  type Element,
  type Node,
} from "../html.js";
import { accountFrom } from "../read-thread.js";
import {
  destination,
  positive,
  safeFields,
  sameOrigin,
  type Editor,
  type EditorTarget,
  type Pair,
} from "./forms.js";

const has = (node: Element, name: string) =>
  node.attrs.some((attr) => attr.name === name);

export function documentBody(
  body: string,
  data: Record<string, unknown> | null,
): Node | null {
  const document = data ? data.document : body;
  return typeof document === "string" && /^\s*</.test(document)
    ? documentFrom(document)
    : null;
}

export function memberOf(doc: Node, source: string) {
  const account = accountFrom(doc, source);
  return account.kind === "member" ? account.id : null;
}

function editorForm(doc: Node) {
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === "postform",
  );
  return forms.length === 1 ? forms[0] : undefined;
}

function values(input: Element): Pair[] {
  const name = attr(input, "name");
  const type = attr(input, "type").toLowerCase();
  if (input.tagName === "textarea") return [[name, text(input)]];
  if (input.tagName === "select") {
    const options = descendants(input, (node) => node.tagName === "option");
    const selected = options.filter((node) => has(node, "selected"));
    const active = has(input, "multiple")
      ? selected
      : [selected.at(-1) ?? options.find((option) => !controlDisabled(option))];
    return active.flatMap((node) =>
      node && !controlDisabled(node)
        ? [[name, has(node, "value") ? attr(node, "value") : label(node)]]
        : [],
    );
  }
  if ((type === "checkbox" || type === "radio") && !has(input, "checked"))
    return [];
  return [
    [
      name,
      has(input, "value")
        ? attr(input, "value")
        : type === "checkbox" || type === "radio"
          ? "on"
          : "",
    ],
  ];
}

export function nativeEditor(
  doc: Node,
  source: string,
  target: EditorTarget,
): Editor | null {
  const form = editorForm(doc);
  if (!form || attr(form, "method").toLowerCase() !== "post") return null;
  const to = destination(attr(form, "action"), source, target);
  if (!to) return null;
  const submit = target.threadId ? "editsubmit" : "topicsubmit";
  const controls = descendants(
    form,
    (node) =>
      ["input", "textarea", "select", "button"].includes(node.tagName) &&
      !controlDisabled(node) &&
      !has(node, "form"),
  );
  const active = controls.filter((node) => {
    const name = attr(node, "name");
    const type = attr(node, "type").toLowerCase();
    if (!name || ["file", "button", "reset", "image"].includes(type))
      return false;
    return (node.tagName !== "button" && type !== "submit") || name === submit;
  });
  if (
    active.some((node) =>
      ["formaction", "formmethod", "formenctype"].some((field) =>
        has(node, field),
      ),
    )
  )
    return null;
  const fields = active.flatMap(values);
  if (!safeFields(fields)) return null;
  const body = new URLSearchParams(fields);
  for (const [key, expected] of [
    ["fid", target.boardId],
    ["tid", target.threadId],
    ["pid", target.postId],
  ] as const) {
    if (
      body.getAll(key).length > 1 ||
      (body.has(key) && body.get(key) !== expected) ||
      (expected && !body.has(key) && !to.searchParams.has(key))
    )
      return null;
  }
  if (
    body.getAll("formhash").length !== 1 ||
    !body.get("formhash") ||
    body.getAll("message").length !== 1 ||
    body.getAll("subject").length > 1 ||
    !active.some(
      (node) => node.tagName === "textarea" && attr(node, "name") === "message",
    )
  )
    return null;
  const first = body.has("subject");
  const checkbox = controls.find(
    (node) =>
      attr(node, "name") === "cronpublish" && attr(node, "type") === "checkbox",
  );
  const date = controls.find(
    (node) => attr(node, "name") === "cronpublishdate",
  );
  return {
    url: to.href,
    fields,
    first,
    subject: first
      ? { value: body.get("subject")!, hardMax: 255, unit: "dstrlen" }
      : null,
    message: { value: body.get("message")! },
    canSave:
      body.has("save") &&
      controls.some((node) =>
        /\bpostsave\b.*(?:\.value\s*=\s*['"]?1|\.val\(['"]?1)/.test(
          attr(node, "onclick"),
        ),
      ),
    isDraft: false,
    canPublish: false,
    hooks: [],
    categories: controls
      .filter(
        (node) => node.tagName === "select" && attr(node, "name") === "typeid",
      )
      .flatMap((node) =>
        descendants(
          node,
          (option) => option.tagName === "option" && !controlDisabled(option),
        ),
      )
      .flatMap((node) => {
        const id = positive(attr(node, "value"));
        return id ? [{ id, label: label(node) }] : [];
      }),
    categoryRequired: controls.some(
      (node) => attr(node, "name") === "typeid" && has(node, "required"),
    ),
    scheduleValue:
      checkbox && date ? attr(checkbox, "value") || "on" : undefined,
    scheduledDate:
      checkbox && has(checkbox, "checked")
        ? (body.get("cronpublishdate") ?? "")
        : undefined,
  };
}

export function nativeNeedsBrowser(doc: Node) {
  const form = editorForm(doc);
  return (
    !form ||
    descendants(
      form,
      (node) =>
        /^(?:sec(?:code|qaa)|secanswer)/.test(
          attr(node, "id") || attr(node, "name"),
        ) ||
        (node.tagName === "script" &&
          /\bupdate(?:seccode|secqaa)\s*\(/.test(
            node.childNodes
              .map((child) => ("value" in child ? child.value : ""))
              .join(""),
          )) ||
        (["special", "specialextra", "sortid"].includes(attr(node, "name")) &&
          !["", "0"].includes(attr(node, "value"))),
    ).length > 0
  );
}

export function canonical(doc: Node) {
  const links = descendants(
    doc,
    (node) => node.tagName === "link" && attr(node, "rel") === "canonical",
  );
  return links.length === 1 ? attr(links[0]!, "href") : "";
}

export function nativeThread(
  doc: Node,
  source: string,
  threadId: string,
  memberId: string,
  target: EditorTarget,
) {
  const current = sameOrigin(canonical(doc), source);
  const lists = descendants(doc, (node) => attr(node, "id") === "postlist");
  if (
    !current ||
    resultThread(current) !== threadId ||
    memberOf(doc, source) !== memberId ||
    lists.length !== 1
  )
    return null;
  const list = lists[0]!;
  const heading = descendants(
    list,
    (node) => node.tagName === "h1" && hasClass(node, "ts"),
  );
  if (heading.length !== 1) return null;
  const subject = descendants(
    heading[0]!,
    (node) => attr(node, "id") === "thread_subject",
  );
  if (subject.length !== 1) return null;
  const labels = heading[0]!.childNodes.filter(
    (node): node is Element =>
      "tagName" in node && node.tagName === "span" && node !== subject[0],
  );
  const siblings = heading[0]!.parentNode?.childNodes ?? [];
  const following = siblings
    .slice(siblings.indexOf(heading[0]!) + 1)
    .find((node) => "tagName" in node);
  if (following && "tagName" in following && following.tagName === "span")
    labels.push(following);
  let draftLink = false;
  function statusText(node: Node): string {
    if ("tagName" in node && node.tagName === "a" && hasClass(node, "psave")) {
      const url = sameOrigin(attr(node, "href"), source);
      const query = url?.searchParams;
      if (
        url?.pathname === "/forum.php" &&
        !url.hash &&
        query &&
        query.get("mod") === "misc" &&
        query.get("action") === "pubsave" &&
        query.get("tid") === threadId &&
        [...query.keys()].every(
          (name) =>
            ["mod", "action", "tid"].includes(name) &&
            query.getAll(name).length === 1,
        )
      ) {
        draftLink = true;
        return "";
      }
    }
    return "childNodes" in node
      ? node.childNodes.map(statusText).join("")
      : text(node);
  }
  const notes = labels
    .map(statusText)
    .map((value) => value.replace(/[\s()[\]（）【】]/g, ""))
    .filter(Boolean);
  if (
    notes.some((note) => !/^(?:草稿|审核中|審核中|underreview)$/i.test(note)) ||
    descendants(list, (node) =>
      ["hiderecover", "messagetext"].includes(attr(node, "id")),
    ).length
  )
    return null;
  const draft = draftLink || notes.includes("草稿");
  const moderated = notes.some((note) =>
    /审核中|審核中|underreview/i.test(note),
  );
  if (draft && moderated) return null;
  const posts = descendants(list, (node) =>
    /^post_[1-9]\d*$/.test(attr(node, "id")),
  );
  const matching = target.postId
    ? posts.filter((node) => attr(node, "id") === `post_${target.postId}`)
    : posts.slice(0, 1);
  if (matching.length !== 1) return null;
  const post = matching[0]!;
  if (!target.postId) {
    const header = descendants(
      post,
      (node) => hasClass(node, "pi") && !hasClass(node, "pcb"),
    )[0];
    const anchors = header
      ? descendants(
          header,
          (node) =>
            node.tagName === "a" &&
            node.parentNode !== null &&
            "tagName" in node.parentNode &&
            node.parentNode.tagName === "strong",
        )
      : [];
    if (
      !anchors.some(
        (node) =>
          resultThread(sameOrigin(attr(node, "href"), source)) === threadId ||
          descendants(
            node,
            (child) => child.tagName === "em" && label(child) === "1",
          ).length > 0,
      )
    )
      return null;
  }
  const authors = descendants(post, (node) => hasClass(node, "authi")).flatMap(
    (node) =>
      descendants(
        node,
        (anchor) => anchor.tagName === "a" && hasClass(anchor, "xw1"),
      ),
  );
  if (
    authors.length !== 1 ||
    sameOrigin(attr(authors[0]!, "href"), source)?.searchParams.get("uid") !==
      memberId
  )
    return null;
  return {
    postId: attr(post, "id").slice(5),
    subject: text(subject[0]),
    draft,
    moderated,
  };
}

export function resultThread(url: URL | null) {
  if (!url) return null;
  const rewritten = /^\/thread-([1-9]\d*)-[1-9]\d*-\d+\.html$/.exec(
    url.pathname,
  );
  if (rewritten) return rewritten[1]!;
  const q = url.searchParams;
  return url.pathname === "/forum.php" &&
    q.get("mod") === "viewthread" &&
    ![...q.keys()].some((key) => q.getAll(key).length > 1)
    ? positive(q.get("tid"))
    : null;
}
