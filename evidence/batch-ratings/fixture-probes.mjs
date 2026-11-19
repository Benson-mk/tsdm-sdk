import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function fixtureProbes(upstream) {
  if (!upstream) return null;
  const pins = JSON.parse(readFileSync(new URL("pins.json", import.meta.url)));
  const checked = new Map();
  for (const [path, sha256] of Object.entries(pins.sha256)) {
    const bytes = readFileSync(join(upstream, path));
    assert.equal(digest(bytes), sha256, path);
    if (path.endsWith(".json")) checked.set(path, JSON.parse(bytes));
  }
  const source = (name) =>
    checked.get(`test/data/tsdmapp_390/batchrate_${name}.json`);
  const data = source("confirm_recalc_r3");
  const { floors } = data;
  const fields = {
    formhash: "fictitious-formhash",
    brmode: "3",
    fid: "2",
    tid: "42",
    tids: "",
    pids: "",
    floors,
  };
  const metadata = Object.fromEntries(
    Object.entries(data.submit).filter(
      ([name]) => name.endsWith("_field") || name === "modes",
    ),
  );
  const preview = {
    type: data.type,
    schema: data.schema,
    ok: data.ok,
    uid: 31,
    fid: 2,
    tid: 42,
    mode: data.mode,
    floors,
    total: data.total,
    apply: data.apply,
    multsum: data.multsum,
    chunks: data.chunks,
    blocked: data.blocked,
    credits: data.credits.map(({ id, min, max, score, cond }) => ({
      id,
      min,
      max,
      score,
      cond,
      title: "Fictitious credit",
      unit: "",
    })),
    quota: data.quota.map(({ id, need, left, ok }) => ({ id, need, left, ok })),
    reason: {
      value: "Fictitious reviewed reason",
      required: data.reason.required,
    },
    notify: data.notify,
    antispam: data.antispam,
    exclude: "Fictitious excluded member",
    errors: [],
    precheck: { ok: data.precheck.ok, errors: [] },
    cond_credits: data.cond_credits.map(({ id, cond }) => ({
      id,
      title: "Fictitious threshold",
      cond,
    })),
    items: data.items.map(({ position, status, mult }, n) => ({
      itemid: 0,
      tid: 42,
      pid: 201 + n,
      position,
      status,
      mult,
      authorid: 61 + n,
      author: `Fictitious Member ${n}`,
    })),
    submit: {
      ...metadata,
      url: "plugin.php?id=batchrate:rate",
      method: data.submit.method,
      fields,
    },
  };
  const receipt = (name) => {
    const { ok, type, schema, kind, handlekey, values, alert } = source(name);
    return { ok, type, schema, kind, handlekey, values, alert, uid: 31 };
  };
  return {
    commit: pins.commit,
    sourceCount: Object.keys(pins.sha256).length,
    preview,
    run: [receipt("run_step"), receipt("run_done")],
    undoItem: receipt("undo_item_ok"),
    undoBatch: [receipt("undo_batch_step"), receipt("undo_batch_done")],
  };
}
