import type {
  ForumTask,
  ForumTaskTab,
  ForumTaskAction,
  PreparedForumTaskAction,
  TaskMagicClientOptions,
  ForumTaskListResult,
  ForumTaskDetailResult,
  ForumTaskParticipantsResult,
  ForumTaskPreparation,
  ForumTaskEffectResult,
  TaskMagicClient,
} from "./types.js";
import { documentFrom, label } from "../html.js";
import { id, int, record, rows, string } from "../activity-protocol.js";
import type { NoticeSession } from "../notice-transport.js";
import { nativeTaskList } from "./native.js";
import { magicClient } from "./magic.js";
import { taskResult } from "./task-result.js";
import { query } from "../posts/forms.js";
import {
  taskFrom,
  taskLink,
  taskList,
  taskOperation,
  taskParticipants,
} from "./tasks.js";
import {
  handoff,
  home,
  pageMode,
  taskMagicHost,
  writeMode,
} from "./protocol.js";

export function createTaskMagicClient(
  options: TaskMagicClientOptions,
): TaskMagicClient {
  const host = taskMagicHost(options);
  const tasksBySession = new WeakMap<
    ForumTask,
    { owner: NoticeSession; legacy: boolean }
  >();
  const actions = new WeakMap<
    PreparedForumTaskAction,
    { owner: NoticeSession; legacy: boolean }
  >();
  async function readTasks(tab: ForumTaskTab): Promise<ForumTaskListResult> {
    if (!["new", "doing", "done"].includes(tab))
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const base = home(host.origin, { mod: "task", item: tab });
    const loaded = await host.readCompatible(base, owner);
    if (loaded.kind !== "page") return loaded;
    const legacy = loaded.page.data?.type !== "task_list";
    const tasks =
      loaded.identified &&
      (legacy
        ? nativeTaskList(loaded.page.doc, base, tab)
        : taskList(loaded.page.data!, base, tab));
    if (!tasks) return legacy ? handoff(base) : { kind: "invalid-response" };
    for (const task of tasks) tasksBySession.set(task, { owner, legacy });
    return { kind: "task-list", tab, tasks };
  }
  async function readTask(taskId: string): Promise<ForumTaskDetailResult> {
    if (typeof taskId !== "string" || !id(taskId))
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const base = home(host.origin, { mod: "task", do: "view", id: taskId });
    const loaded = await host.read(query(base, pageMode), owner);
    if (loaded.kind !== "page") return loaded;
    const data = loaded.page.data;
    if (data?.type !== "task") return handoff(base);
    const task =
      loaded.identified &&
      data.schema === 66 &&
      data.ok === 1 &&
      id(data.taskid) === taskId &&
      taskFrom(data, base);
    if (!task) return { kind: "invalid-response" };
    tasksBySession.set(task, { owner, legacy: false });
    const period = record(data.period);
    const type = int(period?.type),
      periodValue = int(period?.value);
    const endTime = int(data.endtime);
    return {
      kind: "task-detail",
      task,
      state: int(data.state),
      condition:
        string(data.condition) ||
        label(documentFrom(string(data.condition_html))),
      conditions:
        rows(data.conditions)?.flatMap((row) => {
          const name = string(row?.name);
          return name ? [{ name, value: string(row?.value) }] : [];
        }) ?? [],
      period:
        type !== null && type >= 0 && type <= 3 && periodValue !== null
          ? { type, value: periodValue }
          : null,
      endTime: endTime !== null && endTime > 0 ? endTime : null,
      timeOffset: int(data.timeoffset),
      next: string(data.next),
      applyCondition: record(data.apply_condition),
      participantsURL:
        taskLink(data.parter_url, base, "parter", taskId)?.href ?? null,
    };
  }
  async function readTaskParticipants(
    taskId: string,
  ): Promise<ForumTaskParticipantsResult> {
    if (typeof taskId !== "string" || !id(taskId))
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const base = home(host.origin, { mod: "task", do: "parter", id: taskId });
    const loaded = await host.read(query(base, pageMode), owner);
    if (loaded.kind !== "page") return loaded;
    const data = loaded.page.data;
    if (data?.type !== "task_parter") return handoff(base);
    const participants =
      loaded.identified &&
      data.schema === 67 &&
      data.ok === 1 &&
      id(data.taskid) === taskId &&
      taskParticipants(data, base);
    return participants
      ? { kind: "task-participants", taskId, participants }
      : { kind: "invalid-response" };
  }
  function prepareTaskAction(
    task: ForumTask,
    operation: ForumTaskAction,
  ): ForumTaskPreparation {
    const authority = tasksBySession.get(task);
    if (!authority || !task.actions.includes(operation))
      return { kind: "invalid-input" };
    if (!host.current(authority.owner)) return { kind: "session-changed" };
    const action = Object.freeze({ taskId: task.id, operation });
    actions.set(action, authority);
    return { kind: "task-action", action };
  }
  async function confirmTaskAction(
    action: PreparedForumTaskAction,
    approved: boolean,
  ): Promise<ForumTaskEffectResult> {
    const authority = actions.get(action);
    if (!authority) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    if (!host.current(authority.owner)) return { kind: "session-changed" };
    actions.delete(action);
    const { taskId, operation } = action;
    const route = home(host.origin, {
      mod: "task",
      do: taskOperation[operation],
      id: taskId,
    });
    const url = query(
      route,
      authority.legacy ? { inajax: "1", tsdmapp: "json" } : writeMode,
    );
    const sent = await host.exchange(url, authority.owner, true);
    return sent.kind === "response"
      ? taskResult(sent.response, authority.owner.memberId, action)
      : { kind: "uncertain", taskId };
  }
  return {
    readTasks,
    readTask,
    readTaskParticipants,
    prepareTaskAction,
    confirmTaskAction,
    ...magicClient(host),
  };
}
