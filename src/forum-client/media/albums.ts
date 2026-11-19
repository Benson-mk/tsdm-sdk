import {
  attr,
  byId,
  children,
  controlDisabled,
  descendants,
  documentFrom,
  hasClass,
  label,
  type Node,
} from "../html.js";
import { accountFrom } from "../read-thread.js";
import {
  forumURL,
  header,
  invalid,
  json,
  numericId,
  positive,
  refused,
  sessionChanged,
  text,
  unknown,
  type MediaHost,
} from "./host.js";
import { hashOf, imagePart, limits, type Uploader } from "./uploads.js";
import type {
  AlbumFiling,
  AlbumOpen,
  AlbumOption,
  AlbumPicture,
  AlbumTarget,
  AlbumUpload,
  AlbumUploadForm,
  MediaFile,
  MediaResponse,
  MediaSession,
} from "./types.js";

const scripts = (root: Node) =>
  descendants(root, (n) => n.tagName === "script" && !attr(n, "src")).map((n) =>
    children(n)
      .map((c) => ("value" in c ? c.value : ""))
      .join(""),
  );
function matchOnce(value: string, pattern: RegExp) {
  const matches = [...value.matchAll(pattern)];
  return matches.length === 1 ? matches[0] : undefined;
}
function choices(form: Node, name: string) {
  const lists = descendants(
    form,
    (n) =>
      n.tagName === "select" && attr(n, "name") === name && !controlDisabled(n),
  );
  if (lists.length !== 1) return [];
  return descendants(
    lists[0]!,
    (n) => n.tagName === "option" && !controlDisabled(n),
  )
    .map((n) => Object.freeze({ value: attr(n, "value"), label: label(n) }))
    .filter((item) => item.label);
}
function albumForm(source: URL, body: string, owner: string) {
  const doc = documentFrom(body);
  const nativeAccount = accountFrom(doc, source.href);
  const scriptUid = matchOnce(
    scripts(doc).join("\n"),
    /\bdiscuz_uid\s*=\s*['"](\d+)['"]/g,
  )?.[1];
  if (
    nativeAccount.kind === "guest" ||
    (scriptUid !== undefined && scriptUid !== owner) ||
    (nativeAccount.kind === "member" && nativeAccount.id !== owner)
  )
    return sessionChanged;
  const refusal = descendants(
    doc,
    (n) => hasClass(n, "alert_error") || attr(n, "id") === "messagetext",
  )[0];
  if (refusal && label(refusal)) return refused(label(refusal));
  if (nativeAccount.kind !== "member" && scriptUid !== owner) return null;
  const forms = descendants(
    doc,
    (n) => n.tagName === "form" && attr(n, "id") === "albumform",
  );
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    attr(form, "method").toLowerCase() !== "post"
  )
    return null;
  const save = forumURL(attr(form, "action"), source, "/home.php");
  if (
    !save ||
    save.searchParams.get("mod") !== "spacecp" ||
    save.searchParams.get("ac") !== "upload" ||
    [...save.searchParams.keys()].length !== 2
  )
    return null;
  const hidden = descendants(
    form,
    (n) =>
      n.tagName === "input" &&
      attr(n, "type") === "hidden" &&
      !controlDisabled(n),
  );
  const tokens = hidden.filter((n) => attr(n, "name") === "formhash");
  const markers = hidden.filter(
    (n) => attr(n, "name") === "albumsubmit" && attr(n, "value") === "true",
  );
  const formhash =
    tokens.length === 1 ? hashOf(attr(tokens[0]!, "value")) : null;
  if (!formhash || markers.length !== 1 || hidden.length !== 2) return null;
  const uploaderScripts = scripts(form).filter((s) =>
    /\bnew SWFUpload\s*\(/.test(s),
  );
  if (uploaderScripts.length !== 1) return null;
  const uploader = uploaderScripts[0]!;
  const dest = forumURL(
    matchOnce(uploader, /\bupload_url\s*:\s*["']([^"']+)["']/g)?.[1],
    source,
    "/misc.php",
  );
  const params = matchOnce(
    uploader,
    /\bpost_params\s*:\s*\{\s*["']uid["']\s*:\s*["'](\d+)["']\s*,\s*["']hash["']\s*:\s*["']([a-zA-Z0-9]+)["']\s*\}/g,
  );
  const hash = hashOf(params?.[2]);
  if (params && params[1] !== owner) return sessionChanged;
  if (
    !dest ||
    !hash ||
    dest.searchParams.get("mod") !== "swfupload" ||
    dest.searchParams.get("action") !== "swfupload" ||
    dest.searchParams.get("operation") !== "album" ||
    [...dest.searchParams.keys()].length !== 3
  )
    return null;
  const qualified = limits(
    matchOnce(uploader, /\bfile_types\s*:\s*["']([^"']+)["']/g)?.[1],
    Number(matchOnce(uploader, /\bfile_size_limit\s*:\s*["']?(\d+)/g)?.[1]),
  );
  if (!qualified?.extensions.length) return null;
  const albums = choices(form, "albumid").filter(
    (o) => numericId(o.value) !== null,
  );
  const privacy = choices(form, "friend").filter((o) =>
    /^[0-4]$/.test(o.value),
  );
  const modes = descendants(
    form,
    (n) =>
      n.tagName === "input" &&
      attr(n, "type") === "radio" &&
      attr(n, "name") === "albumop" &&
      !controlDisabled(n),
  ).map((n) => attr(n, "value"));
  const create =
    modes.includes("creatalbum") &&
    descendants(
      form,
      (n) =>
        n.tagName === "input" &&
        attr(n, "name") === "albumname" &&
        !controlDisabled(n),
    ).length === 1;
  const password =
    descendants(
      form,
      (n) =>
        n.tagName === "input" &&
        attr(n, "name") === "password" &&
        !controlDisabled(n),
    ).length === 1;
  save.searchParams.set("tsdmapp", "json");
  return {
    url: dest,
    hash,
    formhash,
    save,
    ...qualified,
    albums: modes.includes("selectalbum") ? albums : [],
    privacy: create ? privacy : [],
    password,
  };
}
type AlbumAuthority = Uploader & {
  owner: MediaSession;
  save: URL;
  formhash: string;
  albums: AlbumOption[];
  privacy: AlbumOption[];
  password: boolean;
};
function filingFields(form: AlbumAuthority, target: AlbumTarget) {
  if (
    target?.kind === "existing" &&
    form.albums.some((item) => item.value === target.albumId)
  )
    return { albumop: "selectalbum", albumid: target.albumId };
  if (
    target?.kind !== "create" ||
    typeof target.name !== "string" ||
    !target.name.trim() ||
    !["0", "1", "3", "4"].includes(target.privacy) ||
    !form.privacy.some((item) => item.value === target.privacy) ||
    (target.privacy === "4" &&
      (!form.password ||
        typeof target.password !== "string" ||
        !target.password.trim()))
  )
    return null;
  return {
    albumop: "creatalbum",
    albumname: target.name.trim(),
    depict: "",
    friend: target.privacy,
    ...(target.privacy === "4" ? { password: target.password! } : {}),
  };
}
function albumDestination(
  raw: unknown,
  form: AlbumAuthority,
  target: AlbumTarget,
) {
  const url = forumURL(raw, form.save, "/home.php");
  const q = url?.searchParams;
  const id = q?.get("id");
  if (
    !url ||
    !q ||
    !id ||
    q.get("mod") !== "space" ||
    q.get("uid") !== form.owner.memberId ||
    q.get("do") !== "album" ||
    [...q.keys()].some(
      (k) => !["mod", "do", "uid", "id", "quickforward"].includes(k),
    )
  )
    return null;
  if (
    target.kind === "existing"
      ? id !== (target.albumId === "0" ? "-1" : target.albumId)
      : !positive(id)
  )
    return null;
  return { destination: url.href, albumId: id };
}
function filingReceipt(
  response: MediaResponse,
  form: AlbumAuthority,
  target: AlbumTarget,
  pictureIds: string[],
): AlbumFiling {
  const unclear = {
    ...unknown("The forum did not establish filing to the selected album."),
    pictureIds,
  };
  if ([301, 302, 303].includes(response.status)) {
    const matched = albumDestination(
      header(response, "location"),
      form,
      target,
    );
    return matched
      ? {
          kind: "filing-handoff",
          effect: "unknown",
          destination: matched.destination,
          pictureIds,
        }
      : unclear;
  }
  if (response.status !== 200) return unclear;
  const body = text(response),
    data = json(body);
  if (data) {
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      numericId(data.uid) !== form.owner.memberId
    )
      return unclear;
    if (data.ok === 0 || data.login === 1 || data.alert === "error")
      return {
        ...refused(
          typeof data.message === "string"
            ? data.message
            : "The forum refused album filing.",
        ),
        pictureIds,
      };
    const matched = albumDestination(data.url, form, target);
    return data.ok === 1 &&
      ["upload_images_completed", "do_success"].includes(
        String(data.message_key),
      ) &&
      matched
      ? { kind: "filed", ...matched, pictureIds }
      : unclear;
  }
  if (!/^text\/html/i.test(response.contentType)) return unclear;
  const doc = documentFrom(body),
    account = accountFrom(doc, response.url);
  if (
    account.kind === "guest" ||
    (account.kind === "member" && account.id !== form.owner.memberId)
  )
    return unclear;
  const message = byId(doc, "messagetext");
  if (!message) return unclear;
  if (hasClass(message, "alert_error"))
    return { ...refused(label(message)), pictureIds };
  if (!hasClass(message, "alert_info") && !hasClass(message, "alert_right"))
    return unclear;
  const notice = label(descendants(message, (n) => n.tagName === "p")[0]);
  if (!/图片上传成功|圖片上傳成功|图片上传完成|圖片上傳完成/.test(notice))
    return unclear;
  const links = descendants(message, (n) => n.tagName === "a")
    .map((n) => albumDestination(attr(n, "href"), form, target))
    .filter((link) => link !== null);
  return links.length === 1
    ? { kind: "filed", ...links[0]!, pictureIds }
    : unclear;
}

export function createAlbums(host: MediaHost) {
  const forms = new WeakMap<AlbumUploadForm, AlbumAuthority>();
  const pictures = new WeakMap<AlbumPicture, AlbumUploadForm>();
  return {
    async openAlbumUpload(albumId?: string): Promise<AlbumOpen> {
      if (albumId !== undefined && numericId(albumId) !== albumId)
        return invalid("Invalid album ID.");
      const owner = host.session();
      if (!owner || owner.memberId === "0")
        return refused("Sign in to open the album uploader.");
      const source = new URL("/home.php?mod=spacecp&ac=upload", host.origin);
      if (albumId !== undefined) source.searchParams.set("albumid", albumId);
      const received = await host.request(source, owner);
      if (received.kind !== "response") return received;
      if ([401, 403, 404, 429].includes(received.response.status))
        return refused(
          "The forum declined the album form.",
          String(received.response.status),
        );
      if (received.response.status !== 200)
        return invalid("The album form was unavailable.");
      const found = albumForm(source, text(received.response), owner.memberId);
      if (!found)
        return {
          kind: "browser-handoff",
          reason: "unsupported-album",
          destination: source.href,
          message: "Open the native album uploader.",
        };
      if ("kind" in found) return found;
      const form = Object.freeze({
        sourceURL: source.href,
        extensions: Object.freeze([...found.extensions]),
        ...(found.maxBytes !== undefined ? { maxBytes: found.maxBytes } : {}),
        albums: Object.freeze([...found.albums]),
        privacy: Object.freeze([...found.privacy]),
      });
      forms.set(form, { ...found, owner });
      return { kind: "album-upload", form };
    },
    async uploadAlbumImage(
      form: AlbumUploadForm,
      file: MediaFile,
    ): Promise<AlbumUpload> {
      const entry = forms.get(form);
      if (!entry) return invalid("Open a current album form.");
      if (!host.current(entry.owner)) return sessionChanged;
      const part = imagePart(file, entry);
      if (!part)
        return invalid("The image does not match the album uploader's limits.");
      const result = await host.request(entry.url, entry.owner, {
        method: "POST",
        effect: true,
        multipart: {
          fields: { uid: entry.owner.memberId, hash: entry.hash },
          file: part,
        },
      });
      if (result.kind !== "response") return result;
      const data =
        result.response.status === 200 ? json(text(result.response)) : null;
      if (
        numericId(data?.picid) === "0" ||
        [413, 415].includes(result.response.status)
      )
        return refused("The uploader declined the album picture.");
      const pictureId = positive(data?.picid);
      if (!pictureId)
        return unknown("The uploader did not establish a picture ID.");
      const picture = Object.freeze({ pictureId, filename: part.filename });
      pictures.set(picture, form);
      return { kind: "uploaded", picture };
    },
    async fileAlbumImages(
      form: AlbumUploadForm,
      selected: readonly AlbumPicture[],
      target: AlbumTarget,
    ): Promise<AlbumFiling> {
      const entry = forms.get(form);
      if (
        !entry ||
        !selected.length ||
        selected.some((p) => pictures.get(p) !== form) ||
        new Set(selected.map((p) => p.pictureId)).size !== selected.length
      )
        return invalid(
          "Select unused picture receipts from this album uploader.",
        );
      if (!host.current(entry.owner)) return sessionChanged;
      const choice = { ...target };
      const fields = filingFields(entry, choice);
      if (!fields)
        return invalid("The album form did not offer those filing choices.");
      const uploadIds = selected.map((p) => p.pictureId);
      const body = new URLSearchParams({
        formhash: entry.formhash,
        albumsubmit: "true",
      });
      for (const pic of selected) {
        pictures.delete(pic);
        body.set(`title[${pic.pictureId}]`, "");
      }
      for (const [name, value] of Object.entries(fields)) body.set(name, value);
      const result = await host.request(entry.save, entry.owner, {
        method: "POST",
        effect: true,
        form: body.toString(),
      });
      if (result.kind !== "response")
        return { ...result, pictureIds: uploadIds };
      return filingReceipt(result.response, entry, choice, uploadIds);
    },
  };
}
