import {
  attr,
  byId,
  descendants,
  documentFrom,
  label,
  safeURL,
} from "./html.js";
import { decodeBoard } from "./read-board.js";
import { decodeThread } from "./read-thread.js";
import { cleanURL, routeFor } from "./routes.js";
import {
  decodeStructured,
  parseReadPayload,
  readAccount,
  structuredFailure,
  type StructuredRead,
} from "./structured-read.js";
import type { Account, ForumLink, HostResponse } from "./types.js";

const terminal = new Set([
  "limited",
  "login",
  "permission",
  "missing",
  "challenge",
]);

type NativeRead =
  ReturnType<typeof decodeBoard> | ReturnType<typeof decodeThread>;
export type PublicRead = StructuredRead | NativeRead;

export function failure(
  kind: "invalid" | "incomplete" | "network",
  message: string,
  sourceURL: string,
  account: Account = { kind: "unknown" },
) {
  return { kind, message, account, sourceURL };
}

export function readDocument(
  response: HostResponse,
  requested: NonNullable<ReturnType<typeof routeFor>>,
): PublicRead {
  const destination = requested.url.href;
  const payload = parseReadPayload(response);
  if (
    response.status === 429 ||
    response.status === 401 ||
    response.status === 404 ||
    response.status === 410
  ) {
    const fields = payload ?? {};
    return structuredFailure(fields, response, readAccount(fields))!;
  }
  const source = payload
    ? typeof payload.document === "string"
      ? payload.document
      : ""
    : response.body;
  const doc = documentFrom(source);
  const title = label(descendants(doc, (node) => node.tagName === "title")[0]);
  if (
    byId(doc, "challenge-form") ||
    byId(doc, "cf-challenge-running") ||
    /Just a moment|Checking your browser|安全验证|驗證您的瀏覽器/i.test(title)
  ) {
    return {
      kind: "challenge",
      account: { kind: "unknown" },
      sourceURL: destination,
      message: "The forum requires native verification.",
    };
  }
  const explicit = structuredFailure(
    payload ?? {},
    response,
    readAccount(payload ?? {}),
  );
  if (explicit) return explicit;
  const actual = routeFor(response.url);
  if (requested.kind === "thread" || requested.kind === "redirect") {
    const actualThread = actual?.kind === "thread" ? actual.url : null;
    const expectedThread =
      requested.url.searchParams.get("ptid") ??
      requested.url.searchParams.get("tid");
    if (
      actualThread &&
      expectedThread &&
      actualThread.searchParams.get("tid") !== expectedThread
    )
      return failure(
        "invalid",
        "The returned thread identity did not match.",
        destination,
      );
    const native = decodeThread(
      response,
      requested.kind === "redirect" && actualThread
        ? actualThread.href
        : destination,
      true,
    );
    if (native.kind !== "thread") return native;
    const target =
      requested.url.searchParams.get("pid") ??
      native.thread.target ??
      /^#pid([1-9]\d*)$/.exec(actualThread?.hash ?? "")?.[1] ??
      null;
    if (
      (target && !native.thread.posts.some((post) => post.id === target)) ||
      (requested.kind === "redirect" && !target)
    )
      return failure(
        "invalid",
        "The requested post was absent from the returned thread.",
        destination,
        native.account,
      );
    return { ...native, thread: { ...native.thread, target } };
  }
  const native = decodeBoard(response, destination, true);
  if (requested.kind !== "directory" || terminal.has(native.kind))
    return native;
  const section = requested.url.searchParams.get("gid");
  const groups =
    native.kind === "directory"
      ? native.directory.groups.filter(
          (group) =>
            !section ||
            group.sourceId === `category_${section}` ||
            (group.sourceURL &&
              new URL(group.sourceURL).searchParams.get("gid") === section),
        )
      : [];
  const activityRow =
    !section &&
    descendants(doc, (node) => node.tagName === "tr").find((row) =>
      descendants(row, (node) => node.tagName === "h2").some((heading) =>
        /[活]动专区|活動專區/.test(label(heading)),
      ),
    );
  const activities: ForumLink[] = activityRow
    ? descendants(activityRow, (node) => node.tagName === "a").flatMap(
        (node) => {
          const url = safeURL(attr(node, "href"), response.url);
          const item = url && routeFor(url);
          return item && item.kind === "thread" && label(node)
            ? [{ url: cleanURL(item.url.href), label: label(node) }]
            : [];
        },
      )
    : [];
  if (groups.length || activities.length) {
    const url = cleanURL(response.url);
    return {
      kind: "homepage",
      account: native.account,
      sourceURL: url,
      homepage: {
        url,
        groups,
        activities,
        favoriteBoards:
          groups.find((group) => group.sourceId === "category_fav")?.boards ??
          [],
      },
    };
  }
  return failure(
    "incomplete",
    "The page did not establish a homepage or section.",
    destination,
    native.account,
  );
}

export async function publicRead(
  destination: string,
  origin: string,
  allowed: string[],
  request: (url: string) => Promise<HostResponse>,
  options: {
    representation?: "structured" | "native";
    previews?: boolean;
  } = {},
): Promise<PublicRead> {
  const route = routeFor(destination);
  if (!route || route.url.origin !== origin || !allowed.includes(route.kind))
    return failure(
      "invalid",
      "This is not a supported read destination for this origin.",
      destination,
    );
  const nativeURL = cleanURL(route.url.href);
  const useStructured = options.representation !== "native";
  const firstURL = new URL(nativeURL);
  if (useStructured) {
    firstURL.searchParams.set("tsdmapp", "json");
    if (
      options.representation === "structured" ||
      route.kind !== "thread" ||
      options.previews
    )
      firstURL.searchParams.set("nodoc", "1");
    if (options.previews && route.kind === "board")
      firstURL.searchParams.set("tsdmpreview", "1");
  }
  try {
    for (const url of useStructured
      ? [firstURL.href, nativeURL]
      : [nativeURL]) {
      const response = await request(url);
      if (response.redirect === "opaque")
        return {
          kind: "document-navigation",
          account: { kind: "unknown" },
          sourceURL: nativeURL,
          destination: nativeURL,
          message: "Open the original destination in the native forum.",
        };
      if (new URL(response.url).origin !== origin)
        return failure(
          "invalid",
          "The forum response came from a different origin.",
          nativeURL,
        );
      // Representation flags are dispatch metadata, never navigation destinations.
      const responseURL = new URL(cleanURL(response.url));
      responseURL.searchParams.delete("nodoc");
      responseURL.searchParams.delete("tsdmpreview");
      const normalized = { ...response, url: responseURL.href };
      const payload = parseReadPayload(normalized);
      if (payload && normalized.status >= 200 && normalized.status < 300) {
        const refusal = structuredFailure(
          payload,
          normalized,
          readAccount(payload),
        );
        if (refusal) return refusal;
        const result = decodeStructured(
          normalized,
          nativeURL,
          payload,
          Boolean(options.previews),
        );
        if (result && result.kind !== "incomplete") return result;
      }
      const result = readDocument(normalized, route);
      if (
        ["board", "homepage", "thread", "document-navigation"].includes(
          result.kind,
        ) ||
        terminal.has(result.kind)
      )
        return result;
      if (
        result.kind === "invalid" &&
        /different origin|did not match|requested post was absent/.test(
          result.message,
        )
      )
        return result;
      if (url === nativeURL)
        return failure(
          "incomplete",
          "The response did not establish a usable view.",
          nativeURL,
          result.account,
        );
    }
  } catch {
    return failure(
      "network",
      "The host could not complete the forum read.",
      nativeURL,
    );
  }
  return failure(
    "incomplete",
    "The response did not establish a usable view.",
    nativeURL,
  );
}
