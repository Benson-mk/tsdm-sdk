# Manage your profile, privacy, devices and forum sync

[SDK tasks](../README.md#tasks) · [Sign in and manage account security](account.md)

Use an account you control. Supply the canonical HTTPS forum origin and an authenticated host transport with an isolated cookie jar. Use the same origin, member UID and continuity identifier throughout a journey. Rotate the identifier on login, logout, account switches and replacement of the underlying session, including signing back in as the same UID. The transport must honor `fresh`, preserve the method, body, `contentType` and any `headers` supplied by the SDK, and report the actual response URL and redirect disposition. Default POST encoding is `application/x-www-form-urlencoded`. Send each `effect: true` request once. The host owns confirmation, session cookies and device IDs.

## TypeScript

Install `tsdm-sdk` under Node.js 26. The following function can run with a transport for an already signed-in account. The host calls the returned methods after the member reviews the relevant fields and confirms the change.

```ts
import { createProfileClient, type ProfileClientOptions } from "tsdm-sdk";

export function ownAccount(options: ProfileClientOptions, memberId: string) {
  const profile = createProfileClient(options);
  return {
    async saveSignature(confirmedText: string) {
      const form = await profile.openSignature(memberId);
      if (form.kind !== "signature") return form;
      return profile.saveSettings(form, { sightml: confirmedText });
    },
    async saveFeedSetting(field: string, confirmedEnabled: boolean) {
      const form = await profile.openPrivacy(memberId, "feed");
      if (form.kind !== "privacy") return form;
      return profile.saveSettings(form, { [field]: confirmedEnabled });
    },
    listDevices: () => profile.listDevices(memberId),
    download: () => profile.downloadSync(memberId),
    profile,
  };
}
```

| Task              | SDK method and evidence to inspect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile           | `openProfile(uid, tab?)` returns offered fields, their values and select choices. The default reads the forum’s default tab. Pass the exact returned object and the confirmed edits to `saveSettings`. Only touched profile cells are submitted, including their related controls. Inspect `saved` or the refusal field.                                                                                                                                                                                                              |
| Signature         | `openSignature(uid)` follows the advertised profile tabs and exposes `sightml` if the account can edit it. `saveSettings` submits the signature and the form’s fixed fields. This can change what appears under the member’s posts.                                                                                                                                                                                                                                                                                                   |
| Avatar URL        | `openAvatar(uid)` returns the displayed image URL, the configured external URL (empty if unset), and whether a signed upload is offered. `setAvatarUrl(page, url)` changes the external URL when offered. `""` clears it. `saved` requires same-account readback of the configured value.                                                                                                                                                                                                                                             |
| Cropped avatar    | `prepareAvatarUpload(page)` hands the host the forum-supplied signed `rectavatar` destination, encoding, field names and session binding. This only prepares the handoff. See the upload instructions below for the separate effect.                                                                                                                                                                                                                                                                                                  |
| Privacy and feeds | `openPrivacy(uid, "base" \| "feed" \| "other" \| "filter")` reads the served tab. `saveSettings` replaces the tab using the served values plus the requested edits. Toggles take booleans and choices take their offered strings. Privacy can change visibility, feed publication, friend requests and existing filter rules.                                                                                                                                                                                                         |
| Site blacklist    | `listBlacklist(uid)` reports members, quota and whether the listed rows establish the whole list. `lookupBlacklistMember(uid, targetUid)` resolves the other member without a write. `addToBlacklist(uid, targetUid, confirmedName)` checks the name on a fresh lookup. `removeFromBlacklist(uid, targetUid)` uses a fresh row. `confirmed` requires same-account list readback of the requested state. Removal requires a complete list to establish absence. An unchanged matching state before dispatch returns `already-applied`. |
| Forum devices     | `listDevices(uid)` reports the current device and each row’s revoked status. `registerDevice(uid, { id, platform, appVersion, name? })` registers the host’s UUID and sends the corresponding `X-Tsdmapp-Device` header. `revokeDevice(uid, id)` invalidates that device’s login and keeps its row. `removeDevice(uid, id)` removes a row after revocation. Inspect `registered`, `revoked` or `removed` for the matching device. A server can refuse removal of an active device.                                                    |
| Forum sync        | `downloadSync(uid)` returns `sync-document` with opaque text or `null`, the forum’s `updated` timestamp and its advertised byte limit. Call `uploadSync(snapshot, confirmedText)` with the original snapshot from this client. The forum compares `base_updated` before replacing the account’s document. Observe `uploaded`, `conflict` with current document/version, or `too-large`. The host owns interpretation, merges and conflict recovery. This flow uses the forum’s sync action. WebDAV backup is a separate facility.     |

Keep form and sync objects in memory. Use each object for one dispatch and reload it for another effect. Use `refused` for an explicit negative result and `unverified` for an inconclusive response. `uncertain` can follow a dropped response or a change in account/session after dispatch. Keep the proposed edit available and inspect current state before offering a deliberate retry. A blacklist readback can establish the requested list state after a lost reply. Concurrent actions can produce that same state. Unsupported form controls or unavailable deployment features can require opening the native page in the host.

### Avatar uploader handoff

Inspect the destination against your deployment’s trusted uploader hosts. The host must recheck the continuity identifier just before dispatch and use a fresh handoff after a session change. Treat the signed URL as transient. The uploader may be on a different origin. Use only credentials scoped to that uploader and keep forum cookies and authorization headers on the forum origin. Disable automatic redirect following and retries.

The host prepares JPEG crops at up to 200×250, 120×120 and 48×48 pixels. Send them in order as base64 strings in `avatar1`, `avatar2` and `avatar3`, using the returned form encoding. The uploader’s `postMessage('success')` is its save acknowledgement. `postMessage('failure')` can mean that the server removed the previous avatar. XML `message` errors `-1` and `-2` identify a rejected signature and missing image, respectively. After observed success, reopen the avatar page deliberately. The forum may update its avatar marker when the page opens. A failed follow-up leaves the uploader acknowledgement as the available evidence. The SDK handoff itself establishes only the offered destination and input contract.

## Direct HTTP with Python requests and curl

Use the same authenticated account in all steps. `FORUM_ORIGIN` is the canonical origin. Use a local `COOKIE_JAR` in Netscape format for curl or an isolated authenticated `requests.Session` for Python. Keep session material and form hashes out of logs and command history. Revalidate the account on reads via the response `uid` or the native document’s logged-in UID. Reject mismatched identities, login pages, and unrecognized forms. Check that each supplied write URL has the expected origin, path and operation query before submitting it. A native fallback may use an HTML response already present under `document` or one separate native GET.

These Python helpers leave the response body available as JSON, XML or HTML. `fields` is the list of reviewed `(name, value)` pairs, including the freshly served fixed fields. A `requests` multipart part with filename `None` sends a text field. `target` comes from the relevant row in the request table or the checked form. Use a separate deliberate call to `submit` for each effect.

```python
import os
from urllib.parse import urljoin, urlsplit

import requests

origin = os.environ["FORUM_ORIGIN"].rstrip("/")


def forum_url(target):
    url = urljoin(origin + "/", target)
    expected, actual = urlsplit(origin), urlsplit(url)
    if ((actual.scheme, actual.netloc) != (expected.scheme, expected.netloc)
            or actual.username or actual.password or actual.fragment):
        raise ValueError("Unexpected forum destination")
    return url


def read(session: requests.Session, target):
    return session.get(forum_url(target), timeout=15, allow_redirects=False,
                       headers={"Cache-Control": "no-cache"})


def submit(session: requests.Session, target, fields, *, multipart=False, device=None):
    headers = {} if device is None else {"X-Tsdmapp-Device": device}
    payload = ({"files": [(key, (None, value)) for key, value in fields]}
               if multipart else {"data": fields})
    return session.post(forum_url(target), timeout=15, allow_redirects=False,
                        headers=headers, **payload)
```

The curl functions expect a checked origin-relative `target` beginning with `/home.php?` or `/plugin.php?`. Select request arguments from the table. `--data-urlencode` and `--form-string` preserve data such as BBCode and non-ASCII text. `post_forum` takes extra curl options such as the device registration header before the field options. Responses include headers so callers can inspect a redirect and its status.

```sh
read_forum() {
  curl -q --silent --show-error --include --max-time 15 \
    --cookie "$COOKIE_JAR" --cookie-jar "$COOKIE_JAR" \
    --header 'Cache-Control: no-cache' "${FORUM_ORIGIN%/}$1"
}

post_forum() {
  target=$1
  shift
  curl -q --silent --show-error --include --max-time 15 \
    --cookie "$COOKIE_JAR" --cookie-jar "$COOKIE_JAR" \
    --request POST "$@" "${FORUM_ORIGIN%/}$target"
}

# Read examples. Execute effectful calls separately after review.
# read_forum '/home.php?mod=spacecp&ac=profile&tsdmapp=json&tsdmform=1&nodoc=1'
# read_forum '/home.php?mod=spacecp&ac=privacy&op=feed'
# read_forum '/plugin.php?id=tsdmapp%3Aapi&action=device'
# read_forum '/plugin.php?id=tsdmapp%3Aapi&action=sync'
```

| Operation                          | Request and observable result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read profile and signature         | `GET /home.php?mod=spacecp&ac=profile&tsdmapp=json&tsdmform=1&nodoc=1`. Schema 17 has `form: "profile"`, `op`, `ops`, `fields`, optional `signature.input` and `submit`. Follow an advertised `op` when locating `sightml`. Native fallback drops the three plugin flags and uses the `frame_profile` form.                                                                                                                                                                                                              |
| Save profile and signature         | POST the checked `submit.url` or native form `action` as multipart. Include the fresh hidden values and submit button, then touched profile cell fields and related controls. For signature use `sightml` only alongside fixed fields. Add the JSON selector to a structured submission. A schema 13 success message or the editor’s `parent.show_success('')` establishes a save. `parent.show_error(...)` identifies a refused field.                                                                                  |
| Read or set external avatar        | `GET /home.php?mod=spacecp&ac=avatar`. Read the displayed avatar and the separate `headform` when offered. POST to that native form’s action with its `formhash`, `headsubmit=true` and reviewed `headedit`. Read the same page again to check the stored URL.                                                                                                                                                                                                                                                           |
| Upload avatar crops                | Read the avatar editor page and use its signed `stl_src` with `a=rectavatar`. With Python, use a separate uploader-scoped `requests.Session` and `post(signed_url, data=fields, timeout=15, allow_redirects=False)`. With curl, use `curl -q --include --max-time 15 --data-urlencode "avatar1@$BIG_BASE64" --data-urlencode "avatar2@$MEDIUM_BASE64" --data-urlencode "avatar3@$SMALL_BASE64" "$SIGNED_URL"` with local files containing the plain base64 strings. Use the uploader’s response markers described above. |
| Read privacy settings              | `GET /home.php?mod=spacecp&ac=privacy&op=base` or change `op` to `feed` or `other`. Parse the matching native form. For `filter`, request `tsdmapp=json&tsdmv=4&nodoc=1` and expect schema 55 `privacy_filter`, with native `op=filter` as fallback.                                                                                                                                                                                                                                                                     |
| Save a privacy tab                 | POST to the supplied tab’s action with the fixed fields and the complete reviewed tab. Keep selected values and checked boxes. Omit unchecked boxes. Posts from schema 55 use the v4 write flags and URL encoding. Schema 13 can report `message_key: "do_success"`. With a plain redirect, read the same tab again and compare published values.                                                                                                                                                                        |
| List or look up a blacklist member | `GET /home.php?mod=spacecp&ac=plugin&id=blockuser%3Aspacecp`. Add `bu_q=<targetUid>` for the read-only lookup. Prefer `tsdmapp=json&tsdmv=4&nodoc=1`. Schema 56 supplies count, limit, rows, confirmation and forms. Native fallback uses `bu_page`, `bu_list` or an explicit empty marker, and `bu_confirm` for lookup.                                                                                                                                                                                                 |
| Add or remove a blacklist member   | POST the fresh confirmation or row form to its supplied action with `buid=<targetUid>` and `blockuseradd=yes` or `blockuserdel=yes`, plus the served hidden fields. Structured writes add `tsdmapp=json&tsdmv=4`. Read the list again. Check presence for add, and complete-list absence for removal.                                                                                                                                                                                                                    |
| List and register devices          | `GET /plugin.php?id=tsdmapp%3Aapi&action=device` returns schema 20. For registration, first use `GET /plugin.php?id=tsdmapp%3Aapi&action=status` for `device=1`, the account and fresh `formhash`. POST `op=register`, `device`, `platform`, `app_version`, `formhash` and optional nonempty `name` to `action=device`, with `X-Tsdmapp-Device` equal to that UUID. Check `op`, `created` and the returned device.                                                                                                       |
| Revoke or remove devices           | Get a fresh device list and use its form hash. POST `op=revoke` or `op=remove` with `device` and `formhash` to `action=device`. Revoke returns the matching device with `revoked=1`. Remove returns its ID in `removed`. Treat `notrevoked`, `nodevice`, `device_revoked` and rate limits according to the response.                                                                                                                                                                                                     |
| Download or upload forum sync      | `GET /plugin.php?id=tsdmapp%3Aapi&action=sync` returns `uid`, `supported`, `formhash`, `updated`, `data` and possibly `max_bytes`. POST to the same URL with `formhash`, the downloaded `updated` as `base_updated`, and the new text as `data`. Check `ok` and the returned write time. HTTP 409 `conflict` carries the competing `updated` and document. HTTP 413 `size` carries `max_bytes`.                                                                                                                          |

For example, set `FORM_ACTION` to the checked profile target and `FORM_HASH` to the freshly read form value. Confirm the `sightml` text before dispatch. Python’s example assumes `session` is already authenticated and `signature` is the reviewed text. Use the fixed fields as served by your form.

```python
response = submit(session, os.environ["FORM_ACTION"], [
    ("formhash", os.environ["FORM_HASH"]),
    ("profilesubmit", "true"),
    ("profilesubmitbtn", "true"),
    ("sightml", signature),
], multipart=True)
```

```sh
post_forum "$FORM_ACTION" \
  --form-string "formhash=$FORM_HASH" \
  --form-string 'profilesubmit=true' --form-string 'profilesubmitbtn=true' \
  --form-string "sightml=$SIGNATURE"
```

For a URL-encoded effect, pass the same field pairs to Python without `multipart`, or one `--data-urlencode 'name=value'` per field to curl. An HTTP 200 or redirect alone may carry a refused, redrawn or ambiguous result. A lost response leaves the effect uncertain until there is independent evidence. A fresh read observes current state without repeating the submission.
