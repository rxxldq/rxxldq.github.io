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

function verifyLanguage(language, proofread = false) {
  const suffix = language === "en" ? "-en" : "";
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
    dataset: { language, currentUrl: `/b${suffix}.html` },
    hidden: true,
    querySelector(selector) {
      return destinations[selector] || null;
    },
  };
  const entries = [
    { zhUrl: "/a.html", enUrl: "/a-en.html", zhTitle: "甲", enTitle: "A", year: 2026, order: 1 },
    { zhUrl: "/b.html", enUrl: "/b-en.html", zhTitle: "乙", enTitle: "B", year: 2025, order: 1 },
    { zhUrl: "/c.html", enUrl: "/c-en.html", zhTitle: "丙", enTitle: "C", year: 2024, order: 1 },
  ];
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
      pathname: `/b${suffix}.html`,
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
  if (previous.href !== `/a${suffix}.html${query}`) throw new Error(`${language}: previous crossed languages or lost mode`);
  if (next.href !== `/c${suffix}.html${query}`) throw new Error(`${language}: next crossed languages or lost mode`);
  if (navigation.hidden) throw new Error(`${language}: navigation stayed hidden`);

  random.listeners.click({ preventDefault() { prevented = true; } });
  if (!prevented) throw new Error(`${language}: random did not intercept the link`);
  if (language === "en" && !/-en\.html(?:\?|$)/.test(assigned)) throw new Error("en: random crossed languages");
  if (language === "zh" && /-en\.html(?:\?|$)/.test(assigned)) throw new Error("zh: random crossed languages");
  if (proofread && language === "en" && !/\?proofread=1$/.test(assigned)) throw new Error("en: random lost proofreading mode");
}

verifyLanguage("zh");
verifyLanguage("en");
verifyLanguage("en", true);
console.log("Reading tools test passed for Chinese and English.");
