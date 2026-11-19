import {
  attr,
  controlDisabled,
  descendants,
  hasClass,
  label,
  type Element,
  type Node,
} from "../html.js";
import { integer, object } from "../notice-transport.js";
import { destination, scalar, type Pair } from "../posts/forms.js";
import type { SpecialThreadSettings } from "./types.js";

export function preparePacket(
  data: Record<string, unknown>,
  doc: Node,
  source: string,
) {
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === "postform",
  );
  if (forms.length !== 1) return null;
  const form = forms[0]!;
  const boxes = descendants(form, (node) => hasClass(node, "hb-postbox"));
  const box = boxes.length === 1 ? boxes[0] : null;
  if (!box || attr(form, "method").toLowerCase() !== "post") return null;
  const boardId = scalar(data.fid);
  const structured = object(data.submit);
  const to = boardId && destination(attr(form, "action"), source, { boardId });
  const structuredUrl =
    boardId && destination(structured?.url, source, { boardId });
  if (!to || !structuredUrl || to.href !== structuredUrl.href) return null;
  const named = (node: Node, name: string) =>
    descendants(
      node,
      (child) => attr(child, "name") === name && !controlDisabled(child),
    );
  const one = (node: Node, name: string) => {
    const items = named(node, name);
    return items.length === 1 ? items[0] : undefined;
  };
  const hash = one(form, "formhash");
  const plugin = one(form, "specialextra");
  if (
    !hash ||
    attr(hash, "value") !== object(structured?.fields)?.formhash ||
    !plugin ||
    attr(plugin, "value") !== "hongbao"
  )
    return null;
  const input = (name: string) => {
    const item = one(box, name);
    return item && !item.attrs.some((attr) => attr.name === "readonly")
      ? item
      : undefined;
  };
  const total = input("hb_total"),
    shares = input("hb_shares"),
    expiry = input("hb_expire"),
    blessing = input("hb_blessing");
  const splits = named(box, "hb_split").filter(
    (node) => attr(node, "type") === "radio",
  );
  if (
    !total ||
    !shares ||
    !expiry ||
    expiry.tagName !== "select" ||
    !blessing ||
    !splits.length
  )
    return null;
  const possibilities = descendants(
    expiry,
    (node) => node.tagName === "option" && !controlDisabled(node),
  );
  const selected = (nodes: Element[], attrName: string) =>
    nodes.findLast((node) =>
      node.attrs.some((attr) => attr.name === attrName),
    ) ?? nodes[0];
  const defaultExpiry = selected(possibilities, "selected");
  const defaultSplit = selected(splits, "checked");
  if (!defaultExpiry || !defaultSplit) return null;
  const condition = input("hb_cond");
  const password = input("hb_password");
  const recipients = input("hb_appoint");
  const defaults: Pair[] = [
    ["hb_split", attr(defaultSplit, "value")],
    ["hb_expire", attr(defaultExpiry, "value")],
    ["hb_blessing", attr(blessing, "value")],
  ];
  if (condition?.attrs.some((attr) => attr.name === "checked"))
    defaults.push(["hb_cond", attr(condition, "value") || "on"]);
  if (password) defaults.push(["hb_password", attr(password, "value")]);
  if (recipients) defaults.push(["hb_appoint", attr(recipients, "value")]);
  const maximum = Number(attr(shares, "max"));
  const minimumShare = Number(
    /每份至少\s*([1-9]\d*)/.exec(label(box))?.[1] ?? 1,
  );
  const balance = Number(
    label(descendants(box, (node) => hasClass(node, "hb-bal"))[0]),
  );
  const maxLength = (field: Element | undefined) =>
    field ? Number(attr(field, "maxlength")) : 0;
  const valid = (value: unknown, field: Element | undefined) =>
    value === undefined ||
    (field &&
      typeof value === "string" &&
      !/[\0\r\n]/.test(value) &&
      (!maxLength(field) || [...value].length <= maxLength(field)));
  return {
    fields: defaults,
    edits(
      settings: SpecialThreadSettings,
    ): Record<string, string | null> | null {
      if (settings?.kind !== "red-packet") return null;
      const split =
        settings.split === undefined
          ? attr(defaultSplit, "value")
          : settings.split === "even"
            ? "2"
            : settings.split === "lucky"
              ? "1"
              : "";
      const expires =
        settings.expiresAfterHours ?? attr(defaultExpiry, "value");
      if (
        !integer(settings.shares, 1) ||
        !integer(settings.total, 1) ||
        (maximum > 0 && settings.shares > maximum) ||
        settings.total < minimumShare * settings.shares ||
        (split === "2" && settings.total % settings.shares !== 0) ||
        (balance > 0 && settings.total > balance) ||
        !splits.some((node) => attr(node, "value") === split) ||
        !possibilities.some((node) => attr(node, "value") === expires) ||
        !valid(settings.password, password) ||
        !valid(settings.recipients, recipients) ||
        !valid(settings.blessing, blessing) ||
        (settings.requireReply !== undefined &&
          (!condition || typeof settings.requireReply !== "boolean"))
      )
        return null;
      return {
        hb_total: String(settings.total),
        hb_shares: String(settings.shares),
        hb_split: split,
        hb_expire: expires,
        ...(settings.requireReply !== undefined && {
          hb_cond: settings.requireReply
            ? attr(condition!, "value") || "on"
            : null,
        }),
        ...(settings.password !== undefined && {
          hb_password: settings.password,
        }),
        ...(settings.recipients !== undefined && {
          hb_appoint: settings.recipients,
        }),
        ...(settings.blessing !== undefined && {
          hb_blessing: settings.blessing,
        }),
      };
    },
  };
}
