import type {
  NoticeClientOptions,
  NoticeRequest,
  NoticeSession,
} from "../notice-transport.js";
export type CreditsClientOptions = NoticeClientOptions;
export type CreditsRequest = NoticeRequest;
export type CreditsSession = NoticeSession;
export type CreditsFailure = {
  kind:
    | "refused"
    | "rate-limited"
    | "invalid-input"
    | "invalid-response"
    | "session-changed"
    | "network";
  message: string;
  code?: string;
  retryAfterSeconds?: number;
};
export type CreditsHandoff = {
  kind: "browser-handoff";
  destination: string;
  message: string;
};
export type Attendance = {
  kind: "attendance";
  memberId: string;
  source: "plugin" | "native";
  checkedToday: boolean;
  canCheckIn?: boolean;
  window?: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    openNow: boolean;
  };
  dayStart?: number;
  observedAt?: number;
  lastTime?: number;
  days?: number;
  monthDays?: number;
};
export type AttendanceResult = Attendance | CreditsFailure;
export type CheckInFeeling =
  "kx" | "ng" | "ym" | "wl" | "nu" | "ch" | "fd" | "yl" | "shuai";
export interface CheckInChoice {
  feeling: CheckInFeeling;
  message: string;
}
export interface CheckInForm {
  readonly memberId: string;
  readonly dayStart?: number;
  readonly source: "plugin" | "native";
}
export type CheckInPreparation =
  | CreditsFailure
  | CreditsHandoff
  | { kind: "checkin-ready"; form: CheckInForm }
  | { kind: "already-checked" | "closed"; attendance: Attendance };
export type CheckInResult =
  | CreditsFailure
  | ((
      | {
          kind: "checked-in" | "already-checked" | "attendance-observed";
          checkedToday: boolean;
          attendance: Attendance;
          message: string;
        }
      | { kind: "unknown"; message: string; interruption?: CreditsFailure }
    ) & { memberId: string; choice: CheckInChoice });

export interface CreditValue {
  id?: string;
  title: string;
  value: number;
  unit?: string;
}
export interface CreditChange {
  id?: string;
  operation: string;
  operationCode: string;
  direction: "income" | "expense" | "unknown";
  changes: CreditValue[];
  after: CreditValue[];
  detail: string;
  date: string;
  timestamp?: number;
  destination?: string;
}
export interface CreditBalance {
  kind: "credit-balance";
  source: "plugin" | "native";
  memberId: string;
  credits: CreditValue[];
  total: { value: number; formula?: string };
  recent: CreditChange[];
  rules?: CreditsHandoff;
}
export interface CreditLogQuery {
  creditId?: string;
  direction?: -1 | 0 | 1;
  operation?: string;
  start?: string;
  end?: string;
  page?: number;
}
export interface CreditLog {
  kind: "credit-log";
  memberId: string;
  source: "plugin" | "native";
  query: Required<CreditLogQuery>;
  rows: CreditChange[];
  count?: number;
  page: number;
  pages?: number;
  hasNext?: boolean;
  filters: {
    credit: { value: string; name: string }[];
    direction: { value: string; name: string }[];
    operation: { value: string; name: string }[];
  };
}
export interface AttendanceCalendar {
  kind: "attendance-calendar";
  memberId: string;
  month: string;
  start: string;
  end: string;
  days: string[];
  pagesRead: number;
  complete: boolean;
  interruption?: CreditsFailure;
}

export interface GroupPermissionSection {
  key: string;
  name: string;
  rows: { key: string; label: string; value: string | number | boolean }[];
}
export interface GroupSummary {
  id?: string;
  title: string;
  stars?: number;
  credits?: number;
  permissions?: GroupPermissionSection[];
}
export interface GroupDetail extends GroupSummary {
  category?: string;
  threshold?: number;
  remaining?: number;
  expiry?: number;
}
export interface GroupMenu {
  key: string;
  name: string;
  groups: { id?: string; title: string; active: boolean }[];
}
export interface Groups {
  kind: "groups";
  source: "plugin" | "native";
  memberId: string;
  current: GroupSummary;
  menus: GroupMenu[];
  viewed?: GroupDetail;
}
export interface GroupProgress {
  kind: "group-progress";
  source: "plugin" | "native";
  memberId: string;
  current: GroupSummary;
  next?: GroupDetail;
}
export interface ExpiringGroup {
  id: string;
  title: string;
  expiry: string;
  expired?: boolean;
  main?: boolean;
  price?: string;
  canSwitch: boolean;
}
export interface GroupExpiry {
  kind: "group-expiry";
  memberId: string;
  source: "plugin" | "native";
  view: "expiry" | "list";
  currentTitle: string;
  groups: ExpiringGroup[];
  balance?: CreditValue;
  expiredNotice?: boolean;
}
export interface GroupSwitchForm {
  readonly memberId: string;
  readonly groupId: string;
  readonly from: string;
  readonly to: string;
}
export type GroupSwitchPreparation =
  | CreditsFailure
  | CreditsHandoff
  | { kind: "switch-ready"; form: GroupSwitchForm };
export type GroupSwitchResult =
  | CreditsFailure
  | ((
      | { kind: "switched" | "unknown" | "redrawn"; message: string }
      | {
          kind: "switch-handoff";
          effect: "unknown";
          destination: string;
          message: string;
        }
    ) & { memberId: string; groupId: string; from: string; to: string });
