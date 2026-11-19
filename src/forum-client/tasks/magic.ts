import type {
  MagicPreparation,
  MagicEffectResult,
  PreparedMagicForm,
  MagicOperation,
  MagicItem,
  MagicLogEntry,
  MagicLogDirection,
  MagicShopResult,
  MagicInventoryResult,
  MagicLogResult,
  MagicShopItem,
  MagicInventoryItem,
  MagicPage,
} from "./types.js";
import { id, int, record, rows, string } from "../activity-protocol.js";
import { nativeMagicPage } from "./native.js";
import {
  magicBody,
  magicResult,
  nativeMagicForm,
  structuredMagicForm,
} from "./magic-form.js";
import { query } from "../posts/forms.js";
import type { NoticeSession } from "../notice-transport.js";
import {
  handoff,
  home,
  homeRoute,
  href,
  pageMode,
  type taskMagicHost,
  writeMode,
} from "./protocol.js";

const logs = {
  usage: "uselog",
  purchase: "buylog",
  gift: "givelog",
  receipt: "receivelog",
} as const;
export interface MagicAuthority {
  owner: NoticeSession;
  legacy: boolean;
  operation: MagicOperation;
}
const positive = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const identifierPattern = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/;
const magicWindow = (
  raw: unknown,
  base: string,
  operation: MagicOperation,
  target: string,
) =>
  homeRoute(
    raw,
    base,
    {
      mod: "magic",
      action: operation === "buy" ? "shop" : "mybox",
      operation,
      [operation === "buy" ? "mid" : "magicid"]: target,
    },
    ["infloat", "inajax", "handlekey"],
  );

function magicEntry(row: Record<string, unknown>, base: string) {
  const name = string(row.name).trim();
  const identifier = string(row.identifier);
  return name && identifierPattern.test(identifier)
    ? {
        id: id(row.magicid),
        identifier,
        name,
        description: string(row.description),
        imageURL: href(row.pic, base),
      }
    : null;
}
function logEntry(
  row: Record<string, unknown>,
  direction: MagicLogDirection,
  base: string,
): MagicLogEntry | null {
  const name = string(row.name).trim();
  if (!name) return null;
  const entry = {
    magicId: id(row.magicid),
    name,
    time: positive(row.dateline) ? int(row.dateline) : null,
  };
  if (direction === "usage") {
    const target = record(row.target);
    const type = target?.type;
    const ref = id(target?.id);
    const url = href(target?.url, base);
    if (type === "drop" || type === "sell")
      return { ...entry, target: { type, id: null, url: null } };
    if (ref && (type === "uid" || type === "tid" || type === "pid")) {
      const check = url && new URL(url);
      const qualified =
        check &&
        check.pathname === (type === "uid" ? "/home.php" : "/forum.php") &&
        check.searchParams.get(type) === ref;
      return {
        ...entry,
        target: { type, id: ref, url: qualified ? url : null },
      };
    }
    return { ...entry, target: null };
  }
  if (direction === "purchase")
    return {
      ...entry,
      amount: int(row.amount),
      price: int(row.price),
      credit: record(row.credit),
    };
  const user = record(row.user);
  const uid = id(user?.uid);
  return {
    ...entry,
    amount: int(row.amount),
    member: uid ? { id: uid, username: string(user?.username) } : null,
  };
}

export function magicClient(host: ReturnType<typeof taskMagicHost>) {
  const authority = new WeakMap<MagicItem, MagicAuthority>();
  async function loadMagic(
    action: string,
    current: number,
    operation?: string,
  ) {
    if (!positive(current)) return { kind: "invalid-input" } as const;
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" } as const;
    const base = home(host.origin, {
      mod: "magic",
      action,
      ...(operation && { operation }),
      ...(current > 1 && { page: String(current) }),
    });
    const loaded =
      action === "log"
        ? await host.read(query(base, pageMode), owner)
        : await host.readCompatible(base, owner);
    return loaded.kind === "page" ? { ...loaded, base, owner } : loaded;
  }
  function paging(
    data: Record<string, unknown>,
    current: number,
  ): MagicPage | null {
    const page = int(data.page);
    const pages = int(data.pages);
    return page === current &&
      pages !== null &&
      pages >= 0 &&
      page <= Math.max(1, pages)
      ? { page, pages: Math.max(1, pages) }
      : null;
  }
  function capacityOf(data: Record<string, unknown>) {
    const value = record(data.capacity);
    const used = int(value?.used),
      max = int(value?.max);
    return used !== null && max !== null && used >= 0 && max >= 0
      ? { used, max }
      : null;
  }
  async function readMagicShop(current = 1): Promise<MagicShopResult> {
    const loaded = await loadMagic("shop", current);
    if (loaded.kind !== "page") return loaded;
    const data = loaded.page.data;
    if (data?.type !== "magic_shop") {
      const native =
        loaded.identified &&
        nativeMagicPage(loaded.page.doc, loaded.base, "shop", current);
      if (!native) return handoff(loaded.base);
      const { shop: items, page, pages, capacity } = native;
      for (const item of items)
        if (item.available)
          authority.set(item, {
            owner: loaded.owner,
            legacy: true,
            operation: "buy",
          });
      return { kind: "magic-shop", items, page, pages, capacity, balances: [] };
    }
    const pages = paging(data, current);
    const entries = rows(data.list);
    if (
      !loaded.identified ||
      data.schema !== 69 ||
      data.ok !== 1 ||
      data.operation !== "index" ||
      !pages ||
      !entries
    )
      return { kind: "invalid-response" };
    const items = entries.flatMap((row) => {
      const base = row && magicEntry(row, loaded.base);
      if (!row || !base) return [];
      const price = int(row.price);
      const available =
        price !== null &&
        price >= 0 &&
        row.soldout !== 1 &&
        !!magicWindow(row.buy_url, loaded.base, "buy", base.identifier);
      const item: MagicShopItem = Object.freeze({
        ...base,
        price,
        credit: record(row.credit),
        available,
      });
      if (available)
        authority.set(item, {
          owner: loaded.owner,
          legacy: false,
          operation: "buy",
        });
      return [item];
    });
    return {
      kind: "magic-shop",
      ...pages,
      capacity: capacityOf(data),
      balances: rows(data.balances)?.filter((x) => x !== null) ?? [],
      items,
    };
  }
  async function readMagicInventory(
    current = 1,
  ): Promise<MagicInventoryResult> {
    const loaded = await loadMagic("mybox", current);
    if (loaded.kind !== "page") return loaded;
    const data = loaded.page.data;
    if (data?.type !== "magic_mybox") {
      const native =
        loaded.identified &&
        nativeMagicPage(loaded.page.doc, loaded.base, "mybox", current);
      if (!native) return handoff(loaded.base);
      const { inventory: items, page, pages, capacity } = native;
      for (const item of items)
        if (item.available)
          authority.set(item, {
            owner: loaded.owner,
            legacy: true,
            operation: "use",
          });
      return { kind: "magic-inventory", items, page, pages, capacity };
    }
    const pages = paging(data, current);
    const entries = rows(data.list);
    if (
      !loaded.identified ||
      data.schema !== 70 ||
      data.ok !== 1 ||
      !pages ||
      !entries
    )
      return { kind: "invalid-response" };
    const items = entries.flatMap((row) => {
      const base = row && magicEntry(row, loaded.base);
      if (!row || !base?.id) return [];
      const count = int(row.num);
      const available =
        count !== null &&
        count > 0 &&
        (!row.use_url ||
          !!magicWindow(row.use_url, loaded.base, "use", base.id));
      const item: MagicInventoryItem = Object.freeze({
        ...base,
        count,
        weight: int(row.weight),
        available,
      });
      if (available)
        authority.set(item, {
          owner: loaded.owner,
          legacy: false,
          operation: "use",
        });
      return [item];
    });
    return {
      kind: "magic-inventory",
      ...pages,
      capacity: capacityOf(data),
      items,
    };
  }
  async function readMagicLog(
    direction: MagicLogDirection,
    current = 1,
  ): Promise<MagicLogResult> {
    if (typeof direction !== "string" || !Object.hasOwn(logs, direction))
      return { kind: "invalid-input" };
    const loaded = await loadMagic("log", current, logs[direction]);
    if (loaded.kind !== "page") return loaded;
    const data = loaded.page.data;
    if (data?.type !== "magic_log") return handoff(loaded.base);
    const pages = paging(data, current);
    const source = rows(data.list);
    if (
      !loaded.identified ||
      data.schema !== 71 ||
      data.ok !== 1 ||
      data.operation !== logs[direction] ||
      !pages ||
      !source
    )
      return { kind: "invalid-response" };
    const entries = source.flatMap((row) => {
      const entry = row && logEntry(row, direction, loaded.base);
      return entry ? [entry] : [];
    });
    return {
      kind: "magic-log",
      direction,
      ...pages,
      timeOffset: int(data.timeoffset),
      entries,
    };
  }
  const prepared = new WeakMap<
    PreparedMagicForm,
    {
      owner: NoticeSession;
      url: string;
      fields: URLSearchParams;
      legacy: boolean;
    }
  >();
  async function prepareMagic(
    item: MagicItem,
    operation: MagicOperation,
  ): Promise<MagicPreparation> {
    const offer = authority.get(item);
    if (!offer || offer.operation !== operation)
      return { kind: "invalid-input" };
    const target =
      operation === "buy" ? { mid: item.identifier } : { magicid: item.id! };
    const base = home(host.origin, {
      mod: "magic",
      action: operation === "buy" ? "shop" : "mybox",
      operation,
      ...target,
    });
    const window = query(base, {
      infloat: "yes",
      handlekey: "magics",
      inajax: "1",
    });
    const legacyURL = query(window, { tsdmapp: "json" });
    let loaded = await host.read(
      offer.legacy
        ? legacyURL
        : query(window, { ...writeMode, tsdmform: "1", nodoc: "1" }),
      offer.owner,
    );
    if (loaded.kind !== "page") return loaded;
    if (
      !offer.legacy &&
      loaded.page.data?.ok === 0 &&
      loaded.page.data.error === "unknown" &&
      loaded.page.data.form === `magic${operation}`
    ) {
      loaded = await host.read(legacyURL, offer.owner);
      if (loaded.kind !== "page") return loaded;
    }
    const data = loaded.page.data;
    if (data?.type === "form" && !loaded.identified)
      return { kind: "invalid-response" };
    const form =
      data?.type === "form"
        ? structuredMagicForm(data, window, item, operation)
        : nativeMagicForm(loaded.page.doc, window, item, operation);
    if (form === "invalid") return { kind: "invalid-response" };
    if (form === "browser") return handoff(base);
    prepared.set(form.form, {
      owner: offer.owner,
      url: form.url,
      fields: form.fields,
      legacy: form.legacy,
    });
    return { kind: "magic-form", form: form.form };
  }
  async function confirmMagic(
    form: PreparedMagicForm,
    values: Readonly<Record<string, string>>,
    approved: boolean,
  ): Promise<MagicEffectResult> {
    const offer = prepared.get(form);
    if (!offer) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    if (!host.current(offer.owner)) return { kind: "session-changed" };
    const fields = magicBody(form, offer.fields, values);
    if (!fields) return { kind: "invalid-input" };
    prepared.delete(form);
    const url = query(
      offer.url,
      offer.legacy ? { tsdmapp: "json" } : writeMode,
    );
    const sent = await host.exchange(url, offer.owner, true, fields.toString());
    return sent.kind === "response"
      ? magicResult(
          sent.response,
          offer.owner.memberId,
          form,
          fields,
          offer.legacy,
        )
      : {
          kind: "uncertain",
          magicId: form.magicId,
          identifier: form.identifier,
        };
  }
  return {
    readMagicShop,
    readMagicInventory,
    readMagicLog,
    prepareMagicPurchase: (item: MagicShopItem) => prepareMagic(item, "buy"),
    prepareMagicUse: (item: MagicInventoryItem) => prepareMagic(item, "use"),
    confirmMagic,
  };
}
