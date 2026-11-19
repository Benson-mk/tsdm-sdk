# Buy a paid thread or complete a trade order

Use an authenticated forum session with enough credits. The host supplies the canonical HTTPS origin, the current member ID and session continuity, and fresh same-session requests. The transport sends form bodies as `application/x-www-form-urlencoded`. It returns the original response URL, status, content type and body, plus the raw `Location` when present. Use manual redirects and one attempt per POST. Keep cookies in the host's session store and exclude payment bodies and raw payment responses from logging.

## SDK

```ts
import {
  createTradeClient,
  type TradeClientOptions,
  type TradeItemTarget,
  type TradeOrderInput,
} from "tsdm-sdk";

export async function tradeWalkthrough(
  host: TradeClientOptions,
  threadId: string,
  item: TradeItemTarget,
  input: TradeOrderInput,
  approve: (effect: "purchase" | "order" | "payment", details: unknown) => Promise<boolean>,
  readPassword: () => Promise<string>,
) {
  const client = createTradeClient(host);
  const available = await client.preparePaidThread(threadId);
  const purchase = available.kind === "purchase-form"
    ? await client.confirmPaidThread(available.form, await approve("purchase", available.form.terms))
    : available;

  const history = client.tradeHistory();
  const goods = await client.readTradeGoods(item);
  if (goods.kind !== "trade-goods") return { purchase, order: goods, history };
  const open = await client.prepareTradeOrder(goods.goods);
  if (open.kind !== "trade-order-form") return { purchase, order: open, history };
  if (!await approve("order", { ...open.form.terms, quantity: input.quantity })) {
    return { purchase, order: { kind: "not-confirmed" }, history };
  }
  const order = await client.createTradeOrder(open.form, input);
  if (order.kind !== "order-created") return { purchase, order, history };

  const payment = await client.prepareTradePayment(order.order);
  if (payment.kind !== "trade-payment-form") return { purchase, order, payment, history };
  if (!await approve("payment", payment.form.order)) {
    return { purchase, order, payment: { kind: "not-confirmed" }, history };
  }
  const paid = await client.payTradeOrder(payment.form, { password: await readPassword() });
  return { purchase, order, payment: paid, history };
}
```

`readPaidThread(threadId)` reports the lock and opening post separately from the purchase dialog. The preparation reads again and returns the author's proceeds, price, credit and remaining balance when it recognizes the form. `confirmPaidThread(form, true)` can deduct credits and checks the exact opening post again before returning `purchased`. `already-accessible` identifies prior access. Supported older pages use the native lock and AJAX dialog with the same post-readback requirement.

`readTradeGoods({ threadId, postId })` exposes the seller, listed prices, stock, description and order-page destination. `prepareTradeOrder(goods)` reads that form and shows the unit credit cost, balance, quantity and available recipient fields. The order operation can create an unpaid order. The SDK supports physical and virtual guaranteed credit trades. Open a `browser-handoff.destination` in the same authenticated browser for cash, buyer-paid freight or other browser-managed terms.

`order-created` supplies the exact `orderId` and its same-origin URL. Pass the original receipt to `prepareTradePayment` to reuse the authorized order form hash for that newly created order. Its `created` status describes the receipt, and its amount comes from the approved quantity and unit price. For an existing order, use `readTradeOrder(orderId)` and `prepareTradePayment(orderId)`. These parse identifiable order details and supported buyer payment forms. An unrecognized order layout hands off to the exact order page. `already-paid` reports a recognizable paid order. Payment needs a separate call with the account password. `paid` is the server's same-order status acknowledgement and can reflect a credit debit. `tradeHistory()` yields the authenticated browser's trade-history page without issuing HTTP.

A form belongs to the creating client and session. After dispatch the SDK consumes it, including on refusal or response loss. `uncertain` means the forum may already have applied the effect. Inspect the thread, exact order or trade history before deciding whether to proceed again.

## Direct Python requests

Use the same authenticated `requests.Session` for the reads and approved writes. The functions below keep responses available for inspection. Use the form actually returned by the server. For purchase review the author, credit, price, and balance. For trade review quantity, total, balance, shipping, recipient controls, and the guaranteed credit route. For payment review the newly returned `orderid` and previous approved amount or the selected order's current terms. Keep the approved action and ordered URL-encoded field pairs private. Never visit the order-creation action via GET because it can itself create an order.

```python
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit, urlencode


def inspect(session, origin, step, *, tid=None, pid=None, orderid=None):
    routes = {
        "thread": {"mod": "viewthread", "tid": tid, "tsdmapp": "json", "nodoc": "1"},
        "purchase-form": {"mod": "misc", "action": "pay", "tid": tid, "pid": pid,
                          "infloat": "yes", "handlekey": "pay", "inajax": "1",
                          "ajaxtarget": "fwin_content_pay", "tsdmapp": "json", "tsdmform": "1"},
        "goods": {"mod": "viewthread", "do": "tradeinfo", "tid": tid, "pid": pid},
        "order-form": {"mod": "trade", "tid": tid, "pid": pid},
        "order": {"mod": "trade", "orderid": orderid},
    }
    query = routes[step]
    if any(value is None for value in query.values()):
        raise ValueError("Supply every target identifier for this read")
    return session.get(origin + "/forum.php", params=query, allow_redirects=False, timeout=20)


def submit_once(session, origin, step, action, fields, *, approved=False, tid=None, pid=None,
                orderid=None, password=None):
    if approved is not True:
        return None
    base = urlsplit(origin)
    dest = urlsplit(urljoin(origin + "/", action))
    if (dest.scheme, dest.netloc, dest.path) != (base.scheme, base.netloc, "/forum.php") or dest.fragment:
        raise ValueError("Unexpected forum action origin or path")
    pairs = parse_qsl(dest.query, keep_blank_values=True)
    query = dict(pairs)
    if len(pairs) != len(query):
        raise ValueError("Repeated query key")
    body = list(fields)
    values = dict(body)
    if not values.get("formhash") or len(values) != len(body) or "password" in values:
        raise ValueError("Missing form hash or unreviewed fields")
    if step == "purchase":
        required = {"mod": "misc", "action": "pay", "paysubmit": "yes"}
        if (not tid or not pid or values.get("tid") != tid or values.get("paysubmit") != "true"
                or query.get("tid", tid) != tid or query.get("pid", pid) != pid):
            raise ValueError("Unexpected purchase target")
        query["inajax"] = "1"
    elif step == "order":
        required = {"mod": "trade", "action": "trade", "tid": tid, "pid": pid}
        if not tid or not pid or values.get("offline") != "1" or values.get("tradesubmit") != "true":
            raise ValueError("Expected the reviewed guaranteed trade form")
    elif step == "payment":
        required = {"mod": "trade", "orderid": orderid}
        if not orderid or not password or values.get("offlinestatus") != "4" or values.get("offlinesubmit") != "true":
            raise ValueError("Expected the selected order payment form")
        body.append(("password", password))
    else:
        raise ValueError("Unknown effect")
    if any(query.get(key) != value for key, value in required.items()) or "password" in query:
        raise ValueError("Unexpected effect target")
    if step != "purchase" and set(query) - set(required) - {"tsdmapp"}:
        raise ValueError("Unexpected trade action parameters")
    query["tsdmapp"] = "json"
    url = urlunsplit(dest._replace(query=urlencode(query)))
    return session.post(url, data=body, allow_redirects=False, timeout=20)
```

For `purchase`, pass the dialog's POST action, `formhash`, `referer`, `tid`, `handlekey`, `paysubmit=true` and applicable served fields. For `order`, pass the served action and successful controls (`formhash`, `number`, `offline`, `transport`, `buyermsg`, `tradesubmit` and applicable recipient fields). For `payment` pass `formhash`, `offlinestatus=4`, `offlinesubmit=true`, `message` and supply the password through a private prompt to `submit_once`. Supply `approved=True` only after the user decides on that specific action.

## Direct curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE_JAR`, and the reviewed `TID`, `PID` and `ORDERID`. The trade item and paid thread may use different IDs. For the purchase dialog use the paid thread's opening post ID. Open `$FORUM_ORIGIN/home.php?mod=space&do=trade&view=tradelog` through the signed-in browser.

```sh
forum="$FORUM_ORIGIN/forum.php"
curl -sS --cookie "$FORUM_COOKIE_JAR" --get "$forum" --data-urlencode mod=viewthread --data-urlencode "tid=$TID" --data-urlencode tsdmapp=json --data-urlencode nodoc=1
curl -sS --cookie "$FORUM_COOKIE_JAR" --get "$forum" --data-urlencode mod=misc --data-urlencode action=pay --data-urlencode "tid=$TID" --data-urlencode "pid=$PID" --data-urlencode infloat=yes --data-urlencode handlekey=pay --data-urlencode inajax=1 --data-urlencode ajaxtarget=fwin_content_pay --data-urlencode tsdmapp=json --data-urlencode tsdmform=1
curl -sS --cookie "$FORUM_COOKIE_JAR" --get "$forum" --data-urlencode mod=viewthread --data-urlencode do=tradeinfo --data-urlencode "tid=$TID" --data-urlencode "pid=$PID"
curl -sS --cookie "$FORUM_COOKIE_JAR" --get "$forum" --data-urlencode mod=trade --data-urlencode "tid=$TID" --data-urlencode "pid=$PID"
curl -sS --cookie "$FORUM_COOKIE_JAR" --get "$forum" --data-urlencode mod=trade --data-urlencode "orderid=$ORDERID"
```

Run the next block separately for each approved effect. Set `EFFECT` to `purchase`, `order` or `payment`, `APPROVED_EFFECT` to the action the user specifically approved, and `OFFERED_POST_URL` to the reviewed canonical action URL, including `tsdmapp=json` (and `inajax=1` for purchase). Supply the reviewed URL-encoded body from a private process on standard input. For payment, prompt for the password in that process and encode it directly in the pipe. Use a new private `RESPONSE_FILE` for each attempt, inspect it securely, and discard it after reconciliation.

```sh
case "${EFFECT-}" in purchase|order|payment) ;; *) exit 2 ;; esac
[ "$EFFECT" = "${APPROVED_EFFECT-}" ] || exit 0
case "$OFFERED_POST_URL" in "$FORUM_ORIGIN"/forum.php\?*) ;; *) exit 2 ;; esac
umask 077
curl -sS --proto '=https,http' --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
  --include --output "$RESPONSE_FILE" --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-binary @- "$OFFERED_POST_URL"
```

An exact `thread_pay_succeed` or qualified native success plus a fresh readable opening post verifies purchase. `credits_buy_thread` with readback shows existing access. An exact `trade_order_created`, a qualified native continuation, or a manual `Location` to the same-origin `mod=trade&orderid=…` identifies the order created. Inspect the next response independently. `trade_orderstatus_updated` must point to that selected order. `trade_password_error` can be a refusal even when `ok=1`. Unclear responses end the attempt and require inspection before another write.
