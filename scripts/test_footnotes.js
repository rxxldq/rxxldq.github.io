const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "footnotes.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");

function target(properties = {}) {
  return Object.assign({
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }, properties);
}

let activeElement = null;
function focusable(properties = {}) {
  return target({
    focusOptions: null,
    focus(options) {
      this.focusOptions = options;
      activeElement = this;
    },
    ...properties
  });
}

const ref = focusable({
  dataset: { note: "A concise explanation." },
  textContent: "",
  getBoundingClientRect() { return { left: 120, width: 20, bottom: 80 }; }
});
const title = target({ textContent: "" });
const copy = target({ textContent: "" });
const close = focusable();
const popover = target({
  id: "",
  className: "",
  hidden: false,
  offsetWidth: 250,
  offsetHeight: 100,
  style: {},
  querySelector(selector) {
    return ({
      ".note-popover-title": title,
      ".note-popover-copy": copy,
      ".note-popover-close": close
    })[selector] || null;
  }
});
const documentListeners = {};
const windowListeners = {};
const document = {
  documentElement: { lang: "en" },
  body: { appendChild(node) { assert.equal(node, popover); } },
  querySelectorAll(selector) {
    assert.equal(selector, ".note-ref[data-note]");
    return [ref];
  },
  createElement(name) {
    assert.equal(name, "aside");
    return popover;
  },
  addEventListener(name, listener) { documentListeners[name] = listener; }
};
const windowObject = {
  innerWidth: 1000,
  innerHeight: 700,
  matchMedia() { return { matches: false }; },
  addEventListener(name, listener) { windowListeners[name] = listener; }
};

vm.runInNewContext(source, { document, window: windowObject, Math });

assert.equal(ref.textContent, "※");
assert.equal(ref.attributes["aria-expanded"], "false");
assert.equal(ref.attributes["aria-haspopup"], "dialog");

ref.listeners.click({ stopPropagation() {} });
assert.equal(popover.hidden, false);
assert.equal(ref.attributes["aria-expanded"], "true");
assert.equal(activeElement, close);
assert.equal(close.focusOptions.preventScroll, true);

close.listeners.click();
assert.equal(popover.hidden, true);
assert.equal(ref.attributes["aria-expanded"], "false");
assert.equal(activeElement, ref);
assert.equal(ref.focusOptions.preventScroll, true);

ref.listeners.click({ stopPropagation() {} });
documentListeners.keydown({ key: "Escape" });
assert.equal(popover.hidden, true);
assert.equal(activeElement, ref);

ref.listeners.click({ stopPropagation() {} });
documentListeners.click();
assert.equal(popover.hidden, true);
assert.equal(ref.attributes["aria-expanded"], "false");

assert.match(styles, /bottom:\s*calc\(1rem\s*\+\s*env\(safe-area-inset-bottom\)\)/);
assert.match(styles, /\.note-ref\s*\{\s*min-width:\s*1\.5rem;\s*height:\s*1\.5rem;/);

console.log("Footnote dialog focus, close behavior, and mobile CSS checks passed.");
