const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "passage-links.js"), "utf8");

function target(properties = {}) {
  return Object.assign({
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }, properties);
}

async function verify(search, notrack) {
  const block = {
    nodeType: 1,
    id: "",
    textContent: "A deliberately selected sentence.",
    scrolled: null,
    scrollIntoView(options) { this.scrolled = options; },
    closest() { return this; }
  };
  const textNode = { nodeType: 3, parentElement: block };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString() { return "  A deliberately   selected sentence.  "; },
    getRangeAt() {
      return {
        commonAncestorContainer: textNode,
        startContainer: textNode
      };
    }
  };
  const article = {
    contains(node) { return node === block || node === textNode; },
    querySelectorAll() { return [block]; }
  };
  const actions = target({ hidden: true, dataset: {} });
  const readerMessage = { hidden: false };
  const noteButton = target({ hidden: false });
  const copyButton = target({ textContent: "Copy paragraph link" });
  const status = { textContent: "" };
  const documentListeners = {};
  let fallbackHelper = null;
  let fallbackCopiedUrl = null;
  const document = {
    body: {
      appendChild(node) { fallbackHelper = node; },
      removeChild() { fallbackHelper = null; }
    },
    documentElement: { lang: "en" },
    getElementById(id) { return id === block.id ? block : null; },
    createElement(name) {
      if (name !== "textarea") throw new Error(`Unexpected element: ${name}`);
      return {
        value: "",
        style: {},
        setAttribute() {},
        select() {}
      };
    },
    execCommand(command) {
      if (command !== "copy" || !fallbackHelper) return false;
      fallbackCopiedUrl = fallbackHelper.value;
      return true;
    },
    querySelector(selector) {
      return ({
        ".article-body": article,
        "[data-reader-selection-actions]": actions,
        "[data-reader-message]": readerMessage,
        "[data-reader-selection-note]": noteButton,
        "[data-reader-selection-copy]": copyButton,
        "[data-reader-selection-status]": status
      })[selector] || null;
    },
    addEventListener(name, listener) { documentListeners[name] = listener; }
  };

  let copiedUrl = null;
  const windowListeners = {};
  const href = `https://example.test/article-en.html${search}`;
  const windowObject = {
    location: { href, search, hash: "" },
    getSelection() { return selection; },
    addEventListener(name, listener) { windowListeners[name] = listener; },
    requestAnimationFrame(callback) { callback(); },
    clearTimeout() {},
    setTimeout(callback, delay) { if (delay === 0) callback(); return 1; }
  };
  const navigatorObject = {
    clipboard: {
      async writeText(value) { copiedUrl = value; }
    }
  };

  vm.runInNewContext(source, {
    document,
    window: windowObject,
    navigator: navigatorObject,
    URL,
    URLSearchParams,
    Math,
    console
  });

  assert.match(block.id, /^passage-[a-z0-9]+$/);
  assert.equal(readerMessage.hidden, notrack);
  assert.equal(noteButton.hidden, notrack);
  documentListeners.selectionchange();
  assert.equal(actions.hidden, false);
  assert.equal(actions.dataset.quote, "A deliberately selected sentence.");
  assert.equal(actions.dataset.paragraphIndex, "1");
  assert.equal(actions.dataset.anchor, block.id);

  await copyButton.listeners.click();
  assert.equal(copiedUrl, `${href}#${block.id}`);
  assert.equal(copyButton.textContent, "Copied");
  assert.equal(status.textContent, "Copied");

  navigatorObject.clipboard = null;
  copyButton.textContent = "Copy paragraph link";
  await copyButton.listeners.click();
  assert.equal(fallbackCopiedUrl, `${href}#${block.id}`);

  windowObject.location.hash = `#${block.id}`;
  windowListeners.hashchange();
  assert.equal(block.scrolled.block, "center");
}

Promise.all([
  verify("", false),
  verify("?notrack=1", true)
]).then(() => {
  console.log("Passage links test passed in normal and no-tracking modes.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
