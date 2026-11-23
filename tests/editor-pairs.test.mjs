import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const pairStart = html.indexOf("function handleAutoPairs(");
const pairEnd = html.indexOf('code.addEventListener("keydown"', pairStart);
assert.ok(pairStart >= 0 && pairEnd > pairStart);

function editor(value = "", start = value.length, end = start) {
  const code = {
    value, selectionStart: start, selectionEnd: end, inputs: 0,
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    setRangeText(text, a, b) { this.value = this.value.slice(0, a) + text + this.value.slice(b); },
    dispatchEvent() { this.inputs++; }
  };
  const context = vm.createContext({
    code, Event: class {}, refresh() {},
    document: { execCommand(_command, _ui, text) {
      code.setRangeText(text, code.selectionStart, code.selectionEnd);
      code.inputs++;
      return true;
    } }
  });
  vm.runInContext(html.slice(pairStart, pairEnd), context);
  return {
    code,
    key(key, extras = {}) {
      const event = { key, preventDefault() { this.prevented = true; }, ...extras };
      context.handleAutoPairs(event);
      return event;
    }
  };
}

test("inserts matching brackets and quotes with the caret inside", () => {
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["'", "'"], ['"', '"'], ["`", "`"]]) {
    const e = editor();
    assert.equal(e.key(open).prevented, true);
    assert.equal(e.code.value, open + close);
    assert.equal(e.code.selectionStart, 1);
    assert.equal(e.code.inputs, 1);
  }
});

test("wraps selections, skips existing closers, and removes empty pairs", () => {
  const selected = editor("hello", 0, 5);
  selected.key("(");
  assert.equal(selected.code.value, "(hello)");
  assert.deepEqual([selected.code.selectionStart, selected.code.selectionEnd], [1, 6]);
  const paired = editor("()", 1);
  paired.key(")");
  assert.equal(paired.code.value, "()");
  assert.equal(paired.code.selectionStart, 2);
  paired.code.setSelectionRange(1, 1);
  paired.key("Backspace");
  assert.equal(paired.code.value, "");
  assert.equal(paired.code.inputs, 1);
});

test("does not interfere with escaped quotes, apostrophes, strings, or shortcuts", () => {
  for (const [source, key, extras] of [
    ["\\", '"', {}], ["word", "'", {}], ['"hello ', '"', {}],
    ["", "(", { ctrlKey: true }], ["", "(", { isComposing: true }], ["a", "<", {}]
  ]) {
    const e = editor(source);
    assert.equal(e.key(key, extras).prevented, undefined, source);
    assert.equal(e.code.value, source);
  }
});
