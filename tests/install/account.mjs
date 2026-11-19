import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAccountClient } from "tsdm-sdk";
import { changeSetting, inspect, signIn, signOut } from "./account-example.js";

const pins = JSON.parse(
  readFileSync(new URL("account-pins.json", import.meta.url)),
);
function fixture(path) {
  const bytes = readFileSync(join(process.argv[2], path));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    pins.sha256[path],
    path,
  );
  return bytes.toString("utf8");
}
const origin = "https://forum.test";
const statusPath = "/plugin.php?id=tsdmapp%3Aapi&action=status";
const statusFixture = fixture("tsdmapp/v4/status_v400.json");
const observations = [];
const requestCounts = { readGET: 0, logoutGET: 0, POST: 0 };
function record(operation, expected, observed) {
  assert.deepEqual(observed, expected, operation);
  observations.push({ operation, expected, observed });
}
function scenario(steps) {
  let epoch = 0;
  let continuity = "fixture-session";
  const rotate = () => {
    continuity = `replacement-session-${++epoch}`;
  };
  let sent = 0;
  const client = createAccountClient({
    origin,
    session: () => continuity,
    transport: {
      async request(url, options) {
        const step = steps[sent++];
        if (!step) throw new Error("Unexpected request");
        // Keep assertion failures out of the transport error channel.
        try {
          assert.equal(url, origin + step.path);
          assert.equal(options.session, continuity);
          assert.equal(options.fresh, true);
          assert.equal(options.method, step.method ?? "GET");
          assert.equal(options.effect, step.effect ?? false);
          assert.deepEqual(
            options.body === undefined
              ? undefined
              : Object.fromEntries(new URLSearchParams(options.body)),
            step.fields,
          );
        } catch (error) {
          failures.push(error);
        }
        if (step.rotate) rotate();
        if (step.lost) throw new Error("Synthetic lost response");
        return {
          url,
          status: step.status ?? 200,
          body: step.body,
          contentType: "",
          redirect: step.redirect ?? "none",
        };
      },
    },
  });
  const failures = [];
  return {
    client,
    rotate,
    done() {
      assert.equal(failures.length, 0, "transport contract assertion failed");
      assert.equal(sent, steps.length, "request count");
      for (const step of steps)
        requestCounts[
          step.method === "POST"
            ? "POST"
            : step.effect
              ? "logoutGET"
              : "readGET"
        ]++;
    },
  };
}
{
  const { client, done } = scenario([
    { path: statusPath, body: statusFixture },
    {
      path: statusPath,
      body: JSON.stringify({ ok: 1, uid: 0, api: 1, version: "3.9.0", v4: 0 }),
    },
    { path: statusPath, body: '{"ok":0,"error":"busy"}' },
  ]);
  const status = await client.readStatus();
  assert.equal(status.kind, "status");
  record(
    "member status and feature switches",
    {
      identity: { kind: "member", id: "31" },
      version: "4.0.0",
      v4: true,
      admin: false,
      paging: true,
      statusAction: true,
      magicForm: true,
    },
    {
      identity: status.identity,
      version: status.version,
      v4: status.switches.v4,
      admin: status.switches.admin,
      paging: status.switches.notify_paging,
      statusAction: status.lists.actions.includes("status"),
      magicForm: status.lists.forms.includes("magicuse"),
    },
  );
  const guest = await client.readStatus();
  record(
    "guest status with disabled v4",
    [{ kind: "guest" }, false],
    [guest.identity, guest.switches.v4],
  );
  record("busy status", "rate-limited", (await client.readStatus()).kind);
  done();
}
const loginPath =
  "/member.php?mod=logging&action=login&infloat=yes&handlekey=login&inajax=1&ajaxtarget=fwin_content_login";
// Keep captured form tokens and the deployment out of the controlled host.
const loginForm = fixture("login_form.xml")
  .replaceAll("LOr87", "FixtureLogin")
  .replaceAll(
    /name="formhash" value="[^"]+"/g,
    'name="formhash" value="fictionalHash"',
  )
  .replaceAll(/https:\/\/www\.tsdm39\.com/g, origin);
const challenged = loginForm.replace(
  'name="formhash"',
  'name="seccodehash" value="FixtureImage"><input type="hidden" name="formhash"',
);
const loginSubmit =
  "/member.php?mod=logging&action=login&loginsubmit=yes&handlekey=login&inajax=1&loginhash=FixtureLogin";
const credentials = {
  loginField: "username",
  identifier: "fictional-member",
  password: "fake-password",
  verificationCode: "fake-code",
  question: { id: "2", answer: "fake-answer" },
};
const fields = {
  formhash: "fictionalHash",
  referer: origin + "/",
  loginfield: "username",
  username: "fictional-member",
  password: "fake-password",
  questionid: "2",
  answer: "fake-answer",
  cookietime: "0",
  loginsubmit: "true",
  seccodehash: "FixtureImage",
  seccodemodid: "member::logging",
  seccodeverify: "fake-code",
};
const ajax = (body) => `<?xml version="1.0"?><root><![CDATA[${body}]]></root>`;
{
  const { client, done } = scenario([
    { path: loginPath, body: challenged },
    {
      path: loginSubmit,
      method: "POST",
      effect: true,
      fields,
      body: ajax(
        "<script>succeedhandle_login('/', 'Welcome', {'username':'fictional-member','usergroup':'member','uid':'31'});</script>",
      ),
    },
  ]);
  const form = await client.openLoginForm();
  assert.equal(form.kind, "login-form");
  record(
    "registration and lost-password browser destinations",
    [
      origin + "/member.php?mod=register",
      origin + "/member.php?mod=lostpasswd",
    ],
    [form.registration, form.lostPassword],
  );
  const image = client.loginVerificationImage(form);
  assert.equal(image.kind, "verification-image");
  const destination = new URL(image.destination);
  assert.match(destination.searchParams.get("update"), /^\d+$/);
  destination.searchParams.delete("update");
  assert.equal(destination.searchParams.get("idhash"), "FixtureImage");
  assert.equal(image.session, "fixture-session");
  record(
    "verification image handed to host using the form jar",
    [origin + "/misc.php", "seccode", true],
    [
      destination.origin + destination.pathname,
      destination.searchParams.get("mod"),
      form.needsVerificationImage,
    ],
  );
  record(
    "missing challenge answer prevents dispatch",
    "invalid",
    (
      await client.submitLogin(form, {
        ...credentials,
        verificationCode: undefined,
      })
    ).kind,
  );
  record(
    "deliberate login returns the served account",
    {
      kind: "signed-in",
      identity: { kind: "member", id: "31", name: "fictional-member" },
    },
    await client.submitLogin(form, credentials),
  );
  record(
    "login form consumed",
    "invalid",
    (await client.submitLogin(form, credentials)).kind,
  );
  done();
}
{
  const { client, done } = scenario([
    { path: loginPath, body: loginForm },
    { path: loginPath, body: loginForm },
    {
      path: loginSubmit,
      method: "POST",
      effect: true,
      fields: {
        ...Object.fromEntries(
          Object.entries(fields).filter(([key]) => !key.startsWith("seccode")),
        ),
        questionid: "0",
        answer: "",
      },
      body: ajax(
        "<script>errorhandle_login('抱歉，您输入的密码有误', {});</script>",
      ),
    },
  ]);
  const old = await client.openLoginForm();
  const fresh = await client.openLoginForm();
  record(
    "superseded login form",
    "invalid",
    (await client.submitLogin(old, credentials)).kind,
  );
  record(
    "login without an image",
    "no-image",
    client.loginVerificationImage(fresh).kind,
  );
  record(
    "explicit login refusal",
    "refused",
    (
      await client.submitLogin(fresh, {
        loginField: "username",
        identifier: "fictional-member",
        password: "fake-password",
      })
    ).kind,
  );
  done();
}
const settingsPath = "/home.php?mod=spacecp";
const guestStatus = '{"ok":1,"uid":"0","api":1,"version":"4.0.0"}';
const sessionHash = JSON.parse(statusFixture).formhash;
const logoutPath = `/member.php?mod=logging&action=logout&formhash=${sessionHash}`;
{
  const { client, done } = scenario([
    { path: statusPath, body: statusFixture },
    { path: statusPath, body: statusFixture },
    { path: logoutPath, effect: true, body: "<p>已退出</p>" },
    { path: statusPath, body: guestStatus },
    { path: statusPath, body: guestStatus },
  ]);
  record(
    "fresh session identity",
    { kind: "member", id: "31" },
    await client.readIdentity(),
  );
  record(
    "logout verified by returned guest identity",
    "signed-out",
    (await client.logout("31")).kind,
  );
  record(
    "already signed out, zero logout dispatches",
    "already-guest",
    (await client.logout("31")).kind,
  );
  done();
}
{
  const { client, done } = scenario([
    { path: statusPath, body: statusFixture },
    { path: statusPath, body: statusFixture },
    { path: logoutPath, effect: true, body: "<p>已退出</p>" },
    { path: statusPath, body: statusFixture },
    { path: statusPath, body: statusFixture },
    { path: logoutPath, effect: true, lost: true },
  ]);
  record(
    "wrong account cannot be logged out",
    "session-changed",
    (await client.logout("42")).kind,
  );
  record(
    "logout message with unchanged identity",
    "unverified",
    (await client.logout("31")).kind,
  );
  record("lost logout response", "uncertain", (await client.logout("31")).kind);
  done();
}
{
  const { client, done } = scenario([
    { path: statusPath, body: '{"ok":0,"error":"off"}' },
    {
      path: settingsPath,
      body: '<form id="lsform" action="member.php?mod=logging&action=login"></form>',
    },
  ]);
  record(
    "native identity fallback when status unavailable",
    { kind: "guest" },
    await client.readIdentity(),
  );
  done();
}
const accountFixture = (name, method = "chgpassword") =>
  fixture(`account/${name}`).replaceAll("chgpassword", method);
const centerPath = "/home.php?mod=spacecp&ac=account";
const methodPath = (method) => `${centerPath}&op=verify&method=${method}`;
const openPath = (method) =>
  `${methodPath(method)}&formhash=f1f2f3f4&inajax=1&infloat=yes&handlekey=security_verify`;
const formFixture = {
  chgpassword: "password",
  chgemail: "email",
  chgquestion: "question",
};
const fixtureAction = (name, method) =>
  "/" +
  /<form[^>]*action="([^"]+)"/
    .exec(accountFixture(name, method))[1]
    .replaceAll("&amp;", "&") +
  "&inajax=1";
const signedPath = (method) =>
  `${methodPath(method)}&formhash=f1f2f3f4&idstring=AbCd12&sign=0123456789abcdef&inajax=1`;
const openChange = (
  method,
  body = accountFixture("verify_password_x5.xml", method),
) => [
  { path: centerPath, body: accountFixture("account_center_x5.html") },
  { path: openPath(method), body },
];
const hidden = { formhash: "f1f2f3f4", referer: origin + "/./" };
function verifyStep(method, response) {
  return {
    path: fixtureAction("verify_password_x5.xml", method),
    method: "POST",
    effect: true,
    fields: { ...hidden, security_submit: "true", password: "fake-current" },
    ...response,
  };
}
function signedStep(method) {
  return {
    path: signedPath(method),
    body: accountFixture(`form_${formFixture[method]}_x5.xml`, method),
  };
}
function changeStep(method, values, response) {
  return {
    path:
      fixtureAction(`form_${formFixture[method]}_x5.xml`, method) +
      "&tsdmapp=json",
    method: "POST",
    effect: true,
    fields: { ...hidden, submit: "true", ...values },
    ...response,
  };
}
const passwordValues = { newpassword: "fake-next", renewpassword: "fake-next" };
{
  const method = "chgpassword";
  const { client, done } = scenario([
    ...openChange(method, accountFixture("choose_password_x5.xml")),
    {
      path: `${methodPath(method)}&verify=password&formhash=f1f2f3f4&inajax=1`,
      body: accountFixture("verify_password_x5.xml"),
    },
    verifyStep(method, { body: accountFixture("verify_ok_x5.xml") }),
    signedStep(method),
    changeStep(method, passwordValues, {
      body: accountFixture("result_password_done_v13.json"),
    }),
  ]);
  const check = await client.openAccountChange("31", "password");
  record(
    "open password verification form via choice GETs",
    "verify-password",
    check.kind,
  );
  const form = await client.verifyAccountChange(check, "fake-current");
  record(
    "verify current password and load its signed form",
    ["account-change-form", ["newpassword", "renewpassword"], true],
    [
      form.kind,
      form.fields.map(({ name }) => name),
      form.fields.every(({ obscure }) => obscure),
    ],
  );
  record(
    "password result key signals forum-reported effect despite ok=0",
    "changed",
    (await client.submitAccountChange(form, passwordValues)).kind,
  );
  record(
    "signed password form consumed",
    "invalid",
    (await client.submitAccountChange(form, passwordValues)).kind,
  );
  done();
}
{
  const method = "chgpassword";
  const { client, done } = scenario([
    ...openChange(method),
    verifyStep(method, { body: accountFixture("verify_wrong_x5.xml") }),
    ...openChange(method),
    verifyStep(method, { lost: true }),
    ...openChange(
      method,
      accountFixture("choose_password_x5.xml").replace(
        "verify=password",
        "verify=email",
      ),
    ),
    ...openChange(method, accountFixture("open_signed_x5.xml")),
    signedStep(method),
    changeStep(method, passwordValues, { lost: true }),
    ...openChange(method, accountFixture("open_signed_x5.xml")),
    signedStep(method),
    changeStep(method, passwordValues, {
      body: '{"type":"result","schema":13,"uid":31,"ok":1,"kind":"redirect"}',
    }),
  ]);
  const wrong = await client.openAccountChange("31", "password");
  record(
    "wrong current password is refused",
    "refused",
    (await client.verifyAccountChange(wrong, "fake-current")).kind,
  );
  const lost = await client.openAccountChange("31", "password");
  record(
    "lost password verification",
    "uncertain",
    (await client.verifyAccountChange(lost, "fake-current")).kind,
  );
  record(
    "lost verification consumes original form",
    "invalid",
    (await client.verifyAccountChange(lost, "fake-current")).kind,
  );
  record(
    "other verification is handed to account center",
    {
      kind: "browser",
      reason: "other-check",
      destination: origin + centerPath,
    },
    await client.openAccountChange("31", "password"),
  );
  const form = await client.openAccountChange("31", "password");
  record(
    "already signed password form from the server",
    "account-change-form",
    form.kind,
  );
  record(
    "lost password change is uncertain",
    "uncertain",
    (await client.submitAccountChange(form, passwordValues)).kind,
  );
  record(
    "lost password change is not replayed",
    "invalid",
    (await client.submitAccountChange(form, passwordValues)).kind,
  );
  const ambiguous = await client.openAccountChange("31", "password");
  record(
    "password effect unverified on bare redirect result",
    "unverified",
    (await client.submitAccountChange(ambiguous, passwordValues)).kind,
  );
  done();
}
for (const [change, method, values, refused, succeeded] of [
  [
    "email",
    "chgemail",
    { email: "fictional@example.invalid" },
    accountFixture("result_email_invalid_v13.json"),
    '{"ok":0,"uid":31,"type":"result","schema":13,"kind":"handle","message_key":"account_change_success","login":0}',
  ],
  [
    "security-question",
    "chgquestion",
    { questionidnew: "2", answernew: "fake-new-answer" },
    ajax("<div class='alert_error'>安全提问答案错误</div>"),
    accountFixture("result_question_done_x5.xml"),
  ],
]) {
  const refusedValues =
    change === "email"
      ? { email: "fictional-invalid-address" }
      : { ...values, answernew: "fake-refused-answer" };
  const steps = [];
  for (const [input, response] of [
    [refusedValues, { body: refused }],
    [values, { body: succeeded }],
    [values, { lost: true }],
    [values, { body: "<script>location.reload()</script>" }],
  ]) {
    steps.push(
      ...openChange(method),
      verifyStep(method, { body: accountFixture("verify_ok_x5.xml", method) }),
      signedStep(method),
      changeStep(method, input, response),
    );
  }
  steps.push(
    ...openChange(
      method,
      accountFixture("choose_password_x5.xml", method).replace(
        "verify=password",
        "verify=email",
      ),
    ),
  );
  const { client, done } = scenario(steps);
  for (const expected of ["refused", "changed", "uncertain", "unverified"]) {
    const check = await client.openAccountChange("31", change);
    assert.equal(check.kind, "verify-password");
    const form = await client.verifyAccountChange(check, "fake-current");
    assert.equal(form.kind, "account-change-form");
    if (expected === "refused") {
      record(
        `${change} verified form fields`,
        Object.keys(values),
        form.fields.map(({ name }) => name),
      );
      if (change === "security-question") {
        const [choice, answer] = form.fields;
        record(
          "question choices, default and hidden answer display",
          [9, "", "0", true],
          [
            choice.choices.length,
            choice.initial,
            choice.choices[1].value,
            answer.obscure,
          ],
        );
        record(
          "unoffered security question cannot dispatch",
          "invalid",
          (
            await client.submitAccountChange(form, {
              ...values,
              questionidnew: "99",
            })
          ).kind,
        );
      }
    }
    record(
      `${change} final submission ${expected}`,
      expected,
      (
        await client.submitAccountChange(
          form,
          expected === "refused" ? refusedValues : values,
        )
      ).kind,
    );
    record(
      `${change} ${expected} consumes the signed form`,
      "invalid",
      (await client.submitAccountChange(form, values)).kind,
    );
  }
  record(
    `${change} other check handoff`,
    {
      kind: "browser",
      reason: "other-check",
      destination: origin + centerPath,
    },
    await client.openAccountChange("31", change),
  );
  done();
}
{
  const method = "chgpassword";
  const { client, done, rotate } = scenario([
    ...openChange(
      method,
      accountFixture("open_signed_x5.xml").replace(
        "home.php?",
        "https://foreign.test/home.php?",
      ),
    ),
    ...openChange(method, accountFixture("open_signed_x5.xml")),
    {
      path: signedPath(method),
      body: accountFixture("form_password_x5.xml").replace(
        'type="password" name="newpassword"',
        'type="text" name="newpassword"',
      ),
    },
    { path: centerPath, body: accountFixture("account_center_x5.html") },
    ...openChange(method, accountFixture("open_signed_x5.xml")),
    signedStep(method),
    ...openChange(method, accountFixture("open_signed_x5.xml")),
    signedStep(method),
    changeStep(method, passwordValues, {
      body: accountFixture("result_password_done_v13.json"),
      rotate: true,
    }),
  ]);
  record(
    "external signed links are rejected before GET",
    "invalid",
    (await client.openAccountChange("31", "password")).kind,
  );
  record(
    "password field must be obscured in the returned form",
    "invalid",
    (await client.openAccountChange("31", "password")).kind,
  );
  record(
    "account center for another member never opens a form",
    "invalid",
    (await client.openAccountChange("42", "password")).kind,
  );
  const stale = await client.openAccountChange("31", "password");
  rotate();
  record(
    "same-UID session replacement invalidates a signed form",
    "session-changed",
    (await client.submitAccountChange(stale, passwordValues)).kind,
  );
  const form = await client.openAccountChange("31", "password");
  record(
    "session replacement during dispatch leaves effect uncertain",
    "uncertain",
    (await client.submitAccountChange(form, passwordValues)).kind,
  );
  done();
}
{
  const mismatchValues = { ...passwordValues, renewpassword: "fake-different" };
  const { client, done } = scenario([
    ...openChange("chgpassword", accountFixture("open_signed_x5.xml")),
    signedStep("chgpassword"),
    changeStep("chgpassword", mismatchValues, {
      body: accountFixture("result_password_mismatch_v13.json"),
    }),
    ...openChange("chgpassword", accountFixture("open_signed_x5.xml")),
    signedStep("chgpassword"),
    changeStep("chgpassword", passwordValues, {
      body: '{"type":"result","schema":13,"uid":31,"ok":0,"kind":"handle","alert":"error"}',
    }),
  ]);
  const mismatch = await client.openAccountChange("31", "password");
  record(
    "server refuses mismatched password",
    "refused",
    (await client.submitAccountChange(mismatch, mismatchValues)).kind,
  );
  const unknown = await client.openAccountChange("31", "password");
  record(
    "empty generic error envelope leaves effect unverified",
    "unverified",
    (await client.submitAccountChange(unknown, passwordValues)).kind,
  );
  done();
}
{
  const { client, done } = scenario([
    {
      path: loginPath,
      body: "<p>Use the browser to complete this verification.</p>",
    },
    { path: loginPath, body: loginForm },
    {
      path: loginSubmit,
      method: "POST",
      effect: true,
      fields: {
        ...Object.fromEntries(
          Object.entries(fields).filter(([key]) => !key.startsWith("seccode")),
        ),
        questionid: "0",
        answer: "",
      },
      lost: true,
    },
  ]);
  record(
    "unrecognized login challenge hands off to login page",
    {
      kind: "browser",
      reason: "login",
      destination: origin + "/member.php?mod=logging&action=login",
    },
    await client.openLoginForm(),
  );
  const form = await client.openLoginForm();
  const input = {
    loginField: "username",
    identifier: "fictional-member",
    password: "fake-password",
  };
  record(
    "lost login may have created a session",
    "uncertain",
    (await client.submitLogin(form, input)).kind,
  );
  record(
    "lost login consumes its original form",
    "invalid",
    (await client.submitLogin(form, input)).kind,
  );
  done();
}
{
  const { client, done } = scenario([
    { path: statusPath, body: '{"ok":0,"error":"off"}' },
    {
      path: settingsPath,
      body: "<head><script>var STYLEID = '2', discuz_uid = '31';</script></head>",
    },
  ]);
  record(
    "native layout without a member header still exposes returned UID",
    { kind: "member", id: "31" },
    await client.readIdentity(),
  );
  done();
}
{
  const { client, done } = scenario([
    { path: statusPath, body: guestStatus },
    { path: loginPath, body: challenged },
    {
      path: loginSubmit,
      method: "POST",
      effect: true,
      fields,
      body: ajax(
        "<script>succeedhandle_login('/', 'Welcome', {'username':'fictional-member','uid':'31'});</script>",
      ),
    },
    { path: statusPath, body: statusFixture },
    ...openChange("chgpassword"),
    verifyStep("chgpassword", { body: accountFixture("verify_ok_x5.xml") }),
    signedStep("chgpassword"),
    changeStep("chgpassword", passwordValues, {
      body: accountFixture("result_password_done_v13.json"),
    }),
    { path: statusPath, body: statusFixture },
    { path: logoutPath, effect: true, body: "<p>已退出</p>" },
    { path: statusPath, body: guestStatus },
  ]);
  const status = await inspect(client);
  const login = await signIn(client, "31", async (image) => {
    assert.equal(image?.kind, "verification-image");
    return credentials;
  });
  const setting = await changeSetting(
    client,
    "31",
    "password",
    async () => "fake-current",
    async (form) => {
      assert.equal(form.change, "password");
      return passwordValues;
    },
  );
  const logout = await signOut(client, "31");
  record(
    "packaged TypeScript guide from guest through change and logout",
    ["guest", "signed-in", "changed", "signed-out"],
    [status.identity.kind, login.kind, setting.kind, logout.kind],
  );
  done();
}
{
  const { client, done } = scenario([
    {
      path: loginPath,
      body: loginForm.replace("mod=register", "mod=joinforum"),
    },
    {
      path: loginPath,
      body: loginForm.replace(
        'href="member.php?mod=register"',
        'href="https://foreign.test/member.php?mod=register"',
      ),
    },
  ]);
  record(
    "configured registration destination from login form",
    origin + "/member.php?mod=joinforum",
    (await client.openLoginForm()).registration,
  );
  record(
    "foreign registration link uses canonical forum handoff",
    origin + "/member.php?mod=register",
    (await client.openLoginForm()).registration,
  );
  done();
}
console.log(JSON.stringify({ upstream: pins, requestCounts, observations }));
