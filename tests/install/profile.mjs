import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProfileClient } from "tsdm-sdk";

const [root, scenario] = process.argv.slice(2);
const pins = JSON.parse(
  readFileSync(new URL("./profile-pins.json", import.meta.url)),
);
const used = {};
function fixture(path) {
  const bytes = readFileSync(join(root, path));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, pins[path], path);
  used[path] = digest;
  return bytes.toString();
}
const origin = "https://forum.example.test";
const member = "501";
const hash = "fixturehash";
const plugin = (action) => `/plugin.php?id=tsdmapp%3Aapi&action=${action}`;
const home = (ac, op = "") =>
  `/home.php?mod=spacecp&ac=${ac}${op ? `&op=${op}` : ""}`;
const observed = [];
const capability = (name, extra = {}, response = {}) => ({
  path: plugin("status"),
  body: { ok: 1, uid: 501, v4: 1, block_pages: [name], ...extra },
  ...response,
});
function host(name, steps) {
  let session = "jar-1";
  steps = steps.flatMap((step) => {
    const query = new URL(step.path, origin).searchParams;
    const name =
      query.get("op") === "filter"
        ? "privacy_filter"
        : query.get("id") === "blockuser:spacecp"
          ? "blockuser"
          : null;
    return step.method !== "POST" && name && query.get("tsdmv") === "4"
      ? [capability(name), step]
      : [step];
  });
  const requests = [];
  let failure;
  const client = createProfileClient({
    origin,
    session: () => session,
    transport: {
      async request(url, request) {
        const expected = steps[requests.length];
        try {
          assert.ok(expected, `Unexpected request ${url}`);
          assert.equal(url, origin + expected.path);
          assert.equal(request.session, "jar-1");
          assert.equal(request.fresh, true);
          assert.equal(request.method, expected.method ?? "GET");
          assert.equal(request.effect, expected.method === "POST");
          if (expected.fields) {
            const fields = request.contentType?.startsWith(
              "multipart/form-data",
            )
              ? Object.fromEntries(
                  [
                    ...request.body.matchAll(
                      /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g,
                    ),
                  ].map(([, key, value]) => [key, value]),
                )
              : Object.fromEntries(new URLSearchParams(request.body));
            assert.deepEqual(fields, expected.fields);
          }
          assert.equal(
            request.headers?.["X-Tsdmapp-Device"],
            expected.deviceHeader,
          );
        } catch (error) {
          failure = error;
          throw error;
        }
        requests.push({
          method: request.method,
          path: expected.path,
          effect: request.effect,
          ...(expected.fields ? { fields: expected.fields } : {}),
          ...(expected.deviceHeader
            ? { deviceHeader: expected.deviceHeader }
            : {}),
        });
        if (expected.rotate) session = "jar-2";
        if (expected.lost) throw new Error("Controlled dropped response");
        return {
          url,
          status: expected.status ?? 200,
          redirect: expected.redirect ?? "none",
          contentType:
            typeof expected.body === "string"
              ? "text/html"
              : "application/json",
          body:
            typeof expected.body === "string"
              ? expected.body
              : JSON.stringify(expected.body),
        };
      },
    },
  });
  return {
    client,
    rotate() {
      session = "jar-2";
    },
    observe(operation, expected, actual) {
      if (failure) throw failure;
      assert.deepEqual(actual, expected, operation);
      observed.push({
        operation,
        expected,
        observed: actual,
        requests: [...requests],
      });
    },
    check(expected, actual) {
      if (failure) throw failure;
      assert.equal(requests.length, steps.length, name);
      assert.deepEqual(actual, expected, name);
      observed.push({
        operation: name,
        expected,
        observed: actual,
        requests,
      });
    },
  };
}
function deviceFixture(op) {
  const pinned = JSON.parse(fixture(`tsdmapp/device_v20_${op}.json`));
  const current = "8ff19e8b-e328-4d40-843d-c79267d29701";
  const other = "8ff19e8b-e328-4d40-843d-c79267d29702";
  const row = (value) => ({
    ...value,
    device: value.current === 1 ? current : other,
    name: value.current === 1 ? "Fixture phone" : "Fixture desktop",
  });
  return {
    ...pinned,
    uid: 501,
    formhash: hash,
    current,
    ...(pinned.devices ? { devices: pinned.devices.map(row) } : {}),
    ...(typeof pinned.device === "object"
      ? { device: row(pinned.device) }
      : {}),
    ...(pinned.removed ? { removed: other } : {}),
  };
}
if (!scenario || scenario === "devices") {
  const path = plugin("device");
  const listing = deviceFixture("list");
  const current = listing.current;
  const other = "8ff19e8b-e328-4d40-843d-c79267d29702";
  const before = {
    ...listing,
    devices: listing.devices.map((row) => ({
      ...row,
      revoked: 0,
      revoked_at: 0,
    })),
  };
  const post = (op, id, body, extra = {}) => ({
    path,
    method: "POST",
    fields: { formhash: hash, op, device: id, ...extra },
    body,
  });
  const read = host("device list", [{ path, body: listing }]);
  const listed = await read.client.listDevices(member);
  read.check(
    {
      kind: "devices",
      current,
      limit: 50,
      rows: [
        [other, true, false],
        [current, false, true],
      ],
    },
    {
      kind: listed.kind,
      current: listed.current,
      limit: listed.limit,
      rows: listed.devices?.map((row) => [row.id, row.revoked, row.current]),
    },
  );
  const registration = host("device registration", [
    {
      path: plugin("status"),
      body: {
        ok: 1,
        api: 1,
        version: "4.0.0",
        uid: 501,
        formhash: hash,
        device: 1,
      },
    },
    {
      ...post("register", current, deviceFixture("register"), {
        platform: "android",
        app_version: "0.1.0",
        name: "Fixture phone",
      }),
      deviceHeader: current,
    },
  ]);
  const registered = await registration.client.registerDevice(member, {
    id: current,
    platform: "android",
    appVersion: "0.1.0",
    name: "Fixture phone",
  });
  registration.check(
    { kind: "registered", id: current, created: true },
    {
      kind: registered.kind,
      id: registered.device?.id,
      created: registered.created,
    },
  );
  const revoke = host("device revocation keeps row", [
    { path, body: before },
    post("revoke", other, deviceFixture("revoke")),
  ]);
  const revoked = await revoke.client.revokeDevice(member, other);
  revoke.check(
    { kind: "revoked", id: other, revoked: true },
    {
      kind: revoked.kind,
      id: revoked.device?.id,
      revoked: revoked.device?.revoked,
    },
  );
  const remove = host("device removal", [
    { path, body: listing },
    post("remove", other, deviceFixture("remove")),
  ]);
  remove.check(
    { kind: "removed", id: other },
    await remove.client.removeDevice(member, other),
  );
  const refusal = host("device refusal", [
    { path, body: listing },
    post("remove", other, { ok: 0, error: "notrevoked" }),
  ]);
  refusal.check(
    { kind: "refused", reason: "notrevoked" },
    await refusal.client.removeDevice(member, other),
  );
  const wrong = host("device wrong account before dispatch", [
    { path, body: { ...listing, uid: 502 } },
  ]);
  wrong.check(
    { kind: "session-changed" },
    await wrong.client.removeDevice(member, other),
  );
  const drift = host("device continuity lost after dispatch", [
    { path, body: listing },
    { ...post("remove", other, deviceFixture("remove")), rotate: true },
  ]);
  drift.check(
    { kind: "uncertain" },
    await drift.client.removeDevice(member, other),
  );
  const revokedAnswer = JSON.parse(
    fixture("tsdmapp/device_v20_revoked.json"),
  );
  const denied = host("revoked device response remains a refusal", [
    { path, body: { ...revokedAnswer, uid: 501, device: other } },
  ]);
  denied.check(
    { kind: "refused", reason: "device_revoked" },
    await denied.client.listDevices(member),
  );
  const busy = host("device rate limit without automatic retry", [
    { path, body: listing },
    { ...post("remove", other, { ok: 0, error: "busy" }), status: 429 },
  ]);
  busy.check(
    { kind: "rate-limited" },
    await busy.client.removeDevice(member, other),
  );
}
if (!scenario || scenario === "sync") {
  assert.match(
    fixture("../regression/test_283_sync_client_per_account_test.dart"),
    /'max_bytes': 65536/,
  );
  const path = plugin("sync");
  const empty = {
    ok: 1,
    api: 1,
    uid: 501,
    formhash: hash,
    supported: 1,
    max_bytes: 65536,
    updated: 0,
    data: null,
  };
  const data = '{"version":1,"fixture":"café"}';
  const post = (body, extra = {}) => ({
    path,
    method: "POST",
    fields: { formhash: hash, base_updated: "0", data },
    body,
    ...extra,
  });
  const download = host("sync download for intended member", [
    { path, body: { ...empty, updated: 52, data } },
  ]);
  download.check(
    {
      kind: "sync-document",
      memberId: member,
      updated: 52,
      data,
      maxBytes: 65536,
    },
    await download.client.downloadSync(member),
  );
  const wrong = host("sync download wrong member", [
    { path, body: { ...empty, uid: 502, updated: 52, data } },
  ]);
  wrong.check(
    { kind: "session-changed" },
    await wrong.client.downloadSync(member),
  );
  for (const [name, step, expected] of [
    [
      "upload",
      post({ ok: 1, supported: 1, uid: 501, updated: 73 }),
      { kind: "uploaded", updated: 73 },
    ],
    [
      "conflict",
      post(
        {
          ok: 0,
          error: "conflict",
          uid: 501,
          updated: 51,
          data: '{"other":true}',
        },
        { status: 409 },
      ),
      { kind: "conflict", updated: 51, data: '{"other":true}' },
    ],
    [
      "size refusal",
      post({ ok: 0, error: "size", max_bytes: 16 }, { status: 413 }),
      { kind: "too-large", maxBytes: 16 },
    ],
    ["lost upload response", post({}, { lost: true }), { kind: "uncertain" }],
    [
      "wrong upload account",
      post({ ok: 1, supported: 1, uid: 502, updated: 73 }),
      { kind: "uncertain" },
    ],
    [
      "same member with a replaced session",
      null,
      { kind: "session-changed" },
    ],
  ]) {
    const sync = host(`sync ${name}`, [
      { path, body: empty },
      ...(step ? [step] : []),
    ]);
    const snapshot = await sync.client.downloadSync(member);
    assert.deepEqual(snapshot, {
      kind: "sync-document",
      memberId: member,
      updated: 0,
      data: null,
      maxBytes: 65536,
    });
    if (!step) sync.rotate();
    sync.check(expected, await sync.client.uploadSync(snapshot, data));
  }
}
const page = (html, uid = member) =>
  `<!doctype html><html><head><script>var discuz_uid = '${uid}';</script></head><body>${html}</body></html>`;
const hasher = (html) =>
  html.replace(/(name="formhash" value=")[^"]+/g, `$1${hash}`);
const flags = "&tsdmapp=json&tsdmform=1&nodoc=1";
const v4page = "&tsdmapp=json&tsdmv=4&nodoc=1";
const v4post = "&tsdmapp=json&tsdmv=4";
const savedProfile = {
  uid: 501,
  ok: 1,
  type: "result",
  schema: 13,
  kind: "page",
  document: "<script>parent.show_success('');</script>",
};
const profileFixed = {
  formhash: hash,
  profilesubmit: "true",
  profilesubmitbtn: "true",
};
const profileNative = (op, field) =>
  page(
    `<form action="${home("profile", op)}" method="post" enctype="multipart/form-data" target="frame_profile"><input type="hidden" name="formhash" value="${hash}"><input type="hidden" name="profilesubmit" value="true">${field}<button type="submit" name="profilesubmitbtn" value="true">Save</button></form>`,
  );
function profileFixture(op) {
  const data = JSON.parse(fixture(`profile_edit/signature_${op}_v17.json`));
  return {
    ...data,
    uid: 501,
    username: "Fixture member",
    loginname: null,
    formhash: hash,
    document: "",
    fields: data.fields.map((field) => ({
      ...field,
      text: field.text === null ? null : "Fixture read-only value",
      inputs: field.inputs.map((input) =>
        ["text", "textarea"].includes(input.type)
          ? { ...input, value: "" }
          : input,
      ),
    })),
    submit: { ...data.submit, fields: profileFixed },
  };
}
if (!scenario || scenario === "editors") {
  const base = profileFixture("base");
  const info = profileFixture("info");
  const open = home("profile");
  const edit = home("profile", "base");
  const signature = home("profile", "info");
  const post = (path, fields, body, extra = {}) => ({
    path,
    method: "POST",
    fields,
    body,
    ...extra,
  });
  const profile = host("profile structured edit", [
    { path: open + flags, body: base },
    post(
      edit + "&tsdmapp=json",
      { ...profileFixed, gender: "2", "privacy[gender]": "0" },
      savedProfile,
    ),
  ]);
  const settings = await profile.client.openProfile(member);
  profile.observe(
    "read structured profile",
    { kind: "profile", tab: "base", gender: "0" },
    {
      kind: settings.kind,
      tab: settings.tab,
      gender: settings.fields?.find((field) => field.name === "gender")?.value,
    },
  );
  profile.check(
    { kind: "saved" },
    await profile.client.saveSettings(settings, { gender: "2" }),
  );
  const sign = host(
    "signature follows advertised tab and posts signature alone",
    [
      { path: open + flags, body: base },
      { path: signature + flags, body: info },
      post(
        signature + "&tsdmapp=json",
        { ...profileFixed, sightml: "[b]Fixture[/b]" },
        savedProfile,
      ),
    ],
  );
  const signForm = await sign.client.openSignature(member);
  sign.observe(
    "read signature on the advertised info tab",
    { kind: "signature", tab: "info", name: "sightml", bbcode: true },
    {
      kind: signForm.kind,
      tab: signForm.tab,
      name: signForm.fields?.[0]?.name,
      bbcode: /\[b\]/.test(signForm.fields?.[0]?.value),
    },
  );
  sign.check(
    { kind: "saved" },
    await sign.client.saveSettings(signForm, { sightml: "[b]Fixture[/b]" }),
  );
  const native = profileNative(
    "base",
    '<textarea name="bio">Fixture before</textarea><textarea name="sightml">Fixture signature</textarea>',
  );
  assert.match(
    fixture("profile_edit_form_x5.html"),
    /target="frame_profile"/,
  );
  assert.match(
    fixture("profile_edit/signature_info_x5.html"),
    /name="sightml"/,
  );
  const legacy = host(
    "profile falls back once to native and keeps other fields out of POST",
    [
      { path: open + flags, body: { ok: 0, error: "unknown", uid: 501 } },
      { path: open, body: native },
      post(
        edit,
        { ...profileFixed, bio: "Fixture after" },
        "<script>parent.show_success('');</script>",
      ),
    ],
  );
  legacy.check(
    { kind: "saved" },
    await legacy.client.saveSettings(
      await legacy.client.openProfile(member),
      {
        bio: "Fixture after",
      },
    ),
  );
  const nativeSig = host("native signature refusal reports the field", [
    { path: open + flags, body: native },
    post(
      edit,
      { ...profileFixed, sightml: "Fixture after" },
      '<script>parent.show_error("sightml");</script>',
    ),
  ]);
  nativeSig.check(
    { kind: "refused", reason: "sightml" },
    await nativeSig.client.saveSettings(
      await nativeSig.client.openSignature(member),
      { sightml: "Fixture after" },
    ),
  );
  const invalid = host("profile refuses a value outside supplied choices", [
    { path: open + flags, body: base },
  ]);
  invalid.check(
    { kind: "invalid" },
    await invalid.client.saveSettings(
      await invalid.client.openProfile(member),
      { gender: "55" },
    ),
  );
  const stale = host("profile rejects same-member session replacement", [
    { path: open + flags, body: base },
  ]);
  const staleForm = await stale.client.openProfile(member);
  stale.rotate();
  stale.check(
    { kind: "session-changed" },
    await stale.client.saveSettings(staleForm, { gender: "2" }),
  );
  const ambiguous = host("profile redirect alone leaves write unverified", [
    { path: open + flags, body: base },
    post(
      edit + "&tsdmapp=json",
      { ...profileFixed, gender: "2", "privacy[gender]": "0" },
      { uid: 501, ok: 1, type: "result", schema: 13, kind: "redirect" },
    ),
  ]);
  ambiguous.check(
    { kind: "unverified" },
    await ambiguous.client.saveSettings(
      await ambiguous.client.openProfile(member),
      { gender: "2" },
    ),
  );

  const privacy = (op, flag, selected, name, changed, initial) => {
    const path = home("privacy", op);
    const raw = fixture(`account/privacy_${op}_x5.html`);
    const form = raw.match(/<form method="post"[\s\S]*?<\/form>/)[0];
    const after = {
      ...JSON.parse(fixture("account/result_privacy_v13.json")),
      uid: 501,
      formhash: hash,
      url: path,
    };
    const check = host(`privacy ${op} read and save`, [
      { path, body: page(hasher(form)) },
      post(
        path + "&tsdmapp=json",
        { formhash: hash, [flag]: "true", ...selected },
        after,
      ),
    ]);
    return check.client.openPrivacy(member, op).then(async (form) => {
      check.observe(
        `read privacy ${op}`,
        { kind: "privacy", tab: op, selected: initial },
        {
          kind: form.kind,
          tab: form.tab,
          selected: form.fields?.find((field) => field.name === name)?.value,
        },
      );
      check.check(
        { kind: "saved" },
        await check.client.saveSettings(form, { [name]: changed }),
      );
    });
  };
  await privacy(
    "base",
    "privacysubmit",
    {
      "privacy[view][friend]": "3",
      "privacy[view][wall]": "0",
      "privacy[view][home]": "0",
      "privacy[view][blog]": "3",
      "privacy[view][album]": "0",
    },
    "privacy[view][friend]",
    "3",
    "1",
  );
  await privacy(
    "feed",
    "privacysubmit",
    { "privacy[feed][newreply]": "1", "privacy[feed][newthread]": "1" },
    "privacy[feed][newreply]",
    true,
    false,
  );
  await privacy(
    "other",
    "privacy3submit",
    { allowasfriend: "1" },
    "allowasfriend",
    "1",
    "0",
  );
  const path = home("privacy", "filter");
  const clean = JSON.parse(fixture("tsdmapp/v4/g3_privacy_filter_v55.json"));
  const filter = {
    ...clean,
    uid: 501,
    formhash: hash,
    document: "",
    submit: {
      ...clean.submit,
      fields: { privacy2submit: "true", formhash: hash },
    },
  };
  const group = host("privacy filter saves only the supplied tab", [
    { path: path + v4page, body: filter },
    post(
      path + v4post,
      {
        formhash: hash,
        privacy2submit: "true",
        "privacy[filter_gid][2]": "2",
      },
      {
        uid: 501,
        ok: 1,
        type: "result",
        schema: 13,
        kind: "message",
        message_key: "do_success",
      },
    ),
  ]);
  group.check(
    { kind: "saved" },
    await group.client.saveSettings(
      await group.client.openPrivacy(member, "filter"),
      { "privacy[filter_gid][2]": true },
    ),
  );
  const rawFilterForm = [
    ...fixture("tsdmapp/v4/g3_privacy_filter_web.html").matchAll(
      /<form\b[\s\S]*?<\/form>/g,
    ),
  ]
    .map(([form]) => form)
    .find((form) => form.includes("ac=privacy&amp;op=filter"));
  assert.ok(rawFilterForm);
  for (const [label, status] of [
    [
      "privacy-filter absent from block_pages uses the native form",
      capability("blockuser"),
    ],
    [
      "v4 off uses the native privacy-filter form",
      capability("privacy_filter", { v4: 0 }),
    ],
  ]) {
    const hostCase = host(label, [
      status,
      { path, body: page(hasher(rawFilterForm)) },
    ]);
    hostCase.check(
      "privacy",
      (await hostCase.client.openPrivacy(member, "filter")).kind,
    );
  }
  for (const [label, status, kind] of [
    [
      "wrong status member blocks the privacy filter",
      capability("privacy_filter", { uid: 502 }),
      "session-changed",
    ],
    [
      "rotated status session blocks the privacy filter",
      capability("privacy_filter", {}, { rotate: true }),
      "session-changed",
    ],
    [
      "rate-limited status blocks the privacy filter",
      capability("privacy_filter", {}, { status: 429 }),
      "rate-limited",
    ],
    [
      "refused status blocks the privacy filter",
      capability("privacy_filter", {}, { status: 403 }),
      "refused",
    ],
  ]) {
    const hostCase = host(label, [status]);
    hostCase.check(
      kind,
      (await hostCase.client.openPrivacy(member, "filter")).kind,
    );
  }

  const nativeFilter = host("privacy filter native fallback", [
    { path: path + v4page, body: { ok: 0, error: "unknown", uid: 501 } },
    { path, body: page(hasher(rawFilterForm)) },
    post(
      path + "&tsdmapp=json",
      {
        formhash: hash,
        privacy2submit: "true",
        "privacy[filter_gid][2]": "2",
      },
      {
        uid: 501,
        ok: 1,
        type: "result",
        schema: 13,
        kind: "message",
        message_key: "do_success",
      },
    ),
  ]);
  nativeFilter.check(
    { kind: "saved" },
    await nativeFilter.client.saveSettings(
      await nativeFilter.client.openPrivacy(member, "filter"),
      { "privacy[filter_gid][2]": true },
    ),
  );
  const otherPath = home("privacy", "other");
  const otherForm = hasher(
    fixture("account/privacy_other_x5.html").match(
      /<form method="post"[\s\S]*?<\/form>/,
    )[0],
  );
  const otherAfter = otherForm
    .replace(/(<option value="0")[^>]*>/, "$1>")
    .replace('<option value="1">', '<option value="1" selected>');
  const otherNative = host(
    "privacy native redirect requires same-account tab readback",
    [
      { path: otherPath, body: page(otherForm) },
      post(
        otherPath + "&tsdmapp=json",
        { formhash: hash, privacy3submit: "true", allowasfriend: "1" },
        "",
        { status: 302, redirect: "opaque" },
      ),
      { path: otherPath, body: page(otherAfter) },
    ],
  );
  otherNative.check(
    { kind: "saved" },
    await otherNative.client.saveSettings(
      await otherNative.client.openPrivacy(member, "other"),
      { allowasfriend: "1" },
    ),
  );
  const unsafe = host(
    "privacy unsupported control prevents whole-tab replacement",
    [
      {
        path: home("privacy", "feed"),
        body: page(
          `<form action="${home("privacy", "feed")}" method="post"><input name="pluginfield"></form>`,
        ),
      },
    ],
  );
  unsafe.check(
    { kind: "unsupported" },
    await unsafe.client.openPrivacy(member, "feed"),
  );
}
if (!scenario || scenario === "avatar") {
  const path = home("avatar");
  const signed =
    "https://uploader.example.test/uc/index.php?m=user&a=rectavatar&input=fixture-signed&agent=fixture-agent";
  const currentUrl = "https://images.example.test/avatars/fixture.jpg";
  const before = "https://images.example.test/before.jpg";
  const after = "https://images.example.test/after.jpg";
  const raw = fixture("profile_edit/avatar_x5.html");
  assert.match(raw, /stl_src,[^,]+a=rectavatar/);
  assert.match(raw, /id="headform"/);
  const avatar = (external, url = signed) =>
    page(
      `<form id="headform" action="${path}" method="post"><input type="hidden" name="formhash" value="${hash}"><input name="headedit" value="${external}"><button name="headsubmit" type="submit" value="true">Save</button></form><form id="avatarform"><img class="_avt" src="${currentUrl}"><div id="avatardesigner"></div></form><script>var data = "width,450,stl_src,${url},height,200".split(',');</script>`,
    );
  const open = { path, body: avatar(before) };
  const initial = {
    kind: "avatar",
    memberId: member,
    currentUrl,
    externalUrl: before,
    uploadAvailable: true,
  };
  const read = host("current avatar and offered modes", [open]);
  read.check(initial, await read.client.openAvatar(member));
  const handoff = host(
    "signed avatar upload goes to host without a forum request",
    [open],
  );
  handoff.check(
    {
      kind: "avatar-upload",
      destination: signed,
      memberId: member,
      session: "jar-1",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      fields: ["avatar1", "avatar2", "avatar3"],
    },
    handoff.client.prepareAvatarUpload(
      await handoff.client.openAvatar(member),
    ),
  );
  const stale = host("stale signed avatar destination withheld from host", [
    open,
  ]);
  const expired = await stale.client.openAvatar(member);
  stale.rotate();
  stale.check(
    { kind: "session-changed" },
    stale.client.prepareAvatarUpload(expired),
  );
  const unsafe = host("non-HTTPS avatar uploader withheld", [
    {
      path,
      body: avatar(before, "http://uploader.example.test/?a=rectavatar"),
    },
  ]);
  const unsupported = await unsafe.client.openAvatar(member);
  assert.equal(unsupported.uploadAvailable, false);
  unsafe.check(
    { kind: "unsupported" },
    unsafe.client.prepareAvatarUpload(unsupported),
  );
  const change = {
    path,
    method: "POST",
    fields: { formhash: hash, headsubmit: "true", headedit: after },
    body: "",
    status: 302,
    redirect: "opaque",
  };
  const set = host(
    "avatar URL save with native redirect and matching readback",
    [open, change, { path, body: avatar(after) }],
  );
  set.check(
    { kind: "saved" },
    await set.client.setAvatarUrl(await set.client.openAvatar(member), after),
  );
  const lost = host("avatar URL response lost without a resend", [
    open,
    { ...change, lost: true },
  ]);
  lost.check(
    { kind: "uncertain" },
    await lost.client.setAvatarUrl(
      await lost.client.openAvatar(member),
      after,
    ),
  );
}
if (!scenario || scenario === "blacklist") {
  const path = "/home.php?mod=spacecp&ac=plugin&id=blockuser%3Aspacecp";
  const target = "502";
  const lookup = `${path}&bu_q=${target}`;
  const username = "Fixture neighbor";
  const row = { uid: 502, username, gone: 0 };
  const data = (input) => {
    const item = JSON.parse(
      fixture(`tsdmapp/v4/g3_blockuser_v56_${input}.json`),
    );
    const form = (key, value) => ({
      ...item[key],
      fields: { formhash: hash, [value]: "yes" },
    });
    return {
      ...item,
      uid: 501,
      formhash: hash,
      document: "",
      list: [],
      input: input === "lookup" ? target : "",
      confirm: input === "lookup" ? { uid: 502, username } : null,
      add: form("add", "blockuseradd"),
      remove: form("remove", "blockuserdel"),
    };
  };
  const empty = data("empty");
  const found = data("lookup");
  const full = { ...empty, count: 1, list: [row] };
  const get = (body, pathToGet = path + v4page) => ({
    path: pathToGet,
    body,
  });
  const change = (op, body, extra = {}) => ({
    path: path + v4post,
    method: "POST",
    fields: { formhash: hash, [`blockuser${op}`]: "yes", buid: target },
    body,
    ...extra,
  });
  const receipt = { kind: "confirmed", memberId: target };
  const redirect = {
    uid: 501,
    ok: 1,
    kind: "redirect",
    type: "result",
    schema: 13,
  };
  const list = host("website blacklist list", [get(full)]);
  list.check(
    {
      kind: "blacklist",
      members: [{ id: target, name: username }],
      complete: true,
      count: 1,
      limit: 10,
    },
    await list.client.listBlacklist(member),
  );
  const find = host("website blacklist lookup is read-only", [
    get(found, lookup + v4page),
  ]);
  find.check(
    {
      kind: "blacklist-member",
      id: target,
      name: username,
      alreadyListed: false,
      canAdd: true,
    },
    await find.client.lookupBlacklistMember(member, target),
  );
  const add = host("website blacklist add requires fresh list readback", [
    get(found, lookup + v4page),
    change("add", redirect),
    get(full),
  ]);
  add.check(
    receipt,
    await add.client.addToBlacklist(member, target, username),
  );
  const remove = host("website blacklist remove requires complete absence", [
    get(full),
    change("del", redirect),
    get(empty),
  ]);
  remove.check(
    receipt,
    await remove.client.removeFromBlacklist(member, target),
  );
  const incomplete = host(
    "website blacklist removal cannot confirm a partial list",
    [
      get(full),
      change("del", redirect),
      get({ ...empty, pages: 2, count: 3 }),
    ],
  );
  incomplete.check(
    { kind: "uncertain" },
    await incomplete.client.removeFromBlacklist(member, target),
  );
  const renamed = host(
    "website blacklist changed lookup name prevents POST",
    [get(found, lookup + v4page)],
  );
  renamed.check(
    { kind: "invalid" },
    await renamed.client.addToBlacklist(
      member,
      target,
      "Different fictitious name",
    ),
  );
  const refusal = host(
    "website blacklist redrawn refusal and unchanged list",
    [
      get(found, lookup + v4page),
      change("add", { ...found, error: { code: "full" } }),
      get(empty),
    ],
  );
  refusal.check(
    { kind: "refused", reason: "full" },
    await refusal.client.addToBlacklist(member, target, username),
  );
  const lost = host(
    "website blacklist readback after a lost write without resending",
    [
      get(found, lookup + v4page),
      change("add", {}, { lost: true }),
      get(full),
    ],
  );
  lost.check(
    receipt,
    await lost.client.addToBlacklist(member, target, username),
  );
  const drift = host("website blacklist session change prevents readback", [
    get(found, lookup + v4page),
    change("add", redirect, { rotate: true }),
  ]);
  drift.check(
    { kind: "uncertain" },
    await drift.client.addToBlacklist(member, target, username),
  );
  assert.match(
    fixture("tsdmapp/v4/g3_blockuser_web_lookup.html"),
    /id="bu_confirmname"/,
  );
  assert.match(
    fixture("tsdmapp/v4/g3_blockuser_web_empty.html"),
    /id="bu_empty"/,
  );
  const nativePost = (id, flag) =>
    `<form ${id} method="post" action="${path}"><input type="hidden" name="formhash" value="${hash}"><input type="hidden" name="buid" value="502"><input type="hidden" name="${flag}" value="yes"><button type="submit">Send</button></form>`;
  const nativeEmpty =
    '<h3 id="bu_listtitle">Blacklist</h3><p id="bu_empty" class="bu-empty">Empty</p>';
  const nativeLookup = `<div id="bu_confirm"><div class="bu-member"><b id="bu_confirmname">${username}</b><span class="bu-uid">UID 502</span></div>${nativePost('id="bu_addform"', "blockuseradd")}</div>${nativeEmpty}`;
  const nativeFull = `<table id="bu_list"><tbody><tr id="bu_row_502"><td><span class="bu-name"><a href="home.php?mod=space&uid=502">${username}</a></span><span class="bu-uid">UID 502</span></td><td></td><td>${nativePost('class="bu-delform"', "blockuserdel")}</td></tr></tbody></table>`;
  const nativePage = (body, used) =>
    page(
      `<div id="bu_page"><div id="bu_quota">${used} / 10</div>${body}</div>`,
    );
  const unadvertised = host("unadvertised blockuser reads native blacklist", [
    capability("privacy_filter"),
    get(nativePage(nativeFull, 1), path),
  ]);
  unadvertised.check(
    "blacklist",
    (await unadvertised.client.listBlacklist(member)).kind,
  );
  const refusedLookup = host("wrong status member blocks blockuser lookup", [
    capability("blockuser", { uid: 502 }),
  ]);
  refusedLookup.check(
    "session-changed",
    (await refusedLookup.client.lookupBlacklistMember(member, target)).kind,
  );
  const nativeChange = (op) => ({
    ...change(op, ""),
    path,
    status: 302,
    redirect: "opaque",
  });
  const nativeAdd = host("native website blacklist add from supplied form", [
    get({ ok: 0, error: "unknown" }, lookup + v4page),
    get(nativePage(nativeLookup, 0), lookup),
    nativeChange("add"),
    get(nativePage(nativeFull, 1), path),
  ]);
  nativeAdd.check(
    receipt,
    await nativeAdd.client.addToBlacklist(member, target, username),
  );
  const nativeRemove = host(
    "native website blacklist removal from row form",
    [
      capability("privacy_filter"),
      get(nativePage(nativeFull, 1), path),
      nativeChange("del"),
      get(nativePage(nativeEmpty, 0), path),
    ],
  );
  nativeRemove.check(
    receipt,
    await nativeRemove.client.removeFromBlacklist(member, target),
  );
}
if (!scenario) {
  const { ownAccount } = await import("./profile-guide.js");
  const expected = {
    ok: 1,
    uid: 501,
    supported: 1,
    updated: 0,
    data: null,
    max_bytes: 65536,
  };
  const path = plugin("sync");
  let requests = 0;
  const guide = ownAccount(
    {
      origin,
      session: () => "jar-1",
      transport: {
        async request(url, request) {
          requests++;
          assert.equal(url, origin + path);
          assert.deepEqual(request, {
            method: "GET",
            effect: false,
            fresh: true,
            session: "jar-1",
          });
          return {
            status: 200,
            url,
            redirect: "none",
            contentType: "application/json",
            body: JSON.stringify(expected),
          };
        },
      },
    },
    member,
  );
  const actual = await guide.download();
  const snapshot = {
    kind: "sync-document",
    memberId: member,
    updated: 0,
    data: null,
    maxBytes: 65536,
  };
  assert.deepEqual(actual, snapshot);
  assert.equal(requests, 1);
  observed.push({
    operation: "packaged TypeScript guide",
    expected: snapshot,
    observed: actual,
    requests: [{ method: "GET", path, effect: false }],
  });
}
console.log(
  JSON.stringify({
    upstream: "02df67e39ded906def5b868e8f8311ba735b316c",
    inputs: used,
    operations: observed,
  }),
);
