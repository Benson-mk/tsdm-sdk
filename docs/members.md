# Find members, make friends and save favourites

[SDK tasks](../README.md#tasks) · [Sign in and manage account security](account.md)

Use the ordinary forum origin and an authorized forum session. The forum determines which member records, visitors, online members and mentions it exposes. The SDK returns the displayed username and UID where available. It preserves anonymous visitors without a UID. Guest access depends on the deployment and operation. The authenticated examples require a signed-in member, their UID, and a transport bound to their cookie jar.

## TypeScript

Use `createForumClient` for page reads and `createMemberClient` with your account transport for mention queries and changes. Supply a fresh, non-secret continuity identifier whenever the cookie jar or signed-in account changes, including a new sign-in as the same account. Set the POST content type to `application/x-www-form-urlencoded` and send `X-Requested-With: XMLHttpRequest` on AJAX requests. Keep credentials on the forum origin and return the exact response URL and redirect disposition. The account transport must perform each effect request at most once and leave redirects unfollowed. `effect: false` also covers the two read-only ATPLUS POSTs.

```ts
import {
  createForumClient,
  createMemberClient,
  type ForumTransport,
  type MemberClientOptions,
} from "tsdm-sdk";

export function memberTools(
  origin: string,
  readTransport: ForumTransport,
  accountTransport: MemberClientOptions["transport"],
  session: MemberClientOptions["session"],
  accountId: string,
) {
  const forum = createForumClient({ origin, transport: readTransport });
  const account = createMemberClient({
    origin,
    transport: accountTransport,
    session,
  });
  return {
    byUID: (id: string) => forum.lookupMember({ id }),
    byName: (username: string) => forum.lookupMember({ username }),
    ownFriends: (page = 1) =>
      forum.readFriends({ scope: "own", accountId, page }),
    memberFriends: (memberId: string) =>
      forum.readFriends({ scope: "member", memberId }),
    friendGroup: (groupId: string) =>
      forum.readFriends({ scope: "own", accountId, groupId }),
    visitors: () => forum.readFriends({ scope: "visitors", accountId }),
    onlineMembers: () => forum.readFriends({ scope: "online" }),
    recentMentions: () => account.loadMentionCandidates(accountId),
    mentionSearch: (query: string) =>
      account.searchMentionMembers(accountId, query),
    nativeMentionNames: () => account.readNativeMentionNames(accountId),
    sendFriendRequest: (memberId: string, groupId?: string) =>
      account.sendFriendRequest({
        accountId,
        memberId,
        ...(groupId === undefined ? {} : { groupId }),
      }),
    approveFriendRequest: (noticeURL: string) =>
      account.approveFriendRequest({ accountId, noticeURL }),
    forumFavorites: (page = 1) =>
      forum.readFavorites({ accountId, kind: "forum", page }),
    threadFavorites: (page = 1) =>
      forum.readFavorites({ accountId, kind: "thread", page }),
    addForum: (targetId: string) =>
      account.addFavorite({ accountId, kind: "forum", targetId }),
    addThread: (targetId: string) =>
      account.addFavorite({ accountId, kind: "thread", targetId }),
    removeForum: (targetId: string, recordId: string) =>
      account.removeFavorite({ accountId, kind: "forum", targetId, recordId }),
    removeThread: (targetId: string, recordId: string) =>
      account.removeFavorite({ accountId, kind: "thread", targetId, recordId }),
  };
}
```

- A `member` result carries the looked-up identity and the separately observed viewer in `account`. Own friends include group IDs and labels when the forum supplies them. Continue a list with `nextPage`. A `permission` result means the forum withheld the view. An `incomplete` result leaves the list unresolved.
- `atplus` candidates contain recent mentions and friends. `members` contains search matches by name or UID. When the plugin endpoint is missing, candidate loading uses the stock mention list. The `native` result contains names only. The own friends list is available independently for hosts that combine a picker with the stock names.
- Invoke a friend effect after the user selects a recipient or an incoming request. Approval requires the exact `from=notice` action URL obtained from the request notice for the same account. Use a group offered by the current form or let the forum's default apply. The optional request note is limited to 30 characters. `request-sent` means the forum acknowledged a request awaiting approval. `approved` means the forum acknowledged an incoming approval. `pending`, `already-friends` and `refused` are distinct outcomes.
- Both favourite lists show the forum record ID (`favid`) and the target ID (`fid` or `tid`). Use the matching pair from that kind's list for removal. Adding can store a description of up to 200 characters. `added` and `already-saved` require a matching record in a fresh list. `removed` and `already-absent` require a complete read of the matching list with the target absent. Verification follows up to 20 pages. Concurrent changes or an inaccessible page can leave the outcome uncertain.
- `stale` before dispatch leaves the effect unsent. `uncertain` means the effect may have occurred. Keep the original account and target. Read the appropriate list under that account before considering another action. Friends readback can establish an existing friendship. A missing friend cannot establish whether an outgoing request is pending. A list shows observed state and cannot attribute the state to a particular attempt.

## Direct HTTP routes

Set `FORUM_ORIGIN` to the forum origin. Use the current account's authenticated `requests.Session`, or set `FORUM_COOKIE_JAR` to its private, local curl cookie jar. The examples print or return forum responses. Decode JSON if the forum serves it. Inspect `document` in legacy envelopes or parse raw HTML or XML for native responses. Handle challenges through the forum's normal sign-in flow. Respect a refusal or rate limit. Keep cookies, form hashes and visitor rows out of logs.

| Operation                       | Method and path                    | Query or POST fields                                                       | Observable forum response                                                                                      |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Profile by UID or name          | GET `home.php`                     | `mod=space`, exactly one of `uid` or `username`                            | Schema 4 `user.uid` and `user.username`, or the native profile heading. Top-level `uid` identifies the viewer. |
| Own or another member's friends | GET `home.php`                     | `mod=space`, `do=friend`, `uid=OWNER_UID`, optional `page`                 | Schema 10 `owner`, `friends`, paging and, for the owner, `groups`, or native friend rows.                      |
| Friends in a group              | GET `home.php`                     | Same as own friends plus `group=GID`                                       | The matching scope and rows.                                                                                   |
| Visitors                        | GET `home.php`                     | `mod=space`, `do=friend`, `view=visitor`, optional `page`                  | The signed-in account's visitor view. Anonymous rows have no usable identity.                                  |
| Online members                  | GET `home.php`                     | `mod=space`, `do=friend`, `view=online`, `type=member`, optional `page`    | Online member rows or a forum refusal.                                                                         |
| Recent mentions and friends     | POST `plugin.php?id=atplus:search` | Form body `op=init`                                                        | Plugin JSON `recent` and `friends`. This POST reads.                                                           |
| Search mention candidates       | POST `plugin.php?id=atplus:search` | Form body `op=search`, `q=NAME_OR_UID`                                     | Plugin JSON `list`. This POST reads.                                                                           |
| Stock mention names             | GET `misc.php`                     | `mod=getatuser`, `inajax=1`                                                | AJAX XML with comma-separated names.                                                                           |
| Favourite forums or threads     | GET `home.php`                     | `mod=space`, `do=favorite`, `type=forum` or `type=thread`, optional `page` | Schema 8 `items` with `favid` and `id`, or native list rows.                                                   |

For the three page families, try `tsdmapp=json&nodoc=1`, inspect a supplied `document` if applicable and use the native route when the representation is unavailable. A refusal ends the read. Check the returned scope, target and viewer before using results.

## Direct HTTP forms

Check the intended viewer first using `GET plugin.php?id=tsdmapp:api&action=status` or the identity in the native forum header. Fetch the exact dialog using the query below. Include `tsdmapp=json` for structured write envelopes. When status advertises the specific `friendadd` or `favorite` form in v4 `forms`, include `tsdmv=4&tsdmform=1&nodoc=1` on its dialog GET. The legacy dialog is XML or a schema 13 `page` containing the form. Use the returned same-origin form action and hidden fields. A dialog GET must carry neither a form hash nor a submit flag. In particular, a signed favourite GET can add a favourite.

| Deliberate operation             | Dialog GET on `home.php?mod=spacecp`                                                                           | Submit button and fields                         | Success evidence                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request friendship               | `ac=friend&op=add&uid=UID&handlekey=addfriendhk_UID&inajax=1`                                                  | `addsubmit=true`, offered `gid`, optional `note` | `request_has_been_sent`, or the form's matching native callback with the sent notice. `waiting_for_the_other_test` means already pending.                           |
| Approve incoming request         | `ac=friend&op=add&uid=UID&from=notice&infloat=yes&handlekey=afr_UID&inajax=1` reached from the incoming notice | `add2submit=true`, offered `gid`, served `from`  | `friends_add`, or the matching native approval callback. When the receipt carries a target UID, it must match the request.                                          |
| Save forum or thread             | `ac=favorite&type=KIND&id=TARGET&infloat=yes&handlekey=k_favorite&inajax=1`                                    | `favoritesubmit=true`, optional `description`    | `favorite_do_success` or matching callback, followed by the matching target in that kind's list. `favorite_repeat` indicates an existing favourite.                 |
| Remove forum or thread favourite | `ac=favorite&op=delete&favid=RECORD&type=KIND&infloat=yes&handlekey=favdelete&inajax=1`                        | `deletesubmit=true`                              | `do_success` or matching delete callback, followed by absence of the target from that kind's complete list. Establish the record and target pair before submission. |

Immediately before the POST, check the same account and session again. Confirm that the response form shows the intended target and mode. Send the current form's `formhash`, `handlekey`, and other qualified hidden fields with the selected values. POST with `inajax=1&tsdmapp=json`; add `tsdmv=4` when posting a v4 small form. Preserve the supplied `spaceuid=0` on a native favourite add where present. Send once and inspect the receipt as data. Recheck the viewer afterward. A timeout, redirect, account change or ambiguous receipt leaves the effect uncertain. A redisplayed form requires inspection and a new deliberate choice. Use a fresh read of the corresponding list to check an uncertain result.

### Python requests

Pass in the same session for all steps. `page` and the two mention helpers are ready to call using the routes above. Call `submit` only with a verified form action and fields following the checks above. The helper returns the raw response so the caller can apply the result checks in the table.

```python
from urllib.parse import urljoin, urlsplit


def page(session, origin, script, params, *, structured=True):
    query = dict(params)
    if structured:
        query.update(tsdmapp="json", nodoc="1")
    return session.get(origin.rstrip("/") + "/" + script, params=query,
                       headers={"X-Requested-With": "XMLHttpRequest"},
                       timeout=15, allow_redirects=False)


def atplus(session, origin, query=None):
    fields = {"op": "init"} if query is None else {"op": "search", "q": query}
    return session.post(origin.rstrip("/") + "/plugin.php", params={"id": "atplus:search"},
                        data=fields, headers={"X-Requested-With": "XMLHttpRequest"},
                        timeout=15, allow_redirects=False)


def stock_mentions(session, origin):
    return page(session, origin, "misc.php", {"mod": "getatuser", "inajax": "1"}, structured=False)


def submit(session, origin, action, fields):
    destination = urljoin(origin.rstrip("/") + "/", action)
    expected, actual = urlsplit(origin), urlsplit(destination)
    if (actual.scheme, actual.netloc, actual.path) != (expected.scheme, expected.netloc, "/home.php") or actual.fragment:
        raise ValueError("Use the verified same-origin form action")
    return session.post(destination, data=fields, headers={"X-Requested-With": "XMLHttpRequest"},
                        timeout=15, allow_redirects=False)
```

For example, `page(session, origin, "home.php", {"mod": "space", "username": name})` looks up a username. Use `{"mod": "space", "do": "favorite", "type": "forum"}` to read back a saved forum. For a dialog use `structured=False` and pass the precise dialog parameters above, including the applicable representation flags.

### curl

Use the same cookie jar for all steps. Pass `get_page` an absolute-path suffix from the tables and one `--data-urlencode` argument per parameter. `atplus` accepts the mention fields. `submit_form` takes a verified relative `home.php` action with the appropriate result flags and its form fields. The shell functions use curl's default single attempt and keep redirects visible.

```sh
get_page() {
  script=$1
  shift
  curl --silent --show-error --max-time 15 --cookie "$FORUM_COOKIE_JAR" \
    --header 'X-Requested-With: XMLHttpRequest' --get "$FORUM_ORIGIN/$script" "$@"
}

atplus() {
  curl --silent --show-error --max-time 15 --cookie "$FORUM_COOKIE_JAR" \
    --header 'X-Requested-With: XMLHttpRequest' "$FORUM_ORIGIN/plugin.php?id=atplus%3Asearch" "$@"
}

submit_form() {
  case "$1" in 'home.php?'*) action=$1 ;; *) return 2 ;; esac
  shift
  curl --silent --show-error --max-time 15 --cookie "$FORUM_COOKIE_JAR" \
    --header 'X-Requested-With: XMLHttpRequest' --request POST "$FORUM_ORIGIN/$action" "$@"
}
```

For stock mentions, call `get_page misc.php --data-urlencode 'mod=getatuser' --data-urlencode 'inajax=1'`. For a mention search, call `atplus --data-urlencode 'op=search' --data-urlencode "q=$NAME_OR_UID"`. For thread favourites set `JSON_MODE=json` and use `get_page home.php --data-urlencode 'mod=space' --data-urlencode 'do=favorite' --data-urlencode 'type=thread' --data-urlencode 'tsdmapp=json' --data-urlencode 'nodoc=1'`.

The SDK verification uses fictitious accounts and controlled responses. The fixtures establish request and result handling. Deployed availability and effects depend on the forum, the acting account and its permissions.
