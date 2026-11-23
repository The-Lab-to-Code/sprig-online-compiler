import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf('$("requestForm").addEventListener("submit"');
const end = html.indexOf("const isDark=", start);
assert.ok(start >= 0 && end > start, "Language request handler is missing");
const handler = html.slice(start, end);

function requestPage(fetch) {
  const elements = {
    requestForm: {
      action: "https://formspree.io/f/xoedpvle",
      addEventListener(type, callback) { this.submit = callback; },
      reset() { this.resetCalled = true; }
    },
    requestSubmit: { disabled: false },
    requestStatus: { textContent: "", dataset: {} },
    requestLanguage: { value: "Scala", focus() { this.focused = true; } }
  };
  const context = vm.createContext({
    $: id => elements[id], fetch,
    FormData: class { constructor(form) { this.form = form; } }
  });
  vm.runInContext(handler, context);
  return { elements, submit: () => elements.requestForm.submit({ preventDefault() {} }) };
}

test("language requests submit to Formspree and clear only after success", async () => {
  let release, sent;
  const { elements, submit } = requestPage((url, options) => {
    sent = { url, options };
    return new Promise(resolve => { release = resolve; });
  });
  const pending = submit();
  assert.equal(elements.requestSubmit.disabled, true);
  assert.equal(sent.url, "https://formspree.io/f/xoedpvle");
  assert.equal(sent.options.method, "POST");
  release({ ok: true });
  await pending;
  assert.equal(elements.requestSubmit.disabled, false);
  assert.equal(elements.requestForm.resetCalled, true);
  assert.equal(elements.requestStatus.dataset.state, "success");
});

test("failed requests keep the form and show the service's error", async () => {
  const { elements, submit } = requestPage(async () => ({
    ok: false, status: 422, headers: { get: () => "application/json" },
    json: async () => ({ errors: [{ message: "Form is inactive." }] })
  }));
  await submit();
  assert.match(elements.requestStatus.textContent, /Form is inactive/);
  assert.equal(elements.requestStatus.dataset.state, "error");
  assert.equal(elements.requestForm.resetCalled, undefined);
  assert.equal(elements.requestSubmit.disabled, false);
});

test("blank language names are rejected without sending", async () => {
  const { elements, submit } = requestPage(() => { throw new Error("Unexpected request"); });
  elements.requestLanguage.value = "   ";
  await submit();
  assert.match(elements.requestStatus.textContent, /Enter a language/);
  assert.equal(elements.requestLanguage.focused, true);
});
