# Sign in and manage account security

[SDK tasks](../README.md#tasks)

These operations are for your own account. The host supplies a canonical HTTPS forum origin, a cookie jar, and a transport that checks origin and session continuity before dispatch. Give each login attempt an isolated, initially signed-out jar. Keep that jar through form retrieval, the image, the login POST, and an identity check. Adopt it only when the returned member ID matches the intended account. Keep the previously active account in its own jar until adoption.

Use a non-secret continuity identifier for each login attempt or selected account session. Rotate it on account switches, resets and replacement logins, including a new login for the same UID. Apply cookies from each response only to the jar that sent the request. Complete an operation with its original jar before switching or retiring it. Passwords, answers, image codes, cookies, and form tokens should stay out of URLs where the protocol permits, logs, telemetry, and durable storage. Some forum-issued URLs already contain form tokens or signatures. Treat those URLs as private as well.

## TypeScript with the installed SDK

The host honors `fresh: true`, reports `redirect` accurately, and sends the URL-encoded POST `body` as `application/x-www-form-urlencoded`. Handle redirects manually on account requests. For every `effect: true`, dispatch at most once and disable automatic retries and caching. Logout is an effectful GET. The other effects here use POST. Form handles belong to the client and the session that opened them. An attempted submission consumes its handle, including when the response is lost. A new login form also supersedes the previous one on that client.

Save this module as `account-example.ts` in the consuming project and call its functions from your host UI. Call `signIn` after the user elects to sign in, and `changeSetting` after the user elects to edit an account setting. The callbacks return values only after the user deliberately approves each submit. The host can use the returned field labels, `choices`, `initial`, and `obscure` to present the change form.

```ts
import { createAccountClient } from "tsdm-sdk";
import type {
  AccountChange,
  AccountChangeForm,
  LoginCredentials,
  StoredDeviceStatusInput,
  StoredDeviceStatusResult,
} from "tsdm-sdk";

type Client = ReturnType<typeof createAccountClient>;
type ImageHandoff = Extract<
  ReturnType<Client["loginVerificationImage"]>,
  { kind: "verification-image" }
>;

export async function signIn(
  client: Client,
  intendedId: string,
  approveLogin: (
    image: ImageHandoff | undefined,
  ) => Promise<LoginCredentials | undefined>,
) {
  const form = await client.openLoginForm();
  if (form.kind !== "login-form") return form;
  const image = client.loginVerificationImage(form);
  if (image.kind !== "verification-image" && image.kind !== "no-image")
    return image;
  const input = await approveLogin(
    image.kind === "verification-image" ? image : undefined,
  );
  if (!input) return { kind: "cancelled" } as const;
  const result = await client.submitLogin(form, input);
  if (result.kind !== "signed-in") return result;
  if (result.identity.id !== intendedId)
    return { kind: "wrong-account" } as const;
  const identity = await client.readIdentity();
  return identity.kind === "member" && identity.id === intendedId
    ? result
    : ({ kind: "unverified" } as const);
}

export async function changeSetting(
  client: Client,
  memberId: string,
  change: AccountChange,
  approveVerification: () => Promise<string | undefined>,
  approveChange: (
    form: AccountChangeForm,
  ) => Promise<Record<string, string> | undefined>,
) {
  let form = await client.openAccountChange(memberId, change);
  if (form.kind === "verify-password") {
    const password = await approveVerification();
    if (password === undefined) return { kind: "cancelled" } as const;
    form = await client.verifyAccountChange(form, password);
  }
  if (form.kind !== "account-change-form") return form;
  const values = await approveChange(form);
  return values
    ? client.submitAccountChange(form, values)
    : ({ kind: "cancelled" } as const);
}

export function inspect(client: Client) {
  return client.readStatus();
}

export function inspectSavedDevice(
  savedAccount: Client,
  input: StoredDeviceStatusInput,
): Promise<StoredDeviceStatusResult> {
  return savedAccount.readStoredDeviceStatus(input);
}

export function signOut(client: Client, memberId: string) {
  return client.logout(memberId);
}
```

- `readStatus()` reports the UID or guest, plugin API and version, and advertised switches, operation lists and check-in settings. Treat missing fields as unknown and check `switches.v4` before using a v4 capability. `readIdentity()` can use a native settings read when status is unavailable. A login submission returns the identity reported by the login response. A fresh identity read checks the jar that the host will adopt.
- To probe a saved login, bind the account client to that login's isolated jar. Call `readStoredDeviceStatus({ memberId, deviceId })` with the saved member UID and lowercase device UUID. Forward the `X-Tsdmapp-Device` header from the SDK request only to the configured origin and keep the identifier private. `status` establishes the returned member. `device-revoked` requires an explicit forum response naming both that member and that device under the original continuity. The host decides whether to retire that saved login. A rate limit or unavailable response leaves revocation unresolved.
- Surface `loginForm.registration` and `loginForm.lostPassword` as browser links. For `verification-image`, fetch and render the image from `destination` in the indicated `session` and let the user supply the answer. A `browser` result gives the host a URL for the user to continue. Other account checks may require an email or phone code in the browser. Browser completion belongs to the user. Read identity again before using the resulting session.
- The account change form keys are `newpassword` and `renewpassword`, `email`, or `questionidnew` and `answernew`. Use the exact fields and offered choices returned for that form. An empty question choice means keep the existing question and answer when offered. `changed` means the forum explicitly reported the change. Follow any additional delivery or activation instructions presented by the forum in its account center. `refused` means the forum reported a refusal. A refused, unverified, or lost response consumes the form. To make a new attempt, obtain fresh forms after reviewing the outcome and getting the user's approval.
- `logout(memberId)` sends a logout GET only for the requested member and checks for returned guest identity. `already-guest` entails no logout dispatch. `unverified` means the received evidence did not establish the requested effect. `uncertain` means a request may have reached the server without a trustworthy result. For login or logout, check fresh identity after the forum's rate limit permits it. For a setting, consult the signed-in account center and let the user decide how to proceed. Status cannot establish the stored password or answer.

## Direct HTTP with Python requests or curl

Use one isolated cookie jar per attempt. Disable automatic retries and redirect following on effects. Resolve and validate each supplied URL against the configured HTTPS origin and expected operation before using it. Keep credentials in URL-encoded POST bodies. Parse XML CDATA as HTML and inspect forum messages and AJAX callbacks as data. Leave script execution and browser verification to the user in the browser.

For a stored-device probe, use the saved account's jar on the status GET. Supply `headers={"X-Tsdmapp-Device": device_id}` to Python `requests` or `--header "X-Tsdmapp-Device: $DEVICE_ID"` to curl. Leave redirects disabled. Read a matching `uid` on a successful status or require `ok: 0`, `error: "device_revoked"`, the expected `uid` and the expected device together on a direct HTTP 200, 401 or 403 response. Discard the response if the host replaced the saved session while it was in flight.

| Task                    | Request and observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status and identity     | GET `/plugin.php?id=tsdmapp%3Aapi&action=status`. On `ok: 1`, read `uid`, `version`, `api`, and the advertised switches and lists. UID 0 is guest. On unavailable or busy status, a fresh native `home.php?mod=spacecp` can establish identity from the signed-in header or the forum UID declaration.                                                                                                                                                                                                                                                                                                |
| Open login              | GET `/member.php?mod=logging&action=login&infloat=yes&handlekey=login&inajax=1&ajaxtarget=fwin_content_login`. The login form gives a `loginhash` in its action and a hidden `formhash`. The user can open the same-origin registration link (normally `/member.php?mod=register`) or `/member.php?mod=lostpasswd` in the browser.                                                                                                                                                                                                                                                                    |
| Show verification image | If the form includes `seccodehash`, GET `/misc.php?mod=seccode` with `idhash` from the form and a fresh millisecond `update` value. Render the image for the user in the same session.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Submit login            | POST once to the login form's same-origin `member.php?mod=logging&action=login&loginsubmit=yes&handlekey=login&inajax=1&loginhash=…`. Send `formhash`, same-origin `referer`, `loginfield`, `username` (also the input field when logging in with email or UID), `password`, `questionid`, `answer`, `cookietime=0`, and `loginsubmit=true`. Add `seccodehash`, `seccodemodid=member::logging`, and the user-entered `seccodeverify` when prompted. `succeedhandle_login` gives the returned UID and username. Check identity before adopting the jar. `errorhandle_login` reports refusal.           |
| Verify a setting        | GET `/home.php?mod=spacecp&ac=account` and verify the served UID. Follow the returned link for `chgpassword`, `chgemail` or `chgquestion` with `inajax=1&infloat=yes&handlekey=security_verify`. If offered a password-check choice, open its same-method `verify=password` URL with `inajax=1`. POST the check form's hidden fields, `security_submit` button value, and the current `password` once to its action with `inajax=1`. If the forum returns a signed form link, GET it in the same session with `inajax=1`. When only another check is offered, open the account center in the browser. |
| Submit a setting        | After approval, POST the signed form's hidden fields, `submit` button value, and the displayed fields to its action with `inajax=1&tsdmapp=json`. Schema 13 with `message_key: account_change_success` for the intended member signals success even with `ok: 0`. An invalid email may be reported in a schema-13 page with `ok: 1`. The native success sample says `修改成功` and schedules a reload. A bare redirect or generic envelope leaves the effect unverified. If the connection drops, retain uncertainty and avoid replaying the form.                                                    |
| Logout                  | After confirming the member UID and obtaining the current `formhash` from status or settings, deliberately GET `/member.php?mod=logging&action=logout&formhash=…` once. Check for guest identity with the resulting cookies. The logout message alone leaves the effect unverified.                                                                                                                                                                                                                                                                                                                   |

These transport examples accept only an HTTP loopback fixture server. Use Python 3 with `requests`, or curl and a private temporary directory. The fixture server supplies the sample shapes described above. In the requests example, the caller passes form fields as a mapping. In the curl example, pass the already URL-encoded body via standard input when `METHOD=POST`. Both expose the response status and body for the parser. Keep the body private. See the repeatable controlled run in the SDK repository at `evidence/account/README.md`.

```python
import json
import sys
from urllib.parse import urlsplit

import requests


def fixture_exchange(session, origin, target, fields=None):
    base = urlsplit(origin)
    if base.scheme != "http" or base.hostname != "127.0.0.1" or not base.port:
        raise ValueError("Use a loopback fixture origin")
    if origin != f"http://127.0.0.1:{base.port}":
        raise ValueError("Use a loopback fixture origin")
    if not target.startswith("/") or target.startswith("//"):
        raise ValueError("Use a relative fixture route")
    response = session.request(
        "GET" if fields is None else "POST",
        origin + target,
        data=fields,
        headers={"Cache-Control": "no-cache"},
        allow_redirects=False,
        timeout=5,
    )
    return response.status_code, response.content


if __name__ == "__main__":
    with requests.Session() as session:
        session.trust_env = False
        status, body = fixture_exchange(
            session, sys.argv[1], "/plugin.php?id=tsdmapp%3Aapi&action=status"
        )
        print(status, json.loads(body)["uid"])
```

```sh
fixture_exchange() {
  case "$FIXTURE_ORIGIN" in
    http://127.0.0.1:*) port=${FIXTURE_ORIGIN#http://127.0.0.1:} ;;
    *) return 2 ;;
  esac
  case "$port" in ''|*[!0-9]*) return 2 ;; esac
  case "$TARGET" in //*) return 2 ;; /*) ;; *) return 2 ;; esac
  case "$METHOD" in
    GET) set -- ;;
    POST) set -- --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @- ;;
    *) return 2 ;;
  esac
  curl -q --silent --show-error --max-time 5 --noproxy '*' \
    --header 'Cache-Control: no-cache' --cookie "$JAR" --cookie-jar "$JAR" \
    --output "$RESPONSE" --write-out '%{http_code}\n' "$@" "$FIXTURE_ORIGIN$TARGET"
}
```
