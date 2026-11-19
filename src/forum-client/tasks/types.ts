import type { ActivityClientOptions } from "../activity-client.js";

export interface TaskMagicClientOptions extends Omit<
  ActivityClientOptions,
  "transport"
> {
  transport: {
    request(
      url: string,
      request: Parameters<ActivityClientOptions["transport"]["request"]>[1],
    ): Promise<
      Awaited<ReturnType<ActivityClientOptions["transport"]["request"]>> & {
        location?: string;
      }
    >;
  };
}
export type TaskMagicFailure =
  | {
      kind:
        "invalid-input" | "invalid-response" | "session-changed" | "network";
    }
  | { kind: "refused"; code?: string; message?: string };
export type TaskMagicHandoff = { kind: "browser-handoff"; destination: string };

export type ForumTaskListResult =
  | { kind: "task-list"; tab: ForumTaskTab; tasks: readonly ForumTask[] }
  | TaskMagicFailure
  | TaskMagicHandoff;
export type ForumTaskDetailResult =
  | {
      kind: "task-detail";
      task: ForumTask;
      state: number | null;
      condition: string;
      conditions: readonly Readonly<{ name: string; value: string }>[];
      period: Readonly<{ type: number; value: number }> | null;
      endTime: number | null;
      timeOffset: number | null;
      next: string;
      applyCondition: Readonly<Record<string, unknown>> | null;
      participantsURL: string | null;
    }
  | TaskMagicFailure
  | TaskMagicHandoff;
export type ForumTaskParticipantsResult =
  | {
      kind: "task-participants";
      taskId: string;
      participants: readonly ForumTaskParticipant[];
    }
  | TaskMagicFailure
  | TaskMagicHandoff;
export type ForumTaskPreparation =
  { kind: "task-action"; action: PreparedForumTaskAction } | TaskMagicFailure;
export type ForumTaskEffectResult = ForumTaskOutcome | TaskMagicFailure;

export type ForumTaskTab = "new" | "doing" | "done";
export type ForumTaskAction = "apply" | "claim" | "abandon";
export interface ForumTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly reward: Readonly<Record<string, unknown>> | null;
  readonly applicants: number | null;
  readonly progress: number | null;
  readonly url: string;
  readonly actions: readonly ForumTaskAction[];
}
export interface ForumTaskParticipant {
  memberId: string;
  username: string;
  avatarURL: string | null;
  status: number | null;
  progress: number | null;
}
export interface PreparedForumTaskAction {
  readonly taskId: string;
  readonly operation: ForumTaskAction;
}
export type ForumTaskOutcome =
  | { kind: "applied"; taskId: string; claimAvailable: boolean }
  | { kind: "rewarded" | "abandoned" | "failed" | "uncertain"; taskId: string }
  | {
      kind: "in-progress";
      taskId: string;
      progress: number | null;
      message: string;
    }
  | { kind: "not-confirmed" };

export type MagicLogDirection = "usage" | "purchase" | "gift" | "receipt";
export interface MagicItem {
  readonly id: string | null;
  readonly identifier: string;
  readonly name: string;
  readonly description: string;
  readonly imageURL: string | null;
  readonly available: boolean;
}
export interface MagicShopItem extends MagicItem {
  readonly price: number | null;
  readonly credit: Readonly<Record<string, unknown>> | null;
}
export interface MagicInventoryItem extends MagicItem {
  readonly count: number | null;
  readonly weight: number | null;
}
export interface MagicCapacity {
  used: number;
  max: number;
}
export interface MagicLogEntry {
  magicId: string | null;
  name: string;
  time: number | null;
  amount?: number | null;
  price?: number | null;
  credit?: Readonly<Record<string, unknown>> | null;
  target?: {
    type: "uid" | "tid" | "pid" | "sell" | "drop";
    id: string | null;
    url: string | null;
  } | null;
  member?: { id: string; username: string } | null;
}
export type MagicPage = { page: number; pages: number };
type MagicReadFailure = TaskMagicFailure | TaskMagicHandoff;
export type MagicShopResult =
  | ({
      kind: "magic-shop";
      items: readonly MagicShopItem[];
      capacity: MagicCapacity | null;
      balances: readonly Readonly<Record<string, unknown>>[];
    } & MagicPage)
  | MagicReadFailure;
export type MagicInventoryResult =
  | ({
      kind: "magic-inventory";
      items: readonly MagicInventoryItem[];
      capacity: MagicCapacity | null;
    } & MagicPage)
  | MagicReadFailure;
export type MagicLogResult =
  | ({
      kind: "magic-log";
      direction: MagicLogDirection;
      entries: readonly MagicLogEntry[];
      timeOffset: number | null;
    } & MagicPage)
  | MagicReadFailure;
export type MagicOperation = "buy" | "use";

export interface MagicField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "number" | "textarea" | "choice";
  readonly value: string;
  readonly required: boolean;
  readonly maxLength: number | null;
  readonly choices: readonly Readonly<{ value: string; label: string }>[];
}
export interface MagicPurchaseTerms {
  readonly price: number | null;
  readonly unitPrice: number | null;
  readonly balance: number | null;
  readonly unitWeight: number | null;
  readonly freeWeight: number | null;
  readonly stock: number | null;
  readonly credit: Readonly<Record<string, unknown>> | null;
}
export interface PreparedMagicForm {
  readonly operation: MagicOperation;
  readonly magicId: string | null;
  readonly identifier: string;
  readonly name: string;
  readonly notes: readonly string[];
  readonly fields: readonly MagicField[];
  readonly purchase: MagicPurchaseTerms | null;
}
export type MagicPreparation =
  | { kind: "magic-form"; form: PreparedMagicForm }
  | TaskMagicFailure
  | TaskMagicHandoff;
export type MagicEffectResult =
  | {
      kind: "purchased" | "used" | "uncertain";
      magicId: string | null;
      identifier: string;
    }
  | { kind: "not-confirmed" }
  | TaskMagicFailure;

export interface TaskMagicClient {
  readTasks(tab: ForumTaskTab): Promise<ForumTaskListResult>;
  readTask(taskId: string): Promise<ForumTaskDetailResult>;
  readTaskParticipants(taskId: string): Promise<ForumTaskParticipantsResult>;
  prepareTaskAction(
    task: ForumTask,
    operation: ForumTaskAction,
  ): ForumTaskPreparation;
  confirmTaskAction(
    action: PreparedForumTaskAction,
    approved: boolean,
  ): Promise<ForumTaskEffectResult>;
  readMagicShop(page?: number): Promise<MagicShopResult>;
  readMagicInventory(page?: number): Promise<MagicInventoryResult>;
  readMagicLog(
    direction: MagicLogDirection,
    page?: number,
  ): Promise<MagicLogResult>;
  prepareMagicPurchase(item: MagicShopItem): Promise<MagicPreparation>;
  prepareMagicUse(item: MagicInventoryItem): Promise<MagicPreparation>;
  confirmMagic(
    form: PreparedMagicForm,
    values: Readonly<Record<string, string>>,
    approved: boolean,
  ): Promise<MagicEffectResult>;
}
