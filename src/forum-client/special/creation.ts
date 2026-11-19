import {
  enabled,
  positive,
  sameOrigin,
  scalar,
  suppliedInput,
} from "../posts/forms.js";
import { integer, object, numericId } from "../notice-transport.js";
import { preparePacket } from "./packet-editor.js";
import type { PostEditorExtension } from "../posts/editor-client.js";

import type { SpecialThreadKind, SpecialThreadSettings } from "./types.js";

const codes = {
  poll: 1,
  bounty: 3,
  activity: 4,
  debate: 5,
  "red-packet": 127,
} satisfies Record<SpecialThreadKind, number>;

type Prepared = NonNullable<
  ReturnType<PostEditorExtension<SpecialThreadSettings>["prepare"]>
>;
const hasText = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim()) && !value.includes("\0");

function forumDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{3}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  )
    return false;
  const date = new Date(value.replace(" ", "T") + ":00Z");
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 16).replace("T", " ") === value
  );
}

function prepareEvent(
  kind: "activity" | "debate",
  data: Record<string, unknown>,
): Prepared | null {
  const block = object(data[kind]);
  const inputs = Array.isArray(block?.inputs) ? block.inputs.map(object) : [];
  const controls = inputs.filter(
    (field) =>
      field && typeof field.name === "string" && !enabled(field.disabled),
  );
  const control = (name: string) =>
    controls.find((field) => field?.name === name && !enabled(field.readonly));
  const required =
    kind === "activity"
      ? ["starttimefrom[0]", "activityplace", "activityclass"]
      : ["affirmpoint", "negapoint"];
  if (!required.every(control)) return null;
  const profile = controls.filter((field) => field?.name === "userfield[]");
  const fields = controls
    .filter((field) => field?.name !== "userfield[]")
    .flatMap(suppliedInput);
  fields.push(
    ...profile
      .filter((field) => enabled(field?.checked))
      .flatMap((field, index): [string, string][] => {
        const value = scalar(field?.value);
        return value === null ? [] : [[`userfield[${index}]`, value]];
      }),
  );
  return {
    fields,
    edits(settings) {
      if (settings?.kind !== kind) return null;
      if (settings.kind === "debate") {
        const { affirmative, negative, endsAt, umpire } = settings;
        if (
          !hasText(affirmative) ||
          !hasText(negative) ||
          (endsAt !== undefined &&
            (!forumDate(endsAt) || !control("endtime"))) ||
          (umpire !== undefined &&
            (typeof umpire !== "string" ||
              /[\0\r\n]/.test(umpire) ||
              !control("umpire")))
        )
          return null;
        return {
          affirmpoint: affirmative,
          negapoint: negative,
          ...(endsAt && { endtime: endsAt }),
          ...(umpire !== undefined && { umpire: umpire.trim() }),
        };
      }
      const {
        startsAt,
        endsAt,
        place,
        category,
        city,
        gender,
        expiresAt,
        requiredProfileFields,
        extraFields,
      } = settings;
      if (
        !forumDate(startsAt) ||
        !hasText(place) ||
        !hasText(category) ||
        (endsAt !== undefined &&
          (!forumDate(endsAt) ||
            endsAt < startsAt ||
            !["activitytime", "starttimefrom[1]", "starttimeto"].every(
              control,
            ))) ||
        (expiresAt !== undefined &&
          (!forumDate(expiresAt) || !control("activityexpiration"))) ||
        (city !== undefined && (!hasText(city) || !control("activitycity")))
      )
        return null;
      const changes: Record<string, string | null> = {
        "starttimefrom[0]": endsAt ? "" : startsAt,
        activityplace: place,
        activityclass: category,
      };
      if (endsAt)
        Object.assign(changes, {
          "starttimefrom[1]": startsAt,
          starttimeto: endsAt,
          activitytime: scalar(control("activitytime")?.value) ?? "1",
        });
      else if (control("activitytime")) changes.activitytime = null;
      if (city !== undefined) changes.activitycity = city;
      if (expiresAt !== undefined) changes.activityexpiration = expiresAt;
      for (const [name, value] of [
        ["activitynumber", settings.capacity],
        ["cost", settings.cost],
        ["activitycredit", settings.credit],
      ] as const) {
        if (value === undefined) continue;
        if (!integer(value, 0) || !control(name)) return null;
        changes[name] = String(value);
      }
      if (gender !== undefined) {
        const choices = control("gender")?.choices;
        if (
          !Array.isArray(choices) ||
          !choices.some((choice) => scalar(object(choice)?.value) === gender)
        )
          return null;
        changes.gender = gender;
      }
      if (requiredProfileFields !== undefined) {
        const allowed = profile
          .map((field) => scalar(field?.value))
          .filter((value): value is string => value !== null);
        if (
          !Array.isArray(requiredProfileFields) ||
          new Set(requiredProfileFields).size !==
            requiredProfileFields.length ||
          requiredProfileFields.some((name) => !allowed.includes(name))
        )
          return null;
        for (const [name] of fields)
          if (name.startsWith("userfield[")) changes[name] = null;
        allowed
          .filter((name) => requiredProfileFields.includes(name))
          .forEach((name, index) => {
            changes[`userfield[${index}]`] = name;
          });
      }
      if (extraFields !== undefined) {
        if (
          !Array.isArray(extraFields) ||
          !integer(block?.extnum, 0) ||
          extraFields.length > block.extnum ||
          extraFields.some(
            (label) => !hasText(label) || /[\r\n]/.test(label),
          ) ||
          !control("extfield")
        )
          return null;
        changes.extfield = extraFields.join("\n");
      }
      return changes;
    },
  };
}

export function specialEditorExtension(
  kind: SpecialThreadKind,
): PostEditorExtension<SpecialThreadSettings> {
  const code = codes[kind];
  return {
    query:
      kind === "red-packet"
        ? { specialextra: "hongbao" }
        : { special: String(code) },
    needsNative: kind === "red-packet",
    accepts(data, source) {
      const special = object(data.special);
      const submit = object(data.submit);
      const fields = object(submit?.fields);
      const target = sameOrigin(submit?.url, source);
      const query = target?.searchParams;
      const plugin = kind === "red-packet" ? "hongbao" : "";
      return (
        Boolean(
          query &&
          (!query.has("special") || query.get("special") === String(code)) &&
          (!query.has("specialextra") ||
            query.get("specialextra") === plugin) &&
          !query.has("sortid"),
        ) &&
        numericId(special?.current) === String(code) &&
        numericId(fields?.special) === String(code) &&
        (special?.specialextra ?? "") === plugin &&
        (fields?.specialextra ?? "") === plugin &&
        !special?.sortid &&
        !fields?.sortid &&
        (!Array.isArray(data.unsupported) ||
          data.unsupported.every(
            (field) =>
              field === "seccheck" ||
              (kind === "red-packet" && field === "threadplugin"),
          ))
      );
    },
    prepare(data, native, source) {
      if (kind === "red-packet")
        return native ? preparePacket(data, native, source) : null;
      if (kind === "activity" || kind === "debate")
        return prepareEvent(kind, data);
      if (kind === "bounty") {
        const reward = object(data.reward);
        if (
          reward?.state !== "new" ||
          !integer(reward.min, 0) ||
          !integer(reward.max, 0) ||
          !integer(reward.have, 0) ||
          typeof reward.tax !== "number" ||
          !Number.isFinite(reward.tax) ||
          reward.tax < 0 ||
          !Array.isArray(reward.inputs) ||
          !reward.inputs.some((raw) => {
            const field = object(raw);
            return (
              field?.name === "rewardprice" &&
              !enabled(field.disabled) &&
              !enabled(field.readonly)
            );
          })
        )
          return null;
        const { min, max, have, tax } = reward;
        return {
          fields: reward.inputs.flatMap(suppliedInput),
          edits(settings) {
            if (
              settings?.kind !== "bounty" ||
              !integer(settings.price, Math.max(1, min)) ||
              (max > 0 && settings.price > max) ||
              settings.price + Math.ceil(settings.price * tax) > have
            )
              return null;
            return { rewardprice: String(settings.price) };
          },
        };
      }
      const poll = object(data.poll);
      if (
        !poll ||
        enabled(poll.image) ||
        !Array.isArray(poll.inputs) ||
        !integer(poll.max_options, 2)
      )
        return null;
      const controls = poll.inputs.map(object);
      const editable = (name: string) =>
        controls.some(
          (control) =>
            control?.name === name &&
            !enabled(control.disabled) &&
            !enabled(control.readonly),
        );
      const fields = poll.inputs.flatMap(suppliedInput);
      const served = new URLSearchParams(fields);
      if (
        served.get("polls") !== "yes" ||
        served.get("tpolloption") !== "1" ||
        !editable("polloptions")
      )
        return null;
      return {
        fields,
        edits(settings) {
          if (
            settings?.kind !== "poll" ||
            !Array.isArray(settings.choices) ||
            settings.choices.length < 2 ||
            settings.choices.length > Number(poll.max_options)
          )
            return null;
          const choices = settings.choices.map((choice) =>
            typeof choice === "string" && !/[\r\n\0]/.test(choice)
              ? choice.trim()
              : "",
          );
          const count =
            settings.maxChoices ?? Number(served.get("maxchoices") ?? 1);
          if (
            choices.some((choice) => !choice) ||
            new Set(choices).size !== choices.length ||
            !integer(count, 1) ||
            count > choices.length ||
            (settings.maxChoices !== undefined && !editable("maxchoices")) ||
            (settings.expiresAfterDays !== undefined &&
              (!integer(settings.expiresAfterDays, 0) ||
                !editable("expiration"))) ||
            (settings.resultsAfterVote !== undefined &&
              (typeof settings.resultsAfterVote !== "boolean" ||
                !editable("visibilitypoll"))) ||
            (settings.publicVotes !== undefined &&
              (typeof settings.publicVotes !== "boolean" || !editable("overt")))
          )
            return null;
          return {
            polloptions: choices.join("\n"),
            ...(settings.maxChoices !== undefined && {
              maxchoices: String(count),
            }),
            ...(settings.expiresAfterDays !== undefined && {
              expiration: String(settings.expiresAfterDays),
            }),
            ...(settings.resultsAfterVote !== undefined && {
              visibilitypoll: settings.resultsAfterVote
                ? (scalar(
                    controls.find(
                      (control) => control?.name === "visibilitypoll",
                    )?.value,
                  ) ?? "1")
                : null,
            }),
            ...(settings.publicVotes !== undefined && {
              overt: settings.publicVotes
                ? (scalar(
                    controls.find((control) => control?.name === "overt")
                      ?.value,
                  ) ?? "1")
                : null,
            }),
          };
        },
      };
    },
    matches(page, submitted) {
      const block = object(page.special);
      if (numericId(object(page.thread)?.special) !== String(code))
        return false;
      if (kind === "red-packet")
        return (
          block?.type === "hongbao" &&
          Boolean(positive(block.packetid)) &&
          block.is_sender === 1 &&
          numericId(object(block.sender)?.uid) === numericId(page.uid) &&
          numericId(block.shares) === submitted.get("hb_shares") &&
          block.split ===
            (submitted.get("hb_split") === "2" ? "even" : "lucky") &&
          block.need_reply === Number(submitted.has("hb_cond"))
        );
      if (kind === "bounty")
        return (
          block?.type === "reward" &&
          block.resolved === 0 &&
          numericId(block.price) === submitted.get("rewardprice")
        );
      if (kind === "activity")
        return (
          block?.type === "activity" &&
          block.class === submitted.get("activityclass") &&
          block.place === submitted.get("activityplace") &&
          (!submitted.get("activitynumber") ||
            numericId(block.number) === submitted.get("activitynumber"))
        );
      if (kind === "debate")
        return (
          block?.type === "debate" &&
          block.affirmpoint === submitted.get("affirmpoint") &&
          block.negapoint === submitted.get("negapoint")
        );
      const stored = Array.isArray(block?.choices)
        ? block.choices.map((choice) => object(choice)?.text)
        : [];
      return (
        block?.type === "poll" &&
        JSON.stringify(stored) ===
          JSON.stringify(submitted.get("polloptions")?.split("\n"))
      );
    },
  };
}
