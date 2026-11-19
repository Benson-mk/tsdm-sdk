import type { ContentNode } from "./types.js";

export interface MemberProfileField {
  id: string | null;
  title: string;
  text: string;
  content: ContentNode[];
}

export interface MemberProfileGroup {
  id: string | null;
  title: string;
  iconURL: string | null;
}

export interface MemberProfile {
  avatarURL: string | null;
  online: boolean | null;
  emailVerified: boolean | null;
  videoVerified: boolean | null;
  customTitle: string | null;
  signature: ContentNode[];
  secondaryTitleURL: string | null;
  fields: MemberProfileField[];
  medals: {
    id: string | null;
    name: string;
    imageURL: string | null;
    description: string;
  }[];
  managedForums: { id: string; name: string; url: string }[];
  groups: {
    admin: MemberProfileGroup | null;
    member: MemberProfileGroup | null;
  };
  activity: {
    onlineHours: number | null;
    registeredAt: number | string | null;
    lastVisitedAt: number | string | null;
    lastActiveAt: number | string | null;
    lastPostedAt: number | string | null;
    registeredIP: string | null;
    lastVisitIP: string | null;
    timezone: string | null;
  };
  timeOffsetHours: number | null;
  checkin: {
    days: number | null;
    monthDays: number | null;
    lastAt: number | string | null;
    reward: number | null;
    lastReward: number | null;
    today: boolean | null;
    level: {
      current: string | null;
      next: string | null;
      remainingDays: number | null;
    } | null;
  } | null;
  stats: {
    friends: number | null;
    friendsURL: string | null;
    points: number | null;
    credits: {
      id: string | null;
      title: string;
      text: string;
      value: number | null;
      unit: string;
    }[];
  };
  unread: { notices: number | null; privateMessages: boolean | null };
}
