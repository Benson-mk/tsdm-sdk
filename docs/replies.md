# Publish an ordinary reply and check an uncertain send

From the [task index](../README.md#tasks), use this flow with a signed-in member who can reply to the thread. Start with the forum’s `forum.php?mod=post&action=reply&fid=…&tid=…` link. For a quote, use the link for the intended floor, including `reppost` and any `replyuid` it supplies. Keep the draft until you can show the user what happened. See [account sign-in](account.md) for session setup.

## TypeScript SDK

The host supplies a canonical HTTPS origin and the current member ID and session continuity token. Change the token on sign-in or session replacement, including a new session for the same member. Bind requests to the supplied session, honor `fresh`, report redirects accurately, encode POSTs as `application/x-www-form-urlencoded`, and disable transport retries and automatic redirect following for POSTs. The verification GETs carry the native page as `referer`. Keep verification answers and form tokens private.

```ts
import { createReplyClient } from "tsdm-sdk";
import type { ReplyAttempt, ReplyClientOptions, ReplyDraft } from "tsdm-sdk";

export function replies(host: ReplyClientOptions) {
  const client = createReplyClient(host);
  return {
    // Call when the user opens the forum's reply or quote link.
    open: client.prepareReply,
    // Call in response to the user's Refresh and Check actions.
    refreshVerification: client.refreshReplyVerification,
    checkVerification: client.checkReplyVerification,
    // Call after the user deliberately chooses to post.
    send: (form: Parameters<typeof client.publishReply>[0], draft: ReplyDraft) =>
      client.publishReply(form, draft),
    // Call after the original member supplies the candidate post's exact link.
    check: (attempt: ReplyAttempt, exactPostURL: string) =>
      client.checkUncertainReply(attempt, exactPostURL),
  };
}
```

A prepared form exposes the forum’s quote, editable options, and verification requirements. Show these to the user. For an image prompt, the returned destination, referer, and session tell the host how to fetch and display the image. For a question prompt, display its text. Use only answers entered by the user. An `accepted` check reports the forum’s field check. The forum also validates the answers on the final submission. For `browser-handoff`, open the supplied reply page in the original account and let the user continue there. Browser completion requires its own observation.

| SDK result | Observable meaning |
| --- | --- |
| `published` | The forum acknowledged a reply with an exact post URL. |
| `moderation` | The forum reports that the reply awaits review. |
| `redisplayed` | The forum returned a form. Keep the draft and inspect the new form before another deliberate send. |
| `refused` | The forum explicitly refused the operation. |
| `uncertain` | The effect could not be established after dispatch. Tell the user the reply may already have been sent. Retain the attempt and offer the read-only check. |
| `confirmed` | Fresh evidence under the original member matches the exact post, author, stored source, and submitted material options. Attribution to a particular send remains unresolved. |
| `inconclusive` | The attempt stays uncertain. The result identifies the missing or conflicting evidence. |

Use the canonical exact URL `forum.php?mod=redirect&goto=findpost&ptid=…&pid=…`, such as the one returned by `readThread` for a particular post. The check reads that post, then loads its edit form with GET to obtain the stored source, subject and options. A rendered body, thread-only URL, or redirect from the send is insufficient. Exact matching can leave forum transformations, merged replies, unavailable edit forms, and unsupported options inconclusive. A new deliberate send requires a new preparation. Each form is single-use and bound to its creating client and session. Hosts own draft retention, restart recovery, and coordination across clients or tabs.

## Direct HTTP with Python `requests`

Use one `requests.Session` with the original member’s cookies throughout an action. Keep the same origin and session, preserve the form’s hidden fields and selected successful controls, and send only after review. Schema 16 gives the form and its `submit.url`. Schema 13 gives the write result, including explicit moderation (`post_reply_mod_succeed`), refusal (for example `post_flood_ctrl`), form redisplay (`kind: page` with `document`), or an acknowledgement with IDs or a link. A plain HTTP redirect supplies a candidate destination. A lost or undecodable response can leave the effect uncertain. Keep the draft and start the read-only check separately.

```python
from urllib.parse import parse_qs, urljoin, urlsplit
import requests


def forum_url(origin, destination, path='/forum.php'):
    target = urlsplit(urljoin(origin + '/', destination))
    base = urlsplit(origin)
    if ((target.scheme, target.netloc) != (base.scheme, base.netloc)
            or target.path != path or target.fragment):
        raise ValueError('Use a same-origin forum destination')
    return target.geturl()


def open_reply(session, origin, page):
    return session.get(forum_url(origin, page), params={'tsdmapp': 'json'},
                       allow_redirects=False, timeout=15)


def verify_field(session, origin, page, field, challenge_id, modid=None, answer=None):
    from time import time
    if field not in ('seccode', 'secqaa'):
        raise ValueError('Choose the field the forum supplied')
    query = {'mod': field, 'action': 'update' if answer is None else 'check',
             'idhash': challenge_id}
    if field == 'seccode':
        query['modid'] = modid
    if field == 'secqaa' or answer is not None:
        query['inajax'] = '1'
    if answer is None:
        query[str(int(time() * 1000))] = ''
    else:
        query['secverify'] = answer.strip()
    return session.get(origin + '/misc.php', params=query, timeout=15,
                       headers={'Referer': forum_url(origin, page), 'Cache-Control': 'no-cache'},
                       allow_redirects=False)


def send_reply(session, origin, form, member, board, thread, message, *, approved, answers=None):
    if not approved:
        raise ValueError('A deliberate send is required')
    if (form.get('type'), form.get('schema'), form.get('action'), form.get('uid'),
        form.get('fid'), form.get('tid'), form.get('ok')) != ('post', 16, 'reply', member, board, thread, 1):
        raise ValueError('Use a current reply form for this account and thread')
    if form.get('unsupported') or form.get('hook_fields') or form['message'].get('json') != 0:
        raise ValueError('Continue in the native browser')
    submit = form['submit']
    destination = forum_url(origin, submit['url'])
    query = parse_qs(urlsplit(destination).query, keep_blank_values=True)
    if (submit['method'] != 'POST' or any(len(v) != 1 for v in query.values())
        or any(query.get(k) != [v] for k, v in
               {'mod': 'post', 'action': 'reply', 'fid': str(board), 'tid': str(thread), 'replysubmit': 'yes'}.items())):
        raise ValueError('Review the returned form destination')
    fields = dict(submit['fields'], message=message)
    if form['subject']['shown']:
        fields['subject'] = form['subject']['value']
    for option in form['options']:
        if option['type'] != 'checkbox':
            raise ValueError('Review the additional controls in the browser')
        if option['checked'] and not option['disabled']:
            fields[option['name']] = option['value']
    checks = form.get('seccheck') or {}
    for key, name in [('seccode', 'seccodeverify'), ('secqaa', 'secanswer')]:
        if checks.get(key):
            answer = (answers or {}).get(key, '').strip()
            if not answer or not checks.get(key + '_hash'):
                raise ValueError('Continue with human verification')
            fields[name] = answer
            fields[key + 'hash'] = checks[key + '_hash']
            if key == 'seccode':
                fields['seccodemodid'] = checks['modid']
    flags = {k: v for k, v in {'inajax': '1', 'tsdmapp': 'json'}.items() if k not in query}
    # Save your draft and attempt before calling this once. A network error can follow dispatch.
    return session.post(destination, params=flags, data=fields, timeout=15, allow_redirects=False)


def check_reply(session, origin, member, board, thread, pid, source, subject, options):
    exact = origin + f'/forum.php?mod=redirect&goto=findpost&ptid={thread}&pid={pid}'
    headers = {'Cache-Control': 'no-cache'}
    def read(url, params):
        response = session.get(forum_url(origin, url), params=params, headers=headers,
                               allow_redirects=False, timeout=15)
        if response.is_redirect:
            return session.get(forum_url(origin, response.headers['Location'].split('#', 1)[0]),
                               headers=headers, allow_redirects=False, timeout=15)
        return response

    try:
        page = read(exact, {'tsdmapp': 'json', 'nodoc': '1'}).json()
        if (page['ok'], page['uid'], page['type'], page['thread']['tid']) != (1, member, 'thread', thread):
            return 'inconclusive'
        matches = [p for p in page['posts'] if p['pid'] == pid]
        if (len(matches) != 1 or matches[0]['authorid'] != member
                or any(matches[0].get(k) for k in ('deleted', 'invisible', 'message_reason'))):
            return 'inconclusive'
        edit = session.get(origin + '/forum.php', params={'mod': 'post', 'action': 'edit', 'fid': board,
                           'tid': thread, 'pid': pid, 'tsdmapp': 'json'}, headers=headers,
                           allow_redirects=False, timeout=15).json()
        if (edit['ok'], edit['uid'], edit['type'], edit['schema'], edit['action'], edit['fid'],
            edit['tid'], edit['pid'], edit['first']) != (1, member, 'post', 16, 'edit', board, thread, pid, 0):
            return 'inconclusive'
        if edit['message']['json'] != 0 or edit['message']['value'] != source or edit['subject']['value'] != subject:
            return 'inconclusive'
        for name, checked in options.items():
            observed = [o for o in edit['options'] if o['name'] == name and o['type'] == 'checkbox']
            if len(observed) != 1 or observed[0]['checked'] != checked or (checked and observed[0]['value'] != '1'):
                return 'inconclusive'
        return 'confirmed, attribution unresolved'
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return 'inconclusive'
```

Before calling `send_reply`, check that both `reppid` and `reppost` equal the chosen quote PID and preserve `noticetrimstr`, `noticeauthor`, and `noticeauthormsg` exactly. For plain replies, those quote controls should be absent or empty. Record the submitted source and expected material options from the form and review. For a quote, compare the full stored BBCode including the forum-supplied prefix. Do not infer confirmation when the representation differs. A native-only deployment returns HTML or AJAX XML, or a JSON envelope with `document`. Parse the exact `postform` action and successful controls from that response, or continue in the browser. For an interactive challenge, continue in the browser. A built-in image update can return a script containing an image URL. Extract the same-origin `misc.php?mod=seccode` image URL for the supplied hash without running the script. The question update returns the question in the AJAX body. The check returns `succeed` or `invalid` for the text the user entered.

## Direct HTTP with curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE`, and `REPLY_PAGE` (a validated same-origin absolute reply link). Keep cookies in a private jar if verification requests set new ones. Choose one `MODE` for each invocation. For `refresh` or `check`, set `VERIFY_FIELD` (`seccode` or `secqaa`) and `VERIFY_HASH` from the form. For `seccode`, also set `VERIFY_MODID` from the form. For `check`, enter the human answer as `VERIFY_ANSWER`. Inspect the body and headers of each response. For `submit`, set `SUBMIT_URL` to the same-origin form action with `inajax=1&tsdmapp=json` added once, and `FORM_BODY_FILE` to the URL-encoded current form controls, subject, message, and any user-entered verification fields. After reviewing the form and the effect, set `CONFIRM=1` only for a deliberate submission. For the check use numeric `BOARD_ID`, `THREAD_ID`, and `POST_ID`.

```sh
set -eu
case "$MODE" in
  open) set -- --get --data-urlencode 'tsdmapp=json' "$REPLY_PAGE" ;;
  native) set -- "$REPLY_PAGE" ;;
  submit)
    test "${CONFIRM:-0}" = 1
    set -- -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$FORM_BODY_FILE" "$SUBMIT_URL" ;;
  refresh|check)
    case "$VERIFY_FIELD" in seccode|secqaa) ;; *) exit 2 ;; esac
    action=update
    if [ "$MODE" = check ]; then action=check; fi
    set -- --get --referer "$REPLY_PAGE" --data-urlencode "mod=$VERIFY_FIELD" \
      --data-urlencode "action=$action" --data-urlencode "idhash=$VERIFY_HASH"
    if [ "$VERIFY_FIELD" = seccode ]; then set -- "$@" --data-urlencode "modid=$VERIFY_MODID"; fi
    if [ "$VERIFY_FIELD" = secqaa ] || [ "$MODE" = check ]; then set -- "$@" --data-urlencode 'inajax=1'; fi
    if [ "$MODE" = check ]; then
      set -- "$@" --data-urlencode "secverify=$VERIFY_ANSWER"
    else
      set -- "$@" --data-urlencode "$(date +%s)="
    fi
    set -- "$@" "$FORUM_ORIGIN/misc.php" ;;
  exact)
    set -- --get --data-urlencode 'mod=redirect' --data-urlencode 'goto=findpost' \
      --data-urlencode "ptid=$THREAD_ID" --data-urlencode "pid=$POST_ID" \
      --data-urlencode 'tsdmapp=json' --data-urlencode 'nodoc=1' "$FORUM_ORIGIN/forum.php" ;;
  stored)
    set -- --get --data-urlencode 'mod=post' --data-urlencode 'action=edit' \
      --data-urlencode "fid=$BOARD_ID" --data-urlencode "tid=$THREAD_ID" --data-urlencode "pid=$POST_ID" \
      --data-urlencode 'tsdmapp=json' "$FORUM_ORIGIN/forum.php" ;;
  *) exit 2 ;;
esac
curl -q --silent --show-error --include --max-time 15 --retry 0 \
  -H 'Cache-Control: no-cache' --cookie "$FORUM_COOKIE" "$@"
```

Use `open` before `native`. Inspect a same-origin GET redirect before following it under the original account. Compare the exact PID and TID, viewer UID, author UID, stored subject and message, and material options independently after an uncertain send. For human verification, use the browser handoff or `refresh` and `check` with the same cookie jar and referer. An explicit moderation response keeps the reply pending. With only a thread redirect, a rendered body, or a different account, keep the attempt uncertain. For identical sends, exact readback can confirm what is stored while leaving the originating send unresolved.
