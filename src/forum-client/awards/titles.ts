import { integer, object } from "../notice-transport.js";
import {
  endpoint,
  ids,
  limit,
  pluginURL,
  postPlan,
  publicRecord,
  rows,
  selected,
  titlePlugin,
} from "./protocol.js";
import type { AwardsCatalogue, AwardsChoice } from "./types.js";

export function titlePlan(
  base: URL,
  data: Record<string, unknown>,
  catalogue: AwardsCatalogue,
  choice: AwardsChoice,
) {
  if (
    catalogue === "titles" &&
    (choice.kind === "wear-title" || choice.kind === "remove-title")
  ) {
    const item =
      choice.kind === "wear-title" ? selected(data.titles, choice.id) : null;
    if (
      choice.kind === "wear-title"
        ? !item || item.expired !== 0 || item.worn !== 0
        : !rows(data.titles).some((row) => row.worn === 1)
    )
      return null;
    const url = pluginURL(base.origin, titlePlugin, { action: "settitle" });
    return postPlan(
      {
        url: url.href,
        fields: {
          formhash: data.formhash,
          settitlesubmit: "true",
          tsdmtitle_return: "plugin.php?id=tsdmtitle:tsdmtitle&app=plugin",
        },
      },
      base,
      titlePlugin,
      "settitle",
      { settitleid: choice.kind === "wear-title" ? String(choice.id) : "0" },
      publicRecord({ item }),
    );
  }
  if (catalogue === "titleshop" && choice.kind === "buy-title") {
    const item = selected(data.items, choice.id);
    const form = object(data.buy_form);
    if (
      !item ||
      item.owned !== 0 ||
      item.for_sale !== 1 ||
      item.afford !== 1 ||
      !integer(item.price, 0) ||
      form?.item_field !== "buyid" ||
      !endpoint(
        object(form.fields)?.tsdmtitle_return,
        base,
        titlePlugin,
        "shop",
      )
    )
      return null;
    return postPlan(
      form,
      base,
      titlePlugin,
      "buy",
      { buyid: String(choice.id) },
      publicRecord({ item, credit: data.credit }),
    );
  }
  if (catalogue === "titleexchange" && choice.kind === "exchange-title") {
    const item = selected(data.items, choice.id);
    if (item?.ready !== 1 || item.owned !== 0) return null;
    return postPlan(
      data.exchange_form,
      base,
      titlePlugin,
      "exchange",
      { exchangeid: String(choice.id) },
      publicRecord({ item }),
    );
  }
  if (
    catalogue === "titleissue" &&
    (choice.kind === "issue-title" || choice.kind === "revoke-title")
  ) {
    if (
      data.can_issue !== 1 ||
      data.supported !== 1 ||
      !ids(choice.titles, limit(data.limits, "titles", 30)) ||
      !Array.isArray(choice.recipients) ||
      choice.recipients.length < 1 ||
      choice.recipients.length > limit(data.limits, "users", 200) ||
      choice.recipients.some(
        (name) =>
          typeof name !== "string" ||
          name !== name.trim() ||
          !name ||
          /[\u0000-\u001f\u007f,，]/.test(name),
      ) ||
      new Set(choice.recipients).size !== choice.recipients.length ||
      !integer(choice.days, 0) ||
      choice.days > limit(data.limits, "days", 36500) ||
      typeof choice.note !== "string" ||
      choice.note.length > limit(data.limits, "note", 80)
    )
      return null;
    const items = choice.titles.map((id) => selected(data.titles, id));
    if (items.some((item) => !item)) return null;
    return postPlan(
      data.issue_form,
      base,
      titlePlugin,
      "issue",
      {
        issueop: choice.kind === "issue-title" ? "grant" : "revoke",
        issuetitles: choice.titles.join(","),
        issueusers: choice.recipients.join("\n"),
        issuedays: String(choice.days),
        issuenote: choice.note,
      },
      publicRecord({ items }),
    );
  }
  return null;
}
