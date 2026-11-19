import assert from "node:assert/strict";
import { createBankClient } from "tsdm-sdk";
const origin = "https://bank.example";
const plugin = `${origin}/plugin.php`;
const id = "id=bank_ane%3Abank";
const raw = "plugin.php?id=bank_ane:bank";
const mode = "&tsdmapp=json";
const session = { memberId: "31", continuity: "fictional-bank-session" };
const sid = "1";
const csrf = "fictitious-form-token";
const wallet =
  '<div class="tbn"><ul><li><font>Fictional coins:</font><span><b>800</b></span>(银行货币)</li></ul></div>';
const doc = (markup, member = "31", side = wallet) =>
  `<html><head><script>var discuz_uid = '${member}';</script></head><body>${side}${markup}</body></html>`;
const section = (title, body) =>
  `<table id="ttt"><thead><tr><td><h2>${title}</h2></td></tr></thead><tbody>${body}</tbody></table>`;
const row = (body) => `<tr><td>${body}</td></tr>`;
const get = (query, html, extra = {}) => ({ query, html, ...extra });
const post = (html, fields, extra = {}) => ({
  query: id + mode,
  html,
  fields,
  ...extra,
});
const redact = (fields) =>
  fields.map(([key, value]) => [
    key,
    /^(?:new)?bankpass2?$/.test(key) ? "[fictitious password supplied]" : value,
  ]);
const results = [];
async function scenario(name, steps, expected, run) {
  const requests = [];
  const options = {
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const next = steps[requests.length];
        requests.push({
          url,
          method: request.method,
          effect: request.effect,
          ...(request.body === undefined
            ? {}
            : { fields: [...new URLSearchParams(request.body)] }),
        });
        assert.ok(next, `Unexpected bank request ${url}`);
        assert.deepEqual(request.session, session);
        assert.equal(request.fresh, true);
        if (next.drop) throw new Error("Controlled response loss");
        return {
          url,
          redirect: next.redirect ?? "none",
          status: next.status ?? 200,
          contentType: next.contentType ?? "text/html",
          body: next.html,
        };
      },
    },
  };
  const observed = await run(createBankClient(options), options);
  const expectedRequests = steps.map((step) => ({
    url: `${plugin}?${step.query}`,
    method: step.fields ? "POST" : "GET",
    effect: Boolean(step.fields),
    ...(step.fields && { fields: Object.entries(step.fields) }),
  }));
  assert.deepEqual(requests, expectedRequests, name);
  assert.deepEqual(observed, expected, name);
  const safe = (rows) =>
    rows.map((entry) =>
      entry.fields ? { ...entry, fields: redact(entry.fields) } : entry,
    );
  results.push({
    name,
    expected,
    observed,
    expectedRequests: safe(expectedRequests),
    requests: safe(requests),
  });
}
const directory = doc(
  section(
    "银行列表",
    `<tr><td>Fictitious logo</td><td>银行名称: Fictional Branch<br>银行行长: Fictitious Manager<br>银行简介: Fictitious directory</td>
<td><a href="${raw}&amp;bankid=1">进入银行</a> (已开户)</td></tr>`,
  ),
);
await scenario(
  "directory reads only bank entries and preserves the selected account marker",
  [get(id, directory)],
  {
    kind: "bank-directory",
    banks: [
      {
        id: "1",
        name: "Fictional Branch",
        description: "Fictitious directory",
        hasAccount: true,
        url: `${plugin}?${id}&bankid=1`,
      },
    ],
  },
  (client) => client.readBankDirectory(),
);
await scenario(
  "another viewer cannot supply bank data",
  [get(id, directory.replace("uid = '31'", "uid = '32'"))],
  { kind: "session-changed" },
  (client) => client.readBankDirectory(),
);
await scenario(
  "directory rejects an offered foreign link",
  [
    get(
      id,
      directory.replace(
        'href="plugin.php',
        'href="https://elsewhere.example/plugin.php',
      ),
    ),
  ],
  { kind: "invalid-response" },
  (client) => client.readBankDirectory(),
);

const branch = `${id}&bankid=1`;
const current = `${branch}&action=cur`;
const global = `${id}&mode=other`;
const banking = (title, body) => doc(section(title, body));
const savingsSummary =
  "您当前的存款金额为 200 ，活期利率为0.1‰，计息时间从虚构日期开始。";
const savings = (forms = "", summary = savingsSummary) =>
  banking(
    "活期储蓄",
    `<tr><td class="footoperation">${summary}</td></tr>
${row(forms)}${row("<p>您当前可得利息 3</p>")}<tr><td class="footoperation">注意事项</td></tr>${row("<p>Fictitious conditions</p>")}`,
  );
await scenario(
  "current savings preserve original balance, interest and notice text",
  [get(current, savings())],
  {
    kind: "bank-service",
    bankId: "1",
    currency: "Fictional coins",
    wallet: "800",
    summary: savingsSummary,
    interest: "您当前可得利息 3",
    notices: ["Fictitious conditions"],
  },
  async (client) => {
    const result = await client.readBankService("savings", sid);
    const service = result.service;
    return {
      kind: result.kind,
      bankId: service?.bankId,
      currency: service?.currency,
      wallet: service?.walletBalance,
      summary: service?.summary,
      interest: service?.interest,
      notices: service?.notices,
    };
  },
);
for (const [service, query, heading] of [
  ["lobby", branch, "欢迎来到 Fictional Branch"],
  ["fixed", `${branch}&action=fix`, "定期储蓄"],
  ["transfer", `${branch}&action=chg`, "账户汇款"],
  ["loans", `${branch}&action=len`, "贷款专柜"],
  ["account", `${branch}&action=pas`, "账户管理"],
  ["overview", global, "我的账户"],
]) {
  const fixture = banking(heading, row("Fictitious service data"));
  const isGlobal = service === "overview";
  await scenario(
    `read ${service} without a transaction`,
    [get(query, fixture)],
    {
      kind: "bank-service",
      service,
      bankId: isGlobal ? null : "1",
      blocks: [{ text: "Fictitious service data", heading: false }],
      forms: [],
      handoffs: [],
    },
    async (client) => {
      const result = await client.readBankService(
        service,
        isGlobal ? undefined : sid,
      );
      return {
        kind: result.kind,
        service: result.service?.kind,
        bankId: result.service?.bankId,
        blocks: result.service?.blocks,
        forms: result.service?.forms,
        handoffs: result.service?.handoffs,
      };
    },
  );
}
await scenario(
  "rankings include the plugin’s following table and qualify its next page",
  [
    get(
      `${global}&action=list`,
      doc(
        section("财富排行", row("Fictitious ranking A")) +
          `<table id="ttt">${row("Fictitious ranking B")}${row(`<div class="pg"><a href="${raw}&amp;mode=other&amp;action=list&amp;page=2">next</a></div>`)}</table>`,
      ),
    ),
  ],
  { blocks: ["Fictitious ranking A", "Fictitious ranking B"], hasNext: true },
  async (client) => {
    const result = await client.readBankService("rankings");
    return {
      blocks: result.service?.blocks.map((block) => block.text),
      hasNext: result.service?.hasNext,
    };
  },
);
const enabledTrading = banking("积分买卖", row("Fictitious exchange terms"));
await scenario(
  "points trading returns the documented same-origin browser destination",
  [get(`${global}&action=buy`, enabledTrading)],
  {
    kind: "bank-service",
    handoffs: [
      {
        operation: "trade-points",
        destination: `${plugin}?${global}&action=buy`,
      },
    ],
  },
  async (client) => {
    const result = await client.readBankService("trading");
    return { kind: result.kind, handoffs: result.service?.handoffs };
  },
);
const msg = (text, type = "error") =>
  doc(
    `<div id="messagetext" class="alert_${type}"><p>${text}</p><p><a href="${raw}">Continue</a></p></div>`,
  );
await scenario(
  "disabled trading preserves the forum reason without a handoff",
  [get(`${global}&action=buy`, msg("Fictitious exchange unavailable"))],
  { kind: "refused", message: "Fictitious exchange unavailable" },
  (client) => client.readBankService("trading"),
);
const log = (body, pagination = "") =>
  banking("理财日志", row(`<table id="ttt">${body}${pagination}</table>`));
const logRow =
  "<tr><td>Info: Fictitious deposit</td><td>Time: Fictitious time</td><td>Ip: 192.0.2.32</td></tr>";
const logPage = `${branch}&action=log&show=0&page=1`;
const pagination = row(
  `<div class="pg"><a href="${raw}&amp;bankid=1&amp;action=log&amp;show=0&amp;page=2">Next</a></div>`,
);
await scenario(
  "own records discard IP and qualify exact next tab and bank",
  [get(logPage, log(logRow, pagination))],
  {
    kind: "bank-logs",
    bankId: "1",
    received: false,
    page: 1,
    entries: [{ message: "Fictitious deposit", time: "Fictitious time" }],
    hasNext: true,
  },
  (client) => client.readBankLogs(sid),
);
await scenario(
  "received records have their own pagination and explicit empty marker",
  [get(`${branch}&action=log&show=1&page=2`, log(row("还没有相关数据。")))],
  {
    kind: "bank-logs",
    bankId: "1",
    received: true,
    page: 2,
    entries: [],
    hasNext: false,
  },
  (client) => client.readBankLogs(sid, { received: true, page: 2 }),
);
await scenario(
  "unrecognized records do not masquerade as an empty log",
  [get(logPage, log(row("Unknown fragment")))],
  { kind: "invalid-response" },
  (client) => client.readBankLogs(sid),
);
await scenario(
  "global service forbids an invented selected bank",
  [],
  { kind: "invalid-input" },
  (client) => client.readBankService("overview", sid),
);

const freshToken = "fictitious-fresh-token";
const password = "fictitious-bank-phrase";
const newPassword = "fictitious-replacement-phrase";
const field = (name, value) =>
  `<input type="hidden" name="${name}" value="${value}">`;
const controls = (fields) =>
  fields
    .map(
      (name) =>
        `<input name="${name}" type="${/(?:new)?bankpass/.test(name) ? "password" : "text"}">`,
    )
    .join("");
const form = (
  action,
  op,
  fields,
  label = "提交",
  extra = "",
  proof = csrf,
  target = raw,
) =>
  `<form method="post" action="${target}">${field("bankid", "1")}${field("action", action)}${op ? field("op", op) : ""}` +
  `${extra}${proof ? field("formhash", proof) : ""}${controls(fields)}<button type="submit" name="banksubmit" value="true">${label}</button></form>`;
const amountChoice = (csrf) =>
  form(
    "cur",
    "",
    ["banknum", "bankpass"],
    "提交",
    '<input type="radio" name="op" value="in"><input type="radio" name="op" value="out">',
    csrf,
  );
const currentPage = savings(amountChoice(csrf));
const updated = (html) => html.replaceAll(csrf, freshToken);
const positiveMessage = "恭喜您，操作成功。";
const accepted = msg(positiveMessage, "right");
const refused = msg("银行密码错误，请返回修改。");
const sent = (operation) => ({
  kind: "unconfirmed",
  operation,
  message: positiveMessage,
});
const prepared = async (client, service, operation) => {
  const read = await client.readBankService(service, sid);
  assert.equal(read.kind, "bank-service");
  const form = read.service.forms.find((item) => item.operation === operation);
  assert.ok(form, `Expected ${operation}`);
  return form;
};
async function submit(client, service, operation, values) {
  const form = await prepared(client, service, operation);
  assert.deepEqual(await client.submitBankForm({ ...form }, values, true), {
    kind: "invalid-input",
  });
  assert.deepEqual(await client.submitBankForm(form, values, false), {
    kind: "not-confirmed",
  });
  const result = await client.submitBankForm(form, values, true);
  assert.deepEqual(await client.submitBankForm(form, values, true), {
    kind: "invalid-input",
  });
  return result;
}
for (const [operation, op, banknum] of [
  ["deposit-current", "in", "999999999999999999"],
  ["withdraw-current", "out", "11"],
]) {
  const values = { banknum, bankpass: password };
  await scenario(
    `${operation} explicitly sends the matching current-savings radio value`,
    [
      get(current, currentPage),
      get(current, updated(currentPage)),
      post(accepted, {
        bankid: "1",
        action: "cur",
        formhash: freshToken,
        op,
        ...values,
        banksubmit: "true",
      }),
    ],
    sent(operation),
    (client) => submit(client, "savings", operation, values),
  );
}
const supported = [
  [
    "lobby",
    branch,
    "欢迎来到 Fictional Branch",
    "open-account",
    "open",
    "",
    { bankpass: password, bankpass2: password },
    "我要开户(开户费用:20)",
  ],
  [
    "fixed",
    `${branch}&action=fix`,
    "定期储蓄",
    "deposit-fixed",
    "fix",
    "in",
    { banknum: "100", daynum: "30", bankpass: password },
  ],
  [
    "transfer",
    `${branch}&action=chg`,
    "账户汇款",
    "transfer",
    "chg",
    "ok",
    { banknum: "101", touser: "Fictitious Recipient", bankpass: password },
  ],
  [
    "account",
    `${branch}&action=pas`,
    "账户管理",
    "change-password",
    "pas",
    "cg",
    { bankpass: password, newbankpass: newPassword, newbankpass2: newPassword },
  ],
  [
    "account",
    `${branch}&action=pas`,
    "账户管理",
    "close-account",
    "pas",
    "cl",
    { bankpass: password },
  ],
  [
    "loans",
    `${branch}&action=len`,
    "贷款专柜",
    "apply-loan",
    "len",
    "try",
    { banknum: "100", daynum: "5", bankpass: password },
  ],
];
const transferTerms =
  '<tr><td class="footoperation">当前汇款手续费率为2.5‰，欢迎使用本行汇款业务。</td></tr>';
for (const [
  service,
  query,
  heading,
  operation,
  action,
  op,
  values,
  label,
] of supported) {
  const offered = form(action, op, Object.keys(values), label).replace(
    "</form>",
    service === "transfer"
      ? '<button type="button" name="taxcheck" value="true">费用计算</button></form>'
      : "</form>",
  );
  const markup = banking(
    heading,
    (service === "transfer" ? transferTerms : "") + row(offered),
  );
  await scenario(
    `${operation} distinguishes inspected terms, approval and a single fresh POST`,
    [
      get(query, markup),
      get(query, updated(markup)),
      post(accepted, {
        bankid: "1",
        action,
        ...(op && { op }),
        formhash: freshToken,
        ...values,
        banksubmit: "true",
      }),
    ],
    sent(operation),
    async (client) => {
      const opened = await client.readBankService(service, sid);
      assert.equal(opened.kind, "bank-service");
      const candidate = opened.service.forms.find(
        (candidate) => candidate.operation === operation,
      );
      assert.ok(candidate);
      if (label) assert.equal(candidate.label, label);
      if (service === "transfer") {
        assert.equal(opened.service.transferFeeRate, "2.5");
        assert.equal(
          client.estimateBankTransferFee(opened.service, "101"),
          "1",
        );
        assert.equal(
          client.estimateBankTransferFee(opened.service, "999999999999999999"),
          "2500000000000000",
        );
      }
      assert.deepEqual(await client.submitBankForm(candidate, values, false), {
        kind: "not-confirmed",
      });
      const result = await client.submitBankForm(candidate, values, true);
      assert.deepEqual(await client.submitBankForm(candidate, values, true), {
        kind: "invalid-input",
      });
      return result;
    },
  );
}
const interestForm = form(
  "cur",
  "ok",
  [],
  "手动结息",
  "<p>您当前可得利息 3</p>",
  "",
);
const interestPage = savings(amountChoice(csrf) + interestForm);
await scenario(
  "interest settlement uses a separate offered form with no guessed password or hash",
  [
    get(current, interestPage),
    get(current, updated(interestPage)),
    post(accepted, {
      bankid: "1",
      action: "cur",
      op: "ok",
      banksubmit: "true",
    }),
  ],
  sent("settle-interest"),
  (client) => submit(client, "savings", "settle-interest", {}),
);
await scenario(
  "noninteger and oversized amounts and unexpected fields are refused before revalidation",
  [get(current, currentPage)],
  { kind: "invalid-input" },
  async (client) => {
    const handle = await prepared(client, "savings", "deposit-current");
    for (const banknum of ["01", "1.5", "1000000000000000000", "10\n"]) {
      assert.deepEqual(
        await client.submitBankForm(
          handle,
          { banknum, bankpass: password },
          true,
        ),
        { kind: "invalid-input" },
      );
    }
    return client.submitBankForm(
      handle,
      { banknum: "10", bankpass: password, bankid: "2" },
      true,
    );
  },
);
const tx = { banknum: "12", bankpass: password };
const txFields = {
  bankid: "1",
  action: "cur",
  formhash: freshToken,
  op: "in",
  ...tx,
  banksubmit: "true",
};
await scenario(
  "generic success text and a 200 do not establish a ledger movement",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(accepted, txFields),
  ],
  sent("deposit-current"),
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "an explicit native wrong-password refusal has its own outcome",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(refused, txFields),
  ],
  {
    kind: "refused",
    code: "bank-rejected",
    message: "银行密码错误，请返回修改。",
  },
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "a lost response is uncertain and never replays the same effect",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post("", txFields, { drop: true }),
  ],
  { kind: "uncertain", operation: "deposit-current" },
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "a changed savings balance stops before any POST",
  [
    get(current, currentPage),
    get(
      current,
      updated(currentPage).replace("存款金额为 200", "存款金额为 210"),
    ),
  ],
  { kind: "terms-changed" },
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "a response that looks like a new form remains uncertain",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(currentPage, txFields),
  ],
  { kind: "uncertain", operation: "deposit-current" },
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "a form with an off-origin POST or secret default is unavailable",
  [
    get(
      current,
      currentPage
        .replace(
          'action="plugin.php?',
          'action="https://elsewhere.example/plugin.php?',
        )
        .replace(
          'type="password"',
          'type="password" value="Fictitious default"',
        ),
    ),
  ],
  { forms: 0, unsupported: true },
  async (client) => {
    const read = await client.readBankService("savings", sid);
    return {
      forms: read.service?.forms.length,
      unsupported: read.service?.unsupportedForms,
    };
  },
);

const fixedURL = `${branch}&action=fix`;
const termLookup = `${fixedURL}&op=out&noid=7`;
const termRecordText = "存款数目: 100 虚构币 当期利息: 3 虚构币";
const termNotice = "您当前准备支取定期的金额为100虚构币，可得利息3虚构币";
const recordLink = (
  action,
  operation,
  recordId,
  label,
  context = termRecordText,
  bank = "1",
) =>
  `<tr><td>${context}</td><td>[<a href="${raw}&amp;bankid=${bank}&amp;action=${action}&amp;op=${operation}&amp;noid=${recordId}">${label}</a>]</td></tr>`;
const recordTable = (records) => row(`<table id="ttt">${records}</table>`);
const term = banking(
  "定期储蓄",
  row(form("fix", "in", ["banknum", "daynum", "bankpass"])) +
    recordTable(recordLink("fix", "out", "7", "支取")),
);
const termConfirm = (recordId = "7", notice = termNotice, token = csrf) =>
  banking(
    "定期储蓄",
    row(
      form(
        "fix",
        "out",
        ["bankpass"],
        "提交",
        field("noid", recordId) + `<p>${notice}</p><p>银行密码:</p>`,
        token,
      ),
    ),
  );
const termList = get(fixedURL, term);
const termRead = get(termLookup, termConfirm());
const readWithdrawal = async (client) =>
  (await client.readBankService("fixed", sid)).service.withdrawals[0];
const withdrawal = async (client) => {
  const selected = await readWithdrawal(client);
  assert.deepEqual(selected, {
    bankId: "1",
    recordId: "7",
    label: "支取",
    context: termRecordText,
  });
  assert.deepEqual(await client.prepareBankWithdrawal({ ...selected }), {
    kind: "invalid-input",
  });
  const prepared = await client.prepareBankWithdrawal(selected);
  assert.equal(prepared.kind, "bank-confirmation");
  assert.equal(prepared.form.context, termNotice);
  assert.equal(prepared.form.operation, "withdraw-fixed");
  return prepared.form;
};
await scenario(
  "fixed withdrawal shows record context and confirmation before any effect",
  [termList, termRead],
  { kind: "not-confirmed" },
  async (client) =>
    client.submitBankForm(
      await withdrawal(client),
      { bankpass: password },
      false,
    ),
);
await scenario(
  "fixed withdrawal rechecks the record and terms and sends the confirmation form only once",
  [
    termList,
    termRead,
    termList,
    get(termLookup, termConfirm("7", termNotice, freshToken)),
    post(accepted, {
      bankid: "1",
      action: "fix",
      op: "out",
      noid: "7",
      formhash: freshToken,
      bankpass: password,
      banksubmit: "true",
    }),
  ],
  sent("withdraw-fixed"),
  async (client) => {
    const offer = await withdrawal(client);
    const result = await client.submitBankForm(
      offer,
      { bankpass: password },
      true,
    );
    assert.deepEqual(
      await client.submitBankForm(offer, { bankpass: password }, true),
      { kind: "invalid-input" },
    );
    return result;
  },
);
await scenario(
  "a confirmed withdrawal cannot switch record IDs",
  [termList, get(termLookup, termConfirm("8"))],
  { kind: "invalid-response" },
  async (client) => client.prepareBankWithdrawal(await readWithdrawal(client)),
);
await scenario(
  "a withdrawal with a changed confirmation notice sends nothing",
  [
    termList,
    termRead,
    termList,
    get(
      termLookup,
      termConfirm("7", termNotice.replace("利息3", "利息8"), freshToken),
    ),
  ],
  { kind: "terms-changed" },
  async (client) =>
    client.submitBankForm(
      await withdrawal(client),
      { bankpass: password },
      true,
    ),
);
await scenario(
  "changed interest on the listed record stops before re-opening its confirmation",
  [
    termList,
    termRead,
    get(fixedURL, term.replace("当期利息: 3", "当期利息: 8")),
  ],
  { kind: "terms-changed" },
  async (client) =>
    client.submitBankForm(
      await withdrawal(client),
      { bankpass: password },
      true,
    ),
);
await scenario(
  "a vanished term record may return a forum refusal during preparation",
  [termList, get(termLookup, msg("参数传递错误，请返回。"))],
  { kind: "refused", message: "参数传递错误，请返回。" },
  async (client) => client.prepareBankWithdrawal(await readWithdrawal(client)),
);
const loansURL = `${branch}&action=len`;
const repayContext = "Fictitious repayment due";
const cancelContext = "Fictitious application pending";
const loans = banking(
  "贷款专柜",
  row(form("len", "try", ["banknum", "daynum", "bankpass"])) +
    recordTable(
      recordLink("len", "gb", "8", "还贷", repayContext) +
        recordLink("len", "gu", "9", "取消", cancelContext),
    ),
);
await scenario(
  "repayment and cancellation return exact separate browser destinations without GETs to those links",
  [get(loansURL, loans)],
  {
    forms: ["apply-loan"],
    handoffs: [
      {
        operation: "repay-loan",
        destination: `${origin}/${raw}&bankid=1&action=len&op=gb&noid=8`,
        bankId: "1",
        recordId: "8",
        context: repayContext,
      },
      {
        operation: "cancel-loan",
        destination: `${origin}/${raw}&bankid=1&action=len&op=gu&noid=9`,
        bankId: "1",
        recordId: "9",
        context: cancelContext,
      },
    ],
  },
  async (client) => {
    const result = await client.readBankService("loans", sid);
    return {
      forms: result.service?.forms.map((form) => form.operation),
      handoffs: result.service?.handoffs,
    };
  },
);
await scenario(
  "lookalike loan links from another bank or a notice authorize no handoff",
  [
    get(
      loansURL,
      banking(
        "贷款专柜",
        row(
          `<a href="${raw}&amp;bankid=1&amp;action=len&amp;op=gb&amp;noid=8">还贷</a>`,
        ) +
          recordTable(recordLink("len", "gu", "9", "取消", cancelContext, "2")),
      ),
    ),
  ],
  { handoffs: [], unsupported: true },
  async (client) => {
    const result = await client.readBankService("loans", sid);
    return {
      handoffs: result.service?.handoffs,
      unsupported: result.service?.unsupportedForms,
    };
  },
);
await scenario(
  "changed session before submission prevents even the revalidation GET",
  [get(current, currentPage)],
  { kind: "session-changed" },
  async (client, options) => {
    const handle = await prepared(client, "savings", "deposit-current");
    options.session = () => ({
      ...session,
      continuity: "fictitious replacement",
    });
    return client.submitBankForm(handle, tx, true);
  },
);
await scenario(
  "a password-reflecting error is classified without returning its raw text",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(msg(`Fictitious reflection: ${password}`), txFields),
  ],
  { kind: "refused", code: "bank-rejected" },
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "structured write result still leaves ledger movement unconfirmed",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(
      JSON.stringify({
        ok: 1,
        uid: 31,
        type: "result",
        schema: 13,
        kind: "message",
        message: positiveMessage,
      }),
      txFields,
      { contentType: "application/json" },
    ),
  ],
  sent("deposit-current"),
  (client) => submit(client, "savings", "deposit-current", tx),
);
await scenario(
  "reflected password equal to a known reply stays out of the result",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(accepted, { ...txFields, bankpass: positiveMessage }),
  ],
  { kind: "unconfirmed", operation: "deposit-current" },
  (client) =>
    submit(client, "savings", "deposit-current", {
      ...tx,
      bankpass: positiveMessage,
    }),
);
const transfer = banking(
  "账户汇款",
  transferTerms + row(form("chg", "ok", ["banknum", "touser", "bankpass"])),
);
await scenario(
  "changed transfer fee prevents a POST",
  [
    get(`${branch}&action=chg`, transfer),
    get(`${branch}&action=chg`, transfer.replace("2.5‰", "3‰")),
  ],
  { kind: "terms-changed" },
  (client) =>
    submit(client, "transfer", "transfer", {
      banknum: "10",
      touser: "Fictitious Recipient",
      bankpass: password,
    }),
);
await scenario(
  "locked savings reply cannot authorize following a redirect",
  [
    get(current, currentPage),
    get(current, updated(currentPage)),
    post(accepted, txFields, { redirect: "followed" }),
  ],
  { kind: "uncertain", operation: "deposit-current" },
  (client) => submit(client, "savings", "deposit-current", tx),
);
const inlineTerm = banking("定期储蓄", recordTable(`<tr><td>Fictitious matured term</td><td>${form("fix", "out", ["bankpass"], "支取", field("fixid", "7"))}</td></tr>`));
await scenario("inline fixed-record form preserves its served fixid and row context", [get(fixedURL, inlineTerm), get(fixedURL, updated(inlineTerm)),
  post(accepted, { bankid: "1", action: "fix", op: "out", fixid: "7", formhash: freshToken, bankpass: password, banksubmit: "true" })],
  sent("withdraw-fixed"), async client => {
    const handle = await prepared(client, "fixed", "withdraw-fixed");
    assert.equal(handle.recordId, "7");
    assert.equal(handle.context, "Fictitious matured term");
    return client.submitBankForm(handle, { bankpass: password }, true);
  });
const { depositExample } = await import("./example.mjs");
await scenario(
  "packaged TypeScript decline reads one page and neither collects a password nor sends a POST",
  [get(current, currentPage)],
  { kind: "not-confirmed" },
  (_client, options) =>
    depositExample(
      options,
      sid,
      "12",
      async () => false,
      async () => {
        throw new Error("Password must only be requested after approval");
      },
    ),
);
console.log(JSON.stringify(results));
