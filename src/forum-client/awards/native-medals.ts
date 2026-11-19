import {
  attr,
  byId,
  controlDisabled,
  descendants,
  documentFrom,
  hasClass,
  label,
} from "../html.js";
import type { Element } from "../html.js";
import { forumURL, medalPlugin, postPlan, publicRecord } from "./protocol.js";

export function hiddenFields(form: Element) {
  const inputs = descendants(
    form,
    (node) => node.tagName === "input" && !controlDisabled(node),
  );
  if (
    inputs.some((node) => attr(node, "type") !== "hidden" || attr(node, "form"))
  )
    return null;
  const fields = Object.fromEntries(
    inputs.map((node) => [attr(node, "name"), attr(node, "value")]),
  );
  return Object.keys(fields).length === inputs.length ? fields : null;
}
export function medalLink(raw: string, base: URL, id: number) {
  const url = forumURL(raw, base, "/plugin.php");
  if (!url) return null;
  const params = url.searchParams;
  if (
    params.get("id") === "dsu_medalCenter:specmedal" &&
    params.get("action") === "newapply" &&
    params.size === 3 &&
    params.get("applymedalid") === String(id)
  )
    return { url, method: 2 };
  if (
    params.get("id") !== medalPlugin ||
    params.get("action") !== "apply" ||
    params.get("medalid") !== String(id)
  )
    return null;
  const type = params.get("applytype");
  if (type === null && params.size === 3) return { url, method: 2 };
  if (params.size === 4 && ["1", "5", "6"].includes(type ?? ""))
    return { url, method: Number(type) };
  return null;
}
export function nativeMedals(html: string, base: URL) {
  const doc = documentFrom(html);
  const container = byId(doc, "ct");
  const legacyList = descendants(
    doc,
    (node) =>
      node.tagName === "ul" && hasClass(node, "mlm") && hasClass(node, "mdl"),
  );
  if ((!container || !hasClass(container, "dsumc")) && legacyList.length !== 1)
    return null;
  const root = container ?? doc;
  const records = descendants(
    root,
    (node) =>
      node.tagName === "li" &&
      (/^dsumc_m\d+$/.test(attr(node, "id")) || hasClass(node, "pns")),
  ).flatMap((card) => {
    const image = descendants(
      card,
      (node) =>
        node.tagName === "img" && /^mc_medal\d+$/.test(attr(node, "id")),
    )[0];
    const id = Number(image && attr(image, "id").slice("mc_medal".length));
    const name = label(
      descendants(card, (node) => node.tagName === "strong")[0],
    );
    if (!Number.isSafeInteger(id) || id <= 0 || !name) return [];
    const mine = descendants(card, (node) => hasClass(node, "mine")).length > 0;
    const pending =
      descendants(card, (node) => hasClass(node, "wait")).length > 0;
    const tooltip = byId(root, `mc_medal${id}_menu`);
    const actions = [];
    if (!mine && !pending) {
      for (const control of descendants(
        card,
        (node) => node.tagName === "form" || node.tagName === "a",
      )) {
        if (control.tagName === "a") {
          if (
            attr(control, "aria-disabled") === "true" ||
            hasClass(control, "disabled")
          )
            continue;
          const link = medalLink(attr(control, "href"), base, id);
          if (link)
            actions.push({
              method: link.method,
              ok: true,
              label: label(control),
              native_url: link.url.href,
            });
          continue;
        }
        if (
          attr(control, "method").toLowerCase() !== "post" ||
          !descendants(
            control,
            (node) =>
              node.tagName === "button" &&
              attr(node, "type") === "submit" &&
              !controlDisabled(node),
          ).length ||
          descendants(
            control,
            (node) => node.tagName === "select" || node.tagName === "textarea",
          ).length
        )
          continue;
        const fields = hiddenFields(control);
        const raw = { url: attr(control, "action"), fields };
        const method = Number(fields?.method);
        if (
          fields?.medalid !== String(id) ||
          fields.dsumcsubmit !== "1" ||
          ![1, 5, 6].includes(method) ||
          !postPlan(raw, base, medalPlugin, "claim", {}, publicRecord({}))
        )
          continue;
        actions.push({
          method,
          ok: true,
          label: label(control),
          confirm: attr(control, "data-confirm"),
          native_form: raw,
        });
      }
    }
    return [
      {
        id,
        name,
        image: image && attr(image, "src"),
        details: label(tooltip),
        owned: mine ? 1 : 0,
        pending: pending ? 1 : 0,
        actions,
      },
    ];
  });
  if (!records.length && !/共\s*0\s*个/.test(label(root))) return null;
  return { medals: records, representation: "native" };
}
