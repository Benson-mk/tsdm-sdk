import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [manifestPath, mode, ...extra] = process.argv.slice(2);
if (!manifestPath || (mode && mode !== "--preview") || extra.length) {
  throw new Error(
    "Usage: node scripts/prepare-release-notes.mjs <release.json> [--preview]",
  );
}
const { tag, sourceCommit, assetUrl } = JSON.parse(
  readFileSync(manifestPath, "utf8"),
);
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (!stableTag.test(tag) || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("Expected a stable release tag and a full source commit");
}

const version = tag.slice(1);
const assetPath = `/releases/download/${tag}/tsdm-sdk-${version}.tgz`;
const download = new URL(assetUrl);
if (
  download.protocol !== "https:" || !download.pathname.endsWith(assetPath) ||
  download.search || download.hash || download.username || download.password
) {
  throw new Error("Expected the versioned SDK release asset URL");
}
const repository = assetUrl.slice(0, -assetPath.length);
const source = `${repository}/blob/${sourceCommit}`;
const summaryPath = `docs/releases/notes/${tag}.md`;
const summary = existsSync(summaryPath)
  ? readFileSync(summaryPath, "utf8").trim()
  : "";
if (!summary && mode !== "--preview") {
  throw new Error(`Write the version summary in ${summaryPath}`);
}
const qualificationPath = `evidence/release/${version}/README.md`;
const qualified = existsSync(qualificationPath);
if (!qualified && mode !== "--preview") {
  throw new Error(`Record release qualification in ${qualificationPath}`);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const priorTags = git("tag", "--merged", sourceCommit, "--list", "v*")
  .split("\n")
  .filter((name) => name !== tag && stableTag.test(name));
const previousTag = priorTags.length
  ? git(
      "describe", "--tags", "--abbrev=0",
      ...priorTags.flatMap((name) => ["--match", name]),
      sourceCommit,
    )
  : null;
const range = previousTag ? `${previousTag}..${sourceCommit}` : sourceCommit;
const log = git("log", "--no-merges", "--reverse", "--format=%H%x09%s", range);
const { changelog } = JSON.parse(readFileSync(".github/release.yml", "utf8"));
const categories = changelog.categories.map((category) => ({
  ...category,
  entries: [],
}));
const fallback = categories.find((category) => category.labels.includes("*"));
if (!fallback) throw new Error("Release categories need a catch-all '*' category");

const labels = new Map([
  ["feat", "enhancement"],
  ["fix", "bug"],
  ["docs", "documentation"],
]);
for (const line of log ? log.split("\n") : []) {
  const separator = line.indexOf("\t");
  const sha = line.slice(0, separator);
  const subject = line.slice(separator + 1);
  const type = subject.match(/^([a-z]+)(?:\([^)]*\))?!?: /)?.[1];
  const category = categories.find(({ labels: keys }) =>
    keys.includes(labels.get(type)),
  );
  const escaped = subject.replace(/[\\`*_{}[\]<>]/g, "\\$&");
  (category ?? fallback).entries.push(
    `- ${escaped} ([${sha.slice(0, 7)}](${repository}/commit/${sha}))`,
  );
}

const sections = categories.flatMap(({ title, entries }) =>
  entries.length ? [`### ${title}`, "", ...entries, ""] : [],
);
const changes = previousTag
  ? `${repository}/compare/${previousTag}...${sourceCommit}`
  : `${repository}/commits/${sourceCommit}`;
console.log([
  summary || `> Release summary pending. Add \`${summaryPath}\`.`,
  "",
  "## What's Changed",
  "",
  ...(sections.length ? sections : ["No non-merge commits in this release.", ""]),
  `[Full changelog](${changes})`,
  "",
  "## Install",
  "",
  "Use Node.js 26.x and import the ESM package from `tsdm-sdk`.",
  "",
  "```sh",
  `npm install --save-exact --engine-strict ${assetUrl}`,
  "```",
  "",
  `[Installation guide](${source}/INSTALL.md) · [Release manifest](${repository}/releases/download/${tag}/release.json)`,
  "",
  qualified
    ? `[Release qualification](${source}/${qualificationPath})`
    : `> Release qualification pending. Add \`${qualificationPath}\`.`,
].join("\n"));
