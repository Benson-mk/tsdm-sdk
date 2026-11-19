# tsdm-sdk

`tsdm-sdk` is an unofficial TypeScript SDK for the TSDM forum.

## Tasks

- [Read a public board and open a thread](#read-a-public-board-and-open-a-thread)
- [Find threads and explore forum activity](docs/discovery.md)
- [Sign in and manage account security](docs/account.md)
- [Manage profile, privacy, devices and forum sync](docs/profile.md)
- [Find members, make friends and save favourites](docs/members.md)
- [Poll unread notices and deliberately acknowledge them](docs/notices.md)
- [Read and send private messages](docs/messages.md)

## Install a local candidate

Use Node.js 26.x and npm. From a new project directory, install the local `0.1.0` tarball and import the ESM entry from `tsdm-sdk`.

```sh
npm init -y
npm install /absolute/path/to/tsdm-sdk-0.1.0.tgz
```

The tarball includes TypeScript declarations usable without DOM types, this README, and the notices for bundled `parse5` and `entities`. To build the tarball from the SDK checkout, run `npm ci` and `npm run pack:sdk`. The build writes `dist/tsdm-sdk-0.1.0.tgz`. The installed fixture replay and archive digest are recorded under `evidence/install/` in the SDK repository.

The first public release is planned for immutable GitHub Releases. Its `release.json` will record the release tag, source commit and archive SHA-256. Compare it with `shasum -a 256 tsdm-sdk-0.1.0.tgz` before installing an archived download. Commit the consumer's `package.json` and `package-lock.json` to pin a published release. [Installation and distribution decision](https://github.com/Benson-mk/tsdm-sdk/issues/6#issuecomment-6977558151)

## Read a public board and open a thread

Use a signed-out session and a public board. This journey sends two GETs on the same HTTPS origin and records the IDs of the board and the thread it opened from that listing. The forum may count the thread view. The example omits credentials and stops at redirects, access refusals and verification challenges.

### TypeScript with the installed SDK

In the clean project where you installed the tarball, save the following as `check-live-guest.ts`. Run `node check-live-guest.ts https://www.tsdm39.com 17`. On a host configured to use an HTTP proxy through environment variables, run `node --use-env-proxy check-live-guest.ts https://www.tsdm39.com 17`.

```ts
import assert from "node:assert/strict";
import { createForumClient } from "tsdm-sdk";

const [deployment, boardId] = process.argv.slice(2);
assert.ok(
  deployment && /^[1-9]\d*$/.test(boardId ?? ""),
  "Usage: node check-live-guest.ts https://forum.example BOARD_ID",
);
const origin = new URL(deployment).origin;
assert.equal(deployment, origin);
assert.equal(new URL(origin).protocol, "https:");

const requests: { url: string; status: number }[] = [];
const client = createForumClient({
  origin,
  transport: {
    async request(url, { fresh }) {
      const target = new URL(url);
      assert.equal(target.origin, origin);
      assert.equal(target.pathname, "/forum.php");
      assert.equal(
        target.searchParams.get("mod"),
        requests.length === 0 ? "forumdisplay" : "viewthread",
      );
      assert.ok(requests.length < 2);
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: fresh ? "no-store" : "default",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      requests.push({ url, status: response.status });
      const redirect = response.status >= 300 && response.status < 400;
      return {
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type") ?? "",
        body: redirect ? "" : await response.text(),
        redirect: redirect ? "opaque" : "none",
      };
    },
  },
});

const listing = await client.readBoard(
  `${origin}/forum.php?mod=forumdisplay&fid=${boardId}`,
  { representation: "native" },
);
assert.equal(
  listing.kind,
  "board",
  "message" in listing ? listing.message : undefined,
);
assert.notEqual(listing.account.kind, "member");
assert.equal(listing.board.id, boardId);
const row = listing.board.threads.find(
  (item) => !item.moved && !item.restriction,
);
assert.ok(row, "The board returned no eligible thread");
const opened = await client.readThread(row.url, { representation: "native" });
assert.equal(
  opened.kind,
  "thread",
  "message" in opened ? opened.message : undefined,
);
assert.notEqual(opened.account.kind, "member");
assert.equal(opened.thread.id, row.id);
assert.ok(opened.thread.posts.length > 0);
assert.equal(requests.length, 2);
console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      origin,
      board: listing.board.id,
      thread: opened.thread.id,
      rows: listing.board.threads.length,
      session: "signed-out",
      boardViewer: listing.account.kind,
      threadViewer: opened.account.kind,
      posts: opened.thread.posts.length,
      requests,
    },
    null,
    2,
  ),
);
```

The receipt includes the date, deployment, board ID, selected thread ID, visible post count, viewer evidence from each page and the two GET statuses. The selected thread can change as the public listing changes.

`readHomepage()` exposes board groups and favorite-board links when supplied. Follow a group’s `sourceURL` to read its section. Request `{ representation: "native" }` to read homepage activity links. `readBoard(url)` exposes subforums, category and filter destinations, thread rows and pagination. For monitoring, read the same board with `orderby=dateline&forumdefstyle=yes` and compare returned thread IDs between calls. Pass `{ previews: true }` to request listing excerpts when the deployment supports them.

Read a thread row’s `url`, its `lastPost.url` when available, or an exact post’s `url` with `readThread`. For updates in reverse order, use `ordertype=1`. An author filter uses `authorid`. Returned pagination may wrap or clamp. An empty `pages.current` or absent `pages.total` means the response did not establish that value. Promoted rows can repeat, so count distinct posts by `post.id`. A post can include visible content and a restriction. Poll, activity, debate, reward and trade responses can carry special-thread display data.

The host supplies the origin and the session-bound GET transport. Keep the session continuous across the read, honor `fresh`, and supply the actual response URL. Report a redirect as `followed` after the host has resolved it, or `opaque` when the destination is unavailable. A `document-navigation` result offers the original destination to the host for deliberate navigation. `account.kind` can be `unknown`.

The SDK first checks supported structured responses and usable HTML in the same response. It can make one native fallback GET with the original target, page, filters and order. `{ representation: "native" }` starts with a single native GET. Inspect `kind` before displaying results. `incomplete` means the response did not establish a usable view, and `invalid` includes a conflicting resource or post identity.

### Python `requests`

Use Python 3 with `requests` and `beautifulsoup4`. The example reads native HTML on a public board, extracts a returned thread link and prints both IDs. Set `FORUM_ORIGIN` and `BOARD_ID` if using a different public deployment or board.

```python
import os
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

origin = os.environ.get("FORUM_ORIGIN", "https://www.tsdm39.com")
board_id = os.environ.get("BOARD_ID", "17")


def read(url, **kwargs):
    response = requests.get(url, timeout=20, allow_redirects=False, **kwargs)
    if response.status_code != 200:
        raise SystemExit(f"GET returned HTTP {response.status_code}")
    return BeautifulSoup(response.content, "html.parser")


board = read(f"{origin}/forum.php", params={"mod": "forumdisplay", "fid": board_id})
board_link = board.select_one("#pt a[href*='mod=forumdisplay']:last-of-type")
assert board_link and parse_qs(urlsplit(board_link["href"]).query).get("fid") == [board_id]
row = board.select_one("#threadlisttableid a.xst, #threadlisttableid a.kmtit")
assert row, "No thread in the returned listing"
thread_url = urljoin(f"{origin}/forum.php", row["href"])
thread = urlsplit(thread_url)
assert f"{thread.scheme}://{thread.netloc}" == origin and thread.path == "/forum.php"
parameters = parse_qs(thread.query)
assert parameters.get("mod") == ["viewthread"]
thread_id, = parameters["tid"]
page = read(thread_url)
canonical = page.select_one("link[rel=canonical][href]")
assert canonical and parse_qs(urlsplit(canonical["href"]).query).get("tid") == [thread_id]
assert page.select_one("#postlist [id^=post_]")
print(board_id, thread_id)
```

### curl

Use `curl` and inspect the returned HTML. Confirm the board ID in the board heading or breadcrumb, copy the `href` of a thread in its listing as an absolute same-origin URL, and decode any HTML `&amp;` separators. Inspect the thread’s canonical link for the selected `tid` and check that the page contains posts.

```sh
FORUM_ORIGIN=https://www.tsdm39.com
BOARD_ID=17
curl -q --fail --silent --show-error --get --max-time 20 \
  "$FORUM_ORIGIN/forum.php" --data-urlencode mod=forumdisplay \
  --data-urlencode "fid=$BOARD_ID" --output board.html --write-out '%{http_code}\n'
# Set THREAD_URL to the same-origin viewthread href in board.html after checking HTTP 200.
curl -q --fail --silent --show-error --max-time 20 \
  "$THREAD_URL" --output thread.html --write-out '%{http_code}\n'
```

On a deployment that supports structured reads, add `tsdmapp=json&nodoc=1` to a direct request. Compare `forum.fid` or `thread.tid` with the intended ID and inspect the corresponding `threads` or `posts` list. The native commands above work with returned HTML and leave cookies and redirects to the caller.
