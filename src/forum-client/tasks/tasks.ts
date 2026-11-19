import type {
  ForumTask,
  ForumTaskTab,
  ForumTaskAction,
  ForumTaskParticipant,
} from "./types.js";
import { id, int, record, rows, string } from "../activity-protocol.js";
import { documentFrom, label } from "../html.js";
import { homeRoute, href } from "./protocol.js";

export const taskOperation = {
  apply: "apply",
  claim: "draw",
  abandon: "delete",
} as const;
export function taskLink(
  raw: unknown,
  base: string,
  action: string,
  taskId: string,
) {
  const url = homeRoute(
    raw,
    base,
    { mod: "task", do: action, id: taskId },
    action === "apply" || action === "draw" ? ["inajax"] : [],
  );
  return url &&
    (!url.searchParams.has("inajax") || url.searchParams.get("inajax") === "1")
    ? url
    : null;
}
export function taskFrom(
  data: Record<string, unknown>,
  base: string,
  tab?: ForumTaskTab,
) {
  const taskId = id(data.taskid);
  const name = string(data.name).trim();
  if (!taskId || !name) return null;
  const url = taskLink(
    tab ? data.url : `home.php?mod=task&do=view&id=${taskId}`,
    base,
    "view",
    taskId,
  );
  if (!url) return null;
  const state = int(data.state);
  const inProgress = tab === "doing" || (!tab && state === -1);
  const actions: ForumTaskAction[] = [];
  if (
    (tab === "new" ||
      tab === "done" ||
      (!tab && state !== null && state > 0)) &&
    (tab !== "done" || data.reapply === 1) &&
    data.noperm !== 1 &&
    data.full !== 1 &&
    taskLink(
      tab === "done" ? data.reapply_url : data.apply_url,
      base,
      "apply",
      taskId,
    )
  )
    actions.push("apply");
  if (inProgress && taskLink(data.draw_url, base, "draw", taskId))
    actions.push("claim");
  if (!tab && inProgress && taskLink(data.delete_url, base, "delete", taskId))
    actions.push("abandon");
  const value =
    typeof data.csc === "string" && /^\d+(?:\.\d+)?$/.test(data.csc)
      ? Number(data.csc)
      : data.csc;
  const progress =
    inProgress && typeof value === "number" && value >= 0 && value <= 100
      ? value
      : null;
  const model: ForumTask = Object.freeze({
    id: taskId,
    name,
    description:
      string(data.description) ||
      label(documentFrom(string(data.description_html))),
    reward: record(data.reward),
    applicants: int(data.applicants),
    progress,
    url: url.href,
    actions: Object.freeze(actions),
  });
  return model;
}
export function taskList(
  data: Record<string, unknown>,
  base: string,
  tab: ForumTaskTab,
) {
  if (
    data.type !== "task_list" ||
    data.schema !== 65 ||
    data.ok !== 1 ||
    data.item !== tab
  )
    return null;
  const members = rows(data.tasks)?.map(
    (row) => row && taskFrom(row, base, tab),
  );
  return members && members.every((row) => row !== null) ? members : null;
}

export function taskParticipants(data: Record<string, unknown>, base: string) {
  const entries = rows(data.list)?.map((row) => {
    const memberId = id(row?.uid);
    const username = string(row?.username).trim();
    if (!row || !memberId || !username) return null;
    const participant: ForumTaskParticipant = {
      memberId,
      username,
      avatarURL: href(row.avatar, base),
      status: int(row.status),
      progress: int(row.csc),
    };
    return participant;
  });
  return entries?.every((row) => row !== null) ? entries : null;
}
