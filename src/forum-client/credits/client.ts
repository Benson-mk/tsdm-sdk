import { noticeHost } from "../notice-transport.js";
import { createGroupReads } from "./groups.js";
import { createGroupSwitch } from "./switch.js";
import { createLedger } from "./ledger.js";
import { createAttendance } from "./attendance.js";
import type { CreditsClientOptions } from "./types.js";

export function createCreditsClient(options: CreditsClientOptions) {
  const host = noticeHost(options);
  return {
    ...createAttendance(host),
    ...createLedger(host),
    ...createGroupReads(host),
    ...createGroupSwitch(host),
  };
}
