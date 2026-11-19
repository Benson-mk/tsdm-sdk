import {
  attr,
  byId,
  children,
  controlDisabled,
  descendants,
  element,
  hasClass,
  label,
  type Node,
} from "../html.js";
import type { NoticeHost } from "../notice-transport.js";
import {
  answer,
  bit,
  failure,
  formhash,
  forumURL,
  nativeIdentity,
  nativeMessage,
  numericId,
  positive,
  readIssue,
  record,
  string,
  urlAt,
  whole,
} from "./protocol.js";
import { groupInfoURL } from "./groups.js";
import type {
  CreditValue,
  CreditsFailure,
  CreditsSession,
  ExpiringGroup,
  GroupExpiry,
  GroupSwitchForm,
  GroupSwitchPreparation,
  GroupSwitchResult,
} from "./types.js";

const handle = "switchgrouphk";
const invalid = (message: string) => failure("invalid-response", message);
const login = () =>
  failure("refused", "Sign in to manage your group membership.", "login");
const fieldNames = [
  "referer",
  "groupsubmit",
  "gid",
  "handlekey",
  "formhash",
  "editsubmit_btn",
];
type Listed = { view: GroupExpiry; urls: Map<string, URL>; hash: string };
function switchURL(raw: unknown, base: URL, id: string) {
  const url = forumURL(raw, base, "/home.php"),
    q = url?.searchParams;
  if (
    !url ||
    !q ||
    q.get("mod") !== "spacecp" ||
    q.get("ac") !== "usergroup" ||
    q.get("do") !== "switch" ||
    q.get("groupid") !== id ||
    [...q.keys()].some(
      (k) =>
        ![
          "mod",
          "ac",
          "do",
          "groupid",
          "handlekey",
          "inajax",
          "infloat",
        ].includes(k),
    ) ||
    (q.has("handlekey") && ![handle, "group"].includes(q.get("handlekey")!)) ||
    (q.has("inajax") && q.get("inajax") !== "1") ||
    (q.has("infloat") && q.get("infloat") !== "yes")
  )
    return null;
  return url;
}
function apiExpiry(
  data: Record<string, unknown>,
  source: URL,
  owner: CreditsSession,
  view: GroupExpiry["view"],
): Listed | null {
  if (
    data.ok !== 1 ||
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== "usergroup" ||
    data.do !== view ||
    numericId(data.uid) !== owner.memberId ||
    !Array.isArray(data.groups) ||
    data.submit !== null
  )
    return null;
  const currentTitle = string(record(data.current)?.title);
  if (!currentTitle) return null;
  const groups: ExpiringGroup[] = [],
    urls = new Map<string, URL>();
  for (const raw of data.groups) {
    const row = record(raw),
      id = positive(row?.gid),
      title = string(row?.title);
    if (
      !row ||
      !id ||
      !title ||
      groups.some((g) => g.id === id) ||
      !Array.isArray(row.actions)
    )
      return null;
    const offered = row.actions
      .map(record)
      .filter((item) => item?.do === "switch");
    const link =
      offered.length === 1 ? switchURL(offered[0]?.url, source, id) : null;
    const canSwitch = Boolean(link && row.expired !== 1 && row.main !== 1);
    if (link && canSwitch) urls.set(id, link);
    const price = record(row.price);
    groups.push({
      id,
      title,
      expiry: string(row.expiry),
      ...(bit(row.expired) ? { expired: row.expired === 1 } : {}),
      ...(bit(row.main) ? { main: row.main === 1 } : {}),
      ...(typeof price?.type === "string" ? { price: price.type } : {}),
      canSwitch,
    });
  }
  const money = record(data.money),
    credit = record(money?.credit),
    id = positive(credit?.id),
    title = string(credit?.title),
    amount = whole(money?.amount);
  const balance =
    id && title && amount !== null
      ? ({
          id,
          title,
          value: amount,
          unit: string(credit?.unit),
        } satisfies CreditValue)
      : undefined;
  return {
    view: {
      kind: "group-expiry",
      memberId: owner.memberId,
      source: "plugin",
      view,
      currentTitle,
      groups,
      ...(balance ? { balance } : {}),
      ...(bit(data.expired_notice)
        ? { expiredNotice: data.expired_notice === 1 }
        : {}),
    },
    urls,
    hash: formhash(data.formhash),
  };
}
function nativeExpiry(
  doc: Node,
  source: URL,
  owner: CreditsSession,
  view: GroupExpiry["view"],
): Listed | null {
  const root = byId(doc, "ct") ?? byId(doc, "ct_shell");
  if (!root) return null;
  const summary = descendants(
    root,
    (n) => n.tagName === "p" && hasClass(n, "tbmu"),
  )[0];
  if (!summary) return null;
  const currentTitle = label(
    descendants(summary, (n) => n.tagName === "font")[0],
  );
  const tables = descendants(
    root,
    (n) => n.tagName === "table" && hasClass(n, "dt"),
  );
  if (!currentTitle || tables.length !== 1) return null;
  const groups: ExpiringGroup[] = [],
    urls = new Map<string, URL>();
  for (const tr of descendants(tables[0]!, (n) => n.tagName === "tr")) {
    const cells = children(tr).filter((n) => element(n) && n.tagName === "td");
    if (
      !cells.length ||
      (cells.length === 1 && /暂无|没有/.test(label(cells[0])))
    )
      continue;
    if (cells.length < 4) return null;
    const name = descendants(cells[0]!, (n) => n.tagName === "a")[0];
    const id =
        name &&
        groupInfoURL(attr(name, "href"), source)?.searchParams.get("gid"),
      title = label(name);
    if (!id || !title || groups.some((row) => row.id === id)) return null;
    const links = descendants(cells.at(-1)!, (n) => n.tagName === "a")
      .map((n) => switchURL(attr(n, "href"), source, id))
      .filter((u): u is URL => Boolean(u));
    const expiry =
      /\d{4}-\d{1,2}-\d{1,2}/.exec(
        cells.slice(1, -1).map(label).join(" "),
      )?.[0] ?? "";
    const expired = /已过期|已過期/.test(label(tr));
    const canSwitch = links.length === 1 && !expired;
    if (canSwitch) urls.set(id, links[0]!);
    groups.push({
      id,
      title,
      expiry,
      expired,
      price: label(cells[1]),
      canSwitch,
    });
  }
  const balanceText = label(descendants(summary, (n) => hasClass(n, "xi1"))[0]);
  const balance = /^([+-]?\d+)\s*(\S.*)$/.exec(balanceText);
  const hashes = descendants(
    root,
    (n) =>
      n.tagName === "input" &&
      attr(n, "name") === "formhash" &&
      attr(n, "type") === "hidden",
  );
  return {
    view: {
      kind: "group-expiry",
      memberId: owner.memberId,
      source: "native",
      view,
      currentTitle,
      groups,
      ...(balance
        ? { balance: { value: Number(balance[1]), title: balance[2]! } }
        : {}),
    },
    urls,
    hash: hashes.length === 1 ? formhash(attr(hashes[0]!, "value")) : "",
  };
}
function validFields(fields: Record<string, string>, gid: string) {
  if (
    Object.keys(fields).some((k) => !fieldNames.includes(k)) ||
    !formhash(fields.formhash) ||
    fields.groupsubmit !== "true" ||
    (fields.gid !== "" && fields.gid !== gid) ||
    ![handle, "group"].includes(fields.handlekey ?? "") ||
    (fields.editsubmit_btn !== undefined && fields.editsubmit_btn !== "true") ||
    typeof fields.referer !== "string"
  )
    return false;
  return true;
}
function apiForm(
  data: Record<string, unknown>,
  source: URL,
  gid: string,
  title: string,
  currentTitle: string,
  memberId: string,
) {
  if (
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== "usergroup" ||
    data.do !== "switch" ||
    data.ok !== 1
  )
    return null;
  const target = positive(data.groupid),
    to = string(record(data.to)?.title),
    from = string(record(data.from)?.title);
  if (
    target !== gid ||
    to !== title ||
    from !== currentTitle ||
    numericId(data.uid) !== memberId
  )
    return invalid(
      "The switch form returned a different account or membership.",
    );
  if (
    ![data.hook_fields, data.unsupported].every(
      (v) => Array.isArray(v) && v.length === 0,
    ) ||
    data.seccheck
  )
    return null;
  const submit = record(data.submit),
    controls = record(submit?.fields);
  const destination = switchURL(submit?.url, source, gid);
  if (
    !destination ||
    submit?.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !controls ||
    Object.values(controls).some((v) => typeof v !== "string")
  )
    return null;
  const fields = Object.fromEntries(
    Object.entries(controls).map(([k, v]) => [k, string(v)]),
  );
  if (!validFields(fields, gid) || fields.formhash !== data.formhash)
    return null;
  return { destination, fields, from, to };
}
function nativeForm(
  doc: Node,
  source: URL,
  gid: string,
  from: string,
  to: string,
) {
  const found = descendants(
    doc,
    (n) => n.tagName === "form" && attr(n, "method").toLowerCase() === "post",
  ).flatMap((form) => {
    const dest = switchURL(attr(form, "action"), source, gid);
    return dest ? [{ form, dest }] : [];
  });
  if (found.length !== 1) return null;
  const { form, dest: destination } = found[0]!;
  const fields: Record<string, string> = {};
  for (const n of descendants(
    form,
    (n) =>
      ["input", "button", "select", "textarea"].includes(n.tagName) &&
      !controlDisabled(n),
  )) {
    const name = attr(n, "name"),
      type = attr(n, "type");
    if (
      !fieldNames.includes(name) ||
      Object.hasOwn(fields, name) ||
      !(
        (n.tagName === "input" && type === "hidden") ||
        (name === "editsubmit_btn" && type === "submit")
      )
    )
      return null;
    fields[name] = attr(n, "value");
  }
  if (!validFields(fields, gid) || !label(form).includes(to)) return null;
  return { destination, fields, from, to };
}
function hasRedrawnForm(doc: Node, source: URL, gid: string) {
  return descendants(
    doc,
    (n) => n.tagName === "form" && attr(n, "method").toLowerCase() === "post",
  ).some((n) => Boolean(switchURL(attr(n, "action"), source, gid)));
}

export function createGroupSwitch(host: NoticeHost) {
  const expiry = urlAt(host.origin, "/home.php", {
    mod: "spacecp",
    ac: "usergroup",
    do: "expiry",
  });
  const listings = new WeakMap<
    GroupExpiry,
    {
      owner: CreditsSession;
      urls: Map<string, URL>;
      groupTitles: Map<string, string>;
      currentTitle: string;
      hash: string;
    }
  >();
  const forms = new WeakMap<
    GroupSwitchForm,
    { owner: CreditsSession; destination: URL; fields: Record<string, string> }
  >();
  const pending = new Set<string>();
  return {
    async readGroupExpiry(
      view: "expiry" | "list" = "expiry",
    ): Promise<GroupExpiry | CreditsFailure> {
      if (view !== "expiry" && view !== "list")
        return failure("invalid-input", "Select expiry or group list.");
      const owner = host.session();
      if (!owner) return login();
      const page = new URL(expiry.href);
      page.searchParams.set("do", view);
      const lean = new URL(page.href);
      lean.searchParams.set("tsdmapp", "json");
      lean.searchParams.set("tsdmform", "1");
      lean.searchParams.set("nodoc", "1");
      for (const source of [lean, page]) {
        const sent = await host.request(source.href, owner);
        if (sent.kind !== "response")
          return failure(sent.kind, "The group expiry view was unavailable.");
        const { data, html } = answer(sent.response),
          issue = readIssue(sent.response, data, owner.memberId);
        if (issue) return issue;
        if (
          data?.type === "form" &&
          data.form === "usergroup" &&
          data.do !== view
        )
          return invalid("The forum returned a different group view.");
        const identity = nativeIdentity(html, source);
        if (identity !== null && identity !== owner.memberId)
          return failure(
            identity === "0" ? "refused" : "session-changed",
            "The group page used a different session.",
          );
        const native = nativeMessage(html);
        if (native.isError && native.message)
          return failure("refused", native.message);
        const parsed =
          (data && apiExpiry(data, source, owner, view)) ??
          (identity === owner.memberId ||
          numericId(data?.uid) === owner.memberId
            ? nativeExpiry(native.doc, source, owner, view)
            : null);
        if (parsed) {
          listings.set(parsed.view, {
            owner,
            urls: parsed.urls,
            groupTitles: new Map(
              parsed.view.groups.map((g) => [g.id, g.title]),
            ),
            currentTitle: parsed.view.currentTitle,
            hash: parsed.hash,
          });
          return parsed.view;
        }
      }
      return invalid("The forum did not establish the group expiry list.");
    },
    async prepareGroupSwitch(
      list: GroupExpiry,
      groupId: string,
    ): Promise<GroupSwitchPreparation> {
      const listing = listings.get(list),
        offered = listing?.urls.get(groupId),
        title = listing?.groupTitles.get(groupId);
      if (!offered || !listing || !title)
        return failure(
          "invalid-input",
          "Select a group offered for switching by a current expiry read.",
        );
      if (!host.current(listing.owner))
        return failure(
          "session-changed",
          "The session changed before opening the switch form.",
        );
      const window = new URL(offered.href);
      window.searchParams.set("infloat", "yes");
      window.searchParams.set("inajax", "1");
      window.searchParams.set("tsdmapp", "json");
      window.searchParams.set("tsdmform", "1");
      const sent = await host.request(window.href, listing.owner);
      if (sent.kind !== "response")
        return failure(sent.kind, "The switch window was unavailable.");
      const { data, html } = answer(sent.response),
        issue = readIssue(sent.response, data, listing.owner.memberId);
      if (issue) return issue;
      const native = nativeMessage(html);
      if (native.isError && native.message)
        return failure("refused", native.message);
      const identity = nativeIdentity(html, window);
      if (identity !== null && identity !== listing.owner.memberId)
        return failure(
          "session-changed",
          "The switch window used a different session.",
        );
      const parsed =
        data?.type === "form"
          ? apiForm(
              data,
              window,
              groupId,
              title,
              listing.currentTitle,
              listing.owner.memberId,
            )
          : nativeForm(
              native.doc,
              window,
              groupId,
              listing.currentTitle,
              title,
            );
      if (!parsed)
        return {
          kind: "browser-handoff",
          destination: expiry.href,
          message: "Review the switch in the native group expiry page.",
        };
      if ("kind" in parsed) return parsed;
      if (
        data?.type !== "form" &&
        identity !== listing.owner.memberId &&
        numericId(data?.uid) !== listing.owner.memberId &&
        parsed.fields.formhash !== listing.hash
      )
        return invalid(
          "The native switch window did not match the current session form hash.",
        );
      parsed.destination.searchParams.set("inajax", "1");
      parsed.destination.searchParams.set("tsdmapp", "json");
      const form = Object.freeze({
        memberId: listing.owner.memberId,
        groupId,
        from: parsed.from,
        to: parsed.to,
      });
      forms.set(form, {
        owner: listing.owner,
        destination: parsed.destination,
        fields: parsed.fields,
      });
      return { kind: "switch-ready", form };
    },
    async submitGroupSwitch(form: GroupSwitchForm): Promise<GroupSwitchResult> {
      const stored = forms.get(form);
      if (!stored)
        return failure("invalid-input", "Select a fresh unused switch form.");
      const { owner, destination, fields } = stored;
      if (!host.current(owner))
        return failure(
          "session-changed",
          "The session changed before switching.",
        );
      if (pending.has(owner.memberId))
        return failure(
          "invalid-input",
          "A group switch is already in progress for this member.",
        );
      forms.delete(form);
      pending.add(owner.memberId);
      const resultFields = { ...form };
      const unknown = {
        kind: "unknown",
        message: "The response did not establish the switch effect.",
        ...resultFields,
      } as const;
      try {
        const sent = await host.request(
          destination.href,
          owner,
          new URLSearchParams(fields).toString(),
        );
        if (sent.kind !== "response") return unknown;
        const { data, html } = answer(sent.response);
        if (
          data?.login === 1 &&
          (data.uid === undefined ||
            numericId(data.uid) === "0" ||
            numericId(data.uid) === owner.memberId)
        )
          return failure(
            "refused",
            string(data.message) || "Sign in to switch groups.",
            "login",
          );
        if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
          return unknown;
        const issue = readIssue(sent.response, data, owner.memberId);
        const native = nativeMessage(html);
        if (
          data &&
          (data.type !== "result" ||
            data.schema !== 13 ||
            numericId(data.uid) !== owner.memberId)
        )
          return issue?.kind === "refused" || issue?.kind === "rate-limited"
            ? issue
            : unknown;
        const values = record(data?.values);
        if (
          values?.groupid !== undefined &&
          positive(values.groupid) !== form.groupId
        )
          return unknown;
        const message = string(data?.message) || native.message;
        if (hasRedrawnForm(native.doc, destination, form.groupId))
          return { kind: "redrawn", message, ...resultFields };
        if (issue?.kind === "refused" || issue?.kind === "rate-limited")
          return issue;
        if (native.isError && message)
          return failure("refused", message, string(data?.message_key));
        if (sent.response.status !== 200) return unknown;
        if (data?.kind === "redirect") {
          const page = forumURL(data.url, expiry, "/home.php"),
            q = page?.searchParams;
          if (
            page &&
            q?.get("mod") === "spacecp" &&
            q.get("ac") === "usergroup" &&
            (!q.has("do") || q.get("do") === "expiry") &&
            [...q.keys()].every((k) => ["mod", "ac", "do"].includes(k))
          )
            return {
              kind: "switch-handoff",
              effect: "unknown",
              message,
              destination: page.href,
              ...resultFields,
            };
          return unknown;
        }
        if (
          data &&
          data.ok === 1 &&
          data.message_key === "usergroups_switch_succeed" &&
          [handle, "group"].includes(string(data.handlekey)) &&
          ["handle", "message"].includes(string(data.kind))
        )
          return { kind: "switched", message, ...resultFields };
        if (!data && /xml/i.test(sent.response.contentType)) {
          const code = descendants(
            native.doc,
            (n) => n.tagName === "script" && !attr(n, "src"),
          )
            .flatMap((n) =>
              children(n).map((c) => ("value" in c ? c.value : "")),
            )
            .join("\n");
          if (
            /\bsucceedhandle_(?:switchgrouphk|group)\(\s*['"][^'"\r\n]*['"]\s*,/.test(
              code,
            )
          )
            return { kind: "switched", message, ...resultFields };
        }
        return unknown;
      } finally {
        pending.delete(owner.memberId);
      }
    },
  };
}
