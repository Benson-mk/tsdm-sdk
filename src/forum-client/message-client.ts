import { selectV4, unsupportedV4 } from "./v4-selection.js";
import { messageEffects } from "./message-effects.js";
import { messageJSON, pageDocument, messageBody } from "./message-pages.js";
import {
  nativeMessageList,
  type MessageListFilter,
} from "./native-message-lists.js";
import {
  chatDocument,
  chatMessages,
  chatQuery,
  dialogForm,
  historyForm,
  matchesSendDestination,
  nativeSendResult,
  type MessageForm,
} from "./message-forms.js";
import { decodePrivateConversation } from "./private-conversation.js";
import { accountFrom } from "./read-thread.js";
import type { ContentNode } from "./types.js";
import {
  attr,
  byId,
  content,
  descendants,
  fragmentFrom,
  hasClass,
  label,
} from "./html.js";
import {
  noticeHost,
  noticeJSON,
  numericId,
  object,
  integer,
  type NoticeClientOptions,
  type NoticeSession,
} from "./notice-transport.js";

const inbox = { mod: "space", do: "pm" };

function positiveId(value: unknown): string | null {
  const id = numericId(value);
  return id === "0" ? null : id;
}

/** A transient, single-use form obtained from a chat dialog or conversation. */
export interface PrivateMessageForm {
  readonly peerId: string;
  readonly maxLength: number | null;
}

export interface NativeMessageListOptions {
  confirm: boolean;
  page?: number;
}

interface NativeMessageListView {
  source: "native";
  memberId: string;
  page: number;
  nextPage: number | null;
  closed: boolean;
}

export interface NativeMessageListRow {
  id: string;
  preview: string;
  unread: boolean;
  /** Absolute time as printed by the forum, whose timezone may be unknown. */
  timestamp: string;
  url: string;
}

export type NativePrivateMessageList = NativeMessageListView & {
  kind: "private-list";
  effect: "may-clear-private-prompt";
  omittedGroups: number;
  rows: (NativeMessageListRow & { peerId: string; peerName: string })[];
};

export type NativeBroadcastMessageList = NativeMessageListView & {
  kind: "broadcast-list";
  effect: "none";
  count: null;
  rows: NativeMessageListRow[];
};

export type NativeMessageListResult =
  | NativePrivateMessageList
  | NativeBroadcastMessageList
  | { kind: "not-dispatched" | "refused" | "rate-limited" | "session-changed" | "network" | "invalid-response" }
  | { kind: "effect-unknown"; effect: "may-clear-private-prompt" };

export function createMessageClient(options: NoticeClientOptions) {
  const host = noticeHost(options);
  function url(path: string, query: Record<string, string>): URL {
    const target = new URL(path, host.origin);
    target.search = new URLSearchParams(query).toString();
    return target;
  }
  function home(query: Record<string, string>) {
    return url("/home.php", query);
  }
  function api(action: string, query: Record<string, string> = {}) {
    return url("/plugin.php", { id: "tsdmapp:api", action, ...query });
  }
  function nativeList(filter: "privatepm" | "announcepm", page: number) {
    return {
      kind: "native-page",
      url: home({ ...inbox, filter, page: String(page) }).href,
      effect: filter === "privatepm" ? "may-clear-private-prompt" : "none",
    } as const;
  }
  const invalid = { kind: "invalid-response" } as const;
  const sessionChanged = { kind: "session-changed" } as const;
  const refused = { kind: "refused" } as const;
  async function broadcastCapability(session: NoticeSession) {
    const url = api("status").href;
    const reply = await host.request(url, session);
    if (reply.kind !== "response") return reply;
    const answer = noticeJSON(reply.response);
    if (reply.response.status !== 200 || answer.kind === "rate-limited") return answer.kind === "json" ? invalid : answer;
    const data = messageJSON(reply.response.body);
    const viewer = numericId(data?.uid);
    if (data?.login === 1 || viewer === "0") return refused;
    if (data?.uid !== undefined && viewer !== session.memberId) return sessionChanged;
    if (answer.kind === "unsupported" || unsupportedV4(data)) return { kind: "legacy" } as const;
    if (answer.kind !== "json") return answer;
    if (viewer !== session.memberId) return invalid;
    const capability = selectV4(reply.response, url, "announce", "announce", session.memberId);
    return capability.kind === "limited" ? { kind: "rate-limited" } as const : capability;
  }
  async function list(filter: "privatepm" | "announcepm", page: number) {
    const session = host.session();
    if (!session) return refused;
    if (!integer(page, 1)) return invalid;
    if (page !== 1) return nativeList(filter, page);
    if (filter === "announcepm") {
      const capability = await broadcastCapability(session);
      if (capability.kind === "legacy") return nativeList(filter, page);
      if (capability.kind !== "v4") return capability;
    }
    const request = await host.request(
      api("pmlist", filter === "announcepm" ? { filter: "announce" } : {}).href,
      session,
    );
    if (request.kind !== "response") return request;
    const answer = noticeJSON(request.response);
    if (filter === "announcepm" && request.response.status === 200 && answer.kind !== "rate-limited") {
      const payload = messageJSON(request.response.body);
      const viewer = numericId(payload?.uid);
      if (payload?.login === 1 || viewer === "0") return refused;
      if (payload?.uid !== undefined && viewer !== session.memberId) return sessionChanged;
      if (unsupportedV4(payload)) return nativeList(filter, page);
    }
    if (answer.kind === "unsupported") return nativeList(filter, page);
    if (answer.kind !== "json") return answer;
    const { data } = answer;
    if (numericId(data.uid) !== session.memberId) return sessionChanged;
    const closed = data.closed === 1;
    if (filter === "announcepm") {
      if (data.filter !== "announce") return nativeList(filter, page);
      if (
        !Array.isArray(data.announces) ||
        !integer(data.page, 1) ||
        !integer(data.count, 0)
      )
        return invalid;
      const rows = [];
      for (const raw of data.announces) {
        const row = object(raw);
        const id = positiveId(row?.id);
        if (
          !id ||
          !row ||
          !integer(row.dateline, 1) ||
          typeof row.text !== "string" ||
          (row.new !== 0 && row.new !== 1)
        )
          return invalid;
        rows.push({
          id,
          preview: row.text,
          unread: row.new === 1,
          timestamp: row.dateline,
          url: home({ ...inbox, subop: "viewg", pmid: id }).href,
        });
      }
      return {
        kind: "broadcast-list",
        memberId: session.memberId,
        closed,
        page: data.page,
        count: data.count,
        rows,
      } as const;
    }
    if (!Array.isArray(data.pms)) return nativeList(filter, page);
    const rows = [];
    let omittedGroups = 0;
    for (const raw of data.pms) {
      const row = object(raw);
      if (row?.type === 2) {
        omittedGroups++;
        continue;
      }
      const peerId = positiveId(row?.touid);
      const id = positiveId(row?.plid);
      const author = positiveId(row?.lastauthorid);
      if (
        !peerId ||
        !id ||
        !author ||
        row?.type !== 1 ||
        typeof row.tousername !== "string" ||
        !row.tousername ||
        typeof row.lastsummary_html !== "string" ||
        !integer(row.lastdateline, 1) ||
        (row.new !== 0 && row.new !== 1)
      )
        return invalid;
      rows.push({
        id,
        peerId,
        peerName: row.tousername,
        preview: label(fragmentFrom(row.lastsummary_html)),
        unread: row.new === 1 && author !== session.memberId,
        timestamp: row.lastdateline,
        url: home({ ...inbox, subop: "view", touid: peerId }).href,
      });
    }
    return {
      kind: "private-list",
      memberId: session.memberId,
      closed,
      rows,
      omittedGroups,
    } as const;
  }
  const notDispatched = { kind: "not-dispatched" } as const;
  const unknownRead = {
    kind: "effect-unknown",
    effect: "may-mark-read",
  } as const;
  const unknownNativePrompt = {
    kind: "effect-unknown",
    effect: "may-clear-private-prompt",
  } as const;

  async function openNativeList(
    filter: MessageListFilter,
    settings: NativeMessageListOptions,
  ): Promise<NativeMessageListResult> {
    const session = host.session();
    const page = settings.page ?? 1;
    if (!session || settings.confirm !== true || !integer(page, 1))
      return notDispatched;
    const destination = new URL(nativeList(filter, page).url);
    const privatePage = filter === "privatepm";
    const loaded = await host.request(
      destination.href,
      session,
      undefined,
      privatePage || undefined,
    );
    if (loaded.kind !== "response")
      return privatePage ? unknownNativePrompt : loaded;
    const response = loaded.response;
    if (response.status === 429) return { kind: "rate-limited" };
    if ([401, 403].includes(response.status)) return refused;
    if (response.status !== 200) return privatePage ? unknownNativePrompt : invalid;
    const payload = messageJSON(response.body);
    if (payload?.uid !== undefined && numericId(payload.uid) !== session.memberId)
      return privatePage ? unknownNativePrompt : sessionChanged;
    const read = nativeMessageList(pageDocument(response, payload), destination, filter, page, session.memberId);
    return privatePage && ["invalid-response", "session-changed"].includes(read.kind)
      ? unknownNativePrompt
      : read;
  }
  const jsonMode = { tsdmapp: "json", nodoc: "1" };
  const sendForms = new WeakMap<
    PrivateMessageForm,
    { session: NoticeSession; form: MessageForm }
  >();

  function prepareSend(
    peerId: string,
    session: NoticeSession,
    form: MessageForm | null,
  ): PrivateMessageForm | null {
    if (!form) return null;
    const prepared = Object.freeze({ peerId, maxLength: form.maxLength });
    sendForms.set(prepared, { session, form });
    return prepared;
  }

  async function detailResponse(
    target: URL,
    session: NoticeSession,
    effect?: true,
  ) {
    const request = await host.request(target.href, session, undefined, effect);
    if (request.kind !== "response") return unknownRead;
    const { response } = request;
    if (response.status === 429) return { kind: "rate-limited" } as const;
    if ([401, 403, 404].includes(response.status)) return refused;
    if (response.status !== 200) return unknownRead;
    const data = messageJSON(response.body);
    if (data?.uid !== undefined && numericId(data.uid) !== session.memberId) {
      return data.uid === 0 && data.login === 1 ? refused : unknownRead;
    }
    if (data?.ok === 0 && (data.error === "message" || data.login === 1))
      return refused;
    if (data?.ok === 0 && data.error === "busy")
      return { kind: "rate-limited" } as const;
    if (effect && data?.ok === 0 && typeof data.error === "string" && !unsupportedV4(data))
      return refused;
    return { kind: "loaded", response, data } as const;
  }

  async function openPrivateConversation(
    peerId: string,
    settings: { confirm: boolean; page?: number },
  ) {
    const session = host.session();
    const page = settings.page;
    if (
      !session ||
      settings.confirm !== true ||
      !positiveId(peerId) ||
      peerId === session.memberId ||
      (page !== undefined && !integer(page, 1))
    )
      return notDispatched;
    const native = home({
      ...inbox,
      subop: "view",
      touid: peerId,
      ...(page === undefined ? {} : { page: String(page) }),
    });
    const target = new URL(native);
    for (const [key, value] of Object.entries(jsonMode))
      target.searchParams.set(key, value);
    const loaded = await detailResponse(target, session);
    if (loaded.kind !== "loaded") return loaded;
    const { data, response } = loaded;
    if (data?.type === "pm" && data.schema === 11) {
      if (
        data.ok !== 1 ||
        numericId(data.uid) !== session.memberId ||
        data.pmtype !== 1 ||
        positiveId(data.touid) !== peerId ||
        typeof data.tousername !== "string" ||
        !data.tousername ||
        !integer(data.count, 0) ||
        !integer(data.page, 1) ||
        !integer(data.pages, data.page) ||
        data.has_next !== Number(data.page < data.pages) ||
        !Array.isArray(data.messages) ||
        data.count < data.messages.length ||
        (!data.messages.length && data.count !== 0)
      )
        return unknownRead;
      const messages = [];
      const seen = new Set<string>();
      for (const raw of data.messages) {
        const row = object(raw);
        const id = positiveId(row?.pmid);
        const senderId = positiveId(row?.fromuid);
        if (
          !row ||
          !id ||
          seen.has(id) ||
          !senderId ||
          ![session.memberId, peerId].includes(senderId) ||
          typeof row.from !== "string" ||
          !integer(row.dateline, 1) ||
          typeof row.message_html !== "string"
        )
          return unknownRead;
        seen.add(id);
        messages.push({
          id,
          senderId,
          sender: row.from,
          time: row.dateline,
          body: messageBody(row.message_html, native),
        });
      }
      return {
        kind: "conversation",
        effect: "may-mark-read",
        memberId: session.memberId,
        peerId,
        peerName: data.tousername,
        page: data.page,
        pages: data.pages,
        hasNext: data.has_next === 1,
        count: data.count,
        messages,
        send: prepareSend(
          peerId,
          session,
          historyForm({ data, peer: peerId, base: native, ids: seen }),
        ),
      } as const;
    }
    const decoded = decodePrivateConversation(
      { ...response, url: native.href },
      native.href,
    );
    if (
      decoded.kind === "private-conversation" &&
      decoded.account.kind === "member" &&
      decoded.account.id === session.memberId
    ) {
      const history = decoded.conversation;
      return {
        kind: "conversation",
        effect: "may-mark-read",
        memberId: session.memberId,
        peerId,
        peerName: history.peerName,
        page: Number(history.pages.current),
        pages: null,
        hasNext: Boolean(history.later),
        count: history.totalCount,
        messages: history.messages,
        send: prepareSend(
          peerId,
          session,
          historyForm({
            doc: pageDocument(response, data),
            peer: peerId,
            base: native,
            ids: new Set(history.messages.map((row) => row.id)),
          }),
        ),
      } as const;
    }
    if (decoded.kind === "login" || decoded.kind === "permission")
      return refused;
    return { ...unknownRead, nativeUrl: native.href };
  }

  async function openBroadcastMessage(
    id: string,
    settings: { confirm: boolean },
  ) {
    const session = host.session();
    if (!session || settings.confirm !== true || !positiveId(id))
      return notDispatched;
    const native = home({ ...inbox, subop: "viewg", pmid: id });
    const capability = await broadcastCapability(session);
    if (capability.kind !== "v4" && capability.kind !== "legacy") return capability;
    const target = new URL(native.href);
    if (capability.kind === "v4")
      for (const [key, value] of Object.entries({ ...jsonMode, tsdmv: "4" }))
        target.searchParams.set(key, value);
    const loaded = await detailResponse(target, session, true);
    if (loaded.kind !== "loaded") return loaded;
    const { data, response } = loaded;
    if (capability.kind === "v4" && data?.type === "announcepm" && data.schema === 40) {
      if (
        data.ok !== 1 ||
        numericId(data.uid) !== session.memberId ||
        positiveId(data.pmid) !== id
      )
        return unknownRead;
      if (data.announce === null) return refused;
      const row = object(data.announce);
      if (!row || positiveId(row.id) !== id || !integer(row.dateline, 1))
        return unknownRead;
      const body =
        typeof row.message_html === "string" && row.message_html
          ? messageBody(row.message_html, native)
          : typeof row.text === "string"
            ? [{ kind: "text", text: row.text } satisfies ContentNode]
            : null;
      if (!body) return unknownRead;
      return {
        kind: "broadcast",
        effect: "may-mark-read",
        memberId: session.memberId,
        id,
        time: row.dateline,
        body,
      } as const;
    }
    const doc = pageDocument(response, data);
    const actor = accountFrom(doc, native.href);
    if (actor.kind === "guest") return refused;
    const list = byId(doc, "pm_ul");
    if (list && actor.kind === "member" && actor.id === session.memberId) {
      const summary = descendants(list, (node) => hasClass(node, "pm_smry"));
      const stamps = descendants(list, (node) => hasClass(node, "xg1"));
      if (summary.length === 1 && stamps.length === 1) {
        const time =
          attr(
            descendants(stamps[0]!, (node) =>
              Boolean(attr(node, "title")),
            )[0] ?? stamps[0]!,
            "title",
          ) || label(stamps[0]);
        if (time)
          return {
            kind: "broadcast",
            effect: "may-mark-read",
            memberId: session.memberId,
            id,
            time,
            body: content(summary[0]!, native.href),
          } as const;
      }
    }
    return { ...unknownRead, nativeUrl: native.href };
  }

  async function openChat(
    peerId: string,
    settings: { confirm: boolean },
    recent: boolean,
  ) {
    const session = host.session();
    if (
      !session ||
      settings.confirm !== true ||
      !positiveId(peerId) ||
      peerId === session.memberId
    )
      return notDispatched;
    const target = home(
      recent
        ? {
            ...chatQuery,
            msgonly: "1",
            touid: peerId,
            pmid: "0",
            inajax: "1",
            daterange: "2",
          }
        : {
            ...chatQuery,
            handlekey: `showmsg_${peerId}`,
            touid: peerId,
            pmid: "0",
            daterange: "2",
            infloat: "yes",
            inajax: "1",
            ajaxtarget: "fwin_content_showMsgBox",
          },
    );
    const loaded = await detailResponse(target, session);
    if (loaded.kind !== "loaded") return loaded;
    const doc = chatDocument(loaded.response.body);
    if (!doc) return unknownRead;
    if (byId(doc, "messagetext") || byId(doc, "main_message")) return refused;
    const list = recent ? doc : byId(doc, "msglist");
    const messages = list && chatMessages(list, target);
    if (!messages) return unknownRead;
    const opened = {
      effect: "may-mark-read",
      memberId: session.memberId,
      peerId,
      messages,
    } as const;
    if (recent) return { ...opened, kind: "recent-messages" } as const;
    const form = dialogForm(doc, peerId, target);
    if (!form) return unknownRead;
    return {
      ...opened,
      kind: "chat-dialog",
      send: prepareSend(peerId, session, form)!,
    } as const;
  }

  async function sendPrivateMessage(
    prepared: PrivateMessageForm,
    message: string,
    settings: { confirm: boolean },
  ) {
    const proof = sendForms.get(prepared);
    if (
      !proof ||
      settings.confirm !== true ||
      !host.current(proof.session) ||
      typeof message !== "string" ||
      !message.trim() ||
      (proof.form.maxLength !== null && message.length > proof.form.maxLength)
    )
      return notDispatched;
    sendForms.delete(prepared);
    const { url, fields, handler } = proof.form;
    const body = new URLSearchParams({ ...fields, message }).toString();
    const request = await host.request(url.href, proof.session, body);
    const uncertain = { kind: "uncertain" } as const;
    if (request.kind !== "response") return uncertain;
    if ([401, 403, 429].includes(request.response.status))
      return { kind: "refused", code: null } as const;
    if (request.response.status !== 200) return uncertain;
    const data = messageJSON(request.response.body);
    if (!data)
      return (
        nativeSendResult(
          request.response.body,
          handler,
          url,
          prepared.peerId,
        ) ?? uncertain
      );
    if (
      numericId(data.uid) !== proof.session.memberId ||
      data.type !== "result" ||
      data.schema !== 13
    )
      return uncertain;
    if (
      data.kind === "handle" &&
      data.handlekey === handler &&
      data.ok === 1 &&
      data.message_key === "do_success" &&
      matchesSendDestination(data.url, url, prepared.peerId)
    ) {
      return {
        kind: "accepted",
        messageId: positiveId(object(data.values)?.pmid),
      } as const;
    }
    if (
      data.ok === 0 &&
      ((data.kind === "handle" && data.handlekey === handler) ||
        data.kind === "message")
    ) {
      return {
        kind: "refused",
        code: typeof data.message_key === "string" ? data.message_key : null,
      } as const;
    }
    return uncertain;
  }

  return {
    listPrivateMessages: (page = 1) => list("privatepm", page),
    listBroadcastMessages: (page = 1) => list("announcepm", page),
    openNativePrivateMessageList: (settings: NativeMessageListOptions) =>
      openNativeList("privatepm", settings),
    openNativeBroadcastMessageList: (settings: NativeMessageListOptions) =>
      openNativeList("announcepm", settings),
    openPrivateConversation,
    openBroadcastMessage,
    openChatDialog: (peerId: string, settings: { confirm: boolean }) =>
      openChat(peerId, settings, false),
    openRecentMessages: (peerId: string, settings: { confirm: boolean }) =>
      openChat(peerId, settings, true),
    sendPrivateMessage,
    ...messageEffects(host),
  };
}
