const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "reader-insights.js"), "utf8");

function target(properties = {}) {
  return Object.assign({
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }, properties);
}

const block = {
  nodeType: 1,
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

const contextPanel = { hidden: true };
const contextQuote = { textContent: "" };
const quoteInput = { value: "" };
const paragraphInput = { value: "" };
const status = { textContent: "" };
const submit = { disabled: false };
const messageField = { focused: false, focus() { this.focused = true; } };
const clearContextButton = target();
const formValues = { message: "A note about this sentence.", name: "", email: "", website: "" };
const form = target({
  querySelector(selector) {
    return ({
      "[data-reader-message-context]": contextPanel,
      "[data-reader-message-quote]": contextQuote,
      'input[name="quote"]': quoteInput,
      'input[name="paragraph_index"]': paragraphInput,
      "[data-reader-message-context-clear]": clearContextButton,
      "[data-reader-message-status]": status,
      'button[type="submit"]': submit,
      'textarea[name="message"]': messageField
    })[selector] || null;
  },
  reset() {
    formValues.message = "";
    quoteInput.value = "";
    paragraphInput.value = "";
  }
});
const article = {
  contains(node) { return node === block || node === textNode; },
  querySelector() { return null; },
  querySelectorAll() { return [block]; }
};
const dialog = target({
  open: false,
  showModal() { this.open = true; },
  close() { this.open = false; },
  setAttribute() { this.open = true; },
  removeAttribute() { this.open = false; }
});
const openButton = target();
const closeButton = target();
const selectionButton = target({ hidden: true });
const documentListeners = {};
const document = {
  body: {
    dataset: {
      insightsEndpoint: "https://insights.example.test",
      articlePath: "/article-en.html",
      articleTitle: "Article",
      articleLanguage: "en"
    }
  },
  documentElement: { lang: "en" },
  visibilityState: "visible",
  querySelector(selector) {
    return ({
      ".article-body": article,
      "[data-reader-message-form]": form,
      "[data-reader-message-dialog]": dialog,
      "[data-reader-message-open]": openButton,
      "[data-reader-message-close]": closeButton,
      "[data-reader-selection-note]": selectionButton
    })[selector] || null;
  },
  addEventListener(name, listener) { documentListeners[name] = listener; }
};

let submittedPayload = null;
const windowObject = {
  innerHeight: 800,
  location: { pathname: "/article-en.html", search: "" },
  getSelection() { return selection; },
  setTimeout(callback, delay) { if (delay === 0) callback(); }
};

class TestFormData {
  get(name) {
    if (name === "quote") return quoteInput.value;
    if (name === "paragraph_index") return paragraphInput.value;
    return formValues[name] || "";
  }
}

async function run() {
  vm.runInNewContext(source, {
    document,
    window: windowObject,
    navigator: { sendBeacon() { return true; } },
    crypto: { randomUUID() { return "view-id"; } },
    URLSearchParams,
    Blob,
    FormData: TestFormData,
    fetch: async (_url, options) => {
      submittedPayload = JSON.parse(options.body);
      return { ok: true };
    },
    console
  });

  documentListeners.selectionchange();
  assert.equal(selectionButton.hidden, false);
  selectionButton.listeners.click();
  assert.equal(dialog.open, true);
  assert.equal(contextPanel.hidden, false);
  assert.equal(contextQuote.textContent, "A deliberately selected sentence.");
  assert.equal(quoteInput.value, "A deliberately selected sentence.");
  assert.equal(paragraphInput.value, "1");
  assert.equal(messageField.focused, true);

  await form.listeners.submit({ preventDefault() {} });
  assert.equal(submittedPayload.quote, "A deliberately selected sentence.");
  assert.equal(submittedPayload.paragraphIndex, "1");
  assert.equal(submittedPayload.message, "A note about this sentence.");
  assert.equal(contextPanel.hidden, true);
  assert.equal(status.textContent, "Sent. Thank you.");

  openButton.listeners.click();
  assert.equal(contextPanel.hidden, true);
  assert.equal(quoteInput.value, "");
}

run().then(() => {
  console.log("Reader message context test passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
