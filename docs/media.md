# Upload media and retrieve attachments

Install `tsdm-sdk` in Node 26.x. Get editor and attachment URLs from the forum as the intended member. Use the canonical HTTPS origin and a session with `memberId` and `continuity`. Use member ID `"0"` for a guest and change the continuity value when the underlying credential context changes, including another login as the same member.

The SDK's forum transport receives only canonical forum requests. Send them with the indicated session, a fresh response and manual redirect handling. Return the HTTP status, the URL requested, response content type, headers, `Uint8Array` body, and redirect disposition. An unfollowed HTTP `302` has `redirect: "none"` and its original `Location`. Mark filtered redirects `opaque` and automatically followed redirects `followed`. Use one attempt for `effect: true`. For a multipart request, let the HTTP library generate its boundary. Write `multipart.fields` as text parts and the supplied filename, content type and bytes as `Filedata`. For `form`, send the encoded string as `application/x-www-form-urlencoded`.

## Choose an operation

| Task                      | SDK operation and observable result                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post image                | `openPostUpload(editorURL)` returns file limits or a native editor handoff. After approval, `uploadPostImage(form, file)` sends multipart and can return an attachment ID and `[attachimg]` markup. The id establishes upload acknowledgement. Saving the enclosing post remains a separate action.                                                                                                                     |
| Album picture             | `openAlbumUpload(albumId?)` reads offered albums and privacy choices. Each approved `uploadAlbumImage(form, file)` can return a picture receipt. Use `fileAlbumImages(form, pictures, target)` after separate consent to file only the selected acknowledged receipts. `filed` gives the acknowledged album destination. A bare redirect gives a `filing-handoff` with `effect: "unknown"`.                             |
| Smileys                   | `readSmileys()` reads the structured catalogue or falls back to the native script and parses its literal groups and entries. `readSmileyScript()` returns script text for inspection as data. Use `readMedia(item.url)` to retrieve an image.                                                                                                                                                                           |
| Avatar and media          | `readAvatar(url)` reads an offered avatar and tries `/data/avatar/noavatar.svg` on a forum `404` or `410`. Call it without a URL for the fallback directly. `readMedia(url)` handles supported forum post, album and static media. `delivered` includes the bytes and content type. Use the existing [profile client and avatar editor handoff](profile.md) for the signed `rectavatar` upload and crop field contract. |
| Restricted attachment     | `downloadAttachment(url)` uses the current member's offered link. A `delivered` result includes bytes and a filename hint when present. A denial or incomplete response has a failure result. A paid attachment can return a `browser-handoff` with the native purchase destination. The browser and user handle the purchase.                                                                                          |
| Seller-priced attachment  | `inspectPaidAttachment({ threadId, attachmentId })` checks current access or reads the exact native seller quote without buying or downloading. IDs are positive decimal strings.                                                                                                                                                                                                                                        |
| Credit charge             | A forum redirect to `attachcredit` can return `credit-required`. Loading that URL can deduct credits. Present the effect before asking for approval. Call `confirmAttachmentCredit(offer)` once on approval. `credit-confirmed` carries the forum message and an opaque continuation for `resumeAttachment(resume)`. A lost charge response is `unknown`.                                                               |
| External storage or media | `external-handoff` contains an HTTPS destination and a credentialless GET contract. Use a separate host client with cookies, authorization, device and app headers, and the forum referrer omitted. Keep redirects manual and assess further destinations independently with the same separation.                                                                                                                       |

### Inspect a seller-priced attachment

Pass the thread and attachment IDs from the forum under the intended
member's session. The SDK first reads the structured thread for evidence of
current access. If no matching accessible attachment is established, it can
read the exact native `attachpay` quote under the same account and session.
An `offer` returns `attachment`, `amount`, and `creditType` separately; the
supported native layout explicitly shows 天使币. `already-accessible`
reports access, not a previous purchase. Missing or unrecognized terms
return `unknown`; an unsupported native page returns a `browser-handoff`
with the exact purchase destination. A refusal or session change is a
separate result.

Inspection uses fresh GETs with `effect: false` and never follows a
redirect, downloads a file, submits a form, or requests `attachcredit`.
An offer is not a confirmation, a balance check, or an approval to buy.

### Players embedded in a post

Walk the `content` tree on each post returned by `createForumClient(...).readThread(url)`. An `unsupported` node with `media` supplies `media.kind` (`audio` or `video`) and `media.url`. The SDK reads the player address from the page and makes no request to the player. For the forum’s videohub player, a visible Bilibili link in a native post supplies the canonical video and part. Display the destination to the reader. If they open an external player, omit forum cookies, authorization, device headers and the forum referrer. The host decides whether to allow a plaintext HTTP destination.

With Python or curl, read the same thread first. In the visible message HTML, inspect `iframe[src]` (or its lazy `data-src`), object data and player parameters, embed `flashvars`, and audio or video sources. For a Discuz player declaration, extract the literal address as text. Resolve relative addresses against the forum page and accept HTTP(S) destinations without URL credentials. Present the address before handing it to the host. For an approved external HTTPS request, use `read_external` or the `external` curl mode below.

[SDK tasks](../README.md#tasks)

The SDK reports `refused` for an explicit denial, `invalid` for unsupported inputs or incomplete reads, and `unknown` when a dispatched effect lacks a qualified acknowledgement or attachment terms cannot be established. Retain acknowledged picture IDs and inspect the forum after an ambiguous write. The SDK supports existing albums and new public, friends-only, private, or password-protected albums. Use the native form for named-friend lists. A credit continuation can expire and a resumed download will stop if the forum requests another charge. Treat returned bytes and filenames as untrusted input. The host decides how to display, store or open them.

## TypeScript

Save this in your installed SDK project. The functions take your host transport and a confirmation callback. Every submitted file and credit action comes from an explicit approval. For an album, gather accepted `picture` objects from the upload calls, present them with the offered album choices, and pass only the approved set to `fileAlbumImages`.

```ts
import {
  createMediaClient,
  type MediaClientOptions,
  type MediaFile,
  type PaidAttachmentInspection,
  type PaidAttachmentTarget,
  type PostImageForm,
} from "tsdm-sdk";

export function inspectAttachment(
  host: MediaClientOptions,
  attachment: PaidAttachmentTarget,
): Promise<PaidAttachmentInspection> {
  return createMediaClient(host).inspectPaidAttachment(attachment);
}

export async function uploadPostImage(
  host: MediaClientOptions,
  editorURL: string,
  file: MediaFile,
  approve: (form: PostImageForm, file: MediaFile) => Promise<boolean>,
) {
  const client = createMediaClient(host);
  const opened = await client.openPostUpload(editorURL);
  if (opened.kind !== "post-upload") return opened;
  if (!(await approve(opened.form, file)))
    return { kind: "cancelled" } as const;
  return client.uploadPostImage(opened.form, file);
}

export async function retrieveAttachment(
  host: MediaClientOptions,
  offeredURL: string,
  approveCredit: (attachmentId: string) => Promise<boolean>,
) {
  const client = createMediaClient(host);
  const result = await client.downloadAttachment(offeredURL);
  if (result.kind !== "credit-required") return result;
  if (!(await approveCredit(result.offer.attachmentId))) return result;
  const approved = await client.confirmAttachmentCredit(result.offer);
  if (approved.kind !== "credit-confirmed") return approved;
  return {
    charge: approved,
    download: await client.resumeAttachment(approved.resume),
  };
}
```

## Direct HTTP with Python `requests`

Start with a `requests.Session` for the intended forum member. Use the same session for form opens, approved effects and attachment reads. Keep automatic redirects and retries disabled. Read the raw status and `Location` before deciding what action is offered. Verify returned viewer and target IDs before using the form or spending credits.

| Task                      | Request and response                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post editor               | GET the offered `forum.php?mod=post&action=…` editor with `tsdmapp=json&nodoc=1`. Schema 16 exposes `attach.upload` with `url`, `uid`, `hash`, `image`, extension and size limits. POST to that `misc.php?mod=swfupload&action=swfupload&operation=upload&fid=…` URL with `type=image&simple=2`, `uid`, `hash` and `Filedata`. Inspect a positive attachment ID or `DISCUZUPLOAD` with error `0` and the image attachment ID. A negative scalar is an explicit refusal. |
| Album uploader            | GET `home.php?mod=spacecp&ac=upload`, optionally with an offered `albumid`. Read `form#albumform`, its hidden `formhash`, albums, privacy choices and the literal `SWFUpload` configuration. POST `Filedata`, `uid` and `hash` to the supplied `operation=album` uploader. A positive `picid` acknowledges a picture. `picid=0` is a refusal.                                                                                                                           |
| File album pictures       | Separately POST to the album form action with `tsdmapp=json`, `formhash`, `albumsubmit=true` and `title[PICID]` for each approved picture. Use `albumop=selectalbum` and `albumid` for an offered album. For a new album use `albumop=creatalbum`, `albumname`, `depict`, `friend` and `password` for password privacy. Inspect schema 13 `upload_images_completed` or `do_success` and verify the returned album owner and target.                                     |
| Smileys, avatar and media | GET `plugin.php?id=tsdmapp%3Aapi&action=smilies`, inspect its JSON `types` and `smilies`, or GET `data/cache/common_smilies_var.js` and parse literal arrays as data. GET the offered images or media, checking MIME and complete bytes. The native avatar form and uploader are described in the [profile guide](profile.md).                                                                                                                                          |
| Attachment                | GET the offered `forum.php?mod=attachment&aid=…` URL. The forum may return a file, an explicit denial page or a redirect. Verify complete bytes and inspect `Content-Disposition` for the name. Visit `attachpay` in the browser to review purchase terms. After separate approval for `attachcredit`, send one same-origin GET. A successful charge page offers a matching `aid` with `ck`. Keep that continuation for the follow-up download.                         |

```python
from urllib.parse import parse_qs, urljoin, urlsplit

import requests


def forum_url(origin, supplied):
    url = urljoin(origin + "/", supplied)
    actual, expected = urlsplit(url), urlsplit(origin)
    if ((actual.scheme, actual.netloc) != (expected.scheme, expected.netloc)
            or actual.username or actual.password or actual.fragment):
        raise ValueError("Unexpected forum address")
    return url


def read_forum(session, origin, supplied):
    url = forum_url(origin, supplied)
    q = parse_qs(urlsplit(url).query)
    if q.get("action") in (["attachcredit"], ["attachpay"]):
        raise ValueError("Use the approved credit operation or browser purchase handoff")
    return session.get(url, allow_redirects=False, timeout=30)


def upload_image(session, origin, supplied, operation, uid, upload_hash,
                 filename, image_bytes, image_type, *, approved=False):
    if not approved:
        return None
    url = forum_url(origin, supplied)
    parsed = urlsplit(url)
    q = parse_qs(parsed.query)
    if (parsed.path != "/misc.php" or operation not in {"upload", "album"}
            or q.get("mod") != ["swfupload"] or q.get("action") != ["swfupload"]
            or q.get("operation") != [operation]):
        raise ValueError("Unexpected uploader")
    params = {"type": "image", "simple": "2"} if operation == "upload" else None
    return session.post(url, params=params, data={"uid": uid, "hash": upload_hash},
                        files={"Filedata": (filename, image_bytes, image_type)},
                        allow_redirects=False, timeout=30)


def file_pictures(session, origin, supplied, fields, *, approved=False):
    if not approved:
        return None
    url = forum_url(origin, supplied)
    parsed = urlsplit(url)
    if parsed.path != "/home.php" or parse_qs(parsed.query) != {"mod": ["spacecp"], "ac": ["upload"]}:
        raise ValueError("Unexpected album submission")
    return session.post(url, params={"tsdmapp": "json"}, data=fields,
                        allow_redirects=False, timeout=30)


def charge_credit(session, origin, supplied, *, approved=False):
    if not approved:
        return None
    url = forum_url(origin, supplied)
    parsed = urlsplit(url)
    q = parse_qs(parsed.query)
    if (parsed.path != "/forum.php" or q.get("mod") != ["misc"]
            or q.get("action") != ["attachcredit"] or set(q) != {"mod", "action", "aid", "formhash"}
            or len(q["aid"]) != 1 or len(q["formhash"]) != 1):
        raise ValueError("Unexpected credit confirmation")
    return session.get(url, allow_redirects=False, timeout=30)


def read_external(destination):
    parsed = urlsplit(destination)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Unexpected external destination")
    with requests.Session() as isolated:
        isolated.trust_env = False
        return isolated.get(destination, allow_redirects=False, timeout=30)
```

For attachment redirect handling, call `read_forum` again only for a verified same-origin download continuation for the same attachment and member. For an external handoff pass the validated HTTPS `Location` alone to `read_external`. Keep the forum session separate. A charge page can report a debit and supply a continuation even if the subsequent transfer fails. Keep both observations.

## curl

Use a protected forum cookie jar. Set `MEDIA_MODE` to select one action. `READ_URL`, `UPLOAD_URL`, `FILE_URL` and `CREDIT_URL` are verified same-origin URLs from the table. Include `type=image&simple=2` in the post uploader URL and `tsdmapp=json` in the album filing URL. Set `MEDIA_APPROVAL` to the specific effect mode only after the user approves it. Use `READ_URL` for editor, catalogue, script, images, or ordinary attachment GETs. Use `STORAGE_URL` for a validated external HTTPS handoff. Read the status and headers before interpreting the saved body.

```sh
case "${MEDIA_MODE:-}" in
  read)
    curl -q -sS --retry 0 --cookie "$FORUM_COOKIE_JAR" -D "$MEDIA_HEADERS" -o "$MEDIA_OUTPUT" "$READ_URL"
    ;;
  upload-image)
    [ "${MEDIA_APPROVAL:-}" = upload-image ] || exit 2
    curl -q -sS --retry 0 --cookie "$FORUM_COOKIE_JAR" -D "$MEDIA_HEADERS" -o "$MEDIA_OUTPUT" \
      --form-string "uid=$UPLOAD_UID" --form-string "hash=$UPLOAD_HASH" \
      -F "Filedata=@$IMAGE_PATH;type=$IMAGE_MIME" "$UPLOAD_URL"
    ;;
  file-album)
    [ "${MEDIA_APPROVAL:-}" = file-album ] || exit 2
    curl -q -sS --retry 0 --cookie "$FORUM_COOKIE_JAR" -D "$MEDIA_HEADERS" -o "$MEDIA_OUTPUT" \
      -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$ALBUM_BODY" "$FILE_URL"
    ;;
  charge-credit)
    [ "${MEDIA_APPROVAL:-}" = charge-credit ] || exit 2
    curl -q -sS --retry 0 --cookie "$FORUM_COOKIE_JAR" -D "$MEDIA_HEADERS" -o "$MEDIA_OUTPUT" "$CREDIT_URL"
    ;;
  external)
    curl -q -sS --retry 0 --proto '=https' --disallow-username-in-url --noproxy '*' -D "$MEDIA_HEADERS" -o "$MEDIA_OUTPUT" "$STORAGE_URL"
    ;;
  *) exit 2 ;;
esac
```

`ALBUM_BODY` is a local file containing the already URL-encoded returned and approved fields. The external command uses its own invocation with the default curl config disabled. Set up each invocation with the corresponding destination so that signed URLs, the cookie jar and approved fields stay with their intended host.
