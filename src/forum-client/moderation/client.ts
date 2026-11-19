import { id, record, rows, string } from "../activity-protocol.js";
import { attr, descendants, label } from "../html.js";
import { directOffer, qualifySplit, readPosterIp } from "./permissions.js";
import { moderationReceipt } from "./receipts.js";
import type { NoticeSession } from "../notice-transport.js";
import {
  moderationBody,
  moderationWindow,
  nativeForm,
  offeredForm,
  selectTarget,
  type OfferedModeration,
} from "./forms.js";
import type {
  ModerationEffect,
  ModerationForm,
  ModerationPreparation,
  ModerationTarget,
  ModerationValues,
  ModerationPostTarget,
  ModerationClientOptions,
} from "./types.js";
import {
  forum,
  jsonWrite,
  moderationHost,
  v4Form,
  validId,
} from "./protocol.js";

export function createModerationClient(options: ModerationClientOptions) {
  const host = moderationHost(options);
  async function readDestinationTypes(forumId: string) {
    if (!validId(forumId)) return { kind: "invalid-input" } as const;
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" } as const;
    return destinationTypes(forumId, owner);
  }
  async function destinationTypes(forumId: string, owner: NoticeSession) {
    const url = forum(host.origin, {
      mod: "ajax",
      action: "getthreadtypes",
      fid: forumId,
      inajax: "1",
    });
    let reply = await host.exchange(v4Form(url), owner);
    if (reply.kind === "unsupported")
      reply = await host.exchange(jsonWrite(url), owner);
    if (reply.kind !== "answer") return reply;
    const { data, doc } = reply;
    let choices: { value: string; label: string }[] | undefined;
    if (
      id(data?.uid) === owner.memberId &&
      data?.type === "form" &&
      data.schema === 17 &&
      data.form === "threadtypes" &&
      id(data.fid) === forumId &&
      data.submit === null &&
      record(data.select)?.name === "threadtypeid"
    ) {
      choices = rows(record(data.select)?.choices)?.map((item) => ({
        value: String(item?.value ?? ""),
        label: string(item?.label),
      }));
    } else if (
      !data ||
      (id(data.uid) === owner.memberId &&
        data.type === "result" &&
        data.schema === 13 &&
        data.kind === "page")
    ) {
      const selects = descendants(
        doc,
        (node) =>
          node.tagName === "select" && attr(node, "name") === "threadtypeid",
      );
      if (selects.length === 1)
        choices = descendants(
          selects[0]!,
          (node) => node.tagName === "option",
        ).map((item) => ({ value: attr(item, "value"), label: label(item) }));
    }
    if (
      !choices?.length ||
      choices.some(
        (choice) => choice.value !== "0" && !validId(choice.value),
      ) ||
      new Set(choices.map((choice) => choice.value)).size !== choices.length
    )
      return { kind: "invalid-response" } as const;
    const required = choices.every((choice) => choice.value !== "0");
    if (data?.type === "form" && data.required !== Number(required))
      return { kind: "invalid-response" } as const;
    return { kind: "thread-types" as const, forumId, required, choices };
  }
  const offers = new WeakMap<
    ModerationForm,
    { owner: NoticeSession; offer: OfferedModeration }
  >();
  async function prepareModeration(
    intent: ModerationTarget,
  ): Promise<ModerationPreparation> {
    const target = selectTarget(intent);
    if (!target) return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    if (target.operation === "repair" || target.operation === "deleteattach") {
      const offer = await directOffer(host, owner, target);
      if ("kind" in offer) return offer;
      offers.set(offer.form, { owner, offer });
      return { kind: "moderation-form", form: offer.form };
    }
    const url = moderationWindow(host.origin, target);
    let reply = await host.exchange(url, owner);
    if (reply.kind === "unsupported" && url.includes("tsdmform=")) {
      const fallback = new URL(url);
      for (const key of ["tsdmform", "tsdmv", "nodoc"])
        fallback.searchParams.delete(key);
      reply = await host.exchange(fallback.href, owner);
    }
    if (reply.kind !== "answer") return reply;
    const { data, doc } = reply;
    if (data && id(data.uid) !== owner.memberId)
      return { kind: "invalid-response" };
    if (target.operation === "delpost" && data?.kind === "redirect") {
      try {
        const forwarded = new URL(string(data.url), host.origin);
        if (
          forwarded.origin === host.origin &&
          forwarded.pathname === "/forum.php" &&
          forwarded.searchParams.get("mod") === "topicadmin" &&
          forwarded.searchParams.get("action") === "moderate" &&
          forwarded.searchParams.get("operation") === "delete"
        )
          return {
            kind: "refused",
            code: "thread-delete-requires-separate-intent",
          };
      } catch {
        /* Unqualified redirect. */
      }
    }
    const offer =
      data?.type === "form"
        ? offeredForm(data, url, target)
        : !data ||
            (data.type === "result" &&
              data.schema === 13 &&
              data.kind === "page")
          ? nativeForm(doc, url, target)
          : null;
    if (!offer) return { kind: "invalid-response" };
    if ("offeredThreadIds" in offer)
      return {
        kind: "selection-changed",
        target,
        offeredThreadIds: offer.offeredThreadIds!,
      };
    offers.set(offer.form, { owner, offer });
    return { kind: "moderation-form", form: offer.form };
  }
  async function submitModeration(
    form: ModerationForm,
    values: ModerationValues,
    approved: boolean,
  ): Promise<ModerationEffect> {
    const stored = offers.get(form);
    if (!stored) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    const { offer, owner } = stored;
    if (!host.current(owner)) return { kind: "session-changed" };
    const body = moderationBody(offer, values);
    if (body === null) return { kind: "invalid-input" };
    offers.delete(form);
    const destination = body.get("copyto") ?? body.get("moveto");
    if (destination !== null) {
      if (
        !validId(destination) ||
        (form.target.operation === "move" &&
          destination === form.target.forumId)
      )
        return { kind: "invalid-input" };
      const types = await destinationTypes(destination, owner);
      if (types.kind !== "thread-types") return types;
      const category = body.get("threadtypeid") ?? "0";
      if (!types.choices.some((choice) => choice.value === category))
        return { kind: "invalid-input" };
      body.set("threadtypeid", category);
    }
    if (form.target.operation === "split") {
      const issue = await qualifySplit(
        host,
        owner,
        form.target,
        body.get("split")!,
      );
      if (issue) return issue;
    }
    if (!host.current(owner)) return { kind: "session-changed" };
    const reply = await host.exchange(
      offer.url,
      owner,
      true,
      form.method === "POST" ? body.toString() : undefined,
    );
    return moderationReceipt(reply, owner, form.target, offer.url);
  }
  return {
    readDestinationTypes,
    prepareModeration,
    submitModeration,
    readPosterIp: (source: ModerationPostTarget) => readPosterIp(host, source),
  };
}
