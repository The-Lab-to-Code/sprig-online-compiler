import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("const nextName=");
const end = html.indexOf("// ---- quick pick", start);
assert.ok(start >= 0 && end > start, "Editor tab functions are missing");
const tabFunctions = html.slice(start, end);

function editor() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: "" });
    return elements.get(id);
  };
  const context = vm.createContext({
    tabs: [], active: -1, untitledN: 0, job: null,
    code: { value: "" },
    L: { js: { name: "JavaScript", s: "starter" } },
    ORDER: ["js"],
    $: element,
    document: { querySelector: element },
    executionTarget: () => "Runs in browser",
    refresh: () => {},
    confirm: () => true
  });
  vm.runInContext(tabFunctions + "\nrefreshVersionSelector=()=>{};renderTabs=()=>{};renderOpen=()=>{};", context);
  return { context, element, run: source => vm.runInContext(source, context) };
}

test("closing the last tab shows an empty editor until a file is opened", () => {
  const { context, element, run } = editor();
  run('newTab("first.js","js","first"); closeTab(0)');
  assert.equal(context.tabs.length, 0);
  assert.equal(context.active, -1);
  assert.equal(element("emptyEditor").hidden, false);
  assert.equal(element(".ed").hidden, true);
  assert.equal(element("run").disabled, true);

  run('newTab("next.js","js","next")');
  assert.equal(element("emptyEditor").hidden, true);
  assert.equal(element(".ed").hidden, false);
  assert.equal(element("run").disabled, false);
  assert.equal(context.code.value, "next");
});

test("closing another tab keeps active edits and honors discard cancellation", () => {
  const { context, element, run } = editor();
  run('newTab("first.js","js","first"); newTab("second.js","js","second")');
  context.tabs[0].dirty = true;
  context.code.value = "unsaved second";
  context.confirm = () => false;
  run("closeTab(0)");
  assert.equal(context.tabs.length, 2);
  assert.equal(context.code.value, "unsaved second");

  context.confirm = () => true;
  run("closeTab(0)");
  assert.equal(context.tabs.length, 1);
  assert.equal(context.tabs[0].name, "second.js");
  assert.equal(context.code.value, "unsaved second");
  assert.equal(element("emptyEditor").hidden, true);
});

test("late starter examples fill untouched new tabs but preserve edits and files", () => {
  const { context, run } = editor();
  context.L.ada = { name: "Ada", s: "" };
  context.ORDER.push("ada");
  run('newTab("draft","ada",""); newTab("saved","ada","",{name:"saved"}); newTab("edited","ada","")');
  context.tabs[2].dirty = true;
  context.code.value = "my code";
  context.L.ada.s = "Ada starter";
  run("fillPendingStarters()");
  assert.equal(context.tabs[0].text, "Ada starter");
  assert.equal(context.tabs[1].text, "");
  assert.equal(context.code.value, "my code");
  run("activate(0)");
  assert.equal(context.code.value, "Ada starter");
  context.L.late = { name: "Late language", s: "" };
  context.ORDER.push("late");
  run('setLang("late")');
  context.L.late.s = "Late starter";
  run("fillPendingStarters()");
  assert.equal(context.code.value, "Late starter");
});
