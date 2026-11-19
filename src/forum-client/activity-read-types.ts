type Thread = { threadId: string };
type Post = Thread & { postId: string };
export type ActivityQuery =
  | ({ view: "ratings" } & Post)
  | ({ view: "voters"; optionId?: string; page?: number } & Thread)
  | ({ view: "moderation" | "payments" } & Thread)
  | ({ view: "warnings"; memberId: string } & Thread)
  | ({ view: "comments"; page: number } & Post);

export type Member = { memberId: string; name: string };
type Time = number | string;
type Credit = { id?: string; title: string; unit?: string };
type Operator = { memberId?: string; label: string; kind?: string };
type Rating = Member & {
  credit: Credit;
  score: number;
  time: Time;
  reason: string;
  digest?: boolean;
};
type Moderation = {
  operator: Operator;
  time: Time;
  action?: string;
  description: string;
  expiration?: Time;
  active?: boolean;
  unlimited?: boolean;
  reason?: string;
  magic?: string;
};
type Payment = Member & { time: Time; amount: number; displayAmount?: string };
type Warning = { operator: Operator; time: string; reason: string };
type Comment = Member & {
  time: Time;
  message: string;
  id?: string;
  replyPostId?: string;
  canDelete?: boolean;
};
export type ActivityFailure =
  | { kind: "refused"; code: string; message: string }
  | { kind: "incomplete" | "invalid" | "session-changed"; message: string };
export type ActivityRead = {
  sourceURL: string;
  viewerId: string;
  target: ActivityQuery;
} & (
  | {
      kind: "ratings";
      rows: Rating[];
      count?: number;
      totals?: { credit: Credit; score: number }[];
    }
  | {
      kind: "voters";
      rows: Member[];
      optionId?: string;
      options?: { id: string; text: string; selected: boolean }[];
      page?: number;
      pages?: number;
      count?: number;
      hasNext?: boolean;
    }
  | {
      kind: "moderation";
      rows: Moderation[];
      count?: number;
      reasonsPublic?: boolean;
    }
  | { kind: "payments"; rows: Payment[]; count?: number; credit?: Credit }
  | { kind: "warnings"; rows: Warning[]; summary?: string }
  | {
      kind: "comments";
      rows: Comment[];
      scores?: { name: string; score: number }[];
      page?: number;
      pages?: number;
      count?: number;
      hasNext?: boolean;
    }
);
