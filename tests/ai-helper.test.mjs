import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("let aiSuggestion=");
const end = html.indexOf('$("clear").onclick=', start);
assert.ok(start >= 0 && end > start);
const helper = html.slice(start, end);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.value = ""; this._text = ""; this.children = []; this.disabled = false;
    this.dataset = {}; this.classList = { toggle() {} }; this.attributes = {};
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this._text = value; this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
  focus() {}
}

function editor() {
  const elements = Object.fromEntries(["aiPrompt", "aiUseEditor", "aiGenerate", "aiExplain", "aiCancel", "aiApply", "aiOutput", "aiStatus", "aiSidebar", "abAi", "aiClose", "aiNew", "aiUnread", "aiNotifications"]
    .map(id => [id, new FakeElement()]));
  elements.aiUseEditor.checked = true;
  const document = { title: "Sprig", hidden: false, addEventListener() {},
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(text) { const node = new FakeElement(); node.textContent = text; return node; } };
  const tab = { lang: "js", dirty: false };
  const code = { value: "old code", dispatchEvent() { tab.dirty = true; } };
  const context = vm.createContext({
    $: id => elements[id], tabs: [tab], active: 0, code,
    L: { js: { name: "JavaScript" } }, out: { textContent: "ReferenceError: foo is not defined" },
    confirm: () => true, fileChangeBlocked: () => false, Event: class {}, AbortController,
    localPage: true, localRunnerBase: "http://127.0.0.1:3001", location: { protocol: "http:" },
    document, navigator: {}, TextDecoder, Uint8Array,
    completed: text => ({ text, verification: { status: "passed", message: "Basic run passed." } })
  });
  vm.runInContext(helper, context);
  return { elements, tab, code, context, document, run: source => vm.runInContext(source, context) };
}

test("offline explanations identify common errors without pretending to diagnose unknown ones", () => {
  const { run } = editor();
  assert.match(run('explainOfflineError("ReferenceError: x is not defined")'), /name.*cannot find/i);
  assert.match(run('explainOfflineError("something unexpected")'), /No matching common error/);
});

test("generated code requires confirmation and is not applied after the editor changes", async () => {
  const { elements, code, context, tab, run } = editor();
  elements.aiPrompt.value = "Write a greeting";
  context.answer = "Here is code:\n```js\nconsole.log('hello');\n```";
  run("askLocalAi=async()=>completed(answer)");
  await run('runAi("generate")');
  assert.equal(code.value, "old code");
  assert.equal(elements.aiApply.disabled, false);
  code.value = "newer user edit";
  elements.aiApply.onclick();
  assert.equal(code.value, "newer user edit");
  assert.match(elements.aiStatus.textContent, /changed/);
  code.value = "old code";
  elements.aiPrompt.value = "Write a greeting";
  await run('runAi("generate")');
  context.confirm = () => false;
  elements.aiApply.onclick();
  assert.equal(code.value, "old code");
  context.confirm = () => true;
  elements.aiApply.onclick();
  assert.equal(code.value, "console.log('hello');\n");
  assert.equal(tab.dirty, true);
});

test("an unavailable model explains known errors using the labeled offline fallback", async () => {
  const { elements, run } = editor();
  run('askLocalAi=async()=>{throw new Error("model unavailable")}');
  await run('runAi("explain")');
  assert.match(elements.aiStatus.textContent, /offline explanation/);
  assert.match(elements.aiOutput.textContent, /name.*cannot find/i);
});

test("chat includes current editor by default and respects opting out", async () => {
  const { elements, context, run } = editor();
  elements.aiPrompt.value = "Write code";
  context.sources = [];
  run('askLocalAi=async(mode,prompt,source)=>{sources.push(source);return completed("done")}');
  await run('runAi("generate")');
  elements.aiUseEditor.checked = false;
  elements.aiPrompt.value = "Explain it";
  await run('runAi("generate")');
  assert.deepEqual(context.sources, ["old code", ""]);
});

test("follow-up sends previous turns and new chat clears history", async () => {
  const { elements, context, run } = editor();
  context.requests = [];
  run('askLocalAi=async(mode,prompt,source,language,terminal,signal,history)=>{requests.push(history);return completed("answer")}');
  elements.aiPrompt.value = "First question";
  await run('runAi("generate")');
  elements.aiPrompt.value = "Follow up";
  await run('runAi("generate")');
  assert.equal(context.requests[1][0].content, "First question");
  assert.equal(context.requests[1][1].content, "answer");
  elements.aiNew.onclick();
  elements.aiPrompt.value = "Fresh question";
  await run('runAi("generate")');
  assert.equal(context.requests[2].length, 0);
});

test("follow-up includes the ten most recent complete exchanges", async () => {
  const { elements, context, run } = editor();
  context.requests = [];
  run('askLocalAi=async(mode,prompt,source,language,terminal,signal,history)=>{requests.push(history);return completed("answer "+prompt)}');
  for (let i = 1; i <= 12; i++) {
    elements.aiPrompt.value = "question " + i;
    await run('runAi("generate")');
  }
  const history = context.requests[11];
  assert.equal(history.length, 20);
  assert.equal(history[0].content, "question 2");
  assert.equal(history[1].content, "answer question 2");
  assert.equal(history[18].content, "question 11");
  assert.equal(history[19].content, "answer question 11");
});

test("sending clears the prompt immediately without erasing a later draft", async () => {
  const { elements, context, run } = editor();
  elements.aiPrompt.value = "Write a calculator";
  context.finish = null;
  run('askLocalAi=()=>new Promise(resolve=>{finish=resolve})');
  const request = run('runAi("generate")');
  assert.equal(elements.aiPrompt.value, "");
  assert.match(elements.aiOutput.textContent, /Write a calculator/);
  elements.aiPrompt.value = "Write a calculator";
  context.finish(context.completed("answer"));
  await request;
  assert.equal(elements.aiPrompt.value, "Write a calculator");
});

test("explaining an error leaves an unsent draft intact", async () => {
  const { elements, run } = editor();
  elements.aiPrompt.value = "My draft";
  run('askLocalAi=async()=>completed("answer")');
  await run('runAi("explain")');
  assert.equal(elements.aiPrompt.value, "My draft");
});

test("stopping a request does not report an offline failure", async () => {
  const { elements, run } = editor();
  run('askLocalAi=(mode,prompt,source,language,terminal,signal)=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted"))))');
  const request = run('runAi("explain")');
  elements.aiCancel.onclick();
  await request;
  assert.match(elements.aiStatus.textContent, /stopped/);
  assert.equal(elements.aiCancel.disabled, true);
});

test("a disconnected local AI runner explains how to reopen the app", async () => {
  const { elements, context, run } = editor();
  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  elements.aiPrompt.value = "Explain";
  await run('runAi("generate")');
  assert.match(elements.aiStatus.textContent, /runner is not reachable.*start-sprig\.bat.*opened page/i);
});

test("fenced and inline code render as text without interpreting HTML", () => {
  const { context, run } = editor();
  context.body = new FakeElement();
  context.answer = 'Use `value`:\n```html\n<img src=x onerror=alert(1)>\n```\nDone.';
  run("renderAiResponse(body,answer)");
  assert.equal(context.body.children[1].className, "ai-inline");
  const block = context.body.children.find(child => child.className === "ai-code");
  assert.equal(block.children[1].children[0].textContent, "<img src=x onerror=alert(1)>\n");
  assert.ok(!context.body.textContent.includes("```"));
  assert.match(context.body.textContent, /Done/);
});

test("bold text renders safely without formatting code or unmatched markers", () => {
  const { context, run } = editor();
  context.body = new FakeElement();
  context.answer = '**Important `value**literal` and <img src=x>** then `**literal**` and **unfinished\n```js\n"**not bold**"\n```';
  run("renderAiResponse(body,answer)");
  const strong = context.body.children.find(child => child.tagName === "strong");
  assert.ok(strong);
  assert.equal(strong.textContent, "Important value**literal and <img src=x>");
  assert.equal(strong.children.find(child => child.tagName === "code").textContent, "value**literal");
  assert.equal(context.body.children.find(child => child.tagName === "code").textContent, "**literal**");
  assert.match(context.body.textContent, /\*\*unfinished/);
  const block = context.body.children.find(child => child.className === "ai-code");
  assert.equal(block.children[1].children[0].textContent, '"**not bold**"\n');
  assert.equal(strong.children.some(child => child.tagName === "img"), false);
});

test("finishing away marks the response unread until chat is opened", async () => {
  const { elements, document, run } = editor();
  elements.aiSidebar.hidden = true;
  elements.aiPrompt.value = "Explain";
  run('askLocalAi=async()=>completed("answer")');
  await run('runAi("generate")');
  assert.equal(elements.aiUnread.hidden, false);
  assert.match(document.title, /AI ready/);
  run("showAi(true)");
  assert.equal(elements.aiUnread.hidden, true);
  assert.equal(document.title, "Sprig");
});

test("desktop notifications contain no code or prompt when the browser tab is hidden", async () => {
  const { elements, document, context, run } = editor();
  const notices = [];
  context.Notification = class {
    static permission = "granted";
    constructor(title, options) { notices.push({ title, body: options.body }); }
  };
  document.hidden = true;
  elements.aiPrompt.value = "private prompt";
  run('askLocalAi=async()=>completed("private response")');
  await run('runAi("generate")');
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0].body, /private|old code/);
  assert.equal(elements.aiUnread.hidden, false);
});

test("activity shows a real waiting step and stops when cancelled", async () => {
  const { elements, run } = editor();
  run('askLocalAi=(mode,prompt,source,language,terminal,signal)=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted"))))');
  const request = run('runAi("explain")');
  const reply = elements.aiOutput.children[1];
  const activity = reply.children.find(child => child.className === "ai-activity");
  const working = reply.children.find(child => child.className === "ai-working");
  assert.ok(reply.children.indexOf(working) < reply.children.indexOf(activity));
  assert.match(activity.textContent, /Waiting for the local runner/);
  assert.notEqual(working.hidden, true);
  elements.aiCancel.onclick();
  await request;
  assert.equal(working.hidden, true);
  assert.match(activity.textContent, /Request stopped/);
});

test("the assistant withholds streamed code until verification completes", async () => {
  const { elements, context, run } = editor();
  let stream;
  const encoder = new TextEncoder();
  context.fetch = async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }),
    { headers: { "Content-Type": "application/x-ndjson" } });
  elements.aiPrompt.value = "Write code";
  const request = run('runAi("generate")');
  await new Promise(resolve => setImmediate(resolve));
  const event = data => stream.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
  event({ type: "progress", message: "Generating the response locally." });
  event({ type: "delta", text: "Hello 🌱" });
  await new Promise(resolve => setImmediate(resolve));
  const reply = elements.aiOutput.children[1];
  const activity = reply.children.find(child => child.className === "ai-activity");
  const body = reply.children.find(child => child.className === "ai-entry-body");
  const working = reply.children.find(child => child.className === "ai-working");
  const progress = working.children.find(child => child.className === "ai-progress");
  assert.equal(progress.attributes["aria-valuenow"], "0");
  assert.match(activity.textContent, /Generating the response locally/);
  assert.equal(body.textContent, "");
  assert.doesNotMatch(activity.textContent, /Hello 🌱/);
  assert.equal(elements.aiApply.disabled, true);
  event({ type: "progress", message: "Finished isolated test 1 of 5.", completedTests: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(progress.attributes["aria-valuenow"], "20");
  assert.match(progress.textContent, /20%/);
  event({ type: "delta", text: "\n```js\nconsole.log(1);\n```" });
  event({ type: "done", text: "Hello 🌱\n```js\nconsole.log(1);\n```", verification: { status: "passed", message: "Basic run passed." } });
  stream.close();
  await request;
  assert.match(elements.aiOutput.textContent, /console.log\(1\)/);
  assert.ok(body.children.some(child => child.className === "ai-code"));
  assert.equal(elements.aiApply.disabled, false);
  assert.match(activity.textContent, /Response received/);
  assert.match(elements.aiStatus.textContent, /Test passed/);
  assert.equal(progress.attributes["aria-valuenow"], "100");
});

test("an older JSON-only runner cannot display unverified code", async () => {
  const { elements, context, run } = editor();
  context.fetch = async () => new Response(JSON.stringify({ text: "A completed answer" }),
    { headers: { "Content-Type": "application/json" } });
  elements.aiPrompt.value = "Explain";
  await run('runAi("generate")');
  assert.doesNotMatch(elements.aiOutput.textContent, /A completed answer/);
  assert.match(elements.aiStatus.textContent, /Restart start-sprig/);
});

test("an older streaming runner cannot reveal an unverified response", async () => {
  const { elements, context, run } = editor();
  context.fetch = async () => new Response(
    '{"type":"delta","text":"old unverified code"}\n{"type":"done","text":"old unverified code"}\n',
    { headers: { "Content-Type": "application/x-ndjson" } });
  elements.aiPrompt.value = "Write code";
  await run('runAi("generate")');
  assert.doesNotMatch(elements.aiOutput.textContent, /old unverified code/);
  assert.match(elements.aiStatus.textContent, /Restart start-sprig/);
});

test("broken streamed code displays the test error and warns before replacement", async () => {
  const { elements, context, code, tab, run } = editor();
  const verification = { status: "broken", attempts: 5, message: "Failed 5 of 5 isolated tests.", diagnostic: "<script>test error</script>" };
  context.fetch = async () => new Response(
    JSON.stringify({ type: "done", text: "```js\nbroken();\n```", verification }) + "\n",
    { headers: { "Content-Type": "application/x-ndjson" } });
  elements.aiPrompt.value = "Write code";
  await run('runAi("generate")');
  const reply = elements.aiOutput.children[1];
  assert.match(reply.textContent, /Broken: Failed 5 of 5/);
  const details = reply.children.find(child => child.className === "ai-test-error");
  assert.equal(details.children[1].textContent, "<script>test error</script>");
  assert.equal(elements.aiStatus.dataset.error, "true");
  assert.equal(elements.aiApply.disabled, false);
  let warning = "";
  context.confirm = message => { warning = message; return false; };
  elements.aiApply.onclick();
  assert.match(warning, /broken.*test failed/i);
  assert.equal(code.value, "old code");
  code.value = "new user edit";
  context.confirm = () => { throw new Error("should not confirm stale code"); };
  elements.aiApply.onclick();
  assert.equal(code.value, "new user edit");
  assert.equal(elements.aiApply.disabled, true);
  code.value = "old code";
  elements.aiPrompt.value = "Try again";
  await run('runAi("generate")');
  context.confirm = () => true;
  elements.aiApply.onclick();
  assert.equal(code.value, "broken();\n");
  assert.equal(tab.dirty, true);
});

test("JSON broken responses and unavailable test environments remain clearly labeled", async () => {
  const { elements, context, run } = editor();
  elements.aiPrompt.value = "Write code";
  context.fetch = async () => new Response(JSON.stringify({
    text: "```js\nbroken();\n```",
    verification: { status: "broken", attempts: 1, message: "Repair failed.", diagnostic: "ReferenceError" }
  }), { headers: { "Content-Type": "application/json" } });
  await run('runAi("generate")');
  assert.match(elements.aiStatus.textContent, /Broken.*Repair failed/);
  elements.aiPrompt.value = "Try another";
  context.fetch = async () => new Response(JSON.stringify({
    text: "```js\nconsole.log(1);\n```",
    verification: { status: "untested", attempts: 0, message: "Docker unavailable." }
  }), { headers: { "Content-Type": "application/json" } });
  await run('runAi("generate")');
  assert.match(elements.aiStatus.textContent, /Untested.*Docker unavailable/);
  assert.equal(elements.aiApply.disabled, false);
});

test("untested responses are visibly labeled and failed tests never reveal code", async () => {
  const { elements, context, run } = editor();
  elements.aiPrompt.value = "Write code";
  context.fetch = async () => new Response(JSON.stringify({
    text: "```koka\nhello\n```",
    verification: { status: "untested", message: "No isolated environment for Koka." }
  }), { headers: { "Content-Type": "application/json" } });
  await run('runAi("generate")');
  assert.match(elements.aiStatus.textContent, /Untested.*Koka/);
  assert.match(elements.aiOutput.textContent, /hello/);
  elements.aiPrompt.value = "Try again";
  context.fetch = async () => new Response(
    '{"type":"delta","text":"secret failed code"}\n{"type":"error","message":"The code was withheld."}\n',
    { headers: { "Content-Type": "application/x-ndjson" } });
  await run('runAi("generate")');
  assert.doesNotMatch(elements.aiOutput.textContent, /secret failed code/);
  assert.match(elements.aiStatus.textContent, /withheld/);
  assert.equal(elements.aiApply.disabled, true);
});

test("an interrupted live response is not applied or treated as complete", async () => {
  const { elements, context, run } = editor();
  const encoder = new TextEncoder();
  context.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: "partial" }) + "\n"));
      controller.close();
    }
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  elements.aiPrompt.value = "Write code";
  await run('runAi("generate")');
  assert.equal(elements.aiApply.disabled, true);
  assert.match(elements.aiStatus.textContent, /ended unexpectedly/);
  const body = elements.aiOutput.children[1].children.find(child => child.className === "ai-entry-body");
  assert.equal(body.textContent, "");
  assert.equal(run("aiHistory.length"), 0);
});

test("cancelling a streamed response does not expose unverified text", async () => {
  const { elements, context, run } = editor();
  const encoder = new TextEncoder();
  context.fetch = async (url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: "partial code" }) + "\n"));
      options.signal.addEventListener("abort", () => controller.error(new Error("aborted")));
    }
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  elements.aiPrompt.value = "Write code";
  const request = run('runAi("generate")');
  await new Promise(resolve => setImmediate(resolve));
  elements.aiCancel.onclick();
  await request;
  const body = elements.aiOutput.children[1].children.find(child => child.className === "ai-entry-body");
  assert.equal(body.textContent, "");
  assert.equal(elements.aiApply.disabled, true);
  assert.equal(run("aiHistory.length"), 0);
});
