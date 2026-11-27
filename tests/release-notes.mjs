import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

using workspace = mkdtempDisposableSync(join(tmpdir(), "tsdm-sdk-notes-"));
const cwd = workspace.path;
const renderer = fileURLToPath(
  new URL("../scripts/prepare-release-notes.mjs", import.meta.url),
);
const git = (...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

git("init", "--quiet", "--initial-branch=main");
git("config", "user.name", "Release rehearsal");
git("config", "user.email", "rehearsal@example.invalid");
git("config", "commit.gpgsign", "false");
git("config", "tag.gpgsign", "false");
git("commit", "--quiet", "--allow-empty", "-m", "Initial public SDK");
git("tag", "v0.1.0");
git("commit", "--quiet", "--allow-empty", "-m", "fix(reads): restore [native] fallback");
git("tag", "v0.1.1-rc.1");
git("commit", "--quiet", "--allow-empty", "-m", "docs: clarify installation");
git("commit", "--quiet", "--allow-empty", "-m", "feat: support a new format");
git("commit", "--quiet", "--allow-empty", "-m", "chore: refresh release tooling");
git("tag", "v0.1.1");
const sourceCommit = git("rev-parse", "HEAD");
const repository = "https://github.com/owner/sdk";
const assetUrl = `${repository}/releases/download/v0.1.1/tsdm-sdk-0.1.1.tgz`;
const manifest = { tag: "v0.1.1", sourceCommit, assetUrl };
const manifestPath = join(cwd, "release.json");
const notesPath = join(cwd, "docs/releases/notes/v0.1.1.md");
mkdirSync(join(cwd, ".github"));
mkdirSync(join(cwd, "docs/releases/notes"), { recursive: true });
cpSync(new URL("../.github/release.yml", import.meta.url), join(cwd, ".github/release.yml"));
writeFileSync(manifestPath, JSON.stringify(manifest));

const render = (...args) =>
  spawnSync(process.execPath, [renderer, manifestPath, ...args], {
    cwd,
    encoding: "utf8",
  });

const missing = render();
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /Write the version summary/);
const incomplete = render("--preview");
assert.equal(incomplete.status, 0, incomplete.stderr);
assert.match(incomplete.stdout, /Release summary pending/);
assert.match(incomplete.stdout, /Release qualification pending/);

writeFileSync(notesPath, "## 0.1.1: restore native reads\n\nReviewed release summary.\n");
const unqualified = render();
assert.notEqual(unqualified.status, 0);
assert.match(unqualified.stderr, /Record release qualification/);
mkdirSync(join(cwd, "evidence/release/0.1.1"), { recursive: true });
writeFileSync(join(cwd, "evidence/release/0.1.1/README.md"), "Qualified archive.\n");
const prepared = render();
assert.equal(prepared.status, 0, prepared.stderr);
assert.ok(prepared.stdout.startsWith(readFileSync(notesPath, "utf8")));
assert.match(prepared.stdout, /### New features\n\n- feat: support a new format/);
assert.match(prepared.stdout, /### Fixes\n\n- fix\(reads\): restore \\\[native\\\] fallback/);
assert.match(prepared.stdout, /### Documentation\n\n- docs: clarify installation/);
assert.match(prepared.stdout, /### Other changes\n\n- chore: refresh release tooling/);
assert.ok(!prepared.stdout.includes("Initial public SDK"));
assert.ok(prepared.stdout.includes(`${repository}/compare/v0.1.0...${sourceCommit}`));
assert.ok(prepared.stdout.includes(`npm install --save-exact --engine-strict ${assetUrl}`));
assert.ok(prepared.stdout.includes(`${repository}/blob/${sourceCommit}/INSTALL.md`));
assert.ok(prepared.stdout.includes(`${repository}/blob/${sourceCommit}/evidence/release/0.1.1/README.md`));
assert.equal(render("--preview").stdout, prepared.stdout);

writeFileSync(notesPath, " \n");
assert.notEqual(render().status, 0);
writeFileSync(manifestPath, JSON.stringify({ ...manifest, tag: "v0.1.1-rc.1" }));
assert.notEqual(render("--preview").status, 0);

console.log("Release-note rehearsal passed: preview, categories, links, tag selection, and missing inputs.");
