import type {
  ForumTaskOutcome,
  PreparedForumTaskAction,
  TaskMagicFailure,
} from "./types.js";
import { answer, id, responseIssue, string } from "../activity-protocol.js";
import { documentFrom, label } from "../html.js";
import { numericId } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import { taskLink } from "./tasks.js";

export function taskResult(
  response: HostResponse & { location?: string },
  owner: string,
  prepared: PreparedForumTaskAction,
): ForumTaskOutcome | TaskMagicFailure {
  const { taskId, operation } = prepared;
  const uncertain = { kind: "uncertain", taskId } as const;
  const claimLink = (raw: unknown) =>
    taskLink(raw, response.url, "draw", taskId);
  if ([301, 302, 303].includes(response.status)) {
    return operation === "apply" && claimLink(response.location)
      ? { kind: "applied", taskId, claimAvailable: true }
      : uncertain;
  }
  const page = answer(response);
  const failure = responseIssue(response, page.data);
  if (failure) return failure;
  if (response.status !== 200) return uncertain;
  const data = page.data;
  if (
    data &&
    (data.type !== "result" ||
      data.schema !== 13 ||
      numericId(data.uid) !== owner ||
      (data.taskid !== undefined && id(data.taskid) !== taskId))
  )
    return uncertain;
  if (data?.kind === "redirect") {
    return operation === "apply" && data.ok === 1 && claimLink(data.url)
      ? { kind: "applied", taskId, claimAvailable: true }
      : uncertain;
  }
  if (data?.url && !taskLink(data.url, response.url, "view", taskId))
    return uncertain;
  if (data && (data.kind === "message" || data.kind === "handle")) {
    const key = string(data.message_key);
    const message = label(documentFrom(string(data.message)));
    if (operation === "claim" && key === "task_failed")
      return { kind: "failed", taskId };
    if (data.ok === 1 && data.alert !== "error") {
      if (operation === "apply" && key === "task_applied")
        return { kind: "applied", taskId, claimAvailable: false };
      if (operation === "abandon" && key === "task_deleted")
        return { kind: "abandoned", taskId };
      if (
        operation === "claim" &&
        (key === "task_completed" || /^task_reward_\w+$/.test(key))
      )
        return { kind: "rewarded", taskId };
      if (
        operation === "claim" &&
        [
          "task_doing",
          "task_waiting",
          "task_doing_rt",
          "task_waiting_rt",
        ].includes(key)
      ) {
        const percent = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*%/.exec(message);
        const progress = percent ? Number(percent[1]) : null;
        return {
          kind: "in-progress",
          taskId,
          progress: progress !== null && progress <= 100 ? progress : null,
          message,
        };
      }
    }
    return key || message
      ? {
          kind: "refused",
          ...(key && { code: key }),
          ...(message && { message }),
        }
      : uncertain;
  }
  if (data && data.kind !== "page") return uncertain;
  if (operation === "claim") {
    const status = /^\s*(-?\d+(?:\.\d+)?)\|([\s\S]*)$/.exec(page.html);
    if (status) {
      const progress = Number(status[1]);
      if (progress === 100) return { kind: "rewarded", taskId };
      if (progress < 0) return { kind: "failed", taskId };
      if (progress < 100)
        return {
          kind: "in-progress",
          taskId,
          progress,
          message: label(documentFrom(status[2]!)),
        };
    }
  }
  if (operation === "apply" && !data) {
    const match = /\bsucceedhandle_\(\s*'([^'\\]+)'\s*,\s*'([^'\\]*)'/.exec(
      page.html,
    );
    if (match && taskLink(match[1], response.url, "view", taskId))
      return { kind: "applied", taskId, claimAvailable: false };
  }
  return page.failure ? { kind: "refused", message: page.failure } : uncertain;
}
