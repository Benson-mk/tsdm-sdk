# Use member spaces, walls and follow feeds

[All SDK tasks](../README.md#tasks) · [Sign in and verify the account](account.md)

Use Node.js 26.x and import `createSpaceClient` from `tsdm-sdk`. Give the client one forum origin and a transport for a signed-out or member session. For writes, use the signed-in account ID and a continuously bound session. The host changes the `session()` value whenever credentials change, including when the same account signs in again. The transport must use the session named on each request, honor `fresh`, preserve the exact URL and report `none`, `followed` or `opaque` accurately. Do not follow redirects or retry writes in the transport. Encode POST bodies as `application/x-www-form-urlencoded`. Keep cookies, tokens and drafts in the host.

## TypeScript

The host can run these functions with its own `SpaceClientOptions`. `browseWall` returns the observed owner, visible entries and an independently requested next page. `postWall` opens a fresh wall page before preparing a single submission. Call it with `deliberate` set to `true` only after the user confirms the message and destination. After `uncertain`, retain the draft and inspect the wall under the original account before deciding whether to send again.

```ts
import { createSpaceClient, type SpaceClientOptions } from "tsdm-sdk";

export async function browseWall(host: SpaceClientOptions, memberId: string) {
  const client = createSpaceClient(host);
  const path = `/home.php?mod=space&do=wall&uid=${encodeURIComponent(memberId)}`;
  const page = await client.read(path);
  if (page.kind !== "page") return page;
  const next = page.next ? await client.readNext(page) : null;
  return { page, next };
}

export async function postWall(
  host: SpaceClientOptions,
  accountId: string,
  memberId: string,
  message: string,
  deliberate: boolean,
) {
  const client = createSpaceClient(host);
  const form = await client.prepare({
    accountId,
    source: `/home.php?mod=space&do=wall&uid=${encodeURIComponent(memberId)}`,
    command: { action: "post-wall", memberId, message },
  });
  return form.kind === "prepared" ? client.submit(form, { deliberate }) : form;
}
```

The SDK reads structured page types 57–64 where available, otherwise parses the returned document or requests the native page once. A `SpacePage` carries the viewer, known owner, visible rows, any reported hidden count and an advancing continuation. Items carry stable IDs, visible text and parsed content, known privacy or restriction, and applicable links. A null owner, count or continuation means the response could not supply that field, or there was no further page advertised. `readNext(page)` checks the original host session and rejects a conflicting returned account. Keep the original page object to use this binding. For older native feed fragments, an explicit `false` switches the recent stream to archive page 1 or ends the archive. The host can display the results in the forum's order, including repeats across the archive transition.

| Read or handoff                        | Same-origin `/home.php` query                                                                           | Observable result                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Member space                           | `mod=space&uid=MEMBER`                                                                                  | Native member-space destination                                                                                             |
| Status list or one status              | `mod=space&do=doing&view=all` or `mod=space&do=doing&uid=MEMBER&view=me`, optionally with `doid=STATUS` | Status IDs, visible text and replies destination                                                                            |
| Status replies                         | `mod=spacecp&ac=doing&op=getcomment&doid=STATUS&page_c=PAGE`                                            | Replies, structured parent IDs and next reply page                                                                          |
| Blogs and individual blog              | `mod=space&do=blog&uid=MEMBER&view=me` or `mod=space&do=blog&uid=MEMBER&id=BLOG`                        | Titles and list privacy, article and comments                                                                               |
| Albums and photo list                  | `mod=space&do=album&uid=MEMBER&view=me` or `mod=space&do=album&uid=MEMBER&id=ALBUM`                     | Albums, cover, lock and default album link, or photos and thumbnails                                                        |
| Photo viewer                           | `mod=space&do=album&uid=MEMBER&picid=PHOTO`                                                             | Native photo destination                                                                                                    |
| Wall                                   | `mod=space&do=wall&uid=MEMBER`, optionally with `cid=COMMENT`                                           | Owner and visible message IDs                                                                                               |
| Received greetings                     | `mod=spacecp&ac=poke`                                                                                   | Greetings for the signed-in viewer                                                                                          |
| Public, following and member timelines | `mod=follow&view=other`, `mod=follow&view=follow` or `mod=follow&uid=MEMBER&do=view`                    | Feed IDs, relay notes, thread links and visible restrictions                                                                |
| Older feed                             | `mod=spacecp&ac=follow&op=getfeed&archiver=0&page=2&viewtype=other`                                     | Feed fragment scoped to the original stream, with `archiver=1` for older archived items and `uid=MEMBER` for member streams |
| Following and followers                | `mod=follow&do=following&uid=MEMBER` or `mod=follow&do=follower&uid=MEMBER`                             | Member IDs and any visible remark                                                                                           |

When the SDK returns `document-navigation`, open the supplied destination in the same forum session. The host owns navigation and any password or challenge interaction. `permission`, `missing`, `login`, `limited` and `incomplete` explain why there is no page. A redrawn form or an ambiguous result can require inspecting the original forum page.

## Deliberate operations

Use the matching source above, or `source: null` for the three dedicated forms. Copy the IDs from the established view. `prepare` only reads. `submit` consumes that exact prepared object once, including when the response is lost. A `confirmed` result is the forum's acknowledgement for the operation. Acknowledgements for publishing a blog include its destination when established, and a rename can include the server's stored name. A lost or unrecognized reply yields `uncertain`. A fresh independent read is a separate call and never resends. When checking removals, read through all relevant continuations before concluding a row is absent.

| Command                                    | Source and required input                                                                                                    | Effect and forum acknowledgement                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `post-status`                              | A status page offering the post box, with `message`                                                                          | New status, `do_success`                                                                             |
| `reply-status`                             | Status replies, `statusId`, optional `replyId`, `message`                                                                    | Reply to the status or the identified reply, `do_success`                                            |
| `delete-status`                            | Status list or reply list showing a removable row, `statusId` and optional `replyId`                                         | Delete the status or its reply, `do_success` or a matching native handler                            |
| `publish-blog`                             | Dedicated form, `subject`, `message`, selected `privacy`, optional `category`, `newCategory`, `systemCategory` or `password` | Publish plain text under the selected privacy. The acknowledgement is `do_success` with the blog URL |
| `post-wall`                                | Destination wall with a post box, `memberId`, `message`                                                                      | Publish to that member's wall, `do_success`                                                          |
| `reply-wall`                               | Your own wall, `commentId`, `message`                                                                                        | Quote the original comment onto its author's wall, `note_wall_reply_success`                         |
| `delete-wall`                              | Wall showing a removable message, `commentId`                                                                                | Delete that message, `do_success`                                                                    |
| `send-greeting` / `reply-greeting`         | Dedicated form, `memberId`, offered `iconId`, `note`                                                                         | Send a new greeting or return one, `poke_success`                                                    |
| `ignore-greeting` / `ignore-all-greetings` | Received greetings, with `memberId` for one sender                                                                           | Ignore the addressed greeting or all received greetings, `has_been_hailed_overlooked`                |
| `follow`                                   | Target member's following page, `memberId`                                                                                   | Add the member to your follows, `follow_add_succeed`                                                 |
| `unfollow` / `rename-follow`               | Your own following page with the target row, `memberId` and `name` for rename                                                | Remove the follow or save its private name, `follow_cancel_succeed` or `follow_remark_succeed`       |
| `relay`                                    | Timeline with a relay target, `feedId`, `note`, explicit `reply`                                                             | Relay the thread and optionally post a thread reply, `relay_feed_success`                            |
| `delete-feed`                              | Timeline with an offered delete action, `feedId`                                                                             | Delete the feed entry, `do_success`                                                                  |

A same-account schema-13 `poke_success` can confirm a greeting with an empty `handlekey`. A conflicting nonempty key is inconclusive. A redrawn native dialog may contain a callback definition. Only an actual qualified callback invocation establishes the native result.

The forum decides who can read and act. If blog privacy requires selecting specific friends, or the forum requires a challenge, follow the native form handoff. A legacy response may omit the viewer or confirmation fields. If the response cannot establish the signed-in form, keep the operation in the forum UI. Album file uploads and final filing use the separate media workflow.

## Python requests and curl

The SDK reads `status` in the current session before selecting a structured space page or greeting dialog. For direct HTTP callers, check `/plugin.php?id=tsdmapp%3Aapi&action=status` in the same session. A structured list requires `v4: 1` and the exact name in `space_pages` (`doing`, `docomment`, `feed`, `follow`, `blog`, `album`, `wall`, or `poke`). For an eligible list add `tsdmapp=json&tsdmv=4&nodoc=1` and validate its `type`, `schema`, viewer, target, scope, page and list fields. For native fallback, parse the returned document (including `document` in the legacy envelope), or request the same route once without representation flags. A reply-list or older-feed native request also needs `inajax=1`. Parse the XML CDATA, or a schema-13 `kind=page` document, with an HTML parser. A login requirement, privacy notice, missing member or rate limit ends the read. Treat unrecognized markup as incomplete.

Greeting forms have their own capability. Only use `tsdmv=4&tsdmform=1&nodoc=1` with `tsdmapp=json` when `v4` is on and `forms` includes `poke`. Ask the send or reply window with `infloat=yes`, `inajax=1` and the appropriate handle key. Check the returned `op`, `touid`, viewer, offered icon and POST destination. Use the served fields on one approved POST with the v4 write flags. Use the original full-page form when the structured window is unavailable.

With Python 3 and `requests` installed, set `TSDM_ORIGIN` and a member ID in `TSDM_MEMBER` for a wall readable by the guest or member session. Optionally supply the original session cookie through `TSDM_COOKIE`. This checks the schema-63 owner and prints the observed comment IDs. For a native deployment inspect the HTML wall container and its own next-page link.

```python
import os
import requests

origin = os.environ["TSDM_ORIGIN"].rstrip("/")
member = int(os.environ["TSDM_MEMBER"])
with requests.Session() as session:
    if os.environ.get("TSDM_COOKIE"):
        session.headers["Cookie"] = os.environ["TSDM_COOKIE"]
    status = session.get(origin + "/plugin.php", params={"id": "tsdmapp:api", "action": "status"},
                         allow_redirects=False, timeout=20)
    status.raise_for_status()
    capabilities = status.json()
    space_pages = capabilities.get("space_pages")
    if capabilities.get("ok") != 1 or capabilities.get("v4") != 1 or not isinstance(space_pages, list) or "wall" not in space_pages:
        raise SystemExit("Open the native wall in this session")
    response = session.get(
        origin + "/home.php",
        params={"mod": "space", "do": "wall", "uid": member,
                "tsdmapp": "json", "tsdmv": 4, "nodoc": 1},
        allow_redirects=False, timeout=20,
    )
    if response.status_code != 200:
        raise SystemExit(f"Wall read returned HTTP {response.status_code}")
    page = response.json()
    if (page.get("type"), page.get("schema"), page.get("ok"), page.get("page")) != ("space_wall", 63, 1, 1):
        raise SystemExit(page.get("message", "Inspect the native wall in this session"))
    if page.get("owner", {}).get("uid") != member or not isinstance(page.get("comments"), list):
        raise SystemExit("The wall scope or listing could not be established")
    print([row["cid"] for row in page["comments"]])
```

The curl equivalent returns the response for inspection. Keep the cookie in the supplied session jar, if the wall requires membership. An empty guest jar works for a wall available to guests.

```sh
status=$(curl --silent --show-error --fail --get --max-time 20 \
  --cookie "$TSDM_COOKIE_JAR" --data-urlencode 'id=tsdmapp:api' \
  --data-urlencode 'action=status' "${TSDM_ORIGIN%/}/plugin.php") || exit 1
printf '%s' "$status" | jq -e '.ok == 1 and .v4 == 1 and (.space_pages // [] | index("wall") != null)' >/dev/null || exit 1
curl --silent --show-error --fail-with-body --get --max-time 20 \
  --cookie "$TSDM_COOKIE_JAR" \
  --data-urlencode 'mod=space' --data-urlencode 'do=wall' \
  --data-urlencode "uid=$TSDM_MEMBER" --data-urlencode 'tsdmapp=json' \
  --data-urlencode 'tsdmv=4' --data-urlencode 'nodoc=1' \
  "${TSDM_ORIGIN%/}/home.php"
```

For a direct write, first establish the original account, target, offered controls and fresh form token. Then submit once through the same session using `session.post(url, data=fields, allow_redirects=False, timeout=20)` in Python or `curl --cookie "$TSDM_COOKIE_JAR" --data-urlencode "formhash=$TSDM_FORMHASH"` plus one `--data-urlencode` per remaining field in curl. Do not reuse an old form or blindly follow a redirect. The routes below all use `/home.php?mod=spacecp`. For compatible write results add `tsdmapp=json`. Native AJAX operations use `inajax=1` and a matching handler name. Preserve form values if the forum offers a native form.

| Operation                  | Query fields                                                                             | POST fields alongside the fresh token                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status create              | `ac=doing`                                                                               | `addsubmit=true`, `message`, `handlekey=doing`                                                                                                                                                           |
| Status reply/delete        | `ac=doing`, `op=comment` or `delete`, `doid`, optional `docid` (`0` for reply to status) | `commentsubmit=true` and `message`, or `deletesubmit=true`. Use `doing_STATUS` or `doinghk_STATUS[_REPLY]` as the handle                                                                                 |
| Blog                       | `ac=blog`, `blogid=`                                                                     | `blogsubmit=true`, `subject`, `plaintext=1`, `message` with HTML metacharacters escaped, `friend`, `classid`, `tags=` and offered optional `catid` or password                                           |
| Wall post/reply            | `ac=comment`                                                                             | `commentsubmit=true`, `idtype=uid`, target `id`, `message`, plus `quickcomment=true` and `handlekey=qcwall_MEMBER` for a post, or `cid` and `handlekey=replycommenthk_COMMENT` for a reply to its author |
| Wall delete                | `ac=comment`, `op=delete`, `cid`                                                         | `deletesubmit=true`, `handlekey=delcommenthk_COMMENT`                                                                                                                                                    |
| Greeting send/reply/ignore | `ac=poke`, `op=send`, `reply` or `ignore`, `uid` except for ignore all                   | `pokesubmit=true`, `iconid`, `note`, `from=` and the send/reply handle, or `ignoresubmit=true` and `handlekey=pokeignore` or `allignore`                                                                 |
| Follow/unfollow/rename     | `ac=follow`, `op=add`, `del` or `bkname`, `fuid`                                         | `hash` in place of `formhash` for add, `handlekey=followmod` for add/delete, or `editbkname=true`, `bkname`, `handlekey=fbkname_MEMBER` for rename                                                       |
| Relay                      | `ac=follow`, `op=relay`, `tid`                                                           | `relaysubmit=true`, `tid`, `note`, `handlekey=qrelay_THREAD` and `addnewreply=1` only if explicitly requested                                                                                            |
| Feed delete                | `ac=follow`, `op=delete`, `feedid`                                                       | `deletesubmit=true`, `handlekey=c_delete_FEED`                                                                                                                                                           |

Decode the returned operation-specific acknowledgement, refusal or redirect before reporting an effect. An HTTP 200 or generic `ok` alone is insufficient. A timeout after dispatch or an ambiguous redirect needs independent observation. Read the original account's following list after follow, unfollow or rename, or the member timeline after relay or deletion, and compare the expected member, stored name or feed ID. For a wall write inspect the destination wall and the matching author and message. Public readbacks and native handoffs can expose only content visible to that session.
