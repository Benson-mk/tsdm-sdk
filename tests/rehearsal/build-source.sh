#!/bin/sh
set -eu

source_commit=$1
output=$2
if [ "$(git rev-parse --verify "$source_commit^{commit}")" != "$source_commit" ]; then
  printf '%s\n' 'Pass the full committed source SHA.' >&2
  exit 1
fi
mkdir -p "$output"
output=$(cd "$output" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
trap 'exit 1' HUP INT TERM

git archive --output="$scratch/source.tar" "$source_commit"
mkdir "$scratch/source"
tar -xf "$scratch/source.tar" -C "$scratch/source"
(
  cd "$scratch/source"
  npm ci --ignore-scripts --no-audit --no-fund
  npm run pack:sdk
)

cp "$scratch/source/dist/tsdm-sdk-0.1.0.tgz" "$output/"
node --input-type=module - "$source_commit" "$output" <<'JS'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [sourceCommit, output] = process.argv.slice(2);
const name = "tsdm-sdk";
const version = "0.1.0";
const tag = `v${version}`;
const filename = `${name}-${version}.tgz`;
const sha256 = createHash("sha256")
  .update(readFileSync(join(output, filename)))
  .digest("hex");
const assetUrl = `https://github.com/Benson-mk/tsdm-sdk/releases/download/${tag}/${filename}`;
const manifest = { name, version, tag, sourceCommit, filename, sha256, assetUrl };
writeFileSync(join(output, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
JS
