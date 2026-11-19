import type { ForumTransport } from "../index.js";
import { createListReads } from "./discovery/lists.js";
import { createSearchReads } from "./discovery/search.js";
import { createActivityReads } from "./discovery/activity.js";
import { createStatisticsReads } from "./discovery/statistics.js";

export type { DiscoveryFailure, DiscoveryThread } from "./discovery/types.js";
export type {
  GuideModule,
  GuideResult,
  GuideView,
  MemberActivityOptions,
  MemberActivityResult,
} from "./discovery/lists.js";
export type {
  SearchPage,
  SearchQuery,
  SearchResult,
} from "./discovery/search.js";
export type { RankingsResult, TagResult } from "./discovery/activity.js";
export type {
  StatisticsCell,
  StatisticsPage,
  StatisticsResult,
  StatisticsTable,
  TrendData,
  TrendResult,
} from "./discovery/statistics.js";

export function createDiscoveryOperations(
  origin: string,
  transport: ForumTransport,
) {
  return {
    ...createListReads(origin, transport),
    ...createSearchReads(origin, transport),
    ...createActivityReads(origin, transport),
    ...createStatisticsReads(origin, transport),
  };
}
