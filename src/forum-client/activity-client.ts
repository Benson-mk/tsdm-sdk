import {
  addWindow,
  activityReadURL,
  decodeActivityRead,
} from "./activity-reads.js";
import type {
  ActivityFailure,
  ActivityQuery,
  ActivityRead,
} from "./activity-read-types.js";
import { numericId, type NoticeSession } from "./notice-transport.js";
import { safeURL } from "./routes.js";
import {
  activityAuthority,
  activityTarget,
  type Target,
} from "./activity-authority.js";
import {
  activityBody,
  decodeActivityForm,
  type ActivityForm,
} from "./activity-forms.js";
import { activityReceipt } from "./activity-receipts.js";
import type {
  ActivityEffect,
  ActivityIntent,
  ActivityPreparation,
  ActivityTarget,
  PreparedActivity,
} from "./activity-effects.js";
import type { HostResponse } from "./types.js";

export type ActivitySession = NoticeSession;
export type ActivityRequest = {
  readonly fresh: true;
  readonly session: ActivitySession;
} & (
  | { readonly method: "GET"; readonly effect: boolean; readonly body?: never }
  | { readonly method: "POST"; readonly effect: true; readonly body: string }
);
export interface ActivityClientOptions {
  origin: string;
  session(): ActivitySession | null;
  transport: {
    request(
      url: string,
      request: ActivityRequest,
    ): Promise<HostResponse & { redirect: "none" | "opaque" | "followed" }>;
  };
}

export function createActivityClient(options: ActivityClientOptions) {
  const base = safeURL(options.origin);
  if (!base || base.origin !== options.origin)
    throw new TypeError("A canonical HTTPS forum origin is required.");
  const origin = base;
  function session(): ActivitySession | null {
    const current = options.session();
    return current &&
      numericId(current.memberId) === current.memberId &&
      current.continuity
      ? Object.freeze({ ...current })
      : null;
  }
  function same(expected: ActivitySession) {
    const current = session();
    return (
      current?.memberId === expected.memberId &&
      current.continuity === expected.continuity
    );
  }
  async function exchange(
    url: URL,
    owner: ActivitySession,
    effect = false,
    body?: string,
  ) {
    if (!same(owner))
      return {
        kind: "session-changed",
        message: "The forum session changed.",
      } as const;
    let response;
    try {
      response = await options.transport.request(
        url.href,
        body === undefined
          ? { fresh: true, session: owner, effect, method: "GET" }
          : { fresh: true, session: owner, effect: true, method: "POST", body },
      );
    } catch {
      return {
        kind: "incomplete",
        message: "The forum response was unavailable.",
      } as const;
    }
    if (!same(owner))
      return {
        kind: "session-changed",
        message: "The forum session changed.",
      } as const;
    if (response.url !== url.href || response.redirect !== "none")
      return {
        kind: "invalid",
        message: "The host returned a different destination.",
      } as const;
    return { kind: "response", response } as const;
  }
  const prepared = new WeakMap<
    PreparedActivity,
    {
      owner: ActivitySession;
      target: Target;
      url: URL;
      form?: ActivityForm;
      returnURL: string;
    }
  >();
  const pending = new Set<string>();
  return {
    async readActivity(
      query: ActivityQuery,
    ): Promise<ActivityRead | ActivityFailure> {
      const target = { ...query };
      const owner = session();
      if (!owner)
        return {
          kind: "session-changed",
          message: "A forum session is required.",
        };
      const first = activityReadURL(origin, target, false);
      if (!first)
        return { kind: "invalid", message: "Invalid activity target." };
      for (const url of [first, activityReadURL(origin, target, true)!].filter(
        (url, index, all) => index === 0 || url.href !== all[0]!.href,
      )) {
        const result = await exchange(url, owner);
        if (result.kind !== "response") return result;
        const decoded = decodeActivityRead(
          target,
          result.response,
          url,
          owner.memberId,
        );
        if (decoded) return decoded;
      }
      return {
        kind: "incomplete",
        message: "The forum did not establish an activity view.",
      };
    },
    async prepareActivity(
      choice: ActivityTarget,
    ): Promise<ActivityPreparation> {
      const target = activityTarget(origin, choice);
      if (!target)
        return { kind: "invalid", message: "Invalid activity target." };
      const owner = session();
      if (!owner)
        return {
          kind: "session-changed",
          message: "A forum session is required.",
        };
      if (owner.memberId === "0")
        return {
          kind: "refused",
          code: "login",
          message: "Sign in before preparing a post activity action.",
        };
      const returnURL = target.postId
        ? `${target.page.href}#pid${target.postId}`
        : target.page.href;
      const thread = new URL(target.page);
      thread.searchParams.set("tsdmapp", "json");
      const first = await exchange(thread, owner);
      if (first.kind !== "response") return first;
      let authority = activityAuthority(target, first.response, owner.memberId);
      if (!authority) {
        const fallback = await exchange(target.page, owner);
        if (fallback.kind !== "response") return fallback;
        authority = activityAuthority(
          target,
          fallback.response,
          owner.memberId,
        );
      }
      const handoff = {
        kind: "handoff",
        destination: returnURL,
        message:
          "Open the thread in the forum to complete an action the SDK could not prepare.",
      } as const;
      if (!authority) return handoff;
      if ("kind" in authority) return authority;
      const publicTarget = Object.freeze({ ...target.publicTarget });
      if (authority.evaluation) {
        const url = new URL(authority.url);
        url.searchParams.set("tsdmapp", "json");
        const result: PreparedActivity = Object.freeze({
          target: publicTarget,
          evaluation: { ...authority.evaluation },
        });
        prepared.set(result, { owner, target, url, returnURL });
        return { kind: "prepared", prepared: result };
      }
      const window = new URL(authority.url);
      const handle =
        target.publicTarget.action === "report"
          ? `miscreport${target.postId}`
          : target.publicTarget.action;
      addWindow(window, handle);
      window.searchParams.set("tsdmapp", "json");
      window.searchParams.set("tsdmform", "1");
      const opened = await exchange(window, owner);
      if (opened.kind !== "response") return opened;
      const form = decodeActivityForm(
        opened.response,
        target,
        authority,
        owner.memberId,
      );
      if (!form) return handoff;
      if ("kind" in form) return form;
      // Present a copy. Only the saved form can authorize submission.
      const choices = JSON.parse(
        JSON.stringify(form.choices),
      ) as typeof form.choices;
      const result: PreparedActivity = Object.freeze({
        target: publicTarget,
        ...choices,
      });
      prepared.set(result, { owner, target, url: form.url, form, returnURL });
      return { kind: "prepared", prepared: result };
    },
    async submitActivity(
      preparation: PreparedActivity,
      choice: ActivityIntent,
    ): Promise<ActivityEffect> {
      const entry = prepared.get(preparation);
      if (!entry || entry.target.publicTarget.action !== choice.action)
        return {
          kind: "invalid",
          message: "Select a matching unused activity form.",
        };
      if (!same(entry.owner))
        return {
          kind: "session-changed",
          message: "The forum session changed before dispatch.",
        };
      const body = entry.form ? activityBody(entry.form, choice) : undefined;
      if (body === null)
        return {
          kind: "invalid",
          message: "The supplied choices do not match the returned form.",
        };
      const intent: ActivityIntent =
        choice.action === "rate"
          ? { ...choice, scores: { ...choice.scores } }
          : choice.action === "comment" && choice.items
            ? { ...choice, items: { ...choice.items } }
            : { ...choice };
      const key = [
        entry.owner.memberId,
        entry.target.threadId,
        entry.target.postId ?? "",
        entry.form ? choice.action : "evaluation",
      ].join(":");
      if (pending.has(key))
        return {
          kind: "invalid",
          message: "An action on this target is already in progress.",
        };
      pending.add(key);
      prepared.delete(preparation);
      const target = { ...entry.target.publicTarget };
      try {
        const result = await exchange(entry.url, entry.owner, true, body);
        if (result.kind === "response")
          return {
            ...activityReceipt(
              result.response,
              entry.target,
              entry.owner.memberId,
              entry.returnURL,
            ),
            target,
            intent,
          };
        return {
          kind: "unknown",
          message:
            "The forum may have applied this action. Its response could not be verified.",
          target,
          intent,
        };
      } finally {
        pending.delete(key);
      }
    },
  };
}
