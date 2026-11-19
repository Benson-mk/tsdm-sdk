import { nativeNotices } from "./native-notices.js";
import { noticeIgnore } from "./notice-ignore.js";
import { noticePolling } from "./notice-poll.js";
import { noticeHost, type NoticeClientOptions } from "./notice-transport.js";

export function createNoticeClient(options: NoticeClientOptions) {
  const host = noticeHost(options);
  const { pollUnreadNotices, acknowledgeAllUnreadNotices, beginNoticeEffect } = noticePolling(host);
  return {
    pollUnreadNotices,
    acknowledgeAllUnreadNotices,
    ...nativeNotices(host, beginNoticeEffect),
    ...noticeIgnore(host),
  };
}
