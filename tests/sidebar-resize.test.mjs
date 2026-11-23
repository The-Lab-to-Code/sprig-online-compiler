import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf('(function(){\n  const shell=document.querySelector(".shell"),side=$("side")');
const end = html.indexOf('(function(){const g=$("grip")', start);
assert.ok(start >= 0 && end > start);
const script = html.slice(start, end);

function setup(width = 1200) {
  const callbacks = {};
  const element = () => ({
    style: {}, hidden: false, attributes: {}, listeners: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    removeEventListener(name, callback) { if (this.listeners[name] === callback) delete this.listeners[name]; },
    setPointerCapture() {}
  });
  const elements = Object.fromEntries(["side", "aiSidebar", "sideResize", "aiResize"].map(id => [id, element()]));
  elements.aiSidebar.hidden = true;
  const values = {};
  const shell = { clientWidth: width, style: { setProperty(name, value) { values[name] = value; } } };
  const context = vm.createContext({
    $: id => elements[id], document: { querySelector: () => shell },
    innerWidth: width, addEventListener: (name, callback) => { callbacks[name] = callback; }
  });
  context.window = context;
  vm.runInContext(script, context);
  const key = (id, name) => elements[id].listeners.keydown({ key: name, preventDefault() {} });
  return { elements, values, callbacks, context, shell, key };
}

test("keyboard and pointer resizing respect bounds and stop on pointer cancellation", () => {
  const { elements, values, key } = setup();
  key("sideResize", "ArrowRight");
  assert.equal(values["--side-width"], "260px");
  const grip = elements.aiResize;
  elements.aiSidebar.hidden = false;
  grip.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 800, preventDefault() {} });
  grip.listeners.pointermove({ pointerId: 1, clientX: 700 });
  assert.equal(values["--ai-width"], "460px");
  grip.listeners.pointercancel({ pointerId: 1 });
  assert.equal(grip.listeners.pointermove, undefined);
  key("sideResize", "End");
  assert.equal(values["--side-width"], "532px");
});

test("hiding the explorer hides its handle and narrow screens constrain overlays", () => {
  const { elements, values, context, shell, key } = setup();
  elements.side.style.display = "none";
  context.updateSidebarWidths();
  assert.equal(elements.sideResize.hidden, true);
  elements.side.style.display = "flex";
  context.innerWidth = shell.clientWidth = 600;
  elements.aiSidebar.hidden = false;
  context.updateSidebarWidths();
  key("aiResize", "End");
  assert.equal(elements.sideResize.hidden, false);
  assert.equal(values["--ai-width"], "392px");
});

test("hidden editor initialization preserves the default widths", () => {
  const { values, context, shell } = setup(0);
  assert.equal(values["--side-width"], undefined);
  context.innerWidth = shell.clientWidth = 1200;
  context.updateSidebarWidths();
  assert.equal(values["--side-width"], "250px");
  assert.equal(values["--ai-width"], "360px");
});
