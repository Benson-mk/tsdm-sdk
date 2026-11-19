import { unwrap } from "./account-forms.js";
import { positive } from "./discovery/shared.js";
import { byId, documentFrom, label } from "./html.js";
import { numericId } from "./notice-transport.js";
import {
  collectionComments,
  collectionDetail,
  collectionList,
  find,
  pageHash,
  viewer,
} from "./collection-pages.js";
import type { HostResponse } from "../index.js";

import {
  addQuery,
  collectionJSON,
  createQuery,
  decodeCollectionReceipt,
  parseAddDialog,
  type EffectTarget,
} from "./collection-protocol.js";
import type {
  CollectionAddDialog,
  CollectionClientOptions,
  CollectionComments,
  CollectionCreate,
  CollectionDetail,
  CollectionFailure,
  CollectionList,
  CollectionListQuery,
  CollectionMetadata,
  CollectionRequest,
  CollectionSession,
  CollectionWrite,
} from "./collection-types.js";

type Authority = { session: CollectionSession; hash: string };
type DetailAuthority = {
  session: CollectionSession;
  id: string;
  editHash: string;
  deleteHash: string;
  removeHash: string;
  removable: readonly string[];
  followHash: string;
  followState: CollectionDetail["followState"];
};
type DialogAuthority = Authority & {
  tid: string;
  v4: boolean;
  choices: readonly string[];
  fields: Record<string, string>;
};
const invalid = { kind: "invalid" } as const;
const invalidResponse = { kind: "invalid-response" } as const;
const uncertain = { kind: "uncertain" } as const;
const pluginResult = { tsdmapp: "json" };

function selection(ids: readonly string[], choices: readonly string[]) {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => choices.includes(id))
  );
}
function indexed(name: string, ids: readonly string[]) {
  return Object.fromEntries(ids.map((id, index) => [`${name}[${index}]`, id]));
}
function metadataFields(metadata: CollectionMetadata) {
  if (
    !metadata ||
    typeof metadata.title !== "string" ||
    !metadata.title.trim() ||
    (metadata.description !== undefined &&
      typeof metadata.description !== "string") ||
    (metadata.keywords !== undefined && typeof metadata.keywords !== "string")
  )
    return null;
  return {
    collectionsubmit: "1",
    submitcollection: "1",
    title: metadata.title,
    desc: metadata.description ?? "",
    keyword: (metadata.keywords ?? "").replace(/[，、,；;\s]+/gu, " ").trim(),
  };
}

export function createCollectionClient(options: CollectionClientOptions) {
  const base = new URL(options.origin);
  if (base.protocol !== "https:" || base.origin !== options.origin)
    throw new TypeError("A canonical HTTPS forum origin is required.");
  // Preserve the offered targets and form hashes independently of caller-owned display data.
  const creators = new WeakMap<
    CollectionList | CollectionAddDialog,
    Authority
  >();
  const details = new WeakMap<CollectionDetail, DetailAuthority>();
  const comments = new WeakMap<
    CollectionComments,
    Authority & { id: string; canRate: boolean }
  >();
  const dialogs = new WeakMap<CollectionAddDialog, DialogAuthority>();

  function current(): CollectionSession | null {
    const session = options.session();
    return session && positive(session.memberId) && session.continuity
      ? Object.freeze({
          memberId: session.memberId,
          continuity: session.continuity,
        })
      : null;
  }
  function matches(session: CollectionSession | null) {
    const actual = current();
    return (
      actual?.memberId === session?.memberId &&
      actual?.continuity === session?.continuity
    );
  }
  function route(query: Record<string, string>) {
    const url = new URL("/forum.php", base);
    url.search = new URLSearchParams({
      mod: "collection",
      ...query,
    }).toString();
    return url;
  }
  async function request(
    url: URL,
    session: CollectionSession | null,
    dispatch?: { body?: string },
  ): Promise<CollectionFailure | { kind: "response"; response: HostResponse }> {
    if (!matches(session)) return { kind: "session-changed" };
    const hostRequest: CollectionRequest =
      dispatch?.body === undefined
        ? { method: "GET", fresh: true, effect: Boolean(dispatch), session }
        : {
            method: "POST",
            fresh: true,
            effect: true,
            session,
            body: dispatch.body,
          };
    let response: HostResponse;
    try {
      response = await options.transport.request(url.href, hostRequest);
    } catch {
      return { kind: matches(session) ? "unavailable" : "session-changed" };
    }
    if (!matches(session)) return { kind: "session-changed" };
    if (response.redirect !== "none" || response.url !== url.href)
      return { kind: "invalid-response" };
    if (response.status === 429) return { kind: "rate-limited" };
    if (response.status === 401) return { kind: "login" };
    if (response.status === 403 || response.status === 404)
      return { kind: "refused" };
    return response.status === 200
      ? { kind: "response", response }
      : { kind: "invalid-response" };
  }
  async function page(url: URL, session: CollectionSession | null) {
    const reply = await request(url, session);
    if (reply.kind !== "response") return reply;
    const { body } = reply.response;
    const data = collectionJSON(body);
    if (data?.login === 1) return { kind: "login" } as const;
    const doc = documentFrom(
      unwrap(typeof data?.document === "string" ? data.document : body),
    );
    const message = label(
      find(byId(doc, "messagetext"), (n) => n.tagName === "p"),
    );
    if (message) return { kind: "refused", message } as const;
    const root = byId(doc, "ct");
    const uid = viewer(doc);
    const outerUid = numericId(data?.uid);
    if (
      (outerUid !== null && uid !== null && outerUid !== uid) ||
      (session &&
        (uid ?? outerUid) !== null &&
        (uid ?? outerUid) !== session.memberId)
    )
      return { kind: "session-changed" } as const;
    return root
      ? ({
          kind: "page",
          doc,
          root,
          memberVerified: Boolean(session && uid === session.memberId),
        } as const)
      : ({ kind: "invalid-response" } as const);
  }
  function pageQuery(page: number): Record<string, string> {
    return page > 1 ? { page: String(page) } : {};
  }
  const validPage = (page: number) => Number.isSafeInteger(page) && page > 0;
  async function readDirectory(
    url: URL,
    tab: CollectionListQuery["tab"] | "related",
    session: CollectionSession | null,
    personal = false,
  ): Promise<CollectionList | CollectionFailure> {
    const result = await page(url, session);
    if (result.kind !== "page") return result;
    if (personal && !result.memberVerified) return invalidResponse;
    const list = collectionList(result.root, url, tab);
    if (!list) return invalidResponse;
    const hash = pageHash(result.doc, url);
    if (session && result.memberVerified && list.canCreate && hash)
      creators.set(list, { session, hash });
    return list;
  }
  async function readList(
    query: CollectionListQuery,
  ): Promise<CollectionList | CollectionFailure> {
    const { tab } = query;
    const number = "page" in query ? (query.page ?? 1) : 1;
    const order =
      query.tab === "all" ? (query.order ?? "dateline") : "dateline";
    const personal = tab === "owned" || tab === "subscribed";
    if (
      !validPage(number) ||
      (personal && number !== 1) ||
      !["dateline", "threadnum", "commentnum", "follownum"].includes(order) ||
      !["recommended", "all", "owned", "subscribed"].includes(tab)
    )
      return { kind: "invalid" };
    const session = current();
    if (personal && !session) return { kind: "login" };
    const url = route({
      ...(personal ? { op: "my" } : tab === "all" ? { op: "all" } : {}),
      ...(order !== "dateline" ? { order } : {}),
      ...pageQuery(number),
    });
    return readDirectory(url, tab, session, personal);
  }
  async function readRelated(
    threadId: string,
  ): Promise<CollectionList | CollectionFailure> {
    if (!positive(threadId)) return invalid;
    return readDirectory(route({ tid: threadId }), "related", current());
  }
  async function readDetail(
    id: string,
    number = 1,
  ): Promise<CollectionDetail | CollectionFailure> {
    if (!positive(id) || !validPage(number)) return { kind: "invalid" };
    const url = route({ action: "view", ctid: id, ...pageQuery(number) });
    const session = current();
    const result = await page(url, session);
    if (result.kind !== "page") return result;
    const detail = collectionDetail(result.root, url, id);
    if (!detail) return invalidResponse;
    if (session && result.memberVerified)
      details.set(detail.data, {
        session,
        id,
        editHash: detail.editHash,
        deleteHash: detail.deleteHash,
        removeHash: detail.removeHash,
        removable: detail.removable,
        followHash: pageHash(result.doc, url),
        followState: detail.data.followState,
      });
    return detail.data;
  }
  async function readComments(
    id: string,
    number = 1,
  ): Promise<CollectionComments | CollectionFailure> {
    if (!positive(id) || !validPage(number)) return { kind: "invalid" };
    const url = route({
      action: "view",
      op: "comment",
      ctid: id,
      ...pageQuery(number),
    });
    const session = current();
    const result = await page(url, session);
    if (result.kind !== "page") return result;
    const parsed = collectionComments(result.root, url, id);
    if (!parsed) return invalidResponse;
    const hash = parsed.formHash || pageHash(result.doc, url);
    if (session && result.memberVerified && parsed.data.canComment && hash) {
      comments.set(parsed.data, {
        session,
        id,
        hash,
        canRate: parsed.data.canRate,
      });
    }
    return parsed.data;
  }
  async function readAddDialog(
    tid: string,
  ): Promise<CollectionAddDialog | CollectionFailure> {
    if (!positive(tid)) return invalid;
    const session = current();
    if (!session) return { kind: "login" };
    const status = await request(
      new URL("/plugin.php?id=tsdmapp%3Aapi&action=status", base),
      session,
    );
    if (
      status.kind !== "response" &&
      status.kind !== "refused" &&
      status.kind !== "unavailable"
    )
      return status;
    const data =
      status.kind === "response" ? collectionJSON(status.response.body) : null;
    if (data?.error === "busy") return { kind: "rate-limited" };
    if (data?.ok === 1 && numericId(data.uid) !== session.memberId)
      return { kind: "session-changed" };
    const advertised =
      data?.ok === 1 &&
      data.v4 === 1 &&
      Array.isArray(data.forms) &&
      data.forms.includes("collection");
    const attempts = advertised ? [true, false] : [false];
    for (const v4 of attempts) {
      const url = route({
        ...addQuery,
        tid,
        ...(v4 && { handlekey: "k_collect" }),
        inajax: "1",
        ...pluginResult,
        ...(v4 && { tsdmv: "4", tsdmform: "1", nodoc: "1" }),
      });
      const reply = await request(url, session);
      if (reply.kind !== "response") return reply;
      const dialog = parseAddDialog(
        reply.response.body,
        tid,
        session.memberId,
        url,
        v4,
      );
      if (!dialog) continue;
      if (dialog.kind !== "dialog") return dialog;
      const authority = { session, hash: dialog.hash };
      dialogs.set(dialog.data, {
        ...authority,
        tid,
        v4,
        choices: dialog.data.choices.map((choice) => choice.id),
        fields: dialog.fields,
      });
      if (dialog.data.canCreate) creators.set(dialog.data, authority);
      return dialog.data;
    }
    return invalidResponse;
  }

  function writeURL(query: Record<string, string>) {
    return route({ ...query, inajax: "1", ...pluginResult });
  }
  async function dispatch(
    url: URL,
    session: CollectionSession,
    target: EffectTarget,
    fields?: Record<string, string>,
  ) {
    if (!matches(session)) return { kind: "session-changed" } as const;
    const reply = await request(
      url,
      session,
      fields ? { body: new URLSearchParams(fields).toString() } : {},
    );
    if (
      reply.kind === "login" ||
      reply.kind === "refused" ||
      reply.kind === "rate-limited"
    )
      return reply;
    if (reply.kind !== "response") return uncertain;
    return decodeCollectionReceipt(
      reply.response.body,
      base,
      session.memberId,
      target,
    );
  }
  async function write(
    url: URL,
    session: CollectionSession,
    target: EffectTarget,
    fields?: Record<string, string>,
  ): Promise<CollectionWrite> {
    const receipt = await dispatch(url, session, target, fields);
    return receipt.kind === "accepted"
      ? { kind: "confirmed", message: receipt.message }
      : receipt;
  }
  async function createCollection(
    page: CollectionList | CollectionAddDialog,
    metadata: CollectionMetadata,
  ): Promise<CollectionCreate> {
    const authority = creators.get(page);
    const fields = metadataFields(metadata);
    if (!authority || !fields) return invalid;
    const receipt = await dispatch(
      writeURL(createQuery),
      authority.session,
      { operation: "create" },
      { formhash: authority.hash, ...fields },
    );
    if (receipt.kind !== "accepted") return receipt;
    if (!receipt.id) return uncertain;
    return {
      kind: "confirmed",
      message: receipt.message,
      collectionId: receipt.id,
      collectionURL: route({ action: "view", ctid: receipt.id }).href,
    };
  }
  async function editCollection(
    page: CollectionDetail,
    metadata: CollectionMetadata,
  ): Promise<CollectionWrite> {
    const authority = details.get(page);
    const fields = metadataFields(metadata);
    if (!authority?.editHash || !fields) return invalid;
    const { id, editHash, session } = authority;
    return write(
      writeURL({ action: "edit", op: "edit", ctid: id }),
      session,
      { operation: "edit", id },
      { formhash: editHash, ...fields },
    );
  }
  async function deleteCollection(
    page: CollectionDetail,
  ): Promise<CollectionWrite> {
    const authority = details.get(page);
    if (!authority?.deleteHash) return invalid;
    const { id, deleteHash, session } = authority;
    return write(
      writeURL({
        action: "edit",
        op: "remove",
        ctid: id,
        formhash: deleteHash,
      }),
      session,
      { operation: "delete", id },
    );
  }
  async function addThread(
    dialog: CollectionAddDialog,
    collectionIds: readonly string[],
    reason = "",
  ): Promise<CollectionWrite> {
    const authority = dialogs.get(dialog);
    if (
      !authority ||
      !selection(collectionIds, authority.choices) ||
      typeof reason !== "string"
    )
      return invalid;
    const { tid, session, v4, fields } = authority;
    const url = v4
      ? route({ ...addQuery, ...pluginResult, tsdmv: "4" })
      : writeURL(addQuery);
    return write(
      url,
      session,
      {
        operation: "add",
        threadIds: [tid],
        collectionIds: [...collectionIds],
        structuredOnly: v4,
      },
      { ...fields, reason, ...indexed("ctid", collectionIds) },
    );
  }
  async function removeThreads(
    page: CollectionDetail,
    threadIds: readonly string[],
  ): Promise<CollectionWrite> {
    const authority = details.get(page);
    if (!authority?.removeHash || !selection(threadIds, authority.removable))
      return invalid;
    const { id, removeHash, session } = authority;
    return write(
      writeURL({ action: "edit", op: "delthread" }),
      session,
      { operation: "remove", id, threadIds: [...threadIds] },
      { formhash: removeHash, ctid: id, ...indexed("delthread", threadIds) },
    );
  }
  async function comment(
    page: CollectionComments,
    message: string,
    rating?: number,
  ): Promise<CollectionWrite> {
    const authority = comments.get(page);
    if (
      !authority ||
      typeof message !== "string" ||
      (!message.trim() && rating === undefined) ||
      (rating !== undefined &&
        (!authority.canRate ||
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 5))
    )
      return invalid;
    const { id, hash, session } = authority;
    return write(
      writeURL({ action: "comment", ctid: id }),
      session,
      { operation: "comment", id },
      {
        formhash: hash,
        handlekey: "k_addComment",
        message,
        ratescore: rating === undefined ? "" : String(rating),
      },
    );
  }
  async function follow(
    page: CollectionDetail,
    subscribe: boolean,
  ): Promise<CollectionWrite> {
    const authority = details.get(page);
    if (
      !authority?.followHash ||
      authority.followState !== (subscribe ? "can-follow" : "following")
    )
      return invalid;
    const { id, followHash, session } = authority;
    return write(
      writeURL({
        action: "follow",
        op: subscribe ? "follow" : "unfo",
        ctid: id,
        formhash: followHash,
      }),
      session,
      { operation: subscribe ? "follow" : "unfollow", id },
    );
  }
  return {
    readList,
    readRelated,
    readDetail,
    readComments,
    readAddDialog,
    createCollection,
    editCollection,
    deleteCollection,
    addThread,
    removeThreads,
    comment,
    subscribe: (page: CollectionDetail) => follow(page, true),
    unsubscribe: (page: CollectionDetail) => follow(page, false),
  };
}
