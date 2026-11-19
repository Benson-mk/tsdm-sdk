# Separate unread-notice polling from acknowledgement

In SDK 0.1.0, polling observes unread notices. If a continuation is rate-limited, return the established rows for the original account, identify the scan as partial and retain the previous successful lower time bound. A caller can display those rows even though a retry may return the same IDs. A rate limit before the first page leaves the window unknown.

A valid newest-first scan covers the inclusive window when it reaches a strictly older unread notice or exhausts the unread list. This can save requests while leaving older unread notices unexamined. To establish account-wide coverage, follow advancing cursors from the newest page to an explicit last page, or verify that a legacy response lists every unread notice. A count alone, a missing page, a stuck cursor or a request limit leaves exhaustion unproven.

Bind observations and acknowledgement to the same forum origin, member and continuous host session. On a switch, preserve accepted rows only for the original account and discard the mismatched page. A new session requires a fresh scan, including when the same member signs in again.

Marking all unread notices read requires account-wide coverage and a separate deliberate caller action. The unread indicator can remain lit after display, and truncated legacy responses can leave acknowledgement unavailable. Send the first accepted page’s forum time and form hash with the notice-only `seen` request. Omit the private-message flag. An unread notice added or flagged again at or after that time can prevent clearing.

Confirm clearing only when the forum explicitly confirms the notice effect for the expected account. A `newer=1` response means the notices were left unread. A lost or ambiguous reply after dispatch leaves the effect unknown. Retrying requires fresh evidence and a new deliberate choice.

Opening a native notice category or page remains a separate action. Before dispatch the host explains that opening it can mark notices read, even if the response subsequently fails to load or decode. This preserves legacy access while keeping that effect out of polling. [Maintainer resolution, trade-offs and repeatable fixture check](https://github.com/Benson-mk/tsdm-sdk/issues/9#issuecomment-6980615906)
