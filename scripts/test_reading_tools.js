const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "reading-tools.js"), "utf8");
const pagePrefix = "rxxldq:reading:v1:";
const lastKey = "rxxldq:last-reading:v1";

function control(properties = {}) {
  return Object.assign({
    hidden: false,
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }, properties);
}

function storage(map) {
  return {
    getItem(key) { return map.get(key) || null; },
    setItem(key, value) { map.set(key, value); },
    removeItem(key) { map.delete(key); }
  };
}

function articleEnvironment({
  pathname = "/article-en.html", language = "en", title = "An English Title", search = "", hash = "",
  saved = null, blocks = [], scrollY = 0, entries = null, storageUnavailable = false
} = {}) {
  const stored = new Map();
  if (saved) stored.set(`${pagePrefix}${pathname}`, JSON.stringify(saved));
  const listeners = {};
  const progress = { style: {} };
  const resumeOpen = control();
  const resumeDismiss = control();
  const resumeProgress = { textContent: "" };
  const resume = control({
    hidden: true,
    querySelector(selector) {
      return ({
        "[data-reading-resume-open]": resumeOpen,
        "[data-reading-resume-dismiss]": resumeDismiss,
        "[data-reading-resume-progress]": resumeProgress
      })[selector] || null;
    }
  });
  const previous = control({ href: "/" });
  const next = control({ href: "/" });
  const random = control({ href: "/" });
  const previousTitle = { textContent: "" };
  const nextTitle = { textContent: "" };
  const navigation = control({
    hidden: true,
    dataset: { language, currentUrl: pathname },
    querySelector(selector) {
      return ({
        "[data-reading-previous]": previous,
        "[data-reading-next]": next,
        "[data-reading-random]": random,
        "[data-reading-previous-title]": previousTitle,
        "[data-reading-next-title]": nextTitle
      })[selector] || null;
    }
  });
  const article = {
    contains(node) { return blocks.includes(node); },
    querySelectorAll() { return blocks; }
  };
  const document = {
    readyState: "complete",
    title,
    body: { dataset: { articlePath: pathname, articleTitle: title, articleLanguage: language } },
    documentElement: { scrollHeight: 2000 },
    getElementById(id) { return blocks.find((block) => block.id === id) || null; },
    querySelector(selector) {
      if (selector === ".reading-progress span") return progress;
      if (selector === "[data-home-resume]") return null;
      if (selector === "[data-reading-resume]") return resume;
      if (selector === ".article-body") return article;
      if (selector === ".article-navigation") return entries ? navigation : null;
      if (selector === "#reading-sequence") return entries ? { textContent: JSON.stringify(entries) } : null;
      return null;
    }
  };
  let scrollTarget = null;
  const window = {
    innerHeight: 500,
    scrollY,
    location: {
      origin: "https://example.test", pathname, search, hash,
      assign(destination) { this.assigned = destination; }
    },
    localStorage: storage(stored),
    addEventListener(name, listener) { listeners[name] = listener; },
    clearTimeout() {},
    setTimeout(listener) { listener(); return 1; },
    scrollTo(options) { scrollTarget = options; this.scrollY = options.top; }
  };
  if (storageUnavailable) Object.defineProperty(window, "localStorage", {
    get() { throw new Error("storage must not be touched"); }
  });
  vm.runInNewContext(source, { document, window, URL, URLSearchParams, Date, JSON, Math, Number, Array });
  return { stored, listeners, progress, resume, resumeOpen, resumeDismiss, resumeProgress, navigation, previous, next, random, previousTitle, nextTitle, window, get scrollTarget() { return scrollTarget; } };
}

function passage(id, documentTop) {
  return {
    id,
    getBoundingClientRect() { return { top: documentTop - currentWindow.scrollY }; }
  };
}

let currentWindow;

function withPassages(options) {
  const blocks = [];
  const env = articleEnvironment({ ...options, blocks });
  currentWindow = env.window;
  blocks.push(passage("passage-a", 200), passage("passage-b", 600));
  return env;
}

function verifyAnchorResume() {
  const env = withPassages({ saved: { ratio: 0.42, anchor: "passage-b", offset: 35, updatedAt: Date.now() } });
  assert.equal(env.resume.hidden, false, "anchor record is offered");
  env.resumeOpen.listeners.click();
  assert.equal(env.scrollTarget.top, 635, "anchor and in-passage offset win over ratio");
  assert.equal(env.scrollTarget.behavior, "auto");
}

function verifyRatioFallback() {
  const env = withPassages({ saved: { ratio: 0.42, anchor: "missing-anchor", offset: 35, updatedAt: Date.now() } });
  env.resumeOpen.listeners.click();
  assert.equal(env.scrollTarget.top, 630, "old or missing anchors fall back to page ratio");
  assert.equal(env.scrollTarget.behavior, "auto");
}

function verifyHashPriority() {
  const env = withPassages({ hash: "#passage-b", saved: { ratio: 0.42, anchor: "passage-a", offset: 0, updatedAt: Date.now() } });
  assert.equal(env.resume.hidden, true, "a hash deep link never opens the resume prompt");
  assert.equal(env.scrollTarget, null, "a hash deep link is never overwritten");
}

function verifyPersistedRecord() {
  const env = withPassages({ pathname: "/article-en.html", language: "en", title: "English work", scrollY: 700 });
  currentWindow = env.window;
  env.listeners.pagehide();
  const pageRecord = JSON.parse(env.stored.get(`${pagePrefix}/article-en.html`));
  const globalRecord = JSON.parse(env.stored.get(lastKey));
  assert.equal(pageRecord.anchor, "passage-b");
  assert.equal(pageRecord.offset, 100);
  assert.deepEqual(globalRecord, pageRecord, "global record mirrors the current page record");
  assert.deepEqual({ path: globalRecord.path, title: globalRecord.title, language: globalRecord.language }, {
    path: "/article-en.html", title: "English work", language: "en"
  }, "global record retains the same-language actual route and metadata");
}

function verifyPrivacyModes() {
  for (const search of ["?notrack=1", "?proofread=1"]) {
    const env = articleEnvironment({ search, storageUnavailable: true });
    assert.equal(env.resume.hidden, true, `${search} does not offer stored progress`);
  }
  const blocked = withPassages({ scrollY: 700, storageUnavailable: true });
  assert.equal(blocked.resume.hidden, true, "blocked storage leaves normal reading available without a resume prompt");
  blocked.listeners.pagehide();
}

function homeEnvironment(record, search = "", storageUnavailable = false, allowedPaths = record ? [record.path] : []) {
  const stored = new Map(record ? [[lastKey, JSON.stringify(record)], [`${pagePrefix}${record.path}`, JSON.stringify(record)]] : []);
  const open = control({ href: "/" });
  const dismiss = control();
  const title = { textContent: "" };
  const progress = { textContent: "" };
  const home = control({
    hidden: true,
    querySelector(selector) {
      return ({
        "[data-home-resume-open]": open,
        "[data-home-resume-dismiss]": dismiss,
        "[data-home-resume-title]": title,
        "[data-home-resume-progress]": progress
      })[selector] || null;
    }
  });
  const document = {
    documentElement: { scrollHeight: 100 },
    querySelector(selector) {
      if (selector === ".reading-progress span") return null;
      if (selector === "[data-home-resume]") return home;
      return null;
    },
    querySelectorAll() { return allowedPaths.map((href) => ({ href })); }
  };
  const window = {
    innerHeight: 100,
    scrollY: 0,
    location: { origin: "https://example.test", pathname: "/", search, hash: "" },
    localStorage: storage(stored),
    addEventListener() {}
  };
  if (storageUnavailable) Object.defineProperty(window, "localStorage", {
    get() { throw new Error("storage must not be touched"); }
  });
  vm.runInNewContext(source, { document, window, URL, URLSearchParams, Date, JSON, Math, Number, Array });
  return { stored, home, open, dismiss, title, progress };
}

function verifyHomeResume() {
  const record = { ratio: 0.5, anchor: "passage-z", offset: 20, updatedAt: Date.now(), path: "/story-en.html", title: "A Story", language: "en" };
  const visible = homeEnvironment(record);
  assert.equal(visible.home.hidden, false, "home entry is shown for an unfinished record");
  assert.equal(visible.open.href, "/story-en.html#passage-z", "home entry preserves path, language, and passage anchor");
  assert.equal(visible.title.textContent, "A Story");
  assert.equal(visible.progress.textContent, " · 50%", "home entry shows a restrained progress cue");
  visible.dismiss.listeners.click();
  assert.equal(visible.home.hidden, true, "ignore hides the entry");
  assert.equal(visible.stored.has(lastKey), false, "ignore clears the global record");
  assert.equal(visible.stored.has(`${pagePrefix}/story-en.html`), false, "ignore also clears its page record");
  assert.equal(homeEnvironment(null).home.hidden, true, "first visit occupies no home-entry space");
  const privateHome = homeEnvironment(record, "?notrack=1", true);
  assert.equal(privateHome.home.hidden, true, "home respects notrack");
  const stale = homeEnvironment({ ...record, updatedAt: Date.now() - 91 * 24 * 60 * 60 * 1000 });
  assert.equal(stale.home.hidden, true, "expired home records stay hidden");
  assert.equal(stale.stored.has(lastKey), false, "expired home record is cleared");
  const unavailable = homeEnvironment(record, "", false, ["/another-live-work.html"]);
  assert.equal(unavailable.home.hidden, true, "non-home article paths stay hidden");
  assert.equal(unavailable.stored.has(lastKey), false, "non-home article records are cleared");
  assert.equal(unavailable.stored.has(`${pagePrefix}/story-en.html`), false, "non-home page record is cleared too");
  const malformed = homeEnvironment({ ...record, path: "http://[broken" }, "", false, ["/story-en.html"]);
  assert.equal(malformed.home.hidden, true, "malformed paths do not throw or expose an entry");
  assert.equal(malformed.stored.has(lastKey), false, "malformed records are cleared");
}

function verifyLanguageNavigation() {
  const entries = [
    { zhUrl: "/a.html", enUrl: "/a-en.html", zhTitle: "甲", enTitle: "A", year: 2026, order: 1 },
    { zhUrl: "/b.html", enUrl: "/b-en.html", zhTitle: "乙", enTitle: "B", year: 2025, order: 1 },
    { zhUrl: "/c.html", enUrl: "/c-en.html", zhTitle: "丙", enTitle: "C", year: 2024, order: 1 }
  ];
  const env = articleEnvironment({ pathname: "/b-en.html", language: "en", entries, search: "?proofread=1" });
  assert.equal(env.previous.href, "/a-en.html?proofread=1");
  assert.equal(env.next.href, "/c-en.html?proofread=1");
  assert.equal(env.navigation.hidden, false, "same-language navigation remains available");
  let prevented = false;
  env.random.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "random intercepts its placeholder link");
  assert.match(env.window.location.assigned, /-en\.html\?proofread=1$/, "random stays in English and preserves proofreading mode");
  const first = articleEnvironment({ pathname: "/a.html", language: "zh", entries });
  const last = articleEnvironment({ pathname: "/c.html", language: "zh", entries });
  assert.equal(first.previous.hidden, true, "first article hides previous");
  assert.equal(last.next.hidden, true, "last article hides next");
}

function verifyProgressAndCompletion() {
  const progress = articleEnvironment({ scrollY: 375 });
  assert.equal(progress.progress.style.transform, "scaleX(0.25)", "top progress bar preserves page ratio behavior");
  const completed = articleEnvironment({ pathname: "/finished.html", scrollY: 1450 });
  const saved = { ratio: 0.5, updatedAt: Date.now(), path: "/finished.html", title: "Finished", language: "en" };
  completed.stored.set(`${pagePrefix}/finished.html`, JSON.stringify(saved));
  completed.stored.set(lastKey, JSON.stringify(saved));
  completed.listeners.pagehide();
  assert.equal(completed.stored.has(`${pagePrefix}/finished.html`), false, "completion clears the page record");
  assert.equal(completed.stored.has(lastKey), false, "completion clears the matching global record");
}

function parseFrontMatter(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator < 0 || line.trimStart().startsWith("#")) return;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  });
  return meta;
}

function verifyRealArchiveNavigation() {
  const root = path.join(__dirname, "..");
  const files = [
    ...fs.readdirSync(root).filter((name) => name.endsWith(".html")).map((name) => path.join(root, name)),
    ...fs.readdirSync(path.join(root, "works")).filter((name) => name.endsWith(".md")).map((name) => path.join(root, "works", name))
  ];
  const entries = [{ zhUrl: "/middle-class-children.html", enUrl: "/middle-class-children-en.html", zhTitle: "中产阶级的孩子们三篇", enTitle: "The Children of the Middle Class: A Poetry Triptych", year: 9999, order: 0 }]
    .concat(files.map(parseFrontMatter).filter((meta) => meta && meta.listed === "true").map((meta) => ({
      zhUrl: meta.permalink, enUrl: meta.english_url || null, zhTitle: meta.title, enTitle: meta.english_title,
      year: Number(meta.year || 0), order: Number(meta.order || 0)
    })));
  const ordered = [...entries].sort((left, right) => (right.year - left.year) || (left.order - right.order));
  for (const language of ["zh", "en"]) {
    const urlKey = language === "en" ? "enUrl" : "zhUrl";
    const available = ordered.filter((entry) => entry[urlKey]);
    available.forEach((entry, index) => {
      const env = articleEnvironment({ pathname: entry[urlKey], language, entries: ordered });
      assert.equal(env.navigation.hidden, false, `${language}: navigation opens for ${entry[urlKey]}`);
      if (index > 0) assert.equal(env.previous.href, available[index - 1][urlKey], `${language}: previous stays in language`);
      if (index < available.length - 1) assert.equal(env.next.href, available[index + 1][urlKey], `${language}: next stays in language`);
    });
  }
}

verifyAnchorResume();
verifyRatioFallback();
verifyHashPriority();
verifyPersistedRecord();
verifyPrivacyModes();
verifyHomeResume();
verifyLanguageNavigation();
verifyProgressAndCompletion();
verifyRealArchiveNavigation();

const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
assert(index.indexOf("home-theme-field") < index.indexOf("data-home-resume") && index.indexOf("data-home-resume") < index.indexOf("special-edition"), "home resume stays after the theme field and before poetry");
assert(index.includes("reading-tools.js"), "home loads the local reading tool");
assert(index.includes("data-home-resume-progress"), "home includes the compact progress cue");
assert.match(styles, /\.english-title a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;[^}]*align-items:\s*center;/s, "home English-title links keep a 24px minimum touch height without enlarging the type");
assert.match(styles, /\.archive-translation-note \.translation-statement-trigger\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;[^}]*align-items:\s*center;/s, "home translation-note trigger keeps a 24px minimum touch height");
assert.match(styles, /\.site-footer a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;[^}]*align-items:\s*center;/s, "home footer links keep a 24px minimum touch height");
for (const selector of ["language-switch a", "translation-statement-inline-trigger", "translation-statement-banner-link", "reading-resume button", "reader-message-open", "article-navigation-random", "article-author-link a", "back-home"]) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(styles, new RegExp(`\\.${escapedSelector}\\s*\\{[^}]*display:\\s*inline-flex;[^}]*min-height:\\s*24px;[^}]*align-items:\\s*center;`, "s"), `${selector} keeps a 24px minimum touch height`);
}
console.log("Reading tools anchor resume, privacy, home entry, and language navigation tests passed.");
