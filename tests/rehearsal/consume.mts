import { createForumClient, type ForumTransport } from "tsdm-sdk";

const transport: ForumTransport = {
  async request() {
    throw new Error("The import probe does not make forum requests");
  },
};
const client = createForumClient({ origin: "https://forum.test", transport });
if (typeof client.readThread !== "function") {
  throw new Error("The package root did not create a thread reader");
}

// @ts-expect-error The consumer compiles without DOM types.
type DocumentGlobal = typeof document;
