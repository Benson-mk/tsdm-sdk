import {
  attr,
  controlDisabled,
  descendants,
  label,
  text,
  type Element,
  type Node,
} from "../html.js";

export const has = (node: Element, name: string) =>
  node.attrs.some((attr) => attr.name === name);
export const named = (scope: Node, name: string): Element[] =>
  descendants(
    scope,
    (node) =>
      ["input", "button", "textarea", "select"].includes(node.tagName) &&
      attr(node, "name") === name &&
      !controlDisabled(node),
  );
export function unique(nodes: Element[]): Element | null {
  return nodes.length === 1 ? nodes[0]! : null;
}

export function submittedControls(
  form: Element,
  submit: string,
  password?: Element,
): URLSearchParams | null {
  const fields = new URLSearchParams();
  const radio = new Set<string>();
  const controls = descendants(
    form,
    (node) =>
      ["input", "button", "textarea", "select"].includes(node.tagName) &&
      !controlDisabled(node),
  );
  for (const node of controls) {
    const name = attr(node, "name");
    const type = attr(node, "type").toLowerCase();
    if (!name || node === password) continue;
    if (
      has(node, "form") ||
      has(node, "formaction") ||
      has(node, "formmethod") ||
      has(node, "formenctype") ||
      /[\0\r\n]/.test(name) ||
      type === "file" ||
      type === "password" ||
      type === "image"
    )
      return null;
    if (
      (node.tagName === "button" ||
        ["submit", "button", "reset"].includes(type)) &&
      (name !== submit ||
        (type !== "submit" && !(node.tagName === "button" && !type)))
    )
      continue;
    if (node.tagName === "select") {
      if (has(node, "multiple")) return null;
      const choices = descendants(
        node,
        (item) => item.tagName === "option" && !controlDisabled(item),
      );
      const selected =
        choices.findLast((item) => has(item, "selected")) ?? choices[0];
      if (!selected || fields.has(name) || radio.has(name)) return null;
      fields.set(
        name,
        has(selected, "value") ? attr(selected, "value") : label(selected),
      );
      continue;
    }
    if (type === "radio") {
      if (fields.has(name) && !radio.has(name)) return null;
      radio.add(name);
      if (has(node, "checked")) fields.set(name, attr(node, "value") || "on");
      continue;
    }
    if (type === "checkbox" && !has(node, "checked")) continue;
    if (fields.has(name) || radio.has(name)) return null;
    fields.set(
      name,
      node.tagName === "textarea"
        ? text(node)
        : has(node, "value")
          ? attr(node, "value")
          : type === "checkbox"
            ? "on"
            : "",
    );
  }
  return fields;
}
