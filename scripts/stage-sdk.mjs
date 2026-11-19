import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const stage = new URL("dist/sdk/", root);
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
    "README.md",
    "notices/",
  ],
};
writeFileSync(
  new URL("package.json", stage),
  JSON.stringify(manifest, null, 2) + "\n",
);
copyFileSync(new URL("README.md", root), new URL("README.md", stage));
mkdirSync(new URL("forum-client/", stage));
for (const declaration of ["index.d.ts", "forum-client/types.d.ts"]) {
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
