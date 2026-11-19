import { id } from "../activity-protocol.js";
import {
  attr,
  controlDisabled,
  descendants,
  hasClass,
  label,
  type Element,
  type Node,
} from "../html.js";
import { panelDestination, positive } from "./protocol.js";

export const panelForms = (
  doc: Node,
  source: URL,
  action: string,
  op?: string,
): Element[] =>
  descendants(
    doc,
    (node) =>
      node.tagName === "form" &&
      attr(node, "method").toLowerCase() === "post" &&
      panelDestination(attr(node, "action"), source, action, op) !== null,
  );
export const activePanelTab = (
  doc: Node,
  source: URL,
  action: string,
  op?: string,
) =>
  descendants(doc, (node) => node.tagName === "li" && hasClass(node, "a")).some(
    (tab) =>
      descendants(tab, (node) => node.tagName === "a").some((link) =>
        panelDestination(attr(link, "href"), source, action, op),
      ),
  );
export function selectedForum(doc: Node) {
  const select = descendants(
    doc,
    (node) => node.tagName === "select" && attr(node, "name") === "fid",
  );
  if (select.length !== 1) return null;
  const selected = descendants(
    select[0]!,
    (node) =>
      node.tagName === "option" &&
      node.attrs.some(({ name }) => name === "selected"),
  );
  if (selected.length !== 1) return null;
  return attr(selected[0]!, "value") || "0";
}
export const hasNext = (doc: Node) =>
  descendants(doc, (node) => node.tagName === "a" && hasClass(node, "nxt"))
    .length > 0;
export const offeredEmpty = (doc: Node) =>
  descendants(
    doc,
    (node) => hasClass(node, "emp") || hasClass(node, "xi1"),
  ).some((node) =>
    /无符合条件|無符合條件|没有(?:待审核|相关|找到匹配)|沒有(?:待審核|相關|找到匹配)|no results?/i.test(
      label(node),
    ),
  );
export const selectedRows = (
  form: Element,
  predicate: (row: Element) => boolean,
): { id: string; row: Element }[] | null => {
  const rows: { id: string; row: Element }[] = [];
  for (const row of descendants(form, predicate)) {
    const controls = descendants(
      row,
      (node) =>
        node.tagName === "input" &&
        attr(node, "type") === "checkbox" &&
        attr(node, "name") === "moderate[]" &&
        !controlDisabled(node),
    );
    if (!controls.length) continue;
    const value = attr(controls[0]!, "value");
    if (
      controls.length !== 1 ||
      !positive(value) ||
      rows.some((item) => item.id === value)
    )
      return null;
    rows.push({ id: value, row });
  }
  return rows;
};
export function authorLink(node: Element | undefined) {
  if (!node) return null;
  return id(/(?:[?&]uid=|space-uid-)(\d+)/.exec(attr(node, "href"))?.[1]);
}
