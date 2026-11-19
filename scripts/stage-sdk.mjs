import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const stage = new URL("dist/sdk/", root);
const noticeDeclarations = [
  "forum-client/native-notices.d.ts",
  "forum-client/notices.d.ts",
  ...["client", "ignore", "links", "poll", "transport"].map(
    (name) => `forum-client/notice-${name}.d.ts`,
  ),
];
const creditsDeclarations = ["forum-client/credits/client.d.ts", "forum-client/credits/types.d.ts"];
const collectionDeclarations = [
  "forum-client/collection-client.d.ts",
  "forum-client/collection-types.d.ts",
];
const mediaDeclarations = ["forum-client/media/client.d.ts", "forum-client/media/types.d.ts"];
const activityDeclarations = [
  "forum-client/activity-client.d.ts",
  "forum-client/activity-read-types.d.ts",
  "forum-client/activity-effects.d.ts",
];
const manifest = {
  name: "tsdm-sdk",
  version: "0.1.0",
  description: "Unofficial TypeScript SDK for the TSDM forum",
  private: true,
  type: "module",
  engines: { node: "26.x" },
  exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
  files: [
    "index.js",
    "index.d.ts",
    "forum-client/types.d.ts",
    ...noticeDeclarations,
    ...creditsDeclarations,
    ...activityDeclarations,
    ...mediaDeclarations,
    "forum-client/replies.d.ts",
    "forum-client/reply-verification.d.ts",
    ...collectionDeclarations,
    "forum-client/message-client.d.ts",
    "forum-client/message-effects.d.ts",
    "forum-client/account-client.d.ts",
    "forum-client/profile-client.d.ts",
    "forum-client/member-reads.d.ts",
    "forum-client/member-client.d.ts",
    "forum-client/discovery.d.ts",
    "forum-client/discovery/",
    "forum-client/spaces/",
    "forum-client/posts/client.d.ts",
    "forum-client/special/",
    "forum-client/trades/client.d.ts",
    "README.md",
    "docs/replies.md",
    "docs/posts.md",
    "docs/special-threads.md",
    "docs/discovery.md",
    "docs/account.md",
    "docs/profile.md",
    "docs/members.md",
    "docs/notices.md",
    "docs/messages.md",
    "docs/spaces.md",
    "docs/collections.md",
    "docs/activity.md",
    "docs/media.md",
    "docs/trades.md",
    "docs/credits.md",
    "notices/",
  ],
};
writeFileSync(
  new URL("package.json", stage),
  JSON.stringify(manifest, null, 2) + "\n",
);
copyFileSync(new URL("README.md", root), new URL("README.md", stage));
mkdirSync(new URL("docs/", stage));
copyFileSync(new URL("docs/replies.md", root), new URL("docs/replies.md", stage));
copyFileSync(new URL("docs/posts.md", root), new URL("docs/posts.md", stage));
copyFileSync(
  new URL("docs/special-threads.md", root),
  new URL("docs/special-threads.md", stage),
);
copyFileSync(
  new URL("docs/discovery.md", root),
  new URL("docs/discovery.md", stage),
);
copyFileSync(
  new URL("docs/account.md", root),
  new URL("docs/account.md", stage),
);
copyFileSync(
  new URL("docs/profile.md", root),
  new URL("docs/profile.md", stage),
);
copyFileSync(
  new URL("docs/members.md", root),
  new URL("docs/members.md", stage),
);
copyFileSync(new URL("docs/notices.md", root), new URL("docs/notices.md", stage));
copyFileSync(new URL("docs/messages.md", root), new URL("docs/messages.md", stage));
copyFileSync(new URL("docs/spaces.md", root), new URL("docs/spaces.md", stage));
copyFileSync(
  new URL("docs/collections.md", root),
  new URL("docs/collections.md", stage),
);
copyFileSync(
  new URL("docs/activity.md", root),
  new URL("docs/activity.md", stage),
);
copyFileSync(new URL("docs/media.md", root), new URL("docs/media.md", stage));
copyFileSync(new URL("docs/trades.md", root), new URL("docs/trades.md", stage));
copyFileSync(new URL("docs/credits.md", root), new URL("docs/credits.md", stage));
mkdirSync(new URL("forum-client/", stage));
mkdirSync(new URL("forum-client/credits/", stage));
mkdirSync(new URL("forum-client/media/", stage));
mkdirSync(new URL("forum-client/discovery/", stage));
mkdirSync(new URL("forum-client/spaces/", stage));
mkdirSync(new URL("forum-client/posts/", stage));
mkdirSync(new URL("forum-client/special/", stage));
mkdirSync(new URL("forum-client/trades/", stage));
for (const declaration of [
  "forum-client/trades/client.d.ts",
  "forum-client/special/client.d.ts",
  "forum-client/special/types.d.ts",
  "forum-client/special/participation.d.ts",
  "forum-client/posts/client.d.ts",
  "index.d.ts",
  "forum-client/replies.d.ts",
  "forum-client/reply-verification.d.ts",
  "forum-client/message-client.d.ts",
  "forum-client/message-effects.d.ts",
  "forum-client/account-client.d.ts",
  "forum-client/profile-client.d.ts",
  "forum-client/types.d.ts",
  ...noticeDeclarations,
  ...creditsDeclarations,
  ...activityDeclarations,
  ...mediaDeclarations,
  ...collectionDeclarations,
  "forum-client/member-reads.d.ts",
  "forum-client/member-client.d.ts",
  "forum-client/discovery.d.ts",
  ...["client", "model"].map((name) => `forum-client/spaces/${name}.d.ts`),
  ...["types", "lists", "search", "activity", "statistics"].map(
    (name) => `forum-client/discovery/${name}.d.ts`,
  ),
]) {
  copyFileSync(
    new URL(`dist/sdk-types/${declaration}`, root),
    new URL(declaration, stage),
  );
}

const notices = new URL("notices/", stage);
mkdirSync(notices);
for (const [name, version] of [
  ["parse5", "8.0.1"],
  ["entities", "8.1.0"],
]) {
  const installed = new URL(`node_modules/${name}/`, root);
  assert.equal(
    JSON.parse(readFileSync(new URL("package.json", installed), "utf8"))
      .version,
    version,
  );
  const license = readFileSync(new URL("LICENSE", installed));
  const filename = `${name}-${version}.LICENSE`;
  assert.deepEqual(
    license,
    readFileSync(new URL(`evidence/history/notices/${filename}`, root)),
  );
  writeFileSync(new URL(filename, notices), license);
}
