export type SpecialThreadSettings =
  | {
      kind: "poll";
      choices: readonly string[];
      maxChoices?: number;
      expiresAfterDays?: number;
      resultsAfterVote?: boolean;
      publicVotes?: boolean;
    }
  | { kind: "bounty"; price: number }
  | {
      kind: "activity";
      startsAt: string;
      endsAt?: string;
      place: string;
      category: string;
      city?: string;
      capacity?: number;
      cost?: number;
      credit?: number;
      gender?: string;
      expiresAt?: string;
      requiredProfileFields?: readonly string[];
      extraFields?: readonly string[];
    }
  | {
      kind: "debate";
      affirmative: string;
      negative: string;
      endsAt?: string;
      umpire?: string;
    }
  | {
      kind: "red-packet";
      total: number;
      shares: number;
      split?: "lucky" | "even";
      requireReply?: boolean;
      password?: string;
      recipients?: string;
      expiresAfterHours?: string;
      blessing?: string;
    };
export type SpecialThreadKind = SpecialThreadSettings["kind"];
