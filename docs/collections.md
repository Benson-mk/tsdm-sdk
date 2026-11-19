# Organize threads into collections

[SDK tasks](../README.md#tasks)

Use `createCollectionClient` from `tsdm-sdk` on Node.js 26. The host supplies a canonical HTTPS forum origin, a fresh transport, and the current authenticated member ID and session continuity token. Return `null` from `session()` for a guest. Change the continuity token whenever the session changes, including re-login by the same member. The transport must bind each request to the supplied session, bypass caches, keep redirects manual, report the actual response URL and redirect state, and dispatch effects once. For collection AJAX requests send `X-Requested-With: XMLHttpRequest`. For POST send `Content-Type: application/x-www-form-urlencoded` and the supplied body.

```ts
import { createCollectionClient } from "tsdm-sdk";

const origin = "https://forum.example.test";
const client = createCollectionClient({
  origin,
  session: () => null,
  transport: {
    async request(url, request) {
      if (url !== `${origin}/forum.php?mod=collection` || request.effect)
        throw new Error("Unexpected request in the example");
      return {
        url,
        status: 200,
        contentType: "text/html",
        redirect: "none",
        body: `<div id="ct"><div class="tb"><ul><li class="a">
          <a href="forum.php?mod=collection">Recommended</a></li></ul></div>
          <div class="clct_list"><div class="xld"><dl><dt>
          <a href="forum.php?mod=collection&amp;action=view&amp;ctid=91">Example Archive</a>
          </dt></dl></div></div></div>`,
      };
    },
  },
});
const result = await client.readList({ tab: "recommended" });
if (result.kind === "list") console.log(result.items[0]?.id, result.items[0]?.name);
```

The example prints `91 Example Archive` against an in-process fixture. A real host would supply its session and transport at the same boundary.

| Public SDK operation | Prerequisite and observable result |
| --- | --- |
| `readList({ tab: "recommended", page })` or `readList({ tab: "all", order, page })` | Public directory. Returns ordered rows and pagination. The all directory accepts `dateline`, `threadnum`, `commentnum`, and `follownum`. |
| `readList({ tab: "owned" })` or `readList({ tab: "subscribed" })` | Member session. Each reads the same unpaged forum URL and returns the selected relationships. Owned includes collections the member helps maintain. |
| `readRelated(threadId)` | Returns the collections the forum lists for that exact thread. |
| `readDetail(collectionId, page)` | Returns collection metadata, the page of threads and reasons, and the offered management and subscription controls. |
| `readComments(collectionId, page)` | Returns visible comments and ratings with the offered comment and rating controls. |
| `readAddDialog(threadId)` | Member session. Detects the advertised `collection` small form, with a legacy read fallback. Returns eligible collections and the remaining create allowance for the specified thread. |
| `createCollection(listOrDialog, { title, description, keywords })` | Use an original list or dialog from this client that offers create. A confirmed response includes the new `collectionId` and its canonical `collectionURL` for the host. |
| `editCollection(detail, { title, description, keywords })` | Use a detail that offers edit. Updates the metadata of that collection. Keywords accept whitespace, commas and semicolons as separators. |
| `addThread(dialog, collectionIds, reason)` | Supply one or more distinct IDs offered by that dialog. Adds its thread to those collections. The forum can also acknowledge an already-present thread. |
| `removeThreads(detail, threadIds)` | Supply one or more distinct IDs offered for removal on this detail page. Removes collection membership. |
| `comment(comments, message, rating)` | Use the result of `readComments` with an offered comment form. The optional rating is an integer from 1 through 5 and needs the rating input. A rating can be submitted with an empty message. |
| `subscribe(detail)` or `unsubscribe(detail)` | **Effectful GET.** The detail must offer the requested direction. Changes the member’s subscription. |
| `deleteCollection(detail)` | **Effectful GET.** The detail must offer a signed delete link. Deletes the collection itself. |

Use the original objects returned by this client for writes. The client keeps each offer bound to its target and original session and checks the session again after the response. Read results can be serialized for display. Reload the page or dialog to obtain write authority in another client or after reconnecting.

`confirmed` means the forum returned the operation’s expected success receipt. `refused`, `login`, and `rate-limited` indicate distinct server outcomes. An invalid selection or missing offer returns `invalid` before dispatch. `session-changed` means the source session no longer qualifies for the planned request. `uncertain` covers missing, redirected, mismatched, or inconclusive responses after dispatch, including the forum’s blank duplicate-subscription response. To investigate, read the detail, relevant membership page, or comment page again under the original account and compare the returned state. The SDK makes no automatic retry. Do not prefetch or follow the three effectful GETs as links.

## Direct HTTP with Python requests or curl

Start with native collection pages. Use a new `requests.Session()` for public reads and a session with the intended member’s cookies for member operations. Check `discuz_uid` in the returned page before taking its `formhash` or forms. Keep the token and cookies scoped to the same HTTPS origin. Use fresh reads and check the status, URL, selected directory tab, target IDs and returned pagination. IDs below are fictitious.

| Read | Query after `forum.php?mod=collection` | Evidence in the response |
| --- | --- | --- |
| Recommended | No extra query | Active recommended tab and `.clct_list` rows or explicit empty message |
| All | `&op=all&order=follownum&page=2` | Active order, current `.pg` page and collection rows |
| Owned and subscribed | `&op=my` | `ctag0` created, `ctag1` team and `ctag2` subscribed |
| Related | `&tid=501` | Active related tab for `501` and row links with `fromtid=501` |
| Detail | `&action=view&ctid=91` | Collection heading link for `91`, thread table and management controls |
| Comments | `&action=view&op=comment&ctid=91` | Heading link for `91`, comments and optional `message` and `ratescore` form controls |
| Legacy add dialog | `&action=edit&op=addthread&tid=501&inajax=1&tsdmapp=json` | XML CDATA or a schema 13 `page` with `document`. Check the same-origin form target, form hash, `tids[]`, and enabled collection options. |
| Structured add dialog | `&action=edit&op=addthread&tid=501&handlekey=k_collect&inajax=1&tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1` | First GET `/plugin.php?id=tsdmapp%3Aapi&action=status` in the same session. If `v4=1` and `forms` includes `collection`, expect schema 17 with `form=collection`, matching `uid` and `tid`, a same-origin submit target and a single matching `tids[]`. Use the legacy read when a supported form cannot be established. Stop on login, explicit refusal or rate limit. |

For deliberate effects use the following endpoints and data. The `formhash` comes from the qualified page or dialog. Send `tsdmapp=json` to request a structured receipt. A deployment without the plugin may return native HTML or AJAX XML. For schema 13 check its `uid`, receipt type, operation key and any supplied IDs. An `ok` flag or redisplayed page alone is ambiguous. For native XML inspect the matching success/error callback, its values and any destination as text. For an absent or conflicting receipt, verify the current state with a fresh read before deciding whether to make another attempt.

| Effect | Request and form fields | Successful receipt |
| --- | --- | --- |
| Create | POST `action=edit&op=add&inajax=1`. Send `formhash`, `collectionsubmit=1`, `submitcollection=1`, `title`, `desc`, `keyword`. | `collection_create_succ`, new `values.ctid` and matching collection view URL. The legacy handler is `createcollection`. |
| Edit | POST `action=edit&op=edit&ctid=91&inajax=1` with the same fields as create. Confirm the signed edit link. | `collection_edit_succ` and view URL for `91`. |
| Add | POST `action=edit&op=addthread` with `formhash`, `addthread=1`, `handlekey=k_collect`, `reason`, `ctid[0]=91` and `tids[0]=501`. For legacy put `inajax=1` in the query. For v4 include the form’s `inajax=1` field and `tsdmv=4` in the query. | `collection_collect_succ` for a structured submission. A legacy submission can also return the `k_collect` success callback. |
| Remove threads | POST `action=edit&op=delthread&inajax=1` with `formhash`, `ctid=91`, `delthread[0]=501`. Verify the checkbox belongs to the removal form for `91`. | `collection_remove_thread` and view URL for `91`. |
| Comment | POST `action=comment&ctid=91&inajax=1` with `formhash`, `handlekey=k_addComment`, `message`, and `ratescore` (empty when omitted). | `collection_comment_succ` or legacy `addComment` callback. A flood response can include `values.waittime`. |
| Subscribe | **Effectful GET** `action=follow&op=follow&ctid=91&formhash=…&inajax=1`. | `collection_follow_succ` and `values.status=1` or legacy `followcollection` receipt with status `1`. |
| Unsubscribe | **Effectful GET** `action=follow&op=unfo&ctid=91&formhash=…&inajax=1`. | `collection_unfollow_succ` and `values.status=2` or legacy `followcollection` receipt with status `2`. |
| Delete | **Effectful GET** `action=edit&op=remove&ctid=91&formhash=…&inajax=1`. Confirm the signed delete control. | `collection_delete_succ` and the `op=my` destination. |

The Python read calls below show the request boundary. `requests` supports form submissions as `data={...}`. For a deliberate GET use `http.get` with the corresponding query from the effect table. For a deliberate POST use `http.post` with that query as `params` and the table’s fields as `data`. Use `allow_redirects=False` and a timeout on every call. Inspect the receipt before any follow-up request. The `example.test` origin is a placeholder for a controlled forum.

```python
import requests

origin = "https://forum.example.test"
with requests.Session() as http:
    response = http.get(
        f"{origin}/forum.php",
        params={"mod": "collection", "action": "view", "ctid": "91"},
        headers={"Cache-Control": "no-cache"},
        allow_redirects=False,
        timeout=10,
    )
    if response.status_code == 200:
        print(response.text)  # Check the collection heading link for ctid=91.
```

For curl the qualified read looks like this. Use `--cookie "$COOKIE_JAR"` with a local cookie jar for the intended member. For any effect, construct the URL from the effect table at that origin after validating the page. Use `--data-urlencode 'field=value'` for every POST field, including indexed keys. Send each effect once, with no `--location` or `--retry`. Inspect headers and body for the matching receipt before reporting success.

```sh
ORIGIN='https://forum.example.test'
curl --silent --show-error --include --max-time 10 \
  --header 'Cache-Control: no-cache' \
  "$ORIGIN/forum.php?mod=collection&action=view&ctid=91"
```
