# Issue tracker: GitHub

Issues and specs live in `Benson-mk/tsdm-sdk`. Use `gh` from this checkout,
or pass `--repo Benson-mk/tsdm-sdk` when working elsewhere.

- Publish a ticket: `gh issue create --title "..." --body-file -`.
- Fetch a ticket: `gh issue view <number> --json number,title,body,labels,comments`.
- Find work: `gh issue list --state open --label <label>`.
- Update a ticket with `gh issue comment`, `gh issue edit`, or `gh issue close`.

For wayfinding, keep the map in a `wayfinder:map` issue. Link tickets as
sub-issues and record blockers with GitHub issue dependencies. If those
features are unavailable, use a task list on the map and `Part of #<map>`
or `Blocked by: #<blocker>` in the child. Claim the first unassigned ticket
in map order with no open blockers. On completion, close it and link its
outcome from the map.

**PRs as a request surface: no.**
