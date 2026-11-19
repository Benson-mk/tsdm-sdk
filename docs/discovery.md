# Find threads and explore forum activity

[Back to the task index](../README.md#tasks)

Use Node.js 26.x with the installed `tsdm-sdk` tarball. See the task index for installation commands. Supply the forum origin and a host transport that sends fresh GETs with the intended forum session. Keep that session continuous when following pages or loading a chart. Guide views, tags and rankings can be available to guests. Personal activity and saved drafts need an authenticated member session. Other members’ listings, rankings, search and statistics depend on the forum’s settings and the viewer’s permissions.

These reads and handoffs leave posts and drafts as they are. A new search is an explicit GET with `searchsubmit=yes`. It can consume quota or credits even if the response is lost. Opening a result thread can count as a view. On `login`, `permission`, `challenge`, `expired` or `throttle`, inspect the returned message. A continuation never submits a new search. Choose to submit again only after reviewing the effect and any restriction.

## TypeScript with the public SDK

Use the following with a `ForumClient` made by `createForumClient({ origin, transport })`. The transport supplies `status`, the actual response `url`, `contentType`, `body` and `redirect`. Report followed redirects accurately. For search, the host may follow a validated same-origin GET redirect to the search results route with a `searchid`. Stop at opaque redirects and verify the destination before attaching any session credentials to another request.

`explore` is an example for a developer who explicitly wants to run one search plus these reads. Pass a keyword, the member ID whose replies you want (`memberId`) and the signed-in viewer's ID (`viewerId`). In an application, call each operation when the user chooses that task.

```ts
import type { ForumClient } from "tsdm-sdk";

export async function explore(
  client: ForumClient,
  keyword: string,
  memberId: string,
  viewerId: string,
) {
  const index = await client.readGuide();
  const hotLink =
    index.kind === "guide"
      ? index.modules.find((module) => module.view === "hot")?.more
      : undefined;
  const hot = hotLink ? await client.readGuide(hotLink) : undefined;

  const form = await client.openSearch();
  const search = await client.submitSearch({ keyword });
  const next =
    search.kind === "search" && search.nextURL
      ? await client.continueSearch(search)
      : undefined;

  const activity = "/home.php?mod=space&do=thread&view=me";
  const threads = await client.readMemberActivity(`${activity}&type=thread`);
  const replies = await client.readMemberActivity(
    `${activity}&uid=${encodeURIComponent(memberId)}&type=reply`,
  );
  const drafts = await client.readMemberActivity(
    `${activity}&type=thread&filter=save`,
    { viewerId },
  );

  const members = await client.readRankings(
    "/misc.php?mod=ranklist&type=member&view=credit",
  );
  const rankedThreads = await client.readRankings(
    "/misc.php?mod=ranklist&type=thread&view=heats",
  );
  const tags = await client.readTags();
  const tagLink = tags.kind === "tags" ? tags.tags[0]?.url : undefined;
  const tag = tagLink ? await client.readTags(tagLink) : undefined;

  const stats = await client.readStatistics("/misc.php?mod=stat&op=trend");
  const trend =
    stats.kind === "statistics" && stats.trendURL
      ? await client.readTrend(stats)
      : undefined;
  return {
    index,
    hot,
    form,
    search,
    next,
    threads,
    replies,
    drafts,
    members,
    rankedThreads,
    tags,
    tag,
    stats,
    trend,
  };
}
```

| Task            | SDK result                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guide           | Use `readGuide('/forum.php?mod=guide&view=new')` with `index`, `hot`, `digest`, `new`, `newthread`, `sofa` or `my`. For your replies use `view=my&type=reply`. The index exposes module titles and supplied `more` destinations. Listings expose ordered rows, view and paging. Follow `nextURL` when offered.                                                                                                                       |
| Search          | `openSearch()` supplies a `document-navigation` destination for the form and its controls. `submitSearch` accepts keyword, author name or ID, optional board IDs, age in seconds, full-text request and sort. A `search` result includes `searchId`, `count`, the effective `fullText` setting when available and ordered rows. Use `continueSearch(result)` or pass a link from `result.pages.links` as its second argument.        |
| Member activity | Use `type=thread` for topics, `type=reply` for replies and `type=thread&filter=save` for your server-side drafts. Add `uid` or `username` to select another member, and `fid` to limit their threads or replies to a board. The result distinguishes viewer, owner, filter and hidden row count. Reply URLs can target the exact post. Draft rows are saved items. Opening or publishing drafts belongs to the editor workflow.      |
| Rankings        | `readRankings` uses member views `credit`, `post`, `onlinetime` and thread views `replies`, `views`, `favtimes`, `heats`. Check each row’s printed rank, value and destination.                                                                                                                                                                                                                                                      |
| Tags            | `readTags()` returns the cloud. Pass a tag’s `url` to read its details. On a `tag` result follow `moreURL` to its full thread list when supplied, then `nextURL` for further pages.                                                                                                                                                                                                                                                  |
| Statistics      | `readStatistics()` reads the overview. Use returned links for board statistics (`forumstat`), team (`team`), moderation statistics (`modworks`), members (`memberlist`) and trends (`trend`). The statistics result keeps the tables, links and pager. Board daily logs may supply `dailyTrend` from their table. When the page supplies `trendURL`, `readTrend(stats)` fetches it and returns date labels and series in axis order. |

`document-navigation` hands a same-origin destination to the host. Show it as a link or open it in the user's forum session. This applies to the search form and legacy guide or member layouts with insufficient evidence for typed rows. Structured pagination can supply a page and next flag with an unknown total. The SDK resolves native links against the response URL and derives page links from the structured identity and scope when needed.

## Direct HTTP with Python requests and curl

Set `ORIGIN` to the forum’s HTTPS origin. Use a guest session where it has access. For member requests, use the same authorized session for all steps. The examples take an optional `FORUM_COOKIE_JAR` pointing to a private Netscape-format cookie file. Keep it out of logs and source control. Both helpers use fresh same-origin GETs and leave redirects for the caller to inspect. An explicit permission or login message can arrive with HTTP 200.

```python
import os
from http.cookiejar import MozillaCookieJar
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

origin = os.environ["ORIGIN"].rstrip("/")
session = requests.Session()
if cookie_file := os.environ.get("FORUM_COOKIE_JAR"):
    jar = MozillaCookieJar(cookie_file)
    jar.load(ignore_discard=True)
    session.cookies = jar


def get(destination, params=None):
    url = urljoin(origin + "/", destination)
    base, target = urlsplit(origin), urlsplit(url)
    if (target.scheme, target.netloc) != (base.scheme, base.netloc):
        raise ValueError("Expected a same-origin destination")
    response = session.get(url, params=params, allow_redirects=False, timeout=20)
    response.raise_for_status()
    return response


def html(response):
    if response.is_redirect:
        raise ValueError(f"Inspect redirect: {response.headers['Location']}")
    if "json" in response.headers.get("Content-Type", "").lower():
        payload = response.json()
        if payload.get("ok") != 1:
            raise ValueError(payload.get("message", "Forum refusal"))
        body = payload.get("document", "")
    else:
        body = response.text
    document = BeautifulSoup(body, "html.parser")
    if message := document.select_one("#messagetext, #main_message"):
        raise ValueError(message.get_text(" ", strip=True))
    return document
```

```sh
# Bash or zsh. Use a separate shell call for each deliberate search submission.
forum_get() {
  curl --silent --show-error --fail-with-body --max-time 20 \
    ${FORUM_COOKIE_JAR:+--cookie "$FORUM_COOKIE_JAR"} "$@"
}
```

Pass each path from the table to `get(path)` in Python or `forum_get "$ORIGIN$path"` in the shell. Use `tsdmapp=json` on guide, search and member activity requests to ask for the app representation. Inspect `type`, `schema`, `ok`, `uid` and scope before using `threads`; use `document` or native HTML for older page responses. For native lists, inspect the links in the listing and `.pg` pager. Resolve relative URLs against the response URL and check their origin and task scope before following them.

| Read                  | Request path and observable result                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guide index and lists | `/forum.php?mod=guide&view=index&tsdmapp=json`. Use the index `modules[].more` or change `view` to `hot`, `digest`, `new`, `newthread`, `sofa` or `my`. Read `modules`/`threads`, `page` and `has_next` on `type=guide`, schema 7. `view=my&type=reply` is the member reply view.                                                                                                      |
| Search form           | `/search.php?mod=forum`. Inspect the native controls, prerequisites and limits before a deliberate submission.                                                                                                                                                                                                                                                                         |
| Member threads        | `/home.php?mod=space&do=thread&view=me&type=thread&tsdmapp=json`. On schema 9 compare `owner.uid` to the requested member and top-level `uid` to your viewer. Add `uid`, `username` or `fid` for member and board scope.                                                                                                                                                               |
| Member replies        | `/home.php?mod=space&do=thread&view=me&type=reply&tsdmapp=json`. Keep each `pid` with its containing `tid`.                                                                                                                                                                                                                                                                            |
| Saved drafts          | `/home.php?mod=space&do=thread&view=me&type=thread&filter=save&tsdmapp=json`. Require `kind=draft` and verify owner and viewer are your account. The results list saved drafts without opening their editor.                                                                                                                                                                           |
| Member rankings       | `/misc.php?mod=ranklist&type=member&view=credit`. Choose `credit`, `post` or `onlinetime`; inspect `div.hasrank dl` for the rank, profile link and printed value.                                                                                                                                                                                                                      |
| Thread rankings       | `/misc.php?mod=ranklist&type=thread&view=heats`. Choose `replies`, `views`, `favtimes` or `heats`; inspect `div.tl` rows for title links, printed rank and value.                                                                                                                                                                                                                      |
| Tag cloud and detail  | `/misc.php?mod=tag`. Follow a `.taglist a` destination. Read the related threads, its supplied `type=thread` link and pagination.                                                                                                                                                                                                                                                      |
| Statistics            | `/misc.php?mod=stat`. Read the `table.dt` tables and supplied links under `#ct`. Follow `op=forumstat`, `team`, `modworks`, `memberlist` or `trend` according to the section and your permissions.                                                                                                                                                                                     |
| Trend XML             | In the trend page, inspect the literal `drawstatchart(...)` argument beside `#statchart`. Fetch that exact same-origin `/misc.php?mod=stat&op=trend&xml=1&…` URL after validation. The XML contains `xaxis/value` and `graphs/graph/value`; align values by `xid`. A board log may contain daily counts in the page table and an unexpanded XML template. Use the table for that case. |

For a new search, URL-encode the criteria. These calls are alternatives for Python and shell users. Issue one deliberate search, then inspect its redirect or results.

```python
response = get("/search.php", {
    "mod": "forum", "srchtxt": "网盘", "searchsubmit": "yes", "tsdmapp": "json",
})
if response.is_redirect:
    print(response.headers["Location"])
elif "json" in response.headers.get("Content-Type", "").lower():
    outcome = response.json()
    print({key: outcome.get(key) for key in ("type", "ok", "searchid", "page", "count", "message")})
else:
    print([a.get("href") for a in html(response).select(".pg a[href]")])
```

```sh
forum_get --include --get "$ORIGIN/search.php" \
  --data-urlencode 'mod=forum' --data-urlencode 'srchtxt=网盘' \
  --data-urlencode 'searchsubmit=yes' --data-urlencode 'tsdmapp=json'
```

A redirect should lead to the same-origin `/search.php?mod=forum` with a positive `searchid` and no new criteria. Check it before following it. For page 2, prefer the supplied result-page link. With a schema 6 response that only supplies fields, use this equivalent GET with the **returned** ID and order. An established zero-match response has `count=0` and `threads=[]`.

```python
page2 = get("/search.php", {
    "mod": "forum", "searchid": search_id, "orderby": returned_order,
    "ascdesc": returned_direction, "searchsubmit": "yes", "page": 2, "tsdmapp": "json",
})
```

```sh
forum_get --get "$ORIGIN/search.php" \
  --data-urlencode 'mod=forum' --data-urlencode "searchid=$SEARCH_ID" \
  --data-urlencode "orderby=$RETURNED_ORDER" --data-urlencode "ascdesc=$RETURNED_DIRECTION" \
  --data-urlencode 'searchsubmit=yes' --data-urlencode 'page=2' --data-urlencode 'tsdmapp=json'
```
