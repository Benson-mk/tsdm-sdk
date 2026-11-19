# tsdm-sdk

`tsdm-sdk` is an unofficial TypeScript SDK for the TSDM forum.

## Install a local candidate

Use Node.js 26.x and npm. From a new project directory, install the local `0.1.0` tarball and import the ESM entry from `tsdm-sdk`.

```sh
npm init -y
npm install /absolute/path/to/tsdm-sdk-0.1.0.tgz
```

The tarball includes TypeScript declarations usable without DOM types, this README, and the notices for bundled `parse5` and `entities`. To build the tarball from the SDK checkout, run `npm ci` and `npm run pack:sdk`. The build writes `dist/tsdm-sdk-0.1.0.tgz`. The installed fixture replay and archive digest are recorded under `evidence/install/` in the SDK repository.

The first public release is planned for immutable GitHub Releases. Its `release.json` will record the release tag, source commit and archive SHA-256. Compare it with `shasum -a 256 tsdm-sdk-0.1.0.tgz` before installing an archived download. Commit the consumer's `package.json` and `package-lock.json` to pin a published release. [Installation and distribution decision](https://github.com/Benson-mk/tsdm-sdk/issues/6#issuecomment-6977558151)

## Read a thread

Save the following as `read-thread.mjs`, then run `node read-thread.mjs "$THREAD_URL"` with `THREAD_URL` set to an absolute HTTPS `forum.php?mod=viewthread&tid=…` URL for a thread your session can read. This example uses a guest session and stops at redirects.

```js
import { createForumClient } from "tsdm-sdk";

const destination = process.argv[2];
const origin = new URL(destination).origin;
const client = createForumClient({
  origin,
  transport: {
    async request(url, { fresh }) {
      const response = await fetch(url, {
        cache: fresh ? "no-store" : "default",
        redirect: "manual",
      });
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

const result = await client.readThread(destination);
if (result.kind === "thread") {
  console.log(result.thread.id, result.thread.title, result.thread.posts.length);
  for (const post of result.thread.posts) console.log(post.id, post.url);
} else {
  console.error(result.kind, result.message);
  process.exitCode = 1;
}
```

The host supplies the origin and a GET transport bound to its intended session. Keep that session continuous across each read, manage any credentials in the host, honor `fresh` by bypassing cached responses, and report the actual response URL and redirect state. Use `followed` with the final URL after following a redirect, or `opaque` when the SDK cannot inspect the redirect destination. The decoded `account` describes the forum's response and can be `unknown`. The host discards results if it changes sessions during a read.

The installed reader requests the legacy thread representation and returns serializable content, pagination and exact post URLs. Inspect `kind` before using the thread. The retained fixture verifies nine visible post results, including an author-only restriction that the SDK preserves as returned content.
