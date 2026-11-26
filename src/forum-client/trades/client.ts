import {
  noticeHost,
  numericId,
  object,
  type NoticeClientOptions,
  type NoticeSession,
} from "../notice-transport.js";
import { query, sameOrigin, structured } from "../posts/forms.js";
import { answer, requiresStructuredLogin } from "../activity-protocol.js";
import { nativeIdentity } from "../account-forms.js";
import { decodeStructuredThread } from "../structured-thread.js";
import {
  nativeOrderCreated,
  orderDetails,
  orderForm,
  orderId,
  orderReference,
  orderURL,
  paymentForm,
} from "./orders.js";
import { readGoods } from "./goods.js";
import { resultThread } from "../posts/native.js";
import {
  nativePaidThread,
  nativePurchase,
  nativePurchaseSucceeded,
  readablePaidOpening,
  structuredPurchase,
} from "./paid.js";
import {
  forumURL,
  id,
  parsed,
  refusal,
  text,
  threadURL,
  whole,
  writeURL,
} from "./protocol.js";

export interface TradeClientOptions extends Omit<
  NoticeClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: Parameters<NoticeClientOptions["transport"]["request"]>[1],
    ): Promise<
      Awaited<ReturnType<NoticeClientOptions["transport"]["request"]>> & {
        location?: string;
      }
    >;
  };
}
export type TradeFailure =
  | {
      kind:
        "invalid-input" | "invalid-response" | "session-changed" | "network";
    }
  | { kind: "refused"; code?: string; message?: string };
export interface PaidThread {
  threadId: string;
  postId: string;
  title: string;
  price: number;
  payers: number | null;
  access: "requires-purchase" | "accessible";
  url: string;
}
export type PaidThreadRead =
  | { kind: "paid-thread"; thread: PaidThread }
  | { kind: "not-paid-thread" }
  | TradeFailure;

export interface PaidThreadTerms {
  readonly author: Readonly<{ id: string | null; name: string }>;
  readonly price: number;
  readonly authorReceives: number;
  readonly balanceAfterPurchase: number;
  readonly credit: Readonly<{ id: string | null; name: string; unit: string }>;
}
export interface PaidThreadForm {
  readonly threadId: string;
  readonly postId: string;
  readonly terms: PaidThreadTerms;
}
export type TradeHandoff = { kind: "browser-handoff"; destination: string };
export type PaidThreadPreparation =
  | { kind: "purchase-form"; form: PaidThreadForm }
  | { kind: "already-accessible"; thread: PaidThread }
  | { kind: "not-paid-thread" }
  | TradeHandoff
  | TradeFailure;
export type PaidThreadConfirmation =
  | { kind: "purchased" | "already-accessible"; thread: PaidThread }
  | { kind: "not-confirmed" | "uncertain" }
  | TradeFailure;

export interface TradeItemTarget {
  readonly threadId: string;
  readonly postId: string;
}
export interface TradeGoods extends TradeItemTarget {
  readonly url: string;
  readonly subject: string;
  readonly seller: Readonly<{ id: string | null; name: string }>;
  readonly prices: readonly string[];
  readonly originalPrices: readonly string[];
  readonly stock: number | null;
  readonly soldOut: boolean;
  readonly details: readonly Readonly<{ label: string; value: string }>[];
  readonly description: string;
  readonly thumbnailURL: string | null;
  readonly imageURL: string | null;
  readonly orderFormURL: string | null;
}
export type TradeGoodsRead =
  | { kind: "trade-goods"; goods: TradeGoods }
  | { kind: "goods-removed" }
  | TradeFailure;

export interface TradeRecipientField {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly maxLength: number | null;
}
export interface TradeOrderTerms {
  readonly creditPerItem: number;
  readonly balance: number;
  readonly quantity: number;
  readonly stock: number | null;
  readonly recipientFields: readonly TradeRecipientField[];
}
export interface TradeOrderForm extends TradeItemTarget {
  readonly terms: TradeOrderTerms;
}
export interface TradeOrderInput {
  quantity: number;
  message?: string;
  recipient?: Readonly<Record<string, string>>;
}
export interface TradeOrderReference {
  readonly orderId: string;
  readonly url: string;
}
export type TradeOrderPreparation =
  | { kind: "trade-order-form"; form: TradeOrderForm }
  | TradeHandoff
  | TradeFailure;
export type TradeOrderCreation =
  | { kind: "order-created"; order: TradeOrderReference }
  | { kind: "uncertain" }
  | TradeFailure;

export interface TradeOrder extends TradeOrderReference {
  readonly status: "created" | "awaiting-payment" | "paid" | "other";
  readonly buyerId: string | null;
  readonly credit: Readonly<{ amount: number; name: string | null }> | null;
}
export interface TradePaymentForm {
  readonly order: TradeOrder;
}
export interface TradePaymentInput {
  password: string;
  message?: string;
}
export type TradeOrderRead =
  { kind: "trade-order"; order: TradeOrder } | TradeHandoff | TradeFailure;
export type TradePaymentPreparation =
  | { kind: "trade-payment-form"; form: TradePaymentForm }
  | { kind: "already-paid"; order: TradeOrder }
  | TradeHandoff
  | TradeFailure;
export type TradePaymentResult =
  | { kind: "paid"; order: TradeOrderReference }
  | { kind: "uncertain" }
  | TradeFailure;

export function createTradeClient(options: TradeClientOptions) {
  const host = noticeHost(options);
  const items = new WeakMap<
    TradeGoods,
    { owner: NoticeSession; goods: TradeGoods }
  >();
  const orders = new WeakMap<
    TradeOrderForm,
    {
      owner: NoticeSession;
      offer: Exclude<ReturnType<typeof orderForm>, null | "browser">;
    }
  >();
  const created = new WeakMap<
    TradeOrderReference,
    { owner: NoticeSession; token: string; amount: number }
  >();
  const payments = new WeakMap<
    TradePaymentForm,
    { owner: NoticeSession; url: string; fields: URLSearchParams }
  >();
  const purchases = new WeakMap<
    PaidThreadForm,
    {
      owner: NoticeSession;
      url: string;
      fields: URLSearchParams;
      thread: PaidThread;
    }
  >();
  async function inspectPaidThread(
    threadId: string,
    owner: NoticeSession,
    previous?: PaidThread,
  ): Promise<PaidThreadRead> {
    const url = threadURL(host.origin, threadId);
    const loaded = await host.request(structured(url), owner);
    if (loaded.kind !== "response") return loaded;
    const data = parsed(loaded.response.body);
    if ([401, 403, 404, 429].includes(loaded.response.status))
      return { kind: "refused" };
    if (
      requiresStructuredLogin(data) ||
      (data?.ok === 0 && data.error === "message")
    )
      return refusal(data);
    if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
      return { kind: "session-changed" };
    const structuredPage = decodeStructuredThread(data);
    if (
      loaded.response.status === 200 &&
      (!data || typeof data.document === "string") &&
      !structuredPage
    ) {
      const page = answer(loaded.response);
      const viewer = nativeIdentity(page.html, new URL(url));
      if (viewer !== null && viewer !== owner.memberId)
        return { kind: "session-changed" };
      if (page.failure) return { kind: "refused", message: page.failure };
      const native =
        (viewer === owner.memberId ||
          numericId(data?.uid) === owner.memberId) &&
        nativePaidThread(page.doc, url, threadId, previous);
      return native
        ? { kind: "paid-thread", thread: native }
        : { kind: "invalid-response" };
    }
    if (
      loaded.response.status !== 200 ||
      !structuredPage ||
      numericId(structuredPage.uid) !== owner.memberId
    )
      return { kind: "invalid-response" };
    const thread = object(structuredPage.thread);
    if (id(thread?.tid) !== threadId) return { kind: "invalid-response" };
    const pay = object(thread?.pay);
    if (thread?.price === 0 && !pay) return { kind: "not-paid-thread" };
    const openings = Array.isArray(structuredPage.posts)
      ? structuredPage.posts.map(object).filter((post) => post?.first === 1)
      : [];
    const opening = openings.length === 1 ? openings[0] : null;
    const postId = id(opening?.pid);
    const title = text(thread?.subject);
    if (
      !opening ||
      !postId ||
      !title ||
      !pay ||
      !whole(pay.price) ||
      pay.price < 1 ||
      (thread?.price !== undefined && thread.price !== pay.price) ||
      (pay.need_pay !== 0 && pay.need_pay !== 1) ||
      (pay.need_pay === 1 && opening.message_reason !== "pay")
    )
      return { kind: "invalid-response" };
    if (
      pay.need_pay === 0 &&
      !readablePaidOpening(opening, host.origin, threadId)
    )
      return { kind: "invalid-response" };
    return {
      kind: "paid-thread",
      thread: {
        threadId,
        postId,
        title,
        price: pay.price,
        payers: whole(pay.payers) && pay.payers >= 0 ? pay.payers : null,
        access: pay.need_pay === 1 ? "requires-purchase" : "accessible",
        url,
      },
    };
  }
  async function readPaidThread(threadId: string): Promise<PaidThreadRead> {
    if (typeof threadId !== "string" || !id(threadId))
      return { kind: "invalid-input" };
    const owner = host.session();
    return owner ? inspectPaidThread(threadId, owner) : { kind: "refused" };
  }

  async function preparePaidThread(
    threadId: string,
  ): Promise<PaidThreadPreparation> {
    if (typeof threadId !== "string" || !id(threadId))
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused" };
    const opened = await inspectPaidThread(threadId, owner);
    if (opened.kind !== "paid-thread") return opened;
    const thread = opened.thread;
    if (thread.access === "accessible")
      return { kind: "already-accessible", thread };
    const dialog = forumURL(host.origin, {
      mod: "misc",
      action: "pay",
      tid: threadId,
      pid: thread.postId,
      infloat: "yes",
      handlekey: "pay",
      inajax: "1",
      ajaxtarget: "fwin_content_pay",
    });
    const loadOffer = async (url: string) => {
      const loaded = await host.request(url, owner);
      if (loaded.kind !== "response") return loaded;
      const page = answer(loaded.response);
      const data = page.data;
      const viewer = nativeIdentity(page.html, new URL(dialog));
      if (
        (data?.uid !== undefined && numericId(data.uid) !== owner.memberId) ||
        (viewer !== null && viewer !== owner.memberId)
      )
        return { kind: "session-changed" } as const;
      if (
        [401, 403, 404, 429].includes(loaded.response.status) ||
        requiresStructuredLogin(data) ||
        (data?.ok === 0 && data.error === "message")
      )
        return refusal(data);
      if (loaded.response.status !== 200)
        return { kind: "invalid-response" } as const;
      if (page.failure)
        return { kind: "refused", message: page.failure } as const;
      const offer =
        data?.schema === 17
          ? numericId(data.uid) === owner.memberId
            ? structuredPurchase(data, dialog, thread)
            : null
          : nativePurchase(page.doc, dialog, thread);
      return {
        kind: "offer" as const,
        offer,
        legacy:
          data?.ok === 0 && data.error === "unknown" && data.form === "buy",
      };
    };
    let loaded = await loadOffer(
      query(dialog, { tsdmapp: "json", tsdmform: "1" }),
    );
    if (loaded.kind === "offer" && !loaded.offer && loaded.legacy)
      loaded = await loadOffer(writeURL(dialog));
    if (loaded.kind !== "offer") return loaded;
    const { offer } = loaded;
    if (!offer) return { kind: "browser-handoff", destination: thread.url };
    if (offer.terms.balanceAfterPurchase < 0)
      return { kind: "refused", code: "insufficient-balance" };
    const terms = Object.freeze({
      ...offer.terms,
      author: Object.freeze(offer.terms.author),
      credit: Object.freeze(offer.terms.credit),
    });
    const form = Object.freeze({ threadId, postId: thread.postId, terms });
    purchases.set(form, {
      owner,
      url: offer.url,
      fields: offer.fields,
      thread,
    });
    return { kind: "purchase-form", form };
  }

  async function dispatch(
    url: string,
    owner: NoticeSession,
    body: URLSearchParams,
  ) {
    try {
      const requested = writeURL(url);
      const response = await options.transport.request(requested, {
        fresh: true,
        session: owner,
        method: "POST",
        body: body.toString(),
      });
      return host.current(owner) &&
        response.redirect === "none" &&
        response.url === requested
        ? response
        : null;
    } catch {
      return null;
    }
  }

  async function confirmPaidThread(
    form: PaidThreadForm,
    approved: boolean,
  ): Promise<PaidThreadConfirmation> {
    const record = purchases.get(form);
    if (!record) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    if (!host.current(record.owner)) return { kind: "session-changed" };
    purchases.delete(form);
    const response = await dispatch(record.url, record.owner, record.fields);
    if (!response) return { kind: "uncertain" };
    const data = parsed(response.body);
    if ([401, 403, 429].includes(response.status)) return refusal(data);
    if (response.status !== 200) return { kind: "uncertain" };
    let already = false;
    if (data) {
      if (
        data.type !== "result" ||
        data.schema !== 13 ||
        numericId(data.uid) !== record.owner.memberId ||
        !["message", "handle", "redirect"].includes(text(data.kind))
      )
        return { kind: "uncertain" };
      if (data.login === 1) return refusal(data);
      if (
        data.url &&
        resultThread(sameOrigin(data.url, record.url)) !== form.threadId
      )
        return { kind: "uncertain" };
      const key = text(data.message_key);
      already = key === "credits_buy_thread";
      if (!already && (data.ok === 0 || data.alert === "error"))
        return refusal(data);
      if (!already && (data.ok !== 1 || key !== "thread_pay_succeed"))
        return { kind: "uncertain" };
    } else {
      const page = answer(response);
      const viewer = nativeIdentity(page.html, new URL(record.url));
      if (viewer !== null && viewer !== record.owner.memberId)
        return { kind: "uncertain" };
      if (!nativePurchaseSucceeded(page.doc))
        return page.failure
          ? { kind: "refused", message: page.failure }
          : { kind: "uncertain" };
    }
    const verified = await inspectPaidThread(
      form.threadId,
      record.owner,
      record.thread,
    );
    return verified.kind === "paid-thread" &&
      verified.thread.postId === form.postId &&
      verified.thread.access === "accessible"
      ? {
          kind: already ? "already-accessible" : "purchased",
          thread: verified.thread,
        }
      : { kind: "uncertain" };
  }
  async function readNative(url: string, owner: NoticeSession) {
    const response = await host.request(url, owner);
    if (response.kind !== "response") return response;
    const page = answer(response.response);
    if (
      [401, 403, 404, 429].includes(response.response.status) ||
      page.data?.login === 1
    )
      return refusal(page.data);
    if (response.response.status !== 200)
      return { kind: "invalid-response" } as const;
    const viewer = nativeIdentity(page.html, new URL(url));
    if (
      (viewer !== null && viewer !== owner.memberId) ||
      (page.data?.uid !== undefined &&
        numericId(page.data.uid) !== owner.memberId)
    )
      return { kind: "session-changed" } as const;
    if (page.failure)
      return { kind: "refused", message: page.failure } as const;
    if (viewer === null && numericId(page.data?.uid) !== owner.memberId)
      return { kind: "invalid-response" } as const;
    return { kind: "native-page", page } as const;
  }

  async function readTradeGoods(
    target: TradeItemTarget,
  ): Promise<TradeGoodsRead> {
    if (
      !target ||
      typeof target.threadId !== "string" ||
      !id(target.threadId) ||
      typeof target.postId !== "string" ||
      !id(target.postId)
    )
      return { kind: "invalid-input" };
    const selected = { threadId: target.threadId, postId: target.postId };
    const owner = host.session();
    if (!owner) return { kind: "refused" };
    const url = forumURL(host.origin, {
      mod: "viewthread",
      do: "tradeinfo",
      tid: selected.threadId,
      pid: selected.postId,
    });
    const response = await readNative(url, owner);
    if (response.kind !== "native-page") return response;
    const goods = readGoods(response.page.doc, url, selected, owner.memberId);
    if (goods === "removed") return { kind: "goods-removed" };
    if (!goods) return { kind: "invalid-response" };
    Object.freeze(goods);
    items.set(goods, { owner, goods });
    return { kind: "trade-goods", goods };
  }

  async function prepareTradeOrder(
    goods: TradeGoods,
  ): Promise<TradeOrderPreparation> {
    const record = items.get(goods);
    if (!record) return { kind: "invalid-input" };
    const { owner } = record;
    if (!host.current(owner)) return { kind: "session-changed" };
    const destination = record.goods.orderFormURL;
    if (!destination || record.goods.soldOut)
      return { kind: "refused", code: "ordering-unavailable" };
    const loaded = await readNative(destination, owner);
    if (loaded.kind !== "native-page") return loaded;
    const offer = orderForm(loaded.page.doc, destination, record.goods);
    if (offer === "browser") return { kind: "browser-handoff", destination };
    if (!offer) return { kind: "invalid-response" };
    const form = Object.freeze({
      threadId: record.goods.threadId,
      postId: record.goods.postId,
      terms: offer.terms,
    });
    orders.set(form, { owner, offer });
    return { kind: "trade-order-form", form };
  }

  async function createTradeOrder(
    form: TradeOrderForm,
    input: TradeOrderInput,
  ): Promise<TradeOrderCreation> {
    const record = orders.get(form);
    if (!record || !input) return { kind: "invalid-input" };
    const { owner, offer } = record;
    if (!host.current(owner)) return { kind: "session-changed" };
    const { quantity } = input;
    const { stock, balance, creditPerItem } = offer.terms;
    const cost = quantity * creditPerItem;
    const message = input.message ?? offer.fields.get("buyermsg") ?? "";
    const recipient =
      input.recipient === undefined ? {} : object(input.recipient);
    if (
      !whole(quantity) ||
      quantity < 1 ||
      (stock !== null && quantity > stock) ||
      !whole(cost) ||
      typeof message !== "string" ||
      message.includes("\0") ||
      [...message].length > 200 ||
      !recipient ||
      Object.keys(recipient).some(
        (name) => !offer.recipient.some((field) => field.name === name),
      )
    )
      return { kind: "invalid-input" };
    if (cost > balance)
      return { kind: "refused", code: "insufficient-balance" };
    const fields = new URLSearchParams(offer.fields);
    fields.set("number", String(quantity));
    if (fields.has("buyermsg")) fields.set("buyermsg", message);
    else if (input.message !== undefined) return { kind: "invalid-input" };
    for (const field of offer.recipient) {
      const value = Object.hasOwn(recipient, field.name)
        ? recipient[field.name]
        : field.value;
      if (
        typeof value !== "string" ||
        /[\0\r\n]/.test(value) ||
        (field.required && !value.trim()) ||
        (field.maxLength !== null && [...value].length > field.maxLength)
      )
        return { kind: "invalid-input" };
      fields.set(field.name, value);
    }
    orders.delete(form);
    const response = await dispatch(offer.url, owner, fields);
    if (!response) return { kind: "uncertain" };
    function register(order: TradeOrderReference | null): TradeOrderCreation {
      if (!order) return { kind: "uncertain" };
      Object.freeze(order);
      created.set(order, {
        owner,
        token: offer.fields.get("formhash")!,
        amount: cost,
      });
      return { kind: "order-created", order };
    }
    if ([301, 302, 303].includes(response.status))
      return register(orderReference(response.location ?? "", offer.url));
    const page = answer(response);
    if ([401, 403, 429].includes(response.status)) return refusal(page.data);
    if (response.status !== 200) return { kind: "uncertain" };
    const data = page.data;
    if (!data) return register(nativeOrderCreated(page.doc, offer.url));
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      numericId(data.uid) !== owner.memberId ||
      !["message", "handle", "redirect"].includes(text(data.kind))
    )
      return { kind: "uncertain" };
    if (data.ok === 0 || data.login === 1 || data.alert === "error")
      return refusal(data);
    return register(
      data.ok === 1 && data.message_key === "trade_order_created"
        ? orderReference(text(data.url), offer.url)
        : null,
    );
  }

  async function inspectTradeOrder(selected: string, owner: NoticeSession) {
    const destination = orderURL(host.origin, selected);
    const loaded = await readNative(destination, owner);
    if (loaded.kind !== "native-page") return loaded;
    const details = orderDetails(loaded.page.doc, destination, selected);
    return details
      ? { kind: "trade-order" as const, order: details, page: loaded.page }
      : { kind: "browser-handoff" as const, destination };
  }

  async function readTradeOrder(selected: string): Promise<TradeOrderRead> {
    if (!orderId(selected)) return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused" };
    const result = await inspectTradeOrder(selected, owner);
    return result.kind === "trade-order"
      ? { kind: "trade-order", order: result.order }
      : result;
  }

  async function prepareTradePayment(
    selected: string | TradeOrderReference,
  ): Promise<TradePaymentPreparation> {
    if (typeof selected !== "string") {
      const receipt = created.get(selected);
      if (!receipt) return { kind: "invalid-input" };
      if (!host.current(receipt.owner)) return { kind: "session-changed" };
      const order: TradeOrder = Object.freeze({
        ...selected,
        status: "created",
        buyerId: receipt.owner.memberId,
        credit: Object.freeze({ amount: receipt.amount, name: null }),
      });
      const form = Object.freeze({ order });
      const fields = new URLSearchParams({
        formhash: receipt.token,
        offlinestatus: "4",
        offlinesubmit: "true",
        message: "",
      });
      created.delete(selected);
      payments.set(form, { owner: receipt.owner, url: selected.url, fields });
      return { kind: "trade-payment-form", form };
    }
    if (!orderId(selected)) return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused" };
    const result = await inspectTradeOrder(selected, owner);
    if (result.kind !== "trade-order") return result;
    const { order, page } = result;
    if (order.buyerId && order.buyerId !== owner.memberId)
      return { kind: "refused", code: "wrong-buyer" };
    if (order.status === "paid") return { kind: "already-paid", order };
    if (order.status !== "awaiting-payment" || !order.credit || !order.buyerId)
      return { kind: "browser-handoff", destination: order.url };
    const prepared = paymentForm(page.doc, order.url, selected);
    if (!prepared) return { kind: "invalid-response" };
    const form = Object.freeze({ order });
    payments.set(form, { owner, ...prepared });
    return { kind: "trade-payment-form", form };
  }

  async function payTradeOrder(
    form: TradePaymentForm,
    input: TradePaymentInput,
  ): Promise<TradePaymentResult> {
    const record = payments.get(form);
    if (!record || !input) return { kind: "invalid-input" };
    const { owner } = record;
    if (!host.current(owner)) return { kind: "session-changed" };
    const { password } = input;
    const message = input.message ?? record.fields.get("message") ?? "";
    if (
      typeof password !== "string" ||
      !password ||
      password.includes("\0") ||
      typeof message !== "string" ||
      message.includes("\0") ||
      [...message].length > 200
    )
      return { kind: "invalid-input" };
    const fields = new URLSearchParams(record.fields);
    fields.set("password", password);
    fields.set("message", message);
    payments.delete(form);
    const response = await dispatch(record.url, owner, fields);
    if (!response) return { kind: "uncertain" };
    if ([401, 403, 429].includes(response.status)) return { kind: "refused" };
    const data = parsed(response.body);
    if (
      response.status !== 200 ||
      !data ||
      data.type !== "result" ||
      data.schema !== 13 ||
      numericId(data.uid) !== owner.memberId ||
      !["message", "handle", "redirect"].includes(text(data.kind))
    )
      return { kind: "uncertain" };
    const key = text(data.message_key);
    const order = orderReference(text(data.url), record.url);
    if (data.url && order?.orderId !== form.order.orderId)
      return { kind: "uncertain" };
    if (key === "trade_password_error" || key === "trade_credit_lack")
      return { kind: "refused", code: key };
    if (data.login === 1 || data.ok === 0 || data.alert === "error")
      return { kind: "refused" };
    return data.ok === 1 && key === "trade_orderstatus_updated" && order
      ? { kind: "paid", order }
      : { kind: "uncertain" };
  }

  function tradeHistory(): TradeHandoff {
    return {
      kind: "browser-handoff",
      destination: `${host.origin}/home.php?mod=space&do=trade&view=tradelog`,
    };
  }
  return {
    readPaidThread,
    preparePaidThread,
    confirmPaidThread,
    readTradeGoods,
    prepareTradeOrder,
    createTradeOrder,
    readTradeOrder,
    prepareTradePayment,
    payTradeOrder,
    tradeHistory,
  };
}
