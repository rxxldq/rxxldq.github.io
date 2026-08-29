const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "reading-tools.js"), "utf8");

function link() {
  return {
    href: "/",
    hidden: false,
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  };
}

function verifyLanguage(language, proofread = false, entries = null, currentIndex = 1) {
  const sampleEntries = [
    { zhUrl: "/a.html", enUrl: "/a-en.html", zhTitle: "甲", enTitle: "A", year: 2026, order: 1 },
    { zhUrl: "/b.html", enUrl: "/b-en.html", zhTitle: "乙", enTitle: "B", year: 2025, order: 1 },
    { zhUrl: "/c.html", enUrl: "/c-en.html", zhTitle: "丙", enTitle: "C", year: 2024, order: 1 },
  ];
  entries = entries || sampleEntries;
  entries = [...entries].sort((left, right) => (right.year - left.year) || (left.order - right.order));
  const urlKey = language === "en" ? "enUrl" : "zhUrl";
  const available = entries.filter((entry) => entry[urlKey]);
  const currentEntry = available[currentIndex];
  if (!currentEntry) throw new Error(`${language}: missing test entry ${currentIndex}`);
  const currentUrl = currentEntry[urlKey];
  const previous = link();
  const next = link();
  const random = link();
  const previousTitle = { textContent: "" };
  const nextTitle = { textContent: "" };
  const progress = { style: {} };
  let assigned = "";
  let prevented = false;

  const destinations = {
    "[data-reading-previous]": previous,
    "[data-reading-previous-title]": previousTitle,
    "[data-reading-next]": next,
    "[data-reading-next-title]": nextTitle,
    "[data-reading-random]": random,
  };
  const navigation = {
    dataset: { language, currentUrl },
    hidden: true,
    querySelector(selector) {
      return destinations[selector] || null;
    },
  };
  const sequence = { textContent: JSON.stringify(entries) };
  const document = {
    documentElement: { scrollHeight: 300 },
    querySelector(selector) {
      if (selector === ".reading-progress span") return progress;
      if (selector === ".article-navigation") return navigation;
      if (selector === "#reading-sequence") return sequence;
      return null;
    },
  };
  const window = {
    innerHeight: 100,
    scrollY: 50,
    location: {
      origin: "https://example.test",
      pathname: currentUrl,
      search: proofread ? "?proofread=1" : "",
      assign(destination) {
        assigned = destination;
      },
    },
    addEventListener() {},
  };

  vm.runInNewContext(source, { document, window, URL, URLSearchParams });

  if (progress.style.transform !== "scaleX(0.25)") throw new Error(`${language}: progress failed`);
  const query = proofread && language === "en" ? "?proofread=1" : "";
  const expectedPrevious = available[currentIndex - 1];
  const expectedNext = available[currentIndex + 1];
  if (expectedPrevious && previous.href !== `${expectedPrevious[urlKey]}${query}`) {
    throw new Error(`${language}: previous crossed languages, changed order, or lost mode`);
  }
  if (!expectedPrevious && !previous.hidden) throw new Error(`${language}: first entry exposed a previous link`);
  if (expectedNext && next.href !== `${expectedNext[urlKey]}${query}`) {
    throw new Error(`${language}: next crossed languages, changed order, or lost mode`);
  }
  if (!expectedNext && !next.hidden) throw new Error(`${language}: last entry exposed a next link`);
  if (navigation.hidden) throw new Error(`${language}: navigation stayed hidden`);

  random.listeners.click({ preventDefault() { prevented = true; } });
  if (!prevented) throw new Error(`${language}: random did not intercept the link`);
  if (language === "en" && !/-en\.html(?:\?|$)/.test(assigned)) throw new Error("en: random crossed languages");
  if (language === "zh" && /-en\.html(?:\?|$)/.test(assigned)) throw new Error("zh: random crossed languages");
  if (proofread && language === "en" && !/\?proofread=1$/.test(assigned)) throw new Error("en: random lost proofreading mode");
}

function verifyResumeReading() {
  const sourcePath = "/long-article.html";
  const storageKey = `rxxldq:reading:v1:${sourcePath}`;
  const stored = new Map([[storageKey, JSON.stringify({ ratio: 0.42, updatedAt: Date.now() })]]);
  const listeners = {};
  const progress = { style: {} };
  const resumeProgress = { textContent: "" };
  const resumeOpen = link();
  const resumeDismiss = link();
  const resume = {
    hidden: true,
    querySelector(selector) {
      return ({
        "[data-reading-resume-open]": resumeOpen,
        "[data-reading-resume-dismiss]": resumeDismiss,
        "[data-reading-resume-progress]": resumeProgress,
      })[selector] || null;
    },
  };
  const document = {
    readyState: "complete",
    documentElement: { scrollHeight: 2000 },
    querySelector(selector) {
      if (selector === ".reading-progress span") return progress;
      if (selector === "[data-reading-resume]") return resume;
      return null;
    },
  };
  let scrollTarget = null;
  const window = {
    innerHeight: 500,
    scrollY: 0,
    location: { origin: "https://example.test", pathname: sourcePath, search: "" },
    localStorage: {
      getItem(key) { return stored.get(key) || null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); },
    },
    addEventListener(name, listener) { listeners[name] = listener; },
    clearTimeout() {},
    setTimeout(listener) { listener(); return 1; },
    scrollTo(options) { scrollTarget = options; this.scrollY = options.top; },
  };

  vm.runInNewContext(source, { document, window, URL, URLSearchParams, Date, JSON, Math, Number });

  if (resume.hidden) throw new Error("resume: saved position was not offered");
  if (resumeProgress.textContent !== " · 42%") throw new Error("resume: progress label is wrong");
  resumeOpen.listeners.click();
  if (resume.hidden !== true) throw new Error("resume: prompt stayed visible after continuing");
  if (!scrollTarget || scrollTarget.top !== 630 || scrollTarget.behavior !== "auto") {
    throw new Error("resume: restored the wrong reading position");
  }

  resume.hidden = false;
  resumeDismiss.listeners.click();
  if (stored.has(storageKey)) throw new Error("resume: dismiss did not remove the saved position");
}

function verifyResumePrivacyFallbacks() {
  for (const mode of ["blocked-storage", "notrack", "proofread"]) {
    const resume = {
      hidden: true,
      querySelector() { return link(); },
    };
    const document = {
      readyState: "complete",
      documentElement: { scrollHeight: 2000 },
      querySelector(selector) {
        if (selector === ".reading-progress span") return { style: {} };
        if (selector === "[data-reading-resume]") return resume;
        return null;
      },
    };
    const window = {
      innerHeight: 500,
      scrollY: 0,
      location: {
        origin: "https://example.test",
        pathname: "/long-article.html",
        search: mode === "notrack" ? "?notrack=1" : mode === "proofread" ? "?proofread=1" : "",
      },
      addEventListener() {},
      clearTimeout() {},
      setTimeout() { return 1; },
    };
    Object.defineProperty(window, "localStorage", {
      get() {
        if (mode === "blocked-storage") throw new Error("storage unavailable");
        return {
          getItem() { return JSON.stringify({ ratio: 0.42, updatedAt: Date.now() }); },
          setItem() { throw new Error(`${mode}: resume storage should stay disabled`); },
          removeItem() { throw new Error(`${mode}: resume storage should stay disabled`); },
        };
      },
    });

    vm.runInNewContext(source, { document, window, URL, URLSearchParams, Date, JSON, Math, Number });
    if (!resume.hidden) throw new Error(`${mode}: resume prompt should remain hidden`);
  }
}

function parseFrontMatter(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator < 0 || line.trimStart().startsWith("#")) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    meta[key] = value;
  });
  return meta;
}

function actualEntries() {
  const root = path.join(__dirname, "..");
  const candidates = [
    ...fs.readdirSync(root).filter((name) => name.endsWith(".html")).map((name) => path.join(root, name)),
    ...fs.readdirSync(path.join(root, "works")).filter((name) => name.endsWith(".md")).map((name) => path.join(root, "works", name)),
  ];
  const listed = candidates
    .map(parseFrontMatter)
    .filter((meta) => meta && meta.listed === "true")
    .map((meta) => ({
      zhUrl: meta.permalink,
      enUrl: meta.english_url || null,
      zhTitle: meta.title,
      enTitle: meta.english_title,
      year: Number(meta.year || 0),
      order: Number(meta.order || 0),
    }));
  return [
    {
      zhUrl: "/middle-class-children.html",
      enUrl: "/middle-class-children-en.html",
      zhTitle: "中产阶级的孩子们三篇",
      enTitle: "The Children of the Middle Class: A Poetry Triptych",
      year: 9999,
      order: 0,
    },
    ...listed,
  ];
}

verifyLanguage("zh");
verifyLanguage("en");
verifyLanguage("en", true);
verifyResumeReading();
verifyResumePrivacyFallbacks();
const realEntries = actualEntries().sort((left, right) => (right.year - left.year) || (left.order - right.order));
for (const language of ["zh", "en"]) {
  const available = realEntries.filter((entry) => entry[language === "en" ? "enUrl" : "zhUrl"]);
  available.forEach((_, index) => verifyLanguage(language, false, realEntries, index));
}
console.log(`Reading tools test passed for Chinese and English across ${realEntries.length} real archive entries.`);
