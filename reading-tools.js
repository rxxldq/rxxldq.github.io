(() => {
  const parameters = new URLSearchParams(window.location.search || "");
  const preserveProofread = parameters.get("proofread") === "1";
  const storageDisabled = parameters.has("notrack") || preserveProofread;
  const pageStoragePrefix = "rxxldq:reading:v1:";
  const lastReadingKey = "rxxldq:last-reading:v1";
  const maxStorageAge = 90 * 24 * 60 * 60 * 1000;
  const maximumScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const currentRatio = () => {
    const maximum = maximumScroll();
    return maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 1;
  };
  const normalPath = (value) => {
    try {
      const pathname = new URL(value || window.location.pathname, window.location.origin).pathname;
      return pathname.replace(/\/+$/, "") || "/";
    } catch (_) {
      return null;
    }
  };
  const validProgress = (value) => value && Number.isFinite(value.ratio)
    && Number.isFinite(value.updatedAt) && Date.now() - value.updatedAt <= maxStorageAge
    && value.ratio >= 0.05 && value.ratio < 0.96;
  const safeRead = (key) => {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (_) { return null; }
  };
  const safeRemove = (key) => {
    try { window.localStorage.removeItem(key); } catch (_) {}
  };

  const progress = document.querySelector(".reading-progress span");
  const updateProgress = () => {
    if (progress) progress.style.transform = `scaleX(${currentRatio()})`;
  };
  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);

  const homeResume = document.querySelector("[data-home-resume]");
  if (homeResume) {
    if (storageDisabled) return;
    const open = homeResume.querySelector("[data-home-resume-open]");
    const dismiss = homeResume.querySelector("[data-home-resume-dismiss]");
    const title = homeResume.querySelector("[data-home-resume-title]");
    const homeProgress = homeResume.querySelector("[data-home-resume-progress]");
    const record = safeRead(lastReadingKey);
    const recordPath = record && typeof record.path === "string" ? normalPath(record.path) : null;
    const availablePaths = new Set(Array.from(document.querySelectorAll(".special-edition a[href], .writing-list a[href]"))
      .map((link) => normalPath(link.href))
      .filter(Boolean));
    if (!validProgress(record) || !record || typeof record.path !== "string"
      || !/^\/(?!\/)/.test(record.path) || !recordPath || !availablePaths.has(recordPath)
      || !["zh", "en"].includes(record.language) || typeof record.title !== "string") {
      if (record) safeRemove(lastReadingKey);
      if (recordPath) safeRemove(`${pageStoragePrefix}${recordPath}`);
      return;
    }
    title.textContent = record.title;
    if (homeProgress) homeProgress.textContent = ` · ${Math.round(record.ratio * 100)}%`;
    open.href = recordPath + (typeof record.anchor === "string" && record.anchor ? `#${encodeURIComponent(record.anchor)}` : "");
    homeResume.hidden = false;
    if (dismiss) dismiss.addEventListener("click", () => {
      safeRemove(lastReadingKey);
      safeRemove(`${pageStoragePrefix}${recordPath}`);
      homeResume.hidden = true;
    });
    return;
  }

  const resume = document.querySelector("[data-reading-resume]");
  const article = document.querySelector(".article-body");
  const body = document.body;
  if (!resume || !article || !body) return;
  const resumeOpen = resume.querySelector("[data-reading-resume-open]");
  const resumeDismiss = resume.querySelector("[data-reading-resume-dismiss]");
  const resumeProgress = resume.querySelector("[data-reading-resume-progress]");
  const path = normalPath(body.dataset.articlePath || window.location.pathname) || "/";
  const storageKey = `${pageStoragePrefix}${path}`;
  const language = body.dataset.articleLanguage === "en" ? "en" : "zh";
  const title = body.dataset.articleTitle || document.title || "";
  let savedPosition = null;
  let saveTimer = 0;

  const removeSavedPosition = () => {
    safeRemove(storageKey);
    const last = safeRead(lastReadingKey);
    if (last && normalPath(last.path) === path) safeRemove(lastReadingKey);
    savedPosition = null;
  };
  const readSavedPosition = () => {
    if (storageDisabled) return null;
    const value = safeRead(storageKey);
    if (!validProgress(value)) {
      if (value) removeSavedPosition();
      return null;
    }
    return value;
  };
  const passagePosition = () => {
    const blocks = Array.from(article.querySelectorAll("p[id], h2[id], h3[id], blockquote[id], li[id]"));
    if (!blocks.length) return null;
    const readingLine = window.scrollY + Math.min(160, window.innerHeight * 0.25);
    let candidate = blocks[0];
    blocks.forEach((block) => {
      const top = window.scrollY + block.getBoundingClientRect().top;
      if (top <= readingLine) candidate = block;
    });
    const top = window.scrollY + candidate.getBoundingClientRect().top;
    return { anchor: candidate.id, offset: Math.round(window.scrollY - top) };
  };
  const persistPosition = () => {
    if (storageDisabled || maximumScroll() <= window.innerHeight) return;
    const ratio = currentRatio();
    if (ratio >= 0.96) {
      removeSavedPosition();
      return;
    }
    if (ratio < 0.05) return;
    const passage = passagePosition();
    const value = {
      ratio,
      anchor: passage && passage.anchor ? passage.anchor : null,
      offset: passage && Number.isFinite(passage.offset) ? passage.offset : 0,
      updatedAt: Date.now(),
      path,
      title,
      language
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
      window.localStorage.setItem(lastReadingKey, JSON.stringify(value));
    } catch (_) {}
  };
  const schedulePersist = () => {
    if (storageDisabled) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistPosition, 250);
  };
  const restoreSavedPosition = () => {
    if (!savedPosition) return;
    const anchor = typeof savedPosition.anchor === "string" ? savedPosition.anchor : "";
    const target = anchor && document.getElementById(anchor);
    if (target && article.contains(target)) {
      const targetTop = window.scrollY + target.getBoundingClientRect().top;
      const offset = Number.isFinite(savedPosition.offset) ? savedPosition.offset : 0;
      window.scrollTo({ top: Math.max(0, Math.min(maximumScroll(), targetTop + offset)), behavior: "auto" });
    } else {
      window.scrollTo({ top: savedPosition.ratio * maximumScroll(), behavior: "auto" });
    }
  };
  const showResume = () => {
    savedPosition = readSavedPosition();
    if (!savedPosition || window.location.hash || window.scrollY > 32 || maximumScroll() <= window.innerHeight) return;
    resumeProgress.textContent = ` · ${Math.round(savedPosition.ratio * 100)}%`;
    resume.hidden = false;
  };
  if (resumeOpen) resumeOpen.addEventListener("click", () => {
    restoreSavedPosition();
    resume.hidden = true;
  });
  if (resumeDismiss) resumeDismiss.addEventListener("click", () => {
    removeSavedPosition();
    resume.hidden = true;
  });
  window.addEventListener("scroll", schedulePersist, { passive: true });
  window.addEventListener("pagehide", persistPosition);
  if (document.readyState === "complete") showResume();
  else window.addEventListener("pageshow", showResume, { once: true });

  const navigation = document.querySelector(".article-navigation");
  const sequenceElement = document.querySelector("#reading-sequence");
  if (!navigation || !sequenceElement) return;
  let entries;
  try { entries = JSON.parse(sequenceElement.textContent); } catch (_) { return; }
  entries.sort((left, right) => (right.year - left.year) || (left.order - right.order));
  const navigationLanguage = navigation.dataset.language === "en" ? "en" : "zh";
  const urlKey = navigationLanguage === "en" ? "enUrl" : "zhUrl";
  const titleKey = navigationLanguage === "en" ? "enTitle" : "zhTitle";
  const destinationUrl = (value) => {
    if (!preserveProofread || navigationLanguage !== "en") return value;
    const url = new URL(value, window.location.origin);
    url.searchParams.set("proofread", "1");
    return `${url.pathname}${url.search}`;
  };
  const current = normalPath(navigation.dataset.currentUrl || window.location.pathname);
  const available = entries.filter((entry) => entry[urlKey]);
  const index = available.findIndex((entry) => normalPath(entry[urlKey]) === current);
  if (index < 0) return;
  const setDestination = (selector, entry) => {
    const link = navigation.querySelector(`[data-reading-${selector}]`);
    const linkTitle = navigation.querySelector(`[data-reading-${selector}-title]`);
    if (!link || !entry) {
      if (link) link.hidden = true;
      return;
    }
    link.href = destinationUrl(entry[urlKey]);
    if (linkTitle) linkTitle.textContent = entry[titleKey];
  };
  setDestination("previous", available[index - 1]);
  setDestination("next", available[index + 1]);
  const random = navigation.querySelector("[data-reading-random]");
  if (random) random.addEventListener("click", (event) => {
    const choices = available.filter((_, candidateIndex) => candidateIndex !== index);
    if (!choices.length) return;
    event.preventDefault();
    window.location.assign(destinationUrl(choices[Math.floor(Math.random() * choices.length)][urlKey]));
  });
  navigation.hidden = false;
})();
