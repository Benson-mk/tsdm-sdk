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
    "forum-client/account-client.d.ts",
    "forum-client/profile-client.d.ts",
    "forum-client/member-reads.d.ts",
    "forum-client/member-client.d.ts",
    "forum-client/discovery.d.ts",
    "forum-client/discovery/",
    "README.md",
    "docs/discovery.md",
    "docs/account.md",
    "docs/profile.md",
    "docs/members.md",
    "docs/notices.md",
    "notices/",
  ],
};
writeFileSync(
  new URL("package.json", stage),
  JSON.stringify(manifest, null, 2) + "\n",
);
copyFileSync(new URL("README.md", root), new URL("README.md", stage));
mkdirSync(new URL("docs/", stage));
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
mkdirSync(new URL("forum-client/", stage));
mkdirSync(new URL("forum-client/discovery/", stage));
for (const declaration of [
  "index.d.ts",
  "forum-client/account-client.d.ts",
  "forum-client/profile-client.d.ts",
  "forum-client/types.d.ts",
  ...noticeDeclarations,
  "forum-client/member-reads.d.ts",
  "forum-client/member-client.d.ts",
  "forum-client/discovery.d.ts",
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
