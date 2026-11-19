import { nativeIdentity } from "../account-forms.js";
import { readAchievements } from "./achievements.js";
import { nativeMedals } from "./native-medals.js";
import {
  noticeHost,
  numericId,
  object,
  type NoticeSession,
} from "../notice-transport.js";
import {
  catalogueRoute,
  publicRecord,
  readReply,
  rows,
  type Plan,
} from "./protocol.js";
import { medalLookup, medalPlan, openApplication } from "./medals.js";
import { titlePlan } from "./titles.js";
import { backgroundPlan } from "./backgrounds.js";
import { effectResult } from "./result.js";
import type {
  AwardsCatalogue,
  AwardsChoice,
  AwardsClientOptions,
  AwardsFailure,
  AwardsForm,
  AwardsHandoff,
  AwardsPreparation,
  AwardsQuery,
  AwardsResult,
  AwardsView,
  MedalThreadQuery,
} from "./types.js";

export function createAwardsClient(options: AwardsClientOptions) {
  const host = noticeHost(options);
  const views = new WeakMap<
    AwardsView,
    { data: Record<string, unknown>; session: NoticeSession }
  >();
  const forms = new WeakMap<
    AwardsForm,
    { plan: Plan; session: NoticeSession }
  >();
  function state(view: AwardsView) {
    const saved = views.get(view);
    if (!saved) return { kind: "invalid-input" } as const;
    return host.current(saved.session)
      ? { kind: "current" as const, ...saved }
      : ({ kind: "session-changed" } as const);
  }
  async function read(
    catalogue: AwardsCatalogue,
    query: AwardsQuery = {},
    expectedSession?: NoticeSession,
  ): Promise<AwardsView | AwardsHandoff | AwardsFailure> {
    const route = catalogueRoute(host.origin, catalogue, query);
    if (!route) return { kind: "invalid-input" };
    const session = expectedSession ?? host.session();
    if (!session) return { kind: "session-changed" };
    if (catalogue === "achievements") return readAchievements(host, session, route.structured, route.native);
    const reply = await readReply(host, route.structured, session);
    if (reply.kind !== "decoded") return reply;
    let data = reply.data;
    const available =
      data?.ok === 1 &&
      data.installed === 1 && (catalogue !== "bggrant" || (data.type === "bggrant" && data.schema === 31));
    if (
      available &&
      catalogue === "bggrant" &&
      data?.backgrounds === undefined &&
      (data?.can_grant === 0 || data?.supported === 0)
    )
      data = { ...data, backgrounds: [] };
    if (
      !available ||
      numericId(data?.uid) !== session.memberId ||
      !Array.isArray(data?.[route.definition.records])
    ) {
      const handoff: AwardsHandoff = {
        kind: "awards-handoff",
        catalogue,
        url: route.native.href,
        reason: "The structured view is unavailable.",
      };
      if (
        catalogue !== "medals" ||
        (query.filter && query.filter !== "all") ||
        (query.sort && query.sort !== "order")
      )
        return handoff;
      let legacy = reply;
      let nativeData = reply.html
        ? nativeMedals(reply.html, route.native)
        : null;
      if (!nativeData) {
        const native = await readReply(host, route.native, session);
        if (native.kind !== "decoded") return native;
        legacy = native;
        nativeData = nativeMedals(native.html, route.native);
      }
      const viewer =
        nativeIdentity(legacy.html, route.native) ??
        numericId(legacy.data?.uid);
      if (viewer === "0") return { kind: "refused" };
      if (viewer && viewer !== session.memberId)
        return { kind: "session-changed" };
      if (!nativeData || viewer !== session.memberId) return handoff;
      data = nativeData;
    }
    if (!data) return { kind: "invalid-response" };
    const echoed =
      object(data.query) ??
      (catalogue === "bggrant" ? { page: data.page, kw: data.keyword } : null);
    if (
      echoed &&
      Object.entries(route.parameters).some(
        ([key, expected]) =>
          key !== "pp" &&
          echoed[key] !== undefined &&
          String(echoed[key]) !== expected,
      )
    ) {
      return {
        kind: "invalid-response",
        message:
          "The returned catalogue scope differs from the requested scope.",
      };
    }
    const source = data[route.definition.records];
    const records = rows(source);
    if (!Array.isArray(source) || source.length !== records.length)
      return { kind: "invalid-response" };
    const view: AwardsView = Object.freeze({
      kind: "awards-view",
      catalogue,
      memberId: session.memberId,
      records: Object.freeze(records.map(publicRecord)),
      metadata: publicRecord(
        Object.fromEntries(
          route.definition.metadata
            .filter((key) => data[key] !== undefined)
            .map((key) => [key, data[key]]),
        ),
      ),
    });
    views.set(view, { data, session });
    return view;
  }
  function ready(
    plan: Plan,
    session: NoticeSession,
    choice: AwardsChoice,
  ): AwardsPreparation {
    const approved = publicRecord(
      choice as unknown as Record<string, unknown>,
    ) as unknown as AwardsChoice;
    const form = Object.freeze({
      choice: approved,
      memberId: session.memberId,
      terms: plan.terms,
    });
    forms.set(form, { plan, session });
    return { kind: "awards-ready", form };
  }
  function prepare(view: AwardsView, choice: AwardsChoice): AwardsPreparation {
    const saved = state(view);
    if (saved.kind !== "current") return saved;
    if (!object(choice)) return { kind: "invalid-input" };
    const base = new URL(host.origin);
    const plan =
      medalPlan(base, saved.data, view.catalogue, choice) ??
      titlePlan(base, saved.data, view.catalogue, choice) ??
      (view.catalogue === "bggrant"
        ? backgroundPlan(base, saved.data, choice)
        : null);
    if (!plan)
      return {
        kind: "refused",
        message: "The returned view does not offer these terms and controls.",
      };
    return ready(plan, saved.session, choice);
  }
  async function submit(form: AwardsForm): Promise<AwardsResult> {
    const saved = forms.get(form);
    if (!saved) return { kind: "invalid-input" };
    const { plan, session } = saved;
    if (!host.current(session)) return { kind: "session-changed" };
    forms.delete(form);
    const destination = new URL(plan.url);
    if (plan.fields && destination.searchParams.get("action") !== "newapply")
      destination.searchParams.set("tsdmapp", "json");
    const reply = await host.request(
      destination.href,
      session,
      plan.fields && new URLSearchParams(plan.fields).toString(),
    );
    const choice = form.choice;
    if (reply.kind !== "response") return { kind: "unknown", choice };
    const outcome = effectResult(
      reply.response,
      session.memberId,
      choice,
      plan.successPrefix,
    );
    if (
      outcome.kind !== "acknowledged" ||
      (choice.kind !== "wear-title" && choice.kind !== "remove-title")
    )
      return outcome;
    const observed = await read("titles", {}, session);
    const worn =
      observed.kind === "awards-view"
        ? observed.records.filter((item) => item.worn === 1)
        : [];
    const complete =
      observed.kind === "awards-view" &&
      object(observed.metadata.query)?.pages === 1;
    const matches =
      choice.kind === "wear-title"
        ? worn.length === 1 && numericId(worn[0]?.id) === String(choice.id)
        : complete &&
          worn.length === 0 &&
          observed.kind === "awards-view" &&
          observed.records.every((row) => row.worn === 0);
    return {
      ...outcome,
      kind: matches && host.current(session) ? "observed" : "unknown",
    };
  }
  async function openMedalApplication(
    view: AwardsView,
    id: number,
    reason: string,
  ): Promise<AwardsPreparation> {
    const saved = state(view);
    if (saved.kind !== "current") return saved;
    if (view.catalogue !== "medals") return { kind: "invalid-input" };
    const prepared = await openApplication(
      host,
      saved.session,
      saved.data,
      id,
      reason,
    );
    return prepared.kind === "plan"
      ? ready(prepared.plan, saved.session, {
          kind: "acquire-medal",
          id,
          method: 2,
          reason,
        })
      : prepared;
  }
  async function lookupMedalMembers(
    view: AwardsView,
    recipients: readonly number[],
    medals: readonly number[],
  ) {
    const saved = state(view);
    if (saved.kind !== "current") return saved;
    if (view.catalogue !== "medalgrant")
      return { kind: "invalid-input" } as const;
    return medalLookup(host, saved.session, saved.data, { recipients, medals });
  }
  async function lookupMedalThread(view: AwardsView, thread: MedalThreadQuery) {
    const saved = state(view);
    if (saved.kind !== "current") return saved;
    if (view.catalogue !== "medalgrant" || !object(thread))
      return { kind: "invalid-input" } as const;
    return medalLookup(host, saved.session, saved.data, { thread });
  }
  return {
    read: (catalogue: AwardsCatalogue, query?: AwardsQuery) =>
      read(catalogue, query),
    prepare,
    submit,
    openMedalApplication,
    lookupMedalMembers,
    lookupMedalThread,
  };
}
