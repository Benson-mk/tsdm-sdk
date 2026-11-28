import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  label,
} from "../html.js";
import { fileFailure } from "../download.js";
import {
  forumURL,
  header,
  invalid,
  positive,
  refused,
  sessionChanged,
  text,
  unknown,
  type MediaHost,
} from "./host.js";
import type {
  AttachmentCredit,
  AttachmentCreditOffer,
  AttachmentRead,
  AttachmentResume,
  ExternalMediaHandoff,
  MediaDelivery,
  MediaFailure,
  MediaResponse,
  MediaSession,
} from "./types.js";

export function resourceURL(raw: unknown, base: URL, forum: URL) {
  if (typeof raw !== "string" || !raw.trim() || /[\x00-\x1f\x7f\\]/.test(raw))
    return null;
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  // Native attachment links sometimes use HTTP or omit www on this same forum.
  if (
    !url.port &&
    !forum.port &&
    ["https:", "http:"].includes(url.protocol) &&
    url.hostname.replace(/^www\./, "") === forum.hostname.replace(/^www\./, "")
  ) {
    const canonical = new URL(forum.href);
    canonical.pathname = url.pathname;
    canonical.search = url.search;
    return canonical;
  }
  return url.protocol === "https:" ? url : null;
}
export const external = (url: URL): ExternalMediaHandoff => ({
  kind: "external-handoff",
  destination: url.href,
  method: "GET",
  credentials: "omit",
  referrerPolicy: "no-referrer",
  redirect: "manual",
});
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
export const redirect = (r: MediaResponse) => redirectStatuses.has(r.status);
const memberPermission = new Set([401, 403, 404, 410, 429]);
function attachmentID(
  aid: string,
): { attachmentId: string; memberId?: string; threadId?: string } | null {
  if (/^[1-9]\d*$/.test(aid)) return { attachmentId: aid };
  if (!/^[A-Za-z0-9_+/-]{1,600}={0,2}$/.test(aid) || aid.length % 4 === 1)
    return null;
  try {
    const fields = atob(aid.replaceAll("-", "+").replaceAll("_", "/")).split(
      "|",
    );
    const [attachmentId, key, stamp, memberId, threadId] = fields;
    if (
      fields.length !== 5 ||
      !attachmentId ||
      !positive(attachmentId) ||
      !key ||
      !stamp ||
      !/^\d+$/.test(stamp) ||
      !memberId ||
      !/^\d+$/.test(memberId) ||
      !threadId ||
      !positive(threadId)
    )
      return null;
    return { attachmentId, memberId, threadId };
  } catch {
    return null;
  }
}
export function attachment(url: URL, origin: URL) {
  if (
    !forumURL(url.href, origin, "/forum.php") ||
    url.searchParams.get("mod") !== "attachment" ||
    [...url.searchParams.keys()].some(
      (k) => !["mod", "aid", "ck", "nothumb", "noupdate"].includes(k),
    )
  )
    return null;
  return attachmentID(url.searchParams.get("aid") ?? "");
}
function special(url: URL, origin: URL, action: "attachcredit" | "attachpay") {
  const q = url.searchParams,
    aid = q.get("aid"),
    key = action === "attachcredit" ? "formhash" : "tid";
  const field = q.get(key);
  if (
    !forumURL(url.href, origin, "/forum.php") ||
    q.get("mod") !== "misc" ||
    q.get("action") !== action ||
    !aid ||
    !positive(aid) ||
    !field ||
    !(action === "attachpay"
      ? positive(field)
      : /^[a-zA-Z0-9]{6,128}$/.test(field)) ||
    [...q.keys()].some((k) => !["mod", "action", "aid", key].includes(k))
  )
    return null;
  return { aid, tid: action === "attachpay" ? field : null };
}
function nativeMessage(r: MediaResponse) {
  if (
    !/^(?:text\/html|application\/xhtml\+xml|(?:text|application)\/xml)/i.test(
      r.contentType,
    ) &&
    r.bytes[0] !== 60
  )
    return null;
  const body = text(r);
  const html =
    /^\s*(?:<\?xml[^?]*\?>\s*)?<root>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/root>\s*$/.exec(
      body,
    )?.[1] ?? body;
  const doc = documentFrom(html);
  const scope =
    byId(doc, "messagetext") ??
    descendants(doc, (n) =>
      ["alert_info", "alert_right", "alert_error"].some((cls) =>
        hasClass(n, cls),
      ),
    )[0];
  if (!scope) return null;
  const paragraph = descendants(scope, (n) => n.tagName === "p")[0];
  return {
    message: label(paragraph ?? scope),
    error: hasClass(scope, "alert_error"),
    links: descendants(
      scope,
      (n) => n.tagName === "a" && Boolean(attr(n, "href")),
    ).map((n) => attr(n, "href")),
  };
}
function filenameOf(disposition: string) {
  const name =
    /\bfilename\*\s*=\s*UTF-8'[^']*'([^;]+)/i.exec(disposition)?.[1] ??
    /\bfilename\s*=\s*(?:"([^"]*)"|([^;]+))/i
      .exec(disposition)
      ?.slice(1)
      .find(Boolean);
  if (!name) return undefined;
  let value = name.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* Keep a literal percent sequence. */
  }
  value = value
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .trim()
    .replace(/^\.+|[ .]+$/g, "");
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(value))
    value = "_" + value;
  return value ? Array.from(value).slice(0, 180).join("") : undefined;
}
export function delivered(
  r: MediaResponse,
  mode: "attachment" | "media",
): MediaFailure | MediaDelivery {
  const disposition = header(r, "content-disposition") ?? "";
  if (memberPermission.has(r.status))
    return refused(
      "The forum declined access to this resource.",
      String(r.status),
    );
  const mime = r.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  // An image SVG is markup, so only ordinary media URLs with an explicit image MIME can serve it.
  const svg =
    mode === "media" &&
    mime === "image/svg+xml" &&
    /^\s*(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|>)/i.test(
      new TextDecoder().decode(r.bytes.subarray(0, 1500)),
    );
  const failure = fileFailure(
    {
      status: r.status,
      url: r.url,
      contentType: r.contentType,
      contentLength: header(r, "content-length") ?? null,
      contentEncoding: header(r, "content-encoding") ?? "",
      disposition,
      redirected: r.redirect !== "none",
      bytes: r.bytes,
    },
    { allowSvg: svg },
  );
  if (failure)
    return failure.kind === "invalid"
      ? invalid(failure.message)
      : refused(failure.message, failure.kind);
  if (mode === "media" && !/^(?:image|audio|video)\//.test(mime))
    return invalid("The response did not identify media bytes.");
  if (
    mode === "attachment" &&
    !/^(?:attachment|inline)(?:\s*;|$)/i.test(disposition) &&
    !(
      /^(?:image|audio|video)\//.test(mime) ||
      /^application\/(?:octet-stream|pdf|zip|x-[a-z0-9-]+)$/.test(mime)
    )
  )
    return invalid("The forum did not establish a file response.");
  const filename = filenameOf(disposition);
  return {
    kind: "delivered",
    sourceURL: r.url,
    contentType: r.contentType,
    bytes: r.bytes,
    ...(filename ? { filename } : {}),
  };
}

type AttachmentIdentity = NonNullable<ReturnType<typeof attachmentID>>;
type OfferData = {
  url: URL;
  originating: URL;
  owner: MediaSession;
  identity: AttachmentIdentity;
};
type ResumeData = {
  url: URL;
  owner: MediaSession;
  identity: AttachmentIdentity;
};
const sameAttachment = (a: AttachmentIdentity, b: AttachmentIdentity) =>
  a.attachmentId === b.attachmentId &&
  (!a.threadId || a.threadId === b.threadId) &&
  (!a.memberId || a.memberId === b.memberId);
export const purchaseHandoff = (url: URL) =>
  ({
    kind: "browser-handoff",
    destination: url.href,
    reason: "purchase",
    message: "Open the purchase page in the native forum to review the price.",
  }) as const;

export function createAttachmentRetrieval(host: MediaHost) {
  const offers = new WeakMap<AttachmentCreditOffer, OfferData>();
  const resumes = new WeakMap<AttachmentResume, ResumeData>();
  function qualifiedPurchase(url: URL, id: AttachmentIdentity) {
    const pay = special(url, host.origin, "attachpay");
    return (
      pay &&
      pay.aid === id.attachmentId &&
      (!id.threadId || pay.tid === id.threadId)
    );
  }
  async function lookup(
    first: URL,
    owner: MediaSession,
    identity: AttachmentIdentity,
    charged = false,
  ): Promise<AttachmentRead> {
    let url = first;
    const seen = new Set<string>();
    while (seen.size < 5 && !seen.has(url.href)) {
      seen.add(url.href);
      const result = await host.request(url, owner);
      if (result.kind !== "response") return result;
      const { response: r } = result;
      if (redirect(r)) {
        const next = resourceURL(header(r, "location"), url, host.origin);
        if (!next)
          return invalid("The forum did not provide a usable redirect.");
        if (next.origin !== host.origin.origin) return external(next);
        if (qualifiedPurchase(next, identity)) return purchaseHandoff(next);
        const credit = special(next, host.origin, "attachcredit");
        if (credit?.aid === identity.attachmentId) {
          if (charged)
            return invalid(
              "The credit continuation expired or requested another charge.",
            );
          if (owner.memberId === "0")
            return refused("Sign in to review the attachment credit action.");
          const offer = Object.freeze({
            attachmentId: identity.attachmentId,
            ...(identity.threadId ? { threadId: identity.threadId } : {}),
          });
          offers.set(offer, { url: next, originating: url, owner, identity });
          return { kind: "credit-required", offer };
        }
        if (
          next.pathname === "/member.php" &&
          next.searchParams.get("action") === "login"
        )
          return refused("Sign in to retrieve the attachment.", "login");
        const matched = attachment(next, host.origin);
        if (
          !matched ||
          !sameAttachment(identity, matched) ||
          (matched.memberId && matched.memberId !== owner.memberId)
        )
          return invalid("The redirect did not preserve the attachment.");
        url = next;
        continue;
      }
      const notice = nativeMessage(r);
      if (notice) {
        const links = notice.links
          .map((raw) => resourceURL(raw, url, host.origin))
          .filter((link): link is URL =>
            Boolean(link && qualifiedPurchase(link, identity)),
          );
        if (
          r.status === 200 &&
          /需要付费|付费后下载/.test(notice.message) &&
          links.length === 1
        )
          return purchaseHandoff(links[0]!);
        return refused(notice.message || "The forum declined download.");
      }
      return delivered(r, "attachment");
    }
    return invalid("The attachment redirect limit was reached.");
  }
  return {
    async downloadAttachment(source: string): Promise<AttachmentRead> {
      const url = resourceURL(source, host.origin, host.origin);
      if (!url || url.origin !== host.origin.origin)
        return invalid("Select the attachment link supplied by the forum.");
      if (special(url, host.origin, "attachpay")) return purchaseHandoff(url);
      const identity = attachment(url, host.origin);
      if (!identity)
        return invalid(
          "Select the attachment download link supplied by the forum.",
        );
      const owner = host.session();
      if (!owner || (identity.memberId && identity.memberId !== owner.memberId))
        return sessionChanged;
      return lookup(url, owner, identity, Boolean(url.searchParams.get("ck")));
    },
    async confirmAttachmentCredit(
      offer: AttachmentCreditOffer,
    ): Promise<AttachmentCredit> {
      const saved = offers.get(offer);
      if (!saved) return invalid("Select an unused attachment credit offer.");
      if (!host.current(saved.owner)) return sessionChanged;
      offers.delete(offer);
      const result = await host.request(saved.url, saved.owner, {
        method: "GET",
        effect: true,
      });
      if (result.kind !== "response") return result;
      const { response: r } = result;
      const notice = nativeMessage(r);
      if (memberPermission.has(r.status) || notice?.error)
        return refused(
          notice?.message || "The forum declined the credit action.",
        );
      if (r.status !== 200 || !notice || !/现在将开始下载/.test(notice.message))
        return unknown(
          "The forum did not establish whether credits were taken.",
        );
      const found = notice.links
        .map((raw) => resourceURL(raw, saved.url, host.origin))
        .filter((url): url is URL => {
          if (!url || !url.searchParams.get("ck")) return false;
          const target = attachment(url, host.origin);
          return Boolean(
            target &&
            sameAttachment(saved.identity, target) &&
            url.searchParams.get("aid") ===
              saved.originating.searchParams.get("aid"),
          );
        });
      if (found.length !== 1)
        return unknown(
          "The forum reported a charge page without a matching download continuation.",
        );
      const resume = Object.freeze({
        attachmentId: offer.attachmentId,
        ...(offer.threadId ? { threadId: offer.threadId } : {}),
      });
      resumes.set(resume, {
        url: found[0]!,
        owner: saved.owner,
        identity: saved.identity,
      });
      return { kind: "credit-confirmed", message: notice.message, resume };
    },
    async resumeAttachment(resume: AttachmentResume): Promise<AttachmentRead> {
      const saved = resumes.get(resume);
      if (!saved)
        return invalid(
          "Select a continuation from an acknowledged credit action.",
        );
      if (!host.current(saved.owner)) return sessionChanged;
      return lookup(saved.url, saved.owner, saved.identity, true);
    },
  };
}
