import {
  header,
  invalid,
  json,
  numericId,
  positive,
  record,
  refused,
  sessionChanged,
  text,
  type MediaHost,
} from "./host.js";
import { delivered, external, redirect, resourceURL } from "./retrieval.js";
import type {
  MediaRead,
  MediaSession,
  Smiley,
  SmileyCatalogue,
  SmileyGroup,
  SmileyScript,
} from "./types.js";

const string = (v: unknown) => (typeof v === "string" ? v : "");
const singletonKeys = (url: URL) =>
  new Set(url.searchParams.keys()).size === [...url.searchParams.keys()].length;
const avatarPath = (path: string) =>
  /^\/data\/avatar\//.test(path) ||
  /^\/uc_server\/(?:avatar\.php|images\/noavatar_(?:small|middle|big)\.gif)$/.test(
    path,
  );
const resourceExtension =
  /\.(?:avif|bmp|gif|heic|ico|jpe?g|png|svg|webp|m4a|aac|flac|mp3|oga|ogg|wav|m4v|mov|mp4|ogv|webm)$/i;
function nativeMedia(url: URL) {
  if (!singletonKeys(url) || /%2f|%5c|%00/i.test(url.pathname)) return false;
  const q = url.searchParams;
  if (url.pathname === "/forum.php")
    return (
      q.get("mod") === "image" &&
      Boolean(positive(q.get("aid"))) &&
      [...q.keys()].every((k) =>
        ["mod", "aid", "size", "key", "type", "noupdate"].includes(k),
      )
    );
  if (url.pathname === "/uc_server/avatar.php")
    return (
      Boolean(positive(q.get("uid"))) &&
      [...q.keys()].every((k) => ["uid", "size", "type"].includes(k))
    );
  return (
    /^(?:\/data\/(?:attachment|avatar)\/|\/static\/(?:image|audio|video)\/|\/uc_server\/images\/)/.test(
      url.pathname,
    ) && resourceExtension.test(url.pathname)
  );
}
function smileyURL(value: string, base: URL) {
  const url = resourceURL(value, base, base);
  return url &&
    url.origin === base.origin &&
    /^\/static\/image\/smiley\//.test(url.pathname) &&
    nativeMedia(url)
    ? url.href
    : null;
}
function pluginCatalogue(
  data: Record<string, unknown>,
  base: URL,
): SmileyCatalogue | null {
  const version = string(data.version);
  if (
    data.ok !== 1 ||
    !version ||
    !Array.isArray(data.types) ||
    !Array.isArray(data.smilies) ||
    data.count !== data.smilies.length
  )
    return null;
  const groups: SmileyGroup[] = [];
  for (const raw of data.types) {
    const row = record(raw),
      id = positive(row?.typeid),
      name = string(row?.name),
      directory = string(row?.directory);
    if (!id || !name || !directory || groups.some((group) => group.id === id))
      return null;
    groups.push({ id, name, directory });
  }
  const items: Smiley[] = [];
  const ids = new Set<string>();
  for (const raw of data.smilies) {
    const row = record(raw),
      id = positive(row?.id),
      groupId = positive(row?.typeid),
      code = string(row?.code),
      url = smileyURL(string(row?.url), base);
    if (
      !id ||
      ids.has(id) ||
      !groupId ||
      !groups.some((group) => group.id === groupId) ||
      !url ||
      !code
    )
      return null;
    ids.add(id);
    items.push({ id, groupId, code, url });
  }
  return { kind: "smileys", source: "plugin", version, groups, items };
}
function scriptCatalogue(script: string, base: URL): SmileyCatalogue | null {
  const groups: SmileyGroup[] = [];
  for (const match of script.matchAll(
    /\bsmilies_type\['_([1-9]\d*)'\]\s*=\s*\['([^']+)',\s*'([a-zA-Z0-9_-]+)'\]/g,
  )) {
    const [, , name, directory] = match,
      id = match[1]!;
    if (groups.some((row) => row.id === id)) return null;
    groups.push({ id, name: name!, directory: directory! });
  }
  const items: Smiley[] = [];
  const pages = new Set<string>(),
    ids = new Set<string>();
  for (const match of script.matchAll(
    /\bsmilies_array\[([1-9]\d*)\]\[([1-9]\d*)\]\s*=\s*\[([^\r\n]*?)\];/g,
  )) {
    const [, groupId, page, raw] = match;
    const group = groups.find((row) => row.id === groupId);
    const pageKey = `${groupId}:${page}`;
    if (pages.has(pageKey) || !group) return null;
    pages.add(pageKey);
    if (!raw?.trim()) continue;
    const row =
      /\['([1-9]\d*)',\s*'((?:\\['\\]|[^'\\])*)',\s*'([^']+)',\s*'\d+',\s*'\d+',\s*'\d+'\]/gy;
    let cursor = 0;
    while (cursor < raw.length) {
      row.lastIndex = cursor;
      const m = row.exec(raw);
      if (!m) return null;
      const [, id, coded, filename] = m;
      if (
        !id ||
        ids.has(id) ||
        !coded ||
        !filename ||
        /[\/\\\x00-\x1f]/.test(filename)
      )
        return null;
      const url = smileyURL(
        `/static/image/smiley/${group.directory}/${encodeURIComponent(filename)}`,
        base,
      );
      if (!url) return null;
      items.push({
        id,
        groupId: group.id,
        code: coded.replace(/\\(['\\])/g, "$1"),
        url,
      });
      ids.add(id);
      cursor = row.lastIndex;
      if (cursor < raw.length) {
        const separator = /^,\s*/.exec(raw.slice(cursor));
        if (!separator) return null;
        cursor += separator[0].length;
      }
    }
  }
  const expectedPages = [
    ...script.matchAll(/\bsmilies_array\[\d+\]\[\d+\]\s*=/g),
  ].length;
  return groups.length && items.length && pages.size === expectedPages
    ? { kind: "smileys", source: "script", groups, items }
    : null;
}
export function createMediaResources(host: MediaHost) {
  const scriptURL = new URL("/data/cache/common_smilies_var.js", host.origin);
  const fallback = new URL("/data/avatar/noavatar.svg", host.origin);
  async function script(owner: MediaSession): Promise<SmileyScript> {
    const result = await host.request(scriptURL, owner);
    if (result.kind !== "response") return result;
    const r = result.response;
    if ([401, 403, 404, 429].includes(r.status))
      return refused("The forum declined the smiley script.", String(r.status));
    const body = text(r);
    if (
      r.status !== 200 ||
      !/(?:javascript|ecmascript|text\/plain)/i.test(r.contentType) ||
      !/^\s*(?:var\s+smthumb\s*=|var\s+smilies_type\s*=)/.test(body) ||
      body.length > 1_500_000
    )
      return invalid("The forum did not establish the smiley script.");
    return { kind: "script", sourceURL: scriptURL.href, script: body };
  }
  async function fetch(
    url: URL,
    owner: MediaSession,
    avatar = false,
  ): Promise<MediaRead> {
    const seen = new Set<string>();
    while (seen.size < 5 && !seen.has(url.href)) {
      if (url.origin !== host.origin.origin) return external(url);
      if (!nativeMedia(url) || (avatar && !avatarPath(url.pathname)))
        return invalid("Select a supported forum media link.");
      seen.add(url.href);
      const requested = await host.request(url, owner);
      if (requested.kind !== "response") return requested;
      const r = requested.response;
      if (redirect(r)) {
        const next = resourceURL(header(r, "location"), url, host.origin);
        if (!next)
          return invalid("The forum did not provide a usable media redirect.");
        url = next;
        continue;
      }
      if (avatar && [404, 410].includes(r.status) && !seen.has(fallback.href)) {
        url = fallback;
        continue;
      }
      return delivered(r, "media");
    }
    return invalid("The media redirect limit was reached.");
  }
  return {
    async readSmileys(): Promise<SmileyCatalogue> {
      const owner = host.session();
      if (!owner) return sessionChanged;
      const url = new URL(
        "/plugin.php?id=tsdmapp%3Aapi&action=smilies",
        host.origin,
      );
      const result = await host.request(url, owner);
      if (result.kind !== "response") return result;
      const r = result.response;
      const data =
        r.status === 200 && /json/i.test(r.contentType) ? json(text(r)) : null;
      if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
        return sessionChanged;
      if (
        [401, 403, 429].includes(r.status) ||
        (data?.ok === 0 &&
          !["action", "off", "unknown"].includes(string(data.error)))
      )
        return refused(
          string(data?.message) || "The forum declined the smiley catalogue.",
        );
      if (data) {
        const catalogue = pluginCatalogue(data, host.origin);
        if (catalogue) return catalogue;
      }
      if (r.status !== 200 && r.status !== 404)
        return invalid("The smiley catalogue was unavailable.");
      const legacy = await script(owner);
      return legacy.kind === "script"
        ? (scriptCatalogue(legacy.script, host.origin) ??
            invalid(
              "The script did not establish a complete smiley catalogue.",
            ))
        : legacy;
    },
    async readSmileyScript(): Promise<SmileyScript> {
      const owner = host.session();
      return owner ? script(owner) : sessionChanged;
    },
    async readMedia(source: string): Promise<MediaRead> {
      const url = resourceURL(source, host.origin, host.origin);
      const owner = host.session();
      if (!url) return invalid("Select a usable media URL from the forum.");
      return owner ? fetch(url, owner) : sessionChanged;
    },
    async readAvatar(source?: string): Promise<MediaRead> {
      const url =
        source === undefined
          ? fallback
          : resourceURL(source, host.origin, host.origin);
      const owner = host.session();
      if (!url) return invalid("Select a usable avatar URL from the forum.");
      return owner ? fetch(url, owner, true) : sessionChanged;
    },
  };
}
