import { panelAnnouncements } from "./settings/announcements.js";
import { panelRules, panelRecommendations } from "./settings/forum.js";
import { panelLog, panelNotes } from "./settings/records.js";
import { panelMembers, panelIpBans } from "./settings/members.js";
import { panelAccess } from "./settings/access.js";
import type {
  ModeratorDashboardResult,
  ModeratorPanelClient,
} from "./types.js";
import type {
  ModeratorDashboard,
  ModeratorPanelLoginForm,
  ModeratorPanelOptions,
  PanelFailure,
} from "./types.js";
import { panelRecycle } from "./recycle.js";
import { panelQueues } from "./queue.js";
import { panelReports } from "./reports.js";
import { panelSearch } from "./search.js";
import { record, rows } from "../activity-protocol.js";
import type { ActivitySession } from "../activity-client.js";
import {
  loginEvidence,
  panelDestination,
  panelHost,
  panelContext,
  panelRoute,
  panelIdentity,
  panelRefusal,
  type PanelOfferLogin,
} from "./protocol.js";

export function createModeratorPanelClient(
  options: ModeratorPanelOptions,
): ModeratorPanelClient {
  const host = panelHost(options);
  const logins = new WeakMap<
    ModeratorPanelLoginForm,
    {
      owner: ActivitySession;
      evidence: NonNullable<ReturnType<typeof loginEvidence>>;
    }
  >();
  const dashboardUrl = panelRoute(host.origin, {
    action: "home",
    tsdmapp: "json",
    nodoc: "1",
  });
  const offerLogin: PanelOfferLogin = (url, owner, parsed) => {
    const evidence = loginEvidence(parsed, url);
    if (!evidence) return null;
    const form = Object.freeze({ forumId: evidence.forumId });
    logins.set(form, { owner, evidence });
    return { kind: "panel-login", form };
  };
  const panel = panelContext(host, offerLogin);
  async function readDashboard(
    owner = host.session(),
  ): Promise<ModeratorDashboardResult> {
    if (!owner) return { kind: "refused", code: "login" };
    const reply = await panel.read(dashboardUrl, owner);
    if (reply.kind !== "response") return reply;
    const data = reply.parsed.data;
    if (
      reply.response.status !== 200 ||
      data?.ok !== 1 ||
      data?.type !== "modcp_home" ||
      data?.schema !== 39 ||
      data.uid === undefined
    )
      return { kind: "invalid-response" };
    const counts = record(data.counts);
    const forums = rows(data.forums);
    const notes = rows(data.notes);
    if (
      !counts ||
      !forums?.every((row) => row !== null) ||
      !notes?.every((row) => row !== null)
    )
      return { kind: "invalid-response" };
    return {
      kind: "dashboard",
      page: { counts, forums, notes, isModerator: data.ismoderator === 1 },
    };
  }
  async function login(
    form: ModeratorPanelLoginForm,
    password: string,
    confirmed: boolean,
  ): Promise<ModeratorDashboardResult> {
    if (confirmed !== true) return { kind: "not-confirmed" };
    const prepared = logins.get(form);
    if (!prepared) return { kind: "stale" };
    const { owner, evidence } = prepared;
    if (!host.current(owner)) return { kind: "session-changed" };
    if (typeof password !== "string" || !password.length)
      return { kind: "invalid-input" };
    logins.delete(form);
    const fields = new URLSearchParams({
      formhash: evidence.token,
      fid: evidence.forumId,
      submit: "yes",
      login_panel: "yes",
      cppwd: password,
    });
    const reply = await host.request(evidence.url, owner, fields, true, true);
    if (reply.kind !== "response") return reply;
    const { response, parsed } = reply;
    const identity = panelIdentity(parsed, owner);
    if (identity === "refused") return { kind: "refused", code: "login" };
    if (identity) return { kind: "uncertain" };
    if (loginEvidence(parsed, evidence.url))
      return { kind: "refused", code: "panel-password" };
    const problem = panelRefusal(response, parsed);
    if (problem) return problem;
    const data = parsed.data;
    const destination =
      typeof data?.url === "string"
        ? [
            "home",
            "moderate",
            "thread",
            "report",
            "recyclebin",
            "recyclebinpost",
          ].some((action) =>
            panelDestination(data.url as string, evidence.url, action),
          )
        : false;
    if (
      (response.status >= 300 && response.status < 400) ||
      response.redirect === "opaque" ||
      (response.status === 200 &&
        (data?.type === "modcp_home" ||
          (data?.type === "result" &&
            data.schema === 13 &&
            data.kind === "redirect" &&
            destination)))
    ) {
      const verified = await readDashboard(owner);
      return verified.kind === "dashboard"
        ? verified
        : verified.kind === "panel-login"
          ? { kind: "refused", code: "panel-login" }
          : { kind: "uncertain" };
    }
    return { kind: "uncertain" };
  }
  return {
    readDashboard: () => readDashboard(),
    login,
    ...panelSearch(panel),
    ...panelReports(panel),
    ...panelQueues(panel),
    ...panelRecycle(panel),
    ...panelAccess(panel),
    ...panelMembers(panel),
    ...panelIpBans(panel),
    ...panelLog(panel),
    ...panelNotes(panel),
    ...panelRules(panel),
    ...panelRecommendations(panel),
    ...panelAnnouncements(panel),
  };
}
