import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sdk from 'tsdm-sdk';

export const origin = 'https://controlled.example.invalid';
export const notify = '/plugin.php?id=tsdmapp%3Aapi&action=notify';
export const seen = '/plugin.php?id=tsdmapp%3Aapi&action=seen';
export const since = 1793491200;
const firstTime = 1794534229;
const secondTime = 1794534246;
const firstCursor = '1794278273_26767';
const secondCursor = '1793114173_26539';
const formhash = 'fixture-first';
const active = { memberId: '34', continuity: 'session-1' };
const expectNotify = (lower = since) => `GET ${notify}&since=${lower}&limit=200`;
const expectBefore = (cursor) => `GET ${notify}&limit=200&before=${cursor}`;
const expectSeen = (time = firstTime, hash = formhash) =>
  `POST ${seen} formhash=${hash}&notice=${time}`;
const seenReply = { ok: 1, uid: 34, notice: 1, newer: 0 };
const busy = { status: 429, json: { ok: 0, error: 'busy' } };

export const row = (id, dateline, extra = {}) => ({
  id, dateline, new: 1, type: 'system', authorid: 0, note: '<b>Fixture notice</b>', ...extra,
});
// Scrubbed controls retain the dates, row IDs, cursors and notice count from #9.
const firstRows = [row(26771, 1794278273), row(26769, 1794278273), row(26767, 1794278273)];
const olderRows = [row(26545, 1793114401), row(26542, 1793114317), row(26539, 1793114173)];
const page = (notices, extra = {}) => ({
  ok: 1, uid: 34, time: firstTime, formhash, notices, has_more: 0, ...extra,
});
const archived = JSON.parse(readFileSync(new URL('./archived-pages.json', import.meta.url), 'utf8'));
const scrubbedPage = (index, hash) => ({
  ...archived[index], ok: 1, formhash: hash,
  notices: archived[index].notices.map((entry) => ({ ...entry, note: '<b>Fixture notice</b>' })),
});
const first = scrubbedPage(0, formhash);
const older = scrubbedPage(1, 'fixture-continuation');

export function controlled(responses) {
  let session = active;
  const trace = [];
  const client = sdk.createNoticeClient({
    origin,
    session: () => session,
    transport: {
      async request(url, options) {
        const parsed = new URL(url);
        assert.equal(parsed.origin, origin);
        assert.equal(options.fresh, true);
        assert.deepEqual(options.session, session);
        assert.ok(['GET', 'POST'].includes(options.method));
        trace.push(`${options.method} ${parsed.pathname}${parsed.search}${options.body === undefined ? '' : ` ${options.body}`}`);
        const planned = responses.shift();
        assert.ok(planned, `unexpected dispatch: ${trace.at(-1)}`);
        const entry = typeof planned === 'function' ? await planned() : planned;
        if (entry.session) session = entry.session;
        if (entry.lost) throw new Error('response dropped after controlled dispatch');
        return {
          url: entry.url ?? url, redirect: entry.redirect ?? 'none',
          status: entry.status ?? 200, contentType: entry.html === undefined ? 'application/json' : 'text/html',
          body: entry.html ?? JSON.stringify(entry.json ?? entry),
        };
      },
    },
  });
  return { client, trace, changeSession(value) { session = value; }, done() { assert.equal(responses.length, 0); } };
}

export const results = {};
export function record(name, expected, observed) {
  assert.deepEqual(observed, expected, `${name}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`);
  results[name] = { expected, observed };
}
const pollState = (poll) => ({
  account: poll.memberId, ids: poll.rows.map((item) => item.id), window: poll.window,
  accountCoverage: poll.accountCoverage, stop: poll.stop, nextSince: poll.nextSince,
  forumUnreadCount: poll.forumUnreadCount,
});
const state = (ids, window, accountCoverage, stop, nextSince, forumUnreadCount = null) => ({
  account: '34', ids: ids.map(String), window, accountCoverage, stop, nextSince, forumUnreadCount,
});

export async function checkPolling() {
  const window = controlled([first, older]);
  const observedWindow = await window.client.pollUnreadNotices({ since });
  const withheld = await window.client.acknowledgeAllUnreadNotices(observedWindow);
  record('pinned window and older unread backlog', {
    poll: state([26771, 26769, 26767], 'complete', 'unproven', 'window-boundary', firstTime, 221),
    acknowledgement: 'not-dispatched', trace: [expectNotify(), expectBefore(firstCursor)],
  }, { poll: pollState(observedWindow), acknowledgement: withheld.kind, trace: window.trace });
  window.done();

  const partial = controlled([first, busy, first, older]);
  const incomplete = await partial.client.pollUnreadNotices({ since, coverage: 'account' });
  const afterPartial = await partial.client.acknowledgeAllUnreadNotices(incomplete);
  const repeated = await partial.client.pollUnreadNotices({ since: incomplete.nextSince });
  record('continuation 429 preserves rows and bound, retry can repeat IDs', {
    poll: state([26771, 26769, 26767], 'partial', 'unproven', 'rate-limited', since, 221),
    acknowledgement: 'not-dispatched', repeated: ['26771', '26769', '26767'],
    trace: [expectNotify(), expectBefore(firstCursor), expectNotify(), expectBefore(firstCursor)],
  }, { poll: pollState(incomplete), acknowledgement: afterPartial.kind, repeated: repeated.rows.map((item) => item.id), trace: partial.trace });
  partial.done();

  for (const [name, pages, ids, total, stop, trace, window = 'partial'] of [
    ['replayed pinned page cannot end the account scan', [first, { ...first, has_more: 0, next: '' }], [26771, 26769, 26767], 221, 'invalid-cursor', [expectNotify(), expectBefore(firstCursor)]],
    ['advancing terminal page cannot contradict the first unread total', [first, { ...older, has_more: 0, next: '' }], [26771, 26769, 26767], 221, 'invalid-response', [expectNotify(), expectBefore(firstCursor)], 'complete'],
    ['terminal page cannot retain a continuation token', [page(firstRows, { next: firstCursor })], [26771, 26769, 26767], null, 'invalid-cursor', [expectNotify()]],
    ['single terminal page cannot omit known unread rows', [page(firstRows, { counts: { notice: 221 } })], [26771, 26769, 26767], 221, 'invalid-response', [expectNotify()]],
    ['repeated boundary row alone is not terminal progress even without a count', [{ ...first, counts: undefined }, page([firstRows[2]])], [26771, 26769, 26767], null, 'invalid-cursor', [expectNotify(), expectBefore(firstCursor)]],
  ]) {
    const host = controlled([...pages, seenReply]);
    const result = await host.client.pollUnreadNotices({ since, coverage: 'account' });
    const acknowledgement = await host.client.acknowledgeAllUnreadNotices(result);
    record(name, { poll: state(ids, window, 'unproven', stop, since, total), acknowledgement: 'not-dispatched', trace }, {
      poll: pollState(result), acknowledgement: acknowledgement.kind, trace: host.trace,
    });
  }

  const invalidCases = [
    ['first-page 429', [busy], [], 'unknown', 'rate-limited', [expectNotify()]],
    ['first-page busy envelope', [{ ok: 0, error: 'busy' }], [], 'unknown', 'rate-limited', [expectNotify()]],
    ['plugin unavailable', [{ ok: 0, error: 'off' }], [], 'unknown', 'unsupported', [expectNotify()]],
    ['login required', [{ status: 401, json: { ok: 0 } }], [], 'unknown', 'refused', [expectNotify()]],
    ['missing continuation', [first, { ok: 1, uid: 34, has_more: 0 }], [26771, 26769, 26767], 'partial', 'invalid-response', [expectNotify(), expectBefore(firstCursor)]],
    ['stuck cursor', [first, page([row(26766, 1794278273)], { has_more: 1, next: firstCursor })], [26771, 26769, 26767, 26766], 'partial', 'invalid-cursor', [expectNotify(), expectBefore(firstCursor)]],
    ['rewound cursor with a different token', [first, page([row(26766, 1794278273)], { has_more: 1, next: '1794278273_26769' })], [26771, 26769, 26767, 26766], 'partial', 'invalid-cursor', [expectNotify(), expectBefore(firstCursor)]],
    ['same-second continuation must move past its incoming cursor', [first, page([row(26772, 1794278273)], { has_more: 1, next: '1794278273_26772' })], [26771, 26769, 26767, 26772], 'partial', 'invalid-cursor', [expectNotify(), expectBefore(firstCursor)]],
    ['different member page', [first, page(olderRows, { uid: 35 })], [26771, 26769, 26767], 'partial', 'session-changed', [expectNotify(), expectBefore(firstCursor)]],
    ['same member re-login during continuation', [first, { json: older, session: { ...active, continuity: 'session-2' } }], [26771, 26769, 26767], 'partial', 'session-changed', [expectNotify(), expectBefore(firstCursor)]],
    ['other origin page', [first, { json: older, url: 'https://other.example.invalid/plugin.php' }], [26771, 26769, 26767], 'partial', 'invalid-response', [expectNotify(), expectBefore(firstCursor)]],
    ['newest-first order violated', [first, page([row(26772, 1794278274)])], [26771, 26769, 26767], 'partial', 'invalid-response', [expectNotify(), expectBefore(firstCursor)]],
  ];
  for (const [name, responses, ids, coverage, stop, trace] of invalidCases) {
    const host = controlled(responses);
    const result = await host.client.pollUnreadNotices({ since, coverage: 'account' });
    record(name, { poll: state(ids, coverage, 'unproven', stop, since, ids.length ? 221 : null), acknowledgement: 'not-dispatched', trace }, {
      poll: pollState(result), acknowledgement: (await host.client.acknowledgeAllUnreadNotices(result)).kind, trace: host.trace,
    });
    host.done();
  }

  const bound = 1794278273;
  const across = controlled([{ ...first, counts: { notice: 5 } }, page([firstRows[2], row(26766, bound), olderRows[0]], { counts: { notice: 6 } })]);
  const inclusive = await across.client.pollUnreadNotices({ since: bound });
  record('same-second continuation and repeated ID', {
    poll: state([26771, 26769, 26767, 26766], 'complete', 'exhausted', 'exhausted', firstTime, 5),
    trace: [expectNotify(bound), expectBefore(firstCursor)],
  }, { poll: pollState(inclusive), trace: across.trace });
  across.done();

  const movingWindow = controlled([first, { ...older, has_more: 0, next: '', counts: { notice: 224 } }]);
  const bounded = await movingWindow.client.pollUnreadNotices({ since });
  record('older notices still complete the window when the account total is unproven', {
    poll: state([26771, 26769, 26767], 'complete', 'unproven', 'window-boundary', firstTime, 221),
    acknowledgement: 'not-dispatched', trace: [expectNotify(), expectBefore(firstCursor)],
  }, { poll: pollState(bounded), acknowledgement: (await movingWindow.client.acknowledgeAllUnreadNotices(bounded)).kind, trace: movingWindow.trace });
  movingWindow.done();

  const emptyTerminal = controlled([{ ...first, counts: { notice: 3 } }, page([], { next: '' })]);
  const closedScan = await emptyTerminal.client.pollUnreadNotices({ since, coverage: 'account' });
  record('empty terminal continuation can close a scan whose known total is covered', {
    poll: state([26771, 26769, 26767], 'complete', 'exhausted', 'exhausted', firstTime, 3),
    trace: [expectNotify(), expectBefore(firstCursor)],
  }, { poll: pollState(closedScan), trace: emptyTerminal.trace });
  emptyTerminal.done();

  const empty = controlled([older]);
  const emptyWindow = await empty.client.pollUnreadNotices({ since });
  record('empty window with older backlog', {
    poll: state([], 'complete', 'unproven', 'window-boundary', secondTime), trace: [expectNotify()],
  }, { poll: pollState(emptyWindow), trace: empty.trace });
  empty.done();

  const post = `${origin}/forum.php?mod=redirect&goto=findpost&ptid=81&pid=919`;
  const linkedRows = controlled([page([row(26771, 1794278273, {
    type: 'post', authorid: 9,
    note: `<a href="${post}">Reply</a><a href="https://other.example.invalid/forum.php?mod=viewthread&tid=81">Other site</a>`,
  })])]);
  const listed = await linkedRows.client.pollUnreadNotices({ since });
  const [notice] = listed.rows;
  const handoff = linkedRows.client.noticePostDestination(notice.postDestinations[0]);
  record('structured notice post and ignore destinations', {
    posts: [post], handoff: { kind: 'handoff', destination: post },
    ignore: { type: 'post', authorId: '9' }, trace: [expectNotify()],
  }, { posts: notice.postDestinations, handoff, ignore: notice.ignoreTarget, trace: linkedRows.trace });
  linkedRows.done();

  const budget = controlled([first]);
  const limited = await budget.client.pollUnreadNotices({ since, coverage: 'account', maxPages: 1 });
  record('request limit cannot prove exhaustion', { poll: state([26771, 26769, 26767], 'partial', 'unproven', 'page-limit', since, 221), trace: [expectNotify()] }, { poll: pollState(limited), trace: budget.trace });
  budget.done();

  for (const [label, count, rows, proof] of [
    ['legacy truncated', 4, firstRows, false], ['legacy duplicates', 3, [firstRows[0], firstRows[0], firstRows[1]], false],
    ['legacy demonstrably exhaustive', 3, firstRows, true], ['legacy count without a list', 0, undefined, false],
    ['legacy explicit empty list', 0, [], true],
  ]) {
    const host = controlled([{ ok: 1, uid: 34, time: firstTime, formhash, counts: { notice: count }, notices: rows }]);
    const result = await host.client.pollUnreadNotices({ since, coverage: 'account' });
    record(label, { coverage: proof ? 'exhausted' : 'unproven', trace: [expectNotify()] }, { coverage: result.accountCoverage, trace: host.trace });
    host.done();
  }
}

export async function checkAcknowledgement() {
  const final = page([row(26000, 1793010000)], { time: secondTime + 30, formhash: 'fixture-final' });
  const olderPage = { ...older, has_more: 1 };
  const full = controlled([{ ...first, counts: { notice: 7 } }, olderPage, final, seenReply]);
  const exhausted = await full.client.pollUnreadNotices({ since, coverage: 'account' });
  const effect = await full.client.acknowledgeAllUnreadNotices(exhausted);
  const second = await full.client.acknowledgeAllUnreadNotices(exhausted);
  record('account-wide deliberate notice-only acknowledgement', {
    poll: state([26771, 26769, 26767], 'complete', 'exhausted', 'exhausted', firstTime, 7),
    outcomes: ['cleared', 'not-dispatched'], trace: [expectNotify(), expectBefore(firstCursor), expectBefore(secondCursor), expectSeen()],
  }, { poll: pollState(exhausted), outcomes: [effect.kind, second.kind], trace: full.trace });
  full.done();

  for (const [name, response, outcome] of [
    ['newer notice', { ok: 1, uid: 34, notice: 0, newer: 1 }, 'newer-unread'],
    ['newer notice with explicit notice success', { ok: 1, uid: 34, notice: 1, newer: 1 }, 'newer-unread'],
    ['lost acknowledgement', { lost: true }, 'unknown-effect'],
    ['ambiguous acknowledgement', { ok: 1, uid: 34, pm: 1 }, 'unknown-effect'],
    ['response lacks account', { ok: 1, notice: 1 }, 'unknown-effect'],
    ['response names another member', { ok: 1, uid: 35, notice: 1 }, 'unknown-effect'],
    ['same member re-login after dispatch', { json: seenReply, session: { ...active, continuity: 'session-2' } }, 'unknown-effect'],
  ]) {
    const host = controlled([page(firstRows), response]);
    const result = await host.client.pollUnreadNotices({ since });
    const effect = await host.client.acknowledgeAllUnreadNotices(result);
    const replay = await host.client.acknowledgeAllUnreadNotices(result);
    record(name, { outcomes: [outcome, 'not-dispatched'], trace: [expectNotify(), expectSeen()] }, { outcomes: [effect.kind, replay.kind], trace: host.trace });
    host.done();
  }

  const withoutGuard = controlled([page(firstRows, { formhash: '' })]);
  const noHash = await withoutGuard.client.pollUnreadNotices({ since });
  record('exhaustion without a form hash does not authorize dispatch', { coverage: 'exhausted', outcome: 'not-dispatched', trace: [expectNotify()] }, { coverage: noHash.accountCoverage, outcome: (await withoutGuard.client.acknowledgeAllUnreadNotices(noHash)).kind, trace: withoutGuard.trace });
  withoutGuard.done();

  const retry = controlled([
    page(firstRows), page(firstRows), { lost: true },
    page([row(26771, firstTime)], { time: secondTime, formhash: 'fixture-fresh' }),
    { ok: 1, uid: 34, notice: 0, newer: 1 },
  ]);
  const previous = await retry.client.pollUnreadNotices({ since });
  const overlapping = await retry.client.pollUnreadNotices({ since });
  const lost = await retry.client.acknowledgeAllUnreadNotices(previous);
  const early = await retry.client.acknowledgeAllUnreadNotices(overlapping);
  const fresh = await retry.client.pollUnreadNotices({ since: previous.nextSince });
  const refired = await retry.client.acknowledgeAllUnreadNotices(fresh);
  record('lost effect, fresh deliberate retry and re-flagged ID at the bound', {
    outcomes: ['unknown-effect', 'not-dispatched', 'newer-unread'], ids: ['26771'],
    trace: [expectNotify(), expectNotify(), expectSeen(), expectNotify(firstTime), expectSeen(secondTime, 'fixture-fresh')],
  }, { outcomes: [lost.kind, early.kind, refired.kind], ids: fresh.rows.map((item) => item.id), trace: retry.trace });
  retry.done();

  const interrupted = controlled([page(firstRows)]);
  const oldSession = await interrupted.client.pollUnreadNotices({ since });
  interrupted.changeSession({ ...active, continuity: 'session-2' });
  const blocked = await interrupted.client.acknowledgeAllUnreadNotices(oldSession);
  record('same member re-login before acknowledgement', { outcome: 'not-dispatched', trace: [expectNotify()] }, { outcome: blocked.kind, trace: interrupted.trace });
  interrupted.done();

  const racing = controlled([page(firstRows), seenReply]);
  const original = await racing.client.pollUnreadNotices({ since });
  const [accepted, duplicate] = await Promise.all([
    racing.client.acknowledgeAllUnreadNotices(original), racing.client.acknowledgeAllUnreadNotices(original),
  ]);
  record('concurrent deliberate calls send once', { outcomes: ['cleared', 'not-dispatched'], trace: [expectNotify(), expectSeen()] }, { outcomes: [accepted.kind, duplicate.kind], trace: racing.trace });
  racing.done();
}
