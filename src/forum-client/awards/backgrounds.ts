import { object } from "../notice-transport.js";
import { ids, limit, postPlan, publicRecord, selected } from "./protocol.js";
import type { AwardsChoice } from "./types.js";

export function backgroundPlan(
  base: URL,
  data: Record<string, unknown>,
  choice: AwardsChoice,
) {
  if (
    choice.kind !== "grant-background" ||
    data.supported !== 1 ||
    data.can_grant !== 1 ||
    !ids(choice.recipients, limit(data.limits, "users", 200)) ||
    typeof choice.notify !== "boolean" ||
    typeof choice.expiry !== "string" ||
    !/^(?:0|[1-9]\d{0,11}(?:天)?|\d{4}-\d{2}-\d{2}(?: [0-2]\d:[0-5]\d)?)$/.test(
      choice.expiry,
    )
  )
    return null;
  if (choice.expiry.includes("-")) {
    const [date, time = "00:00"] = choice.expiry.split(" ");
    const instant = new Date(`${date}T${time}:00Z`);
    if (
      !Number.isFinite(instant.getTime()) ||
      instant.toISOString().slice(0, 16) !== `${date}T${time}`
    )
      return null;
  }
  if ((choice.id === undefined) === (choice.image === undefined)) return null;
  const item =
    choice.id === undefined ? null : selected(data.backgrounds, choice.id);
  const imageValue = choice.image ?? item?.file;
  if (
    typeof imageValue !== "string" ||
    !imageValue ||
    imageValue !== imageValue.trim() ||
    /[\u0000-\u001f\u007f]/.test(imageValue) ||
    imageValue.length > limit(data.limits, "url", 255)
  )
    return null;
  if (choice.image !== undefined) {
    try {
      const custom = new URL(choice.image);
      if (
        custom.protocol !== "https:" ||
        custom.username ||
        custom.password ||
        custom.hash
      )
        return null;
    } catch {
      return null;
    }
  }
  const form = object(data.form);
  const names = [
    form?.url_field,
    form?.uids_field,
    form?.time_field,
    form?.notify_field,
  ];
  if (
    !form ||
    form.method !== "POST" ||
    typeof form.success_prefix !== "string" ||
    !form.success_prefix.trim() ||
    !names.every(
      (name) =>
        typeof name === "string" &&
        /^slotadd[a-z]+$/.test(name) &&
        name !== "slotaddsubmit",
    ) ||
    new Set(names).size !== names.length ||
    names.some((name) => Object.hasOwn(object(form.fields) ?? {}, String(name)))
  )
    return null;
  const [image, users, time, notify] = names.map(String) as [
    string,
    string,
    string,
    string,
  ];
  const plan = postPlan(
    form,
    base,
    "background:memcp",
    "slotadd",
    {
      [image]: imageValue,
      [users]: choice.recipients.join(","),
      [time]: choice.expiry,
      ...(choice.notify ? { [notify]: "1" } : {}),
    },
    publicRecord({ item, expiry: data.expiry }),
    "ac",
  );
  return plan && { ...plan, successPrefix: form.success_prefix };
}
