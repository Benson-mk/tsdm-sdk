import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMediaClient, createProfileClient } from "tsdm-sdk";

const upstream = process.argv[2];
const origin = "https://forum.test";
const results = [];
const fixture = (name) => readFileSync(join(upstream, "test/data", name));
const encoder = new TextEncoder();
const answer =
  (body, contentType = "text/plain", extra = {}) =>
  (url) => ({
    url,
    status: 200,
    redirect: "none",
    contentType,
    headers: {},
    bytes: typeof body === "string" ? encoder.encode(body) : body,
    ...extra,
  });
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, actual });
}
const journey = (...answers) => journeyAs("31", ...answers);
function journeyAs(memberId, ...answers) {
  let continuity = "original";
  const calls = [];
  const client = createMediaClient({
    origin,
    session: () => ({ memberId, continuity }),
    transport: {
      async request(url, request) {
        assert.equal(
          new URL(url).origin,
          origin,
          "only canonical forum requests enter the forum transport",
        );
        assert.deepEqual(request.session, { memberId, continuity });
        assert.equal(request.fresh, true);
        calls.push({ url: new URL(url), ...request });
        assert.ok(answers.length, "unexpected request or replay");
        return answers.shift()(url, request);
      },
    },
  });
  return {
    client,
    calls,
    done: () => assert.equal(answers.length, 0),
    drift: () => {
      continuity = "new";
    },
  };
}
const editor =
  origin +
  "/forum.php?mod=post&action=edit&fid=7&tid=9600003&pid=9700005&page=1";
const postForm = answer(
  fixture("tsdmapp/post_v16_edit_attach.json"),
  "application/json",
);
const picture = fixture("attachment_head.jpg");
const file = {
  filename: "photo.jpg",
  contentType: "image/jpeg",
  bytes: picture,
};
async function preparePost(j) {
  const result = await j.client.openPostUpload(editor);
  assert.equal(result.kind, "post-upload", JSON.stringify(result));
  assert.equal(j.calls.length, 1);
  assert.equal(j.calls[0].effect, false);
  return result.form;
}
{
  const j = journey(
    postForm,
    answer("DISCUZUPLOAD|1|0|975|1|forum/test.jpg|0"),
  );
  const form = await preparePost(j);
  check(
    "post form limits",
    [form.extensions, form.maxBytes],
    [["jpg", "jpeg", "gif", "png"], 2048000],
  );
  check(
    "bad extension stays local",
    (await j.client.uploadPostImage(form, { ...file, filename: "other.zip" }))
      .kind,
    "invalid",
  );
  const r = await j.client.uploadPostImage(form, file);
  const request = j.calls[1];
  check(
    "post upload and multipart authority",
    [
      r,
      request.method,
      request.effect,
      request.url.pathname,
      request.url.search,
      request.multipart.fields.uid,
      request.multipart.fields.hash,
      request.multipart.file.field,
      request.multipart.file.filename,
      Buffer.from(request.multipart.file.bytes).equals(picture),
    ],
    [
      {
        kind: "uploaded",
        attachmentId: "975",
        bbcode: "[attachimg]975[/attachimg]",
      },
      "POST",
      true,
      "/misc.php",
      "?mod=swfupload&action=swfupload&operation=upload&fid=7&type=image&simple=2",
      "31",
      "00000000000000000000000000000000",
      "Filedata",
      "photo.jpg",
      true,
    ],
  );
  check(
    "one use per post upload approval",
    (await j.client.uploadPostImage(form, file)).kind,
    "invalid",
  );
  j.done();
}
{
  const j = journey(postForm, () => {
    throw Error("socket closed after dispatch");
  });
  const form = await preparePost(j);
  const result = await j.client.uploadPostImage(form, file);
  check(
    "lost post upload",
    [result.kind, j.calls.filter((r) => r.effect).length],
    ["unknown", 1],
  );
  j.done();
}
{
  const j = journey(postForm, answer("-1"));
  const result = await j.client.uploadPostImage(await preparePost(j), file);
  check(
    "explicit upload rejection",
    [result.kind, result.code],
    ["refused", "1"],
  );
  j.done();
}
{
  const j = journey(postForm);
  const form = await preparePost(j);
  j.drift();
  check(
    "same UID new login cannot use an old uploader",
    [(await j.client.uploadPostImage(form, file)).kind, j.calls.length],
    ["session-changed", 1],
  );
  j.done();
}
const albumSource = fixture("space/album_upload.html");
const albumForm = answer(albumSource, "text/html");
const albumUpload = (id) =>
  answer(
    JSON.stringify({
      picid: id,
      url: "data/picture.thumb.jpg",
      bigimg: "data/picture.jpg",
    }),
    "application/json",
  );
const filed = (id = "1") =>
  answer(
    JSON.stringify({
      ok: 1,
      uid: 31,
      type: "result",
      schema: 13,
      kind: "message",
      message_key: "upload_images_completed",
      url: `home.php?mod=space&uid=31&do=album&quickforward=1&id=${id}`,
    }),
    "application/json",
  );
async function prepareAlbum(j) {
  const r = await j.client.openAlbumUpload();
  assert.equal(r.kind, "album-upload", JSON.stringify(r));
  return r.form;
}
{
  const j = journey(albumForm, albumUpload("12"), albumUpload("0"), filed());
  const form = await prepareAlbum(j);
  check(
    "album controls from native form",
    [form.albums, form.privacy.map((p) => p.value), j.calls[0].effect],
    [[{ value: "1", label: "测试相册" }], ["0", "1", "2", "3", "4"], false],
  );
  const took = await j.client.uploadAlbumImage(form, file);
  const rejected = await j.client.uploadAlbumImage(form, {
    ...file,
    filename: "other.jpg",
  });
  const r = j.calls[1];
  check(
    "album uploads run independently from filing",
    [
      took.kind,
      took.picture?.pictureId,
      rejected.kind,
      j.calls.length,
      r.url.search,
      r.multipart.fields.uid,
      r.multipart.fields.hash,
      r.multipart.file.field,
    ],
    [
      "uploaded",
      "12",
      "refused",
      3,
      "?mod=swfupload&action=swfupload&operation=album",
      "31",
      "0123456789abcdef0123456789abcdef",
      "Filedata",
    ],
  );
  check(
    "unoffered album sends nothing",
    [
      (
        await j.client.fileAlbumImages(form, [took.picture], {
          kind: "existing",
          albumId: "53",
        })
      ).kind,
      j.calls.length,
    ],
    ["invalid", 3],
  );
  const done = await j.client.fileAlbumImages(form, [took.picture], {
    kind: "existing",
    albumId: "1",
  });
  check(
    "file only the uploaded picture after approval",
    [
      done.kind,
      done.albumId,
      done.pictureIds,
      j.calls[3].url.search,
      Object.fromEntries(new URLSearchParams(j.calls[3].form)),
    ],
    [
      "filed",
      "1",
      ["12"],
      "?mod=spacecp&ac=upload&tsdmapp=json",
      {
        formhash: "f1f2f3f4",
        albumsubmit: "true",
        "title[12]": "",
        albumop: "selectalbum",
        albumid: "1",
      },
    ],
  );
  check(
    "filed upload cannot be sent twice",
    (
      await j.client.fileAlbumImages(form, [took.picture], {
        kind: "existing",
        albumId: "1",
      })
    ).kind,
    "invalid",
  );
  j.done();
}
{
  const j = journey(albumForm, albumUpload("16"), filed("4"));
  const form = await prepareAlbum(j);
  const r = await j.client.uploadAlbumImage(form, file);
  const done = await j.client.fileAlbumImages(form, [r.picture], {
    kind: "create",
    name: "A & B",
    privacy: "4",
    password: "fixture",
  });
  check(
    "create a protected album using offered controls",
    [
      done.kind,
      done.albumId,
      Object.fromEntries(new URLSearchParams(j.calls[2].form)),
    ],
    [
      "filed",
      "4",
      {
        formhash: "f1f2f3f4",
        albumsubmit: "true",
        "title[16]": "",
        albumop: "creatalbum",
        albumname: "A & B",
        depict: "",
        friend: "4",
        password: "fixture",
      },
    ],
  );
  j.done();
}
{
  const j = journey(albumForm, albumUpload("12"), () => {
    throw Error("lost filing response");
  });
  const form = await prepareAlbum(j),
    r = await j.client.uploadAlbumImage(form, file);
  const done = await j.client.fileAlbumImages(form, [r.picture], {
    kind: "existing",
    albumId: "1",
  });
  check(
    "ambiguous filing retains acknowledged picture IDs",
    [done.kind, done.pictureIds, j.calls.length],
    ["unknown", ["12"], 3],
  );
  check(
    "ambiguous filing cannot replay",
    (
      await j.client.fileAlbumImages(form, [r.picture], {
        kind: "existing",
        albumId: "1",
      })
    ).kind,
    "invalid",
  );
  j.done();
}
const aid36 = "MzZ8ZjFmMmYzZjR8MTcwMDAwMDAwMHwzMXwxMDAw";
const aid37 = "Mzd8ZjFmMmYzZjR8MTcwMDAwMDAwMHwzMXwxMDAw";
const download = (id) => `/forum.php?mod=attachment&aid=${id}`;
const purchase = "/forum.php?mod=misc&action=attachpay&aid=37&tid=1000";
const credit =
  "/forum.php?mod=misc&action=attachcredit&aid=36&formhash=f1f2f3f4";
const redirect = (location) =>
  answer("", "text/plain", { status: 302, headers: { Location: location } });
const jpeg = answer(picture, "image/jpeg", {
  headers: {
    "Content-Disposition":
      "attachment; filename=wrong.jpg; filename*=UTF-8''read%20me.jpg",
    "Content-Length": String(picture.length),
  },
});
{
  const j = journey(jpeg);
  const r = await j.client.downloadAttachment(download(aid36));
  check(
    "restricted attachment bytes use the signed member session",
    [
      r.kind,
      r.filename,
      Buffer.from(r.bytes).equals(picture),
      j.calls[0].session.memberId,
      j.calls[0].effect,
    ],
    ["delivered", "read me.jpg", true, "31", false],
  );
  j.done();
}
{
  const j = journey(
    answer(
      fixture("attachment_download/refused_no_permission.html"),
      "text/html",
    ),
  );
  const r = await j.client.downloadAttachment(download(aid36));
  check(
    "permission page is denial, no bytes",
    [r.kind, typeof r.bytes, j.calls.length],
    ["refused", "undefined", 1],
  );
  j.done();
}
{
  const j = journey(
    answer(
      fixture("attachment_download/refused_price_unpaid.html"),
      "text/html",
    ),
  );
  const r = await j.client.downloadAttachment(download(aid37));
  const linked = await j.client.downloadAttachment(purchase);
  check(
    "unpaid page and offered purchase hand off without loading purchase",
    [
      r.kind,
      r.reason,
      r.destination,
      linked.kind,
      linked.destination,
      j.calls.length,
    ],
    [
      "browser-handoff",
      "purchase",
      origin + purchase,
      "browser-handoff",
      origin + purchase,
      1,
    ],
  );
  j.done();
}
{
  const storage = "https://cdn.example.test/a.zip?sig=storage";
  const j = journey(
    redirect(credit),
    answer(fixture("attachment_download/credit_taken.html"), "text/html"),
    redirect(storage),
  );
  const offered = await j.client.downloadAttachment(download(aid36));
  check(
    "credit redirect awaits approval",
    [offered.kind, offered.offer?.attachmentId, j.calls.length],
    ["credit-required", "36", 1],
  );
  const approved = await j.client.confirmAttachmentCredit(offered.offer);
  check(
    "charge receipt and download are separate",
    [
      approved.kind,
      approved.resume?.attachmentId,
      j.calls.map((r) => r.effect),
    ],
    ["credit-confirmed", "36", [false, true]],
  );
  const external = await j.client.resumeAttachment(approved.resume);
  check(
    "external storage handoff carries no forum credentials or referrer",
    [
      external,
      j.calls[2].url.searchParams.get("ck"),
      j.calls[2].effect,
      j.calls.length,
    ],
    [
      {
        kind: "external-handoff",
        destination: storage,
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "manual",
      },
      "c1c2c3c4",
      false,
      3,
    ],
  );
  check(
    "credit approval is consumed",
    (await j.client.confirmAttachmentCredit(offered.offer)).kind,
    "invalid",
  );
  j.done();
}
{
  const j = journey(redirect(credit), () => {
    throw Error("lost after charge");
  });
  const offered = await j.client.downloadAttachment(download(aid36));
  const failed = await j.client.confirmAttachmentCredit(offered.offer);
  check(
    "lost charge response sends one effect",
    [
      failed.kind,
      (await j.client.confirmAttachmentCredit(offered.offer)).kind,
      j.calls.map((r) => r.effect),
    ],
    ["unknown", "invalid", [false, true]],
  );
  j.done();
}
{
  const j = journey(
    redirect(credit),
    answer(fixture("attachment_download/credit_taken.html"), "text/html"),
    redirect(credit),
  );
  const offered = await j.client.downloadAttachment(download(aid36));
  const approved = await j.client.confirmAttachmentCredit(offered.offer);
  const expired = await j.client.resumeAttachment(approved.resume);
  check(
    "credit continuation cannot auto-charge again",
    [expired.kind, j.calls.filter((r) => r.effect).length],
    ["invalid", 1],
  );
  j.done();
}
{
  const other = Buffer.from("36|f1f2f3f4|1700000000|32|1000").toString(
    "base64",
  );
  const j = journey();
  check(
    "wrong-member token and bare credit URL are rejected locally",
    [
      (await j.client.downloadAttachment(download(other))).kind,
      (await j.client.downloadAttachment(credit)).kind,
      j.calls.length,
    ],
    ["session-changed", "invalid", 0],
  );
  j.done();
}
{
  const j = journey(answer(picture, "image/jpeg", { status: 206 }));
  const r = await j.client.downloadAttachment(download(aid36));
  check(
    "partial response never delivers bytes",
    [r.kind, typeof r.bytes],
    ["invalid", "undefined"],
  );
  j.done();
}
const smileys = fixture("tsdmapp/smilies_v1.json")
  .toString()
  .replaceAll("https://www.tsdm39.com", origin);
const gif = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);
const smileyScript = fixture("emoji/common_smilies_var.js");
{
  const j = journeyAs(
    "0",
    answer(smileys, "application/json"),
    answer(gif, "image/gif"),
  );
  const table = await j.client.readSmileys();
  const row = table.items?.[0];
  check(
    "document-free smiley table",
    [
      table.kind,
      table.source,
      table.items?.length,
      table.groups?.length,
      row?.code,
      row?.url,
      j.calls[0].url.search,
    ],
    [
      "smileys",
      "plugin",
      156,
      4,
      ":bangbangtang:",
      origin + "/static/image/smiley/qq/bangbangtang.gif",
      "?id=tsdmapp%3Aapi&action=smilies",
    ],
  );
  const image = await j.client.readMedia(row.url);
  check(
    "smiley image retrieval",
    [image.kind, Buffer.from(image.bytes).equals(gif), j.calls[1].effect],
    ["delivered", true, false],
  );
  j.done();
}
{
  const j = journey(
    answer('{"ok":0,"error":"action"}', "application/json"),
    answer(smileyScript, "application/javascript"),
  );
  const table = await j.client.readSmileys();
  check(
    "native smiley script fallback and safe literal parsing",
    [
      table.kind,
      table.source,
      table.items?.length,
      table.groups?.length,
      table.items?.[0]?.code,
      table.items?.[0]?.url,
      j.calls[1].url.pathname,
    ],
    [
      "smileys",
      "script",
      788,
      13,
      "{:20_984:}",
      origin + "/static/image/smiley/deepseek/d%20(1).gif",
      "/data/cache/common_smilies_var.js",
    ],
  );
  j.done();
}
{
  const j = journey(answer(smileyScript, "application/javascript"));
  const script = await j.client.readSmileyScript();
  check(
    "read exact raw script without execution",
    [script.kind, script.script === smileyScript.toString(), j.calls.length],
    ["script", true, 1],
  );
  j.done();
}
{
  const src = "/data/avatar/000/00/00/31_avatar_big.jpg?ts=1700000000";
  const j = journey(
    jpeg,
    answer("", "text/plain", { status: 404 }),
    answer('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "image/svg+xml"),
  );
  const avatar = await j.client.readAvatar(src);
  const fallback = await j.client.readAvatar(src);
  check(
    "avatar and explicit missing fallback",
    [
      avatar.kind,
      avatar.sourceURL,
      fallback.kind,
      fallback.sourceURL,
      j.calls.map((r) => r.url.pathname),
    ],
    [
      "delivered",
      origin + src,
      "delivered",
      origin + "/data/avatar/noavatar.svg",
      [
        "/data/avatar/000/00/00/31_avatar_big.jpg",
        "/data/avatar/000/00/00/31_avatar_big.jpg",
        "/data/avatar/noavatar.svg",
      ],
    ],
  );
  j.done();
}
{
  const j = journey(jpeg, jpeg);
  const post = await j.client.readMedia(
    "/forum.php?mod=image&aid=9800001&size=300x300&key=fixture",
  );
  const album = await j.client.readMedia(
    "/data/attachment/album/202609/picture.jpg",
  );
  const unintended = await j.client.readMedia(credit);
  check(
    "forum post and album media, reject charge route",
    [post.kind, album.kind, unintended.kind, j.calls.length],
    ["delivered", "delivered", "invalid", 2],
  );
  j.done();
}
{
  const calls = [];
  const profile = createProfileClient({
    origin,
    session: () => "profile-fixture",
    transport: {
      async request(url, options) {
        calls.push({ url, options });
        return {
          url,
          status: 200,
          redirect: "none",
          contentType: "text/html",
          body: fixture("profile_edit/avatar_x5.html").toString(),
        };
      },
    },
  });
  const page = await profile.openAvatar("31");
  const offered = profile.prepareAvatarUpload(page);
  check(
    "signed avatar crops are a host upload handoff",
    [
      offered.kind,
      new URL(offered.destination).searchParams.get("a"),
      offered.fields,
      calls.length,
      calls[0].options.method,
      calls[0].options.effect,
    ],
    [
      "avatar-upload",
      "rectavatar",
      ["avatar1", "avatar2", "avatar3"],
      1,
      "GET",
      false,
    ],
  );
}
{
  const destination = "/home.php?mod=space&uid=31&do=album&quickforward=1&id=1";
  const native = answer(
    `<div id="messagetext" class="alert_info"><p>图片上传成功</p><p class="alert_btnleft"><a href="${destination.replaceAll("&", "&amp;")}">Continue</a></p></div>`,
    "text/html",
  );
  const j = journey(albumForm, albumUpload("19"), native);
  const form = await prepareAlbum(j);
  const upload = await j.client.uploadAlbumImage(form, file);
  const result = await j.client.fileAlbumImages(form, [upload.picture], {
    kind: "existing",
    albumId: "1",
  });
  check(
    "native album acknowledgement",
    [result.kind, result.destination, result.pictureIds],
    ["filed", origin + destination, ["19"]],
  );
  j.done();
}
{
  const dest = "/home.php?mod=space&uid=31&do=album&quickforward=1&id=1";
  const j = journey(albumForm, albumUpload("20"), redirect(dest));
  const form = await prepareAlbum(j);
  const upload = await j.client.uploadAlbumImage(form, file);
  const result = await j.client.fileAlbumImages(form, [upload.picture], {
    kind: "existing",
    albumId: "1",
  });
  check(
    "album redirect provides a continuation with unknown effect",
    [
      result.kind,
      result.effect,
      result.destination,
      result.pictureIds,
      j.calls.length,
    ],
    ["filing-handoff", "unknown", origin + dest, ["20"], 3],
  );
  j.done();
}
{
  const stale = await journey(
    answer("", "text/html", { status: 302, redirect: "followed" }),
  ).client.downloadAttachment(download(aid36));
  check(
    "automatically followed attachment response is rejected",
    stale.kind,
    "invalid",
  );
  const j = journey(
    answer(picture, "image/jpeg", {
      headers: { "Content-Length": String(picture.length + 1) },
    }),
  );
  const partial = await j.client.downloadAttachment(download(aid36));
  check(
    "length mismatch never hands out the partial body",
    [partial.kind, typeof partial.bytes],
    ["invalid", "undefined"],
  );
  j.done();
}
{
  const j = journey(redirect(download(aid36) + "&nothumb=yes"), jpeg);
  const r = await j.client.downloadAttachment(
    "http://www.forum.test" + download(aid36),
  );
  check(
    "legacy forum alias is canonicalized and same-attachment hops retain the session",
    [
      r.kind,
      j.calls.map((call) => [call.url.origin, call.session.memberId]),
      j.calls[1].url.searchParams.get("nothumb"),
    ],
    [
      "delivered",
      [
        [origin, "31"],
        [origin, "31"],
      ],
      "yes",
    ],
  );
  j.done();
}
console.log(JSON.stringify(results));
