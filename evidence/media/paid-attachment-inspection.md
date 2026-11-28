# SDK #53 evidence gate: paid attachment inspection

## Pinned TSDM evidence

These observations were extracted from `Carinoasd/tsdm_client` at
`02df67e39ded906def5b868e8f8311ba735b316c`. Paths below are relative to
`test/data`. The extracts omit viewer IDs, names, signed links and input values.

| Upstream fixture | Sanitized observation | SHA-256 of upstream file |
| --- | --- | --- |
| `tsdmapp/thread_v14_attachments.json` | Schema 14 signed-in non-author view, thread `9200046`, post `4989`. The thread itself has `price: 0`. Attachment `564` has `price: 2`, `locked: 1`, no download link and no file URL. The attachment's `attach_564` block links to `forum.php?mod=misc&action=attachpay&aid=564&tid=9200046` and displays `售价: 2 天使币`. | `59bdab2c7b0b47fb0bef5d5fab6911f48fe20a141a518ad2233bbfbb6505d0f2` |
| `tsdmapp/thread_v14_hide_replied.json` | A different viewer, the author of both the thread and the post, sees the same attachment with `price: 2`, `locked: 0`, a download link and a file URL. There is no `attachpay` link for it. This shows author access, not a buyer purchase or a transition on one account. | `9460d77da48490c22a3d87660fc08750d2868125812ab57c71b27a5679de1d37` |
| `tsdmapp/thread_v3_denied_guest.json` | The structured thread route can return `ok: 0`, `error: "message"` and `login: 1` instead of a thread. This is a refusal to inspect, not evidence about the attachment's price. | `9cc7dfb12c9659b96dbfff0682cd7e3fa68d5868b48dcc89aa95112c3323f7f8` |
| `attachment_download/refused_no_permission.html` | The download route's notice explicitly refuses attachment access. It does not quote a price. | `a5a5e05e0f483f3e012251b0e87280b92ea865a2a9c5f0fdd4a75acb3c47f9f3` |
| `attachment_download/refused_price_unpaid.html` | The unpaid notice points to `attachpay` with `aid=37` and `tid=1000`, but gives no terms. The SDK already hands the matching purchase destination to the browser without sending a request to it. | `d9d8b9c6131ff384b3753b7338098f9c928924078c04e401fddcac61a75e08af` |
| `attachment_download/post_attachments.html` | The upstream attachment-download regression supplies an accessible link, a permission-restricted link and a list item for attachment `37` that displays `3 天使币` and links to `attachpay`. Treat this as an upstream regression example, not a deployed purchase-form capture. | `5a5fa53e11b53df5987f65e37d1eefab2d70a07060602a0beddad64440da6499` |

The schema 14 snapshots were committed as forum-plugin regression inputs;
their IDs are from a staging dataset and are not evidence that corresponding
production pages exist. The accessible snapshot's signed download link
matches the row's attachment, thread, and viewer; inspection need not
request that link. The pinned tree did not contain a seller-priced
`attachpay` confirmation form. `attachment_payto_x5.html` is a notice for an
attachment in a paid **thread**, not a seller-priced attachment quote.
`attachment_download/credit_taken.html` is a separate download-credit
effect response and is not a seller-price quote.

## Current client semantics

The maintainer checked `tsdm_client` v1.64.0 (`0cd4fa018`). The structured
attachment model in `lib/shared/models/post_bbcode.dart` carries a numeric
price and lock state, but no currency. The attachment download manager
stores an `attachpay` destination and separately handles `attachcredit`
(`attachment_download_manager.dart`, lines 493–510). Its action widget
hands the stored purchase link to the native dispatcher
(`attachment_download_actions.dart`, lines 299–301). The pinned client
also describes that split in `eef10c13`. None of these client paths offers
the SDK a headless seller-attachment purchase protocol.

## Deployed native quote capture

On November 29, 2026 (Asia/Hong_Kong), the maintainer used an existing
signed-in test profile to open two attachment quotes from one TSDM X5
thread. This is a projection of the sanitized Chrome DevTools request and
raw-response observations. `THREAD`, `ATTACHMENT_A`, and `ATTACHMENT_B`
are aliases; no account identifiers, session material, balances, signed
links, or other hidden-field values are retained.

| Observed request (native-view switch omitted) | Response | Verified response target | Seller terms |
| --- | --- | --- | --- |
| `GET /forum.php?mod=misc&action=attachpay&aid=ATTACHMENT_A&tid=THREAD` | Original HTTPS origin, HTTP 200, `text/html` | Hidden `aid` equals `ATTACHMENT_A`; form action `tid` equals `THREAD` | 2 天使币 |
| `GET /forum.php?mod=misc&action=attachpay&aid=ATTACHMENT_B&tid=THREAD` | Original HTTPS origin, HTTP 200, `text/html` | Hidden `aid` equals `ATTACHMENT_B`; form action `tid` equals `THREAD` | 2 天使币 |

The full pages included `#um`, a positive `discuz_uid` marker, and the
`X5 TSDM SP` footer. Relevant form markup, with unrelated attributes and
rows omitted:

```html
<form id="attachpayform" method="post"
      action="forum.php?mod=misc&amp;action=attachpay&amp;tid=THREAD">
  <h3><em>购买附件</em></h3>
  <input type="hidden" name="formhash">
  <input type="hidden" name="referer">
  <input type="hidden" name="aid" value="ATTACHMENT">
  <table><tbody>
    <tr><td>售价(天使币)</td><td>2 </td></tr>
  </tbody></table>
  <input name="buyall" type="checkbox">
  <button name="paysubmit" type="submit">购买附件</button>
</form>
```

The network trace contained no `attachcredit`, `paysubmit` request, or
non-GET `attachpay`: **zero payment requests in both observations**. A
positive viewer marker is evidence that this layout exposes a viewer ID,
not a substitute for matching that ID to the SDK's original account and
session. The capture does not cover Ajax, insufficient funds, native
prior-access responses, two different deployed prices, or a request
without the userscript's native-view switch.

An additional fresh same-origin thread GET with `tsdmapp=json&nodoc=1`
returned HTTP 200, schema 23, and a `uid` matching the native viewer. Its
rendered post data included the two `attachpay` links, but neither quoted
attachment was present in `posts[].attachments[]`. A missing structured
row is inconclusive, not refusal or a reason to skip the exact native
quote. The replay projects this layout and varies only the second quote
for the two-price case.

## Source corroboration, not a TSDM deployment capture

The [Discuz template](https://raw.githubusercontent.com/Discuz-X/DiscuzX/Common/template/default/forum/attachpay.htm)
separates the attachment ID, price, and credit title and has an explicit
POST submit control. The [corresponding handler](https://raw.githubusercontent.com/Discuz-X/DiscuzX/Common/source/module/forum/forum_misc.php)
shows that a bare purchase-page GET is not a submit; `paysubmit` guards the
effect, `buyall` can change its scope, and `attachcredit` is a separate
effectful route even when called with GET. Source behavior does not establish
TSDM's rendered labels, account markers, or form variants.

## Failure cases defined before implementation

- Reject invalid attachment or thread identity. Do not follow redirects to an
  external origin, another attachment or thread, a write, or a charge.
- On account or session mismatch (including same-account re-login), ignore
  the response and do not retry with a different session. Do not issue the
  request without a member session.
- A refusal is not an offer. A paid-thread barrier, a separate download-credit
  prompt, or a missing attachment is not an attachment price or proof of access.
- Missing, contradictory, duplicate, cross-attachment, unknown-currency, or
  malformed terms must not turn into a price or default to 天使币.
- An unrecognized native page retains a browser handoff. Do not execute
  scripts, read back secret values, submit forms, or follow download links
  to determine access.
- A controlled two-price replay can combine or alter captured evidence;
  label it synthetic. Trace method, fresh/read-only intent, and safe target
  identity; retain no session, account, form or signed-link material.

## Installed-package replay

Run on Node.js 26 with the pinned upstream fixture directory present and
dependencies installed in a regular `node_modules` directory:

```sh
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.1.tgz
TSDM_MEDIA_UPSTREAM="$UPSTREAM" node scripts/check-installed-paid-attachment.mjs \
  "$archive" > inspection.json
jq -c '({archiveSHA256, package, node}), (.results[] | {
  scenario: .name, outcome: .observed.kind,
  requests: [.requests[] | [.method, .route, .effect, .fresh, .sameSession, .exactDestination]],
  paymentRequests
})' inspection.json > inspection.jsonl
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" \
  npm run test:install -- "$archive"
TSDM_MEDIA_UPSTREAM="$UPSTREAM" node scripts/check-installed-media.mjs "$archive"
node scripts/check-installed-trades.mjs "$archive"
```

Against `dab4123` the clean installation and lockfile integrity check
succeeded, and the consumer exited 1 with
`TypeError: client.inspectPaidAttachment is not a function`.
The implemented candidate passed all 17 scenarios. The
[sanitized request trace](paid-attachment-inspection.jsonl) records 30
read-only GETs and zero payment requests, including the unsupported-page
handoff. Each request tuple gives its method, route, effect flag, freshness,
same-session assertion, and exact-destination assertion. The full replay
also records the expected and actual attachment ID, amount, and currency
for each offer. The captured author response is replayed at its original
origin using only the controlled host transport; no fixture makes a live
request.

Two packs from the integration worktree with regular dependencies reproduced
the trace and archive hash. A symlinked dependency directory changed only
the bundle's source-region path comments and thus the archive hash, not the
observed requests or outcomes.

## Trade-offs and limits

- One structured read can establish current access from an unlocked, exact,
  same-member attachment and its matching signed destination without
  requesting the file. A missing row (including a row on a different page)
  is inconclusive; the SDK does not scan the thread or infer purchase.
- The terms come from the dedicated native form rather than a numeric
  thread row or rendered list text. Matching form and viewer identity costs
  an additional GET when access is inconclusive. Other layouts or identity
  evidence fall back to the browser, and unrecognized terms stay unknown.
- The host's member ID and continuity, plus returned viewer evidence, bind
  the inspection without credential access. Redirects are never followed.
  Existing download and purchase-handoff behavior reuses the same URL
  qualification helpers without calling the inspector.
- The request receipt traces controlled responses, not production SDK
  traffic. The captured native pages used a native-view switch and both
  quoted 2 天使币. The different price, failure paths and relogin are
  controlled variations; no buyer balance or post-purchase access was checked.
