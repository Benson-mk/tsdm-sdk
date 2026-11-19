import {
  forumURL,
  header,
  invalid,
  json,
  numericId,
  positive,
  record,
  refused,
  sessionChanged,
  text,
  unknown,
  type MediaHost,
} from "./host.js";
import type {
  MediaFile,
  MediaSession,
  PostImageForm,
  PostImageOpen,
  PostImageUpload,
} from "./types.js";

export type Uploader = {
  url: URL;
  hash: string;
  extensions: string[];
  maxBytes?: number;
};
type PostAuthority = Uploader & { owner: MediaSession };
export const hashOf = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9]{8,128}$/.test(value)
    ? value
    : null;
export const limits = (raw: unknown, maxKb: unknown, maxBytes?: unknown) => {
  const extensions =
    typeof raw === "string"
      ? raw
          .split(";")
          .map((item) =>
            item
              .trim()
              .replace(/^\*?\./, "")
              .toLowerCase(),
          )
          .filter(Boolean)
      : [];
  if (extensions.some((ext) => !/^[a-z0-9]+$/.test(ext))) return null;
  const candidates = [
    typeof maxKb === "number" ? maxKb * 1024 : 0,
    maxBytes,
  ].filter(
    (n): n is number =>
      typeof n === "number" && Number.isSafeInteger(n) && n > 0,
  );
  return {
    extensions,
    ...(candidates.length ? { maxBytes: Math.min(...candidates) } : {}),
  };
};
const imageTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  avif: "image/avif",
};
export function imagePart(file: MediaFile, uploader: Uploader) {
  if (
    !file ||
    typeof file.filename !== "string" ||
    /[\x00-\x1f\x7f/\\"]/u.test(file.filename) ||
    !(file.bytes instanceof Uint8Array) ||
    !file.bytes.length
  )
    return null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.filename)?.[1]?.toLowerCase() ?? "";
  if (
    !Object.hasOwn(imageTypes, ext) ||
    (uploader.extensions.length && !uploader.extensions.includes(ext)) ||
    file.contentType !== imageTypes[ext] ||
    (uploader.maxBytes !== undefined && file.bytes.length > uploader.maxBytes)
  )
    return null;
  return {
    field: "Filedata" as const,
    filename: file.filename,
    contentType: file.contentType,
    bytes: new Uint8Array(file.bytes),
  };
}

function editorURL(raw: string, base: URL) {
  const url = forumURL(raw, base, "/forum.php");
  if (!url) return null;
  const q = url.searchParams;
  const action = q.get("action");
  const thread = positive(q.get("tid")),
    post = positive(q.get("pid"));
  if (
    q.get("mod") !== "post" ||
    !positive(q.get("fid")) ||
    !["newthread", "reply", "edit"].includes(action ?? "") ||
    (action === "edit" && (!thread || !post)) ||
    (action === "reply" && (!thread || q.has("pid"))) ||
    (action === "newthread" && (q.has("tid") || q.has("pid"))) ||
    [...q.keys()].some(
      (k) =>
        ![
          "mod",
          "action",
          "fid",
          "tid",
          "pid",
          "page",
          "reppost",
          "repquote",
          "extra",
          "special",
          "topicsubmit",
        ].includes(k),
    ) ||
    q.has("topicsubmit")
  )
    return null;
  return url;
}
function postUploader(
  url: URL,
  data: Record<string, unknown>,
  uid: string,
): Uploader | null {
  const attach = record(data.attach),
    upload = record(attach?.upload);
  const hash = hashOf(upload?.hash);
  const dest = forumURL(upload?.url, url, "/misc.php");
  if (
    !hash ||
    !dest ||
    numericId(upload?.uid) !== uid ||
    attach?.image !== 1 ||
    upload?.image !== 1 ||
    dest.searchParams.get("mod") !== "swfupload" ||
    dest.searchParams.get("action") !== "swfupload" ||
    dest.searchParams.get("operation") !== "upload" ||
    dest.searchParams.get("fid") !== url.searchParams.get("fid") ||
    [...dest.searchParams.keys()].some(
      (key) => !["mod", "action", "operation", "fid"].includes(key),
    )
  )
    return null;
  const qualified = limits(upload.image_exts, upload.max_kb, attach.maxsize);
  if (!qualified) return null;
  dest.searchParams.set("type", "image");
  dest.searchParams.set("simple", "2");
  return { url: dest, hash, ...qualified };
}
function uploadID(body: string) {
  if (/^[1-9]\d*$/.test(body)) return { id: body };
  if (/^-[1-9]\d*$/.test(body)) return { code: body.slice(1) };
  const [prefix, type, error, aid, isImage] = body.split("|");
  if (
    prefix !== "DISCUZUPLOAD" ||
    type !== "1" ||
    !error ||
    !/^\d+$/.test(error)
  )
    return null;
  if (error !== "0") return { code: error };
  return isImage === "1" && positive(aid) ? { id: aid } : null;
}

export function createUploads(host: MediaHost) {
  const postForms = new WeakMap<PostImageForm, PostAuthority>();
  return {
    async openPostUpload(editor: string): Promise<PostImageOpen> {
      const source = editorURL(editor, host.origin);
      if (!source)
        return invalid("Select a same-origin post editor destination.");
      const owner = host.session();
      if (!owner || owner.memberId === "0")
        return refused("Sign in to open a post uploader.");
      const page = new URL(source.href);
      page.searchParams.set("tsdmapp", "json");
      page.searchParams.set("nodoc", "1");
      const result = await host.request(page, owner);
      if (result.kind !== "response") return result;
      const { response } = result;
      if ([401, 403, 404, 429].includes(response.status))
        return refused(
          "The forum declined the editor request.",
          String(response.status),
        );
      if (response.status !== 200)
        return invalid("The post editor was unavailable.");
      const data = json(text(response));
      if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
        return sessionChanged;
      if (
        data?.ok === 0 &&
        !["off", "action", "unknown"].includes(String(data.error))
      )
        return refused(
          typeof data.message === "string"
            ? data.message
            : "The forum refused the post editor.",
        );
      if (data?.ok === 1 && data.type === "post" && data.schema === 16) {
        if (
          data.action !== source.searchParams.get("action") ||
          numericId(data.fid) !== source.searchParams.get("fid") ||
          ["tid", "pid"].some(
            (k) =>
              source.searchParams.has(k) &&
              numericId(data[k]) !== source.searchParams.get(k),
          )
        )
          return invalid("The forum returned a different post editor.");
        if (numericId(data.uid) !== owner.memberId) return sessionChanged;
        const attach = record(data.attach);
        if (attach?.image === 0)
          return refused("The editor does not offer image uploads.");
        const upload = postUploader(source, data, owner.memberId);
        if (upload) {
          const form = Object.freeze({
            editorURL: source.href,
            extensions: Object.freeze([...upload.extensions]),
            ...(upload.maxBytes !== undefined
              ? { maxBytes: upload.maxBytes }
              : {}),
          });
          postForms.set(form, { ...upload, owner });
          return { kind: "post-upload", form };
        }
      }
      return {
        kind: "browser-handoff",
        reason: "unsupported-editor",
        destination: source.href,
        message: "Open the native editor to use its uploader.",
      };
    },
    async uploadPostImage(
      form: PostImageForm,
      file: MediaFile,
    ): Promise<PostImageUpload> {
      const upload = postForms.get(form);
      if (!upload) return invalid("Open a fresh post upload form.");
      if (!host.current(upload.owner)) return sessionChanged;
      const part = imagePart(file, upload);
      if (!part)
        return invalid(
          "The image does not match the uploader's type or size limits.",
        );
      postForms.delete(form);
      const result = await host.request(upload.url, upload.owner, {
        method: "POST",
        effect: true,
        multipart: {
          fields: { uid: upload.owner.memberId, hash: upload.hash },
          file: part,
        },
      });
      if (result.kind !== "response") return result;
      const { response } = result;
      if (response.status === 413 || response.status === 415)
        return refused("The forum rejected the file.", String(response.status));
      const receipt =
        response.status === 200 ? uploadID(text(response).trim()) : null;
      if (receipt?.code)
        return refused("The forum uploader rejected the image.", receipt.code);
      if (!receipt?.id)
        return unknown("The uploader did not establish an attachment ID.");
      return {
        kind: "uploaded",
        attachmentId: receipt.id,
        bbcode: `[attachimg]${receipt.id}[/attachimg]`,
      };
    },
  };
}
