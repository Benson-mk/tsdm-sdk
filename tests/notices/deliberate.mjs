import assert from 'node:assert/strict';
import { controlled, origin, record } from './consume.mjs';

const inbox = '/home.php?mod=space&do=notice';
const system = `${inbox}&view=system`;
const otherCategories = ['mypost', 'interactive', 'app'];
const history = `${system}&isread=1`;
const page2 = `${history}&page=2`;
const formRoute = '/home.php?mod=spacecp&ac=common&op=ignore';
const privacyRoute = '/home.php?mod=spacecp&ac=privacy&op=filter';
const post = '/forum.php?mod=redirect&goto=findpost&ptid=81&pid=919';
const formGet = `${formRoute}&authorid=9&type=post&handlekey=noticeignore&infloat=yes&inajax=1&tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1`;
const privacyGet = `${privacyRoute}&tsdmapp=json&tsdmv=4&nodoc=1`;
const formPost = `${formRoute}&type=post&id=919&inajax=1&tsdmapp=json&tsdmv=4`;
const privacyPost = `${privacyRoute}&tsdmapp=json&tsdmv=4`;
const target = { type: 'post', authorId: '9' };
const rule = { type: 'post', authorId: '9', label: 'Replies / Fixture author' };
const retained = { type: 'system', authorId: '0', label: 'System / Everybody' };
const ignoreLink = `${formRoute}&authorid=9&type=post&handlekey=noticeignore`;
const header = '<div id="um"><strong><a href="home.php?mod=space&uid=34">Fixture member</a></strong></div>';
const nativePage = (id, current, pager = '', view = 'system') => `${header}<div id="ct"><ul class="tb">
  <li><a href="${inbox}">All</a></li><li${view === 'system' ? ' class="a"' : ''}><a href="${system}">System</a></li>
  <li><a href="${history}">Read history</a></li>
  ${otherCategories.map((category) => `<li${category === view ? ' class="a"' : ''}><a href="${inbox}&view=${category}">${category}</a></li>`).join('')}</ul>
  <div class="nts"><dl id="notice_${id}"><dt><span title="2026-11-15 08:00">Sunday</span></dt>
  <dd class="ntc_body"><a href="${post}">Fixture reply</a></dd>
  <dd><a href="${ignoreLink}">Ignore</a></dd></dl></div>
  ${pager && `<div class="pg"><strong>${current}</strong><a href="${pager}">Next</a></div>`}</div>`;

export async function checkNative() {
  const host = controlled([
    { html: nativePage(51, 1) }, { html: nativePage(52, 1) },
    { html: nativePage(49, 1, page2) }, { html: nativePage(47, 2) }, { html: '<p>broken</p>' },
  ]);
  const first = host.client.prepareNativeNoticePage();
  assert.equal(first.kind, 'handoff');
  assert.match(first.warning, /may mark notices read/i);
  record('native notice warning precedes dispatch', { destination: origin + inbox, trace: [] }, { destination: first.destination, trace: [...host.trace] });
  const initial = await host.client.openNativeNoticePage(first);
  assert.equal(initial.kind, 'notices');
  record('native notice page', { id: '51', post: [origin + post], ignore: target, effect: 'possible', trace: [`GET ${inbox}`] }, {
    id: initial.entries[0].id, post: initial.entries[0].postDestinations, ignore: initial.entries[0].ignoreTarget, effect: initial.readEffect, trace: [...host.trace],
  });
  const postLink = host.client.noticePostDestination(initial.entries[0].postDestinations[0]);
  record('notice-to-post handoff', { kind: 'handoff', destination: origin + post, trace: [`GET ${inbox}`] }, { ...postLink, trace: [...host.trace] });
  assert.equal(host.client.noticePostDestination('https://other.example.invalid' + post).kind, 'not-prepared');

  const category = await host.client.openNativeNoticePage(host.client.prepareNativeNoticePage(initial.categories.find(link => link.label === 'System').url));
  assert.equal(category.kind, 'notices');
  record('native notice category dispatch', { id: '52', current: 'System', request: `GET ${system}` }, { id: category.entries[0].id, current: category.categories.find(link => link.current).label, request: host.trace.at(-1) });
  const read = await host.client.openNativeNoticePage(host.client.prepareNativeNoticePage(category.categories.find(link => link.label === 'Read history').url));
  assert.equal(read.kind, 'notices');
  record('native read history', { id: '49', offered: origin + page2, request: `GET ${history}` }, { id: read.entries[0].id, offered: read.pages.links[0].url, request: host.trace.at(-1) });
  const following = await host.client.openNativeNoticePage(host.client.prepareNativeNoticePage(read.pages.links[0].url));
  assert.equal(following.kind, 'notices');
  record('native history page two', { id: '47', current: '2', request: `GET ${page2}` }, { id: following.entries[0].id, current: following.pages.current, request: host.trace.at(-1) });
  const failed = await host.client.openNativeNoticePage(host.client.prepareNativeNoticePage());
  record('failed native decode after deliberate dispatch', { kind: 'unavailable', reason: 'invalid-response', readEffect: 'unknown', request: `GET ${inbox}` }, { ...failed, request: host.trace.at(-1) });
  host.done();

  for (const view of otherCategories) {
    const categoryURL = `${inbox}&view=${view}`;
    const categoryHost = controlled([{ html: nativePage(51, 1) }, { html: nativePage(50, 1, '', view) }]);
    const list = await categoryHost.client.openNativeNoticePage(categoryHost.client.prepareNativeNoticePage());
    const link = list.categories.find(({ label }) => label === view);
    assert.equal(link.url, origin + categoryURL);
    const opened = await categoryHost.client.openNativeNoticePage(categoryHost.client.prepareNativeNoticePage(link.url));
    record(`native ${view} category`, { id: '50', selected: view, trace: [`GET ${inbox}`, `GET ${categoryURL}`] },
      { id: opened.entries[0].id, selected: opened.categories.find((item) => item.current).label, trace: categoryHost.trace });
    categoryHost.done();
  }

  const lost = controlled([{ lost: true }]);
  const lostPage = await lost.client.openNativeNoticePage(lost.client.prepareNativeNoticePage(origin + `${inbox}&isread=1`));
  record('lost native history response', { kind: 'unavailable', reason: 'network', readEffect: 'unknown', trace: [`GET ${inbox}&isread=1`] }, { ...lostPage, trace: lost.trace });
  lost.done();

  const changed = controlled([]);
  const pending = changed.client.prepareNativeNoticePage();
  changed.changeSession({ memberId: '34', continuity: 'session-2' });
  record('native page preparation expires on re-login', { kind: 'not-dispatched', trace: [] }, { kind: (await changed.client.openNativeNoticePage(pending)).kind, trace: changed.trace });
  changed.done();
}

const box = (kind, key, label, target, extra = {}) => ({
  field: `privacy[filter_${kind}][${key}]`, value: key, name: label, target, ...extra,
});
const keep = box('note', 'system|0', 'System', 'Everybody');
const remove = box('note', 'post|9', 'Replies', 'Fixture author');
const feed = box('icon', 'doing|6', 'Feed', 'Fixture icon');
const checked = box('gid', '1', 'Group', '', { checked: 1 });
const unchecked = box('gid', '2', 'Unchecked', '', { checked: 0 });
const submit = (url, fields) => ({ url, method: 'POST', enctype: 'application/x-www-form-urlencoded', fields });
const privacy = (notices, extra = {}) => ({
  ok: 1, uid: 34, type: 'privacy_filter', schema: 55,
  groups: [checked, unchecked], feeds: [feed], notices,
  submit: submit(privacyRoute, { formhash: 'fixture-privacy', privacy2submit: 'true', hook_extra: 'kept' }), ...extra,
});
const windowForm = (extra = {}) => ({
  ok: 1, uid: 34, type: 'form', schema: 17, form: 'ignore', type_key: 'post',
  authorid: { name: 'authorid', value: '9', choices: [{ value: '9' }, { value: '0' }] },
  submit: submit(`${formRoute}&type=post&id=919`, { formhash: 'fixture-ignore', ignoresubmit: 'true', handlekey: 'noticeignore', feedignoresubmit: 'true' }), ...extra,
});
const success = { ok: 1, uid: 34, type: 'result', schema: 13, message_key: 'do_success' };
const refusal = { ...success, message_key: 'submit_invalid' };
const addRequest = (authorId = '9') => `POST ${formPost} formhash=fixture-ignore&ignoresubmit=true&handlekey=noticeignore&feedignoresubmit=true&authorid=${authorId}`;
const removeRequest = `POST ${privacyPost} formhash=fixture-privacy&privacy2submit=true&hook_extra=kept&privacy%5Bfilter_gid%5D%5B1%5D=1&privacy%5Bfilter_icon%5D%5Bdoing%7C6%5D=doing%7C6&privacy%5Bfilter_note%5D%5Bsystem%7C0%5D=system%7C0`;

export async function checkIgnore() {
  const read = controlled([privacy([keep, remove]), windowForm()]);
  const list = await read.client.loadNoticeIgnoreRules();
  const form = await read.client.loadNoticeIgnoreForm(target);
  record('read notice-ignore rules independently', { kind: 'rules', rules: [retained, rule], request: `GET ${privacyGet}` }, { ...list, request: read.trace[0] });
  record('load notice-ignore form without submitting', { kind: 'form', target, scopes: ['author', 'everybody'], request: `GET ${formGet}` }, { ...form, request: read.trace[1] });
  read.done();

  const add = controlled([privacy([keep]), windowForm(), success, privacy([keep, remove])]);
  const added = await add.client.addNoticeIgnoreRule(target, 'author');
  record('add notice-ignore for this author', { kind: 'applied', rules: [retained, rule], trace: [`GET ${privacyGet}`, `GET ${formGet}`, addRequest(), `GET ${privacyGet}`] }, { ...added, trace: add.trace });
  add.done();

  const everyone = { type: 'post', authorId: '0', label: 'Replies / Everybody' };
  const global = controlled([privacy([]), windowForm(), success, privacy([box('note', 'post|0', 'Replies', 'Everybody')])]);
  const globallyAdded = await global.client.addNoticeIgnoreRule(target, 'everybody');
  record('add notice-ignore for everybody', { kind: 'applied', rules: [everyone], request: addRequest('0') }, { ...globallyAdded, request: global.trace[2] });
  global.done();

  const del = controlled([privacy([keep, remove]), success, privacy([keep])]);
  const deleted = await del.client.removeNoticeIgnoreRule(target);
  record('remove one notice-ignore and preserve other checked filters', { kind: 'applied', rules: [retained], trace: [`GET ${privacyGet}`, removeRequest, `GET ${privacyGet}`] }, { ...deleted, trace: del.trace });
  del.done();

  for (const [name, responses, kind, trace] of [
    ['existing rule requires no post', [privacy([remove])], 'already-applied', [`GET ${privacyGet}`]],
    ['ignore form with mismatched target choices', [privacy([]), windowForm({ authorid: { name: 'authorid', value: '10', choices: [{ value: '10' }, { value: '0' }] } })], 'not-dispatched', [`GET ${privacyGet}`, `GET ${formGet}`]],
    ['ignore form posts to another origin', [privacy([]), windowForm({ submit: submit('https://other.example.invalid' + formRoute, { formhash: 'fixture', ignoresubmit: 'true' }) })], 'not-dispatched', [`GET ${privacyGet}`, `GET ${formGet}`]],
    ['ignore form posts to another operation on the same origin', [privacy([]), windowForm({ submit: submit(privacyRoute, { formhash: 'fixture', ignoresubmit: 'true' }) })], 'not-dispatched', [`GET ${privacyGet}`, `GET ${formGet}`]],
    ['ignore form missing its submit flag', [privacy([]), windowForm({ submit: submit(`${formRoute}&type=post&id=919`, { formhash: 'fixture' }) })], 'not-dispatched', [`GET ${privacyGet}`, `GET ${formGet}`]],
    ['ignore result names another member', [privacy([]), windowForm(), { ...success, uid: 35 }], 'unknown-effect', [`GET ${privacyGet}`, `GET ${formGet}`, addRequest()]],
    ['ignore refusal', [privacy([]), windowForm(), refusal, privacy([])], 'refused', [`GET ${privacyGet}`, `GET ${formGet}`, addRequest(), `GET ${privacyGet}`]],
    ['redrawn ignore form is not proof of change', [privacy([]), windowForm(), windowForm(), privacy([])], 'unknown-effect', [`GET ${privacyGet}`, `GET ${formGet}`, addRequest(), `GET ${privacyGet}`]],
    ['lost ignore write has no automatic resend', [privacy([]), windowForm(), { lost: true }], 'unknown-effect', [`GET ${privacyGet}`, `GET ${formGet}`, addRequest()]],
  ]) {
    const h = controlled(responses);
    const change = await h.client.addNoticeIgnoreRule(target, 'author');
    record(name, { kind, trace }, { kind: change.kind, trace: h.trace });
    h.done();
  }

  const collateral = controlled([privacy([keep, remove]), success, privacy([keep], { feeds: [] })]);
  const removal = await collateral.client.removeNoticeIgnoreRule(target);
  record('remove with lost feed filter remains uncertain', { kind: 'unknown-effect', trace: [`GET ${privacyGet}`, removeRequest, `GET ${privacyGet}`] }, { kind: removal.kind, trace: collateral.trace });
  collateral.done();

  const collision = controlled([privacy([remove], { feeds: [box('icon', 'post|9', 'Feed', 'Same value')] }), success, privacy([], { feeds: [box('icon', 'post|9', 'Feed', 'Same value')] })]);
  const removed = await collision.client.removeNoticeIgnoreRule(target);
  record('removal keeps a feed filter with the same value', { kind: 'applied', request: `POST ${privacyPost} formhash=fixture-privacy&privacy2submit=true&hook_extra=kept&privacy%5Bfilter_gid%5D%5B1%5D=1&privacy%5Bfilter_icon%5D%5Bpost%7C9%5D=post%7C9` }, { kind: removed.kind, request: collision.trace[1] });
  collision.done();

  const missing = controlled([privacy([keep])]);
  record('absent removal target sends nothing', { kind: 'not-dispatched', trace: [`GET ${privacyGet}`] }, { kind: (await missing.client.removeNoticeIgnoreRule(target)).kind, trace: missing.trace });
  missing.done();

  const systemTarget = { type: 'system', authorId: '0' };
  const native = controlled([
    windowForm({ type_key: 'system', authorid: { name: 'authorid', value: '0', choices: [{ value: '0' }, { value: '0' }] }, submit: submit(`${formRoute}&type=system&id=0`, { formhash: 'fixture', ignoresubmit: 'true' }) }),
  ]);
  const systemForm = await native.client.loadNoticeIgnoreForm(systemTarget);
  record('system notices offer everybody scope only', { kind: 'form', scopes: ['everybody'] }, { kind: systemForm.kind, scopes: systemForm.scopes });
  assert.equal((await native.client.addNoticeIgnoreRule(systemTarget, 'author')).kind, 'not-dispatched');
  native.done();

  const concurrent = controlled([privacy([keep, remove]), success, privacy([keep])]);
  const [firstChange, competingChange] = await Promise.all([
    concurrent.client.removeNoticeIgnoreRule(target), concurrent.client.removeNoticeIgnoreRule(target),
  ]);
  record('concurrent filter changes on one client send once', { outcomes: ['applied', 'not-dispatched'], trace: [`GET ${privacyGet}`, removeRequest, `GET ${privacyGet}`] }, { outcomes: [firstChange.kind, competingChange.kind], trace: concurrent.trace });
  concurrent.done();

  const handoffs = controlled([]);
  const legacyAdd = handoffs.client.prepareNativeNoticeIgnoreForm(target);
  const legacyRemove = handoffs.client.prepareNativeNoticeIgnoreRules();
  record('legacy native ignore add form handoff', { kind: 'handoff', destination: origin + `${formRoute}&authorid=9&type=post&handlekey=noticeignore&infloat=yes&inajax=1`, trace: [] }, { kind: legacyAdd.kind, destination: legacyAdd.destination, trace: handoffs.trace });
  record('legacy native privacy removal handoff', { kind: 'handoff', destination: origin + privacyRoute, trace: [] }, { kind: legacyRemove.kind, destination: legacyRemove.destination, trace: handoffs.trace });
  handoffs.done();
}
