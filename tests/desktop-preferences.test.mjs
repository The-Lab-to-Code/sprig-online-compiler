import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const { createPreferences } = createRequire(import.meta.url)("../desktop/preferences.js");

test("desktop preferences persist and reject invalid values", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sprig-preferences-"));
  try {
    const prefs = createPreferences(dir);
    assert.deepEqual(prefs.get(), { startup: "home", theme: null, onlineRunning: false });
    prefs.update({ startup: "editor", theme: "dark", onlineRunning: true });
    assert.deepEqual(createPreferences(dir).get(), { startup: "editor", theme: "dark", onlineRunning: true });
    assert.throws(() => prefs.update({ startup: "unknown" }), /Invalid/);
    assert.deepEqual(createPreferences(dir).get(), { startup: "editor", theme: "dark", onlineRunning: true });
    writeFileSync(path.join(dir, "preferences.json"), "{}");
    assert.throws(() => createPreferences(dir), /Invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
