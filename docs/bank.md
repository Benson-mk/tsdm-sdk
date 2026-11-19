# Use forum banking and loan services

Use an authenticated member and the forum's canonical HTTPS origin. The host supplies the member ID and a continuity value that changes when the session is replaced. Use fresh, same-session requests, report redirects accurately and send each effectful POST once. Encode forms as `application/x-www-form-urlencoded`. Keep the bank password and request body out of logs and saved state.

## TypeScript

```ts
import {
  createBankClient,
  type BankClientOptions,
  type BankForm,
  type BankServicePage,
} from "tsdm-sdk";

export async function depositExample(
  host: BankClientOptions,
  bankId: string,
  amount: string,
  approve: (page: BankServicePage, form: BankForm, amount: string) => Promise<boolean>,
  readBankPassword: () => Promise<string>,
) {
  const client = createBankClient(host);
  const read = await client.readBankService("savings", bankId);
  if (read.kind !== "bank-service") return read;
  const form = read.service.forms.find(form => form.operation === "deposit-current");
  if (!form) return read;
  if (!await approve(read.service, form, amount)) return { kind: "not-confirmed" };
  return client.submitBankForm(form, { banknum: amount, bankpass: await readBankPassword() }, true);
}
```

`readBankDirectory()` returns the offered banks and account markers. `readBankService` accepts `lobby`, `savings`, `fixed`, `transfer`, `loans`, `account`, `overview`, `rankings` and `trading`. Use a bank ID for the first six. Overview, rankings and trading are global. Balances, rates and dates remain server text. `readBankLogs(bankId, { received, page })` reads own or received records and omits the separate IP column.

- The lobby can offer `open-account`. Review the fee and choose and confirm the bank password. The account page can offer `close-account` and `change-password`.
- Savings can offer `deposit-current`, `withdraw-current` and `settle-interest`. The SDK uses the actual deposit or withdrawal radio value and a separate interest form when offered.
- Fixed deposits require a positive amount and at least 30 days. Review the record context on an inline withdrawal form when offered. For linked withdrawals, review a record from `service.withdrawals`, then call `prepareBankWithdrawal(record)` to inspect the forum's confirmation notice. Approve the returned form separately.
- Transfers require at least 10 units and an exact recipient name. `estimateBankTransferFee(page, amount)` rounds the displayed per-mille rate up to the next whole unit using integer arithmetic. The forum decides the actual fee.
- `apply-loan` submits the offered amount, duration and bank password after approval. `repay-loan` and `cancel-loan` handoffs can act when visited. Show their exact record and terms and open them only on a deliberate browser action. Do not prefetch them. Enabled points trading also returns a browser destination because the pinned evidence has no native trading POST contract.

`submitBankForm(form, fields, true)` rechecks the selected service, form and displayed terms before dispatch. For a linked withdrawal it also rechecks the exact record and confirmation notice. `not-confirmed`, `terms-changed` and preflight refusal send no POST. The SDK reports a recognized response as `unconfirmed` because even a generic success reply leaves the ledger effect unverified. `refused` preserves a recognizable rejection, and `uncertain` covers a lost or unqualified response. Read the account, record list or logs again to reconcile. An ambiguous attempt must not trigger an automatic retry. Handles belong to the original client and session.

## Direct Python requests

Use an authenticated `requests.Session` with retries disabled. Review the exact server form and its terms, re-read it before submission, and keep the current hidden fields. Read fixed withdrawal confirmation only from a qualified link for the exact record. Loan repayment and cancellation links are browser destinations.

```python
import re
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit, urlencode

PLUGIN = "bank_ane:bank"
SERVICES = {"lobby": "", "savings": "cur", "fixed": "fix", "transfer": "chg", "loans": "len",
            "account": "pas", "overview": "", "rankings": "list", "trading": "buy"}
GLOBAL = {"overview", "rankings", "trading"}
POSTS = {"open-account": ("open", ""), "close-account": ("pas", "cl"), "change-password": ("pas", "cg"),
         "deposit-current": ("cur", "in"), "withdraw-current": ("cur", "out"), "settle-interest": ("cur", "ok"),
         "deposit-fixed": ("fix", "in"), "withdraw-fixed": ("fix", "out"), "transfer": ("chg", "ok"),
         "apply-loan": ("len", "try")}


def positive(value):
    return re.fullmatch(r"[1-9][0-9]{0,17}", str(value)) is not None


def bank_read(session, origin, service, *, bank_id=None, page=1, received=False, record_id=None):
    query = {"id": PLUGIN}
    if service == "directory" or service in GLOBAL:
        if bank_id is not None:
            raise ValueError("Unexpected bank ID")
        if service != "directory":
            query["mode"] = "other"
    elif positive(bank_id):
        query["bankid"] = bank_id
    else:
        raise ValueError("Invalid bank ID")
    if service == "logs":
        query.update(action="log", show="1" if received else "0", page=page)
    elif service == "withdrawal-confirmation" and positive(record_id):
        query.update(action="fix", op="out", noid=record_id)
    elif service != "directory":
        action = SERVICES[service]
        if action:
            query["action"] = action
        if page > 1:
            query["page"] = page
    return session.get(origin + "/plugin.php", params=query, allow_redirects=False, timeout=20)


def qualified_url(origin, raw, expected):
    base = urlsplit(origin)
    dest = urlsplit(urljoin(origin + "/", raw))
    pairs = parse_qsl(dest.query, keep_blank_values=True)
    if ((dest.scheme, dest.netloc, dest.path) != (base.scheme, base.netloc, "/plugin.php") or dest.fragment
            or len(pairs) != len(dict(pairs)) or dict(pairs) != expected):
        raise ValueError("Unexpected bank destination")
    return dest


def loan_destination(origin, offered_url, bank_id, record_id, operation):
    if not positive(bank_id) or not positive(record_id):
        raise ValueError("Invalid loan identity")
    op = {"repay-loan": "gb", "cancel-loan": "gu"}[operation]
    expected = {"id": PLUGIN, "bankid": str(bank_id), "action": "len", "op": op, "noid": str(record_id)}
    return qualified_url(origin, offered_url, expected).geturl()


def submit_once(session, origin, operation, offered_url, fields, *, bank_id, approved=False, record_id=None):
    if approved is not True:
        return None
    dest = qualified_url(origin, offered_url, {"id": PLUGIN})
    action, op = POSTS[operation]
    body = list(fields)
    values = dict(body)
    if (len(values) != len(body) or not positive(bank_id) or values.get("bankid") != str(bank_id)
            or values.get("action") != action or values.get("op", "") != op or values.get("banksubmit") != "true"):
        raise ValueError("Unexpected bank form or submit control")
    if operation == "withdraw-fixed":
        record_keys = values.keys() & {"noid", "fixid"}
        if not positive(record_id) or len(record_keys) != 1 or values[next(iter(record_keys))] != str(record_id):
            raise ValueError("Unexpected withdrawal record")
    elif values.keys() & {"noid", "fixid"}:
        raise ValueError("Unexpected record control")
    url = urlunsplit(dest._replace(query=urlencode({"id": PLUGIN, "tsdmapp": "json"})))
    return session.post(url, data=body, allow_redirects=False, timeout=20)
```

For `submit_once`, pass the current form controls as ordered pairs, including the observed `banksubmit=true` and `formhash` when served. Supply the reviewed user fields and the observed `bankid`, `action`, and `op`. Preserve amount and duration as exact decimal strings. For a withdrawal, preserve the served record control, `fixid` for an inline form or `noid` for the linked confirmation. For password confirmation use the chosen bank password twice. Keep raw responses private because a server could echo a credential. Inspect current, fixed, loan or log records after submission to observe any effect.

## Direct curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE_JAR`, `BANK_ID`, and the selected term `RECORD_ID`. Use the same private cookie jar for the exact reads and reviewed writes. This discovery block includes the fixed record's read-only confirmation. It never visits a loan `gb` or `gu` link.

```sh
endpoint="$FORUM_ORIGIN/plugin.php"
read_bank() {
  curl -sS --max-time 20 --cookie "$FORUM_COOKIE_JAR" --get "$endpoint" --data-urlencode id=bank_ane:bank "$@"
}
read_bank
read_bank --data-urlencode "bankid=$BANK_ID"
for action in cur fix chg len pas; do
  read_bank --data-urlencode "bankid=$BANK_ID" --data-urlencode "action=$action"
done
for show in 0 1; do
  read_bank --data-urlencode "bankid=$BANK_ID" --data-urlencode action=log --data-urlencode "show=$show" --data-urlencode "page=${PAGE:-1}"
done
read_bank --data-urlencode mode=other
for action in list buy; do read_bank --data-urlencode mode=other --data-urlencode "action=$action"; done
read_bank --data-urlencode "bankid=$BANK_ID" --data-urlencode action=fix --data-urlencode op=out --data-urlencode "noid=$RECORD_ID"
```

Set `OPERATION` and `APPROVED_EFFECT` to the exact chosen operation. Set `OFFERED_POST_URL` to the reviewed server POST action with `tsdmapp=json` appended, and `RESPONSE_FILE` to a new private file. Pipe the reviewed form body from a private process on standard input. Prompt for passwords inside that process so they stay out of command arguments. Review the response privately and check the ledger through a separate read.

```sh
case "${OPERATION-}" in
  open-account|close-account|change-password|deposit-current|withdraw-current|settle-interest|deposit-fixed|withdraw-fixed|transfer|apply-loan) ;;
  *) exit 2 ;;
esac
[ "$OPERATION" = "${APPROVED_EFFECT-}" ] || exit 0
case "$OFFERED_POST_URL" in "$FORUM_ORIGIN"/plugin.php\?*) ;; *) exit 2 ;; esac
umask 077
curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
  --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @- \
  --output "$RESPONSE_FILE" "$OFFERED_POST_URL"
```
