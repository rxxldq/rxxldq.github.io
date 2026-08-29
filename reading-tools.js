(() => {
  const progress = document.querySelector(".reading-progress span");
  const parameters = new URLSearchParams(window.location.search || "");
  const preserveProofread = parameters.get("proofread") === "1";
  const storageDisabled = parameters.has("notrack") || preserveProofread;
  const maximumScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const currentRatio = () => {
    const maximum = maximumScroll();
    return maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 1;
  };
  const updateProgress = () => {
    if (!progress) return;
    progress.style.transform = `scaleX(${currentRatio()})`;
  };

  const resume = document.querySelector("[data-reading-resume]");
  const resumeOpen = resume && resume.querySelector("[data-reading-resume-open]");
  const resumeDismiss = resume && resume.querySelector("[data-reading-resume-dismiss]");
  const resumeProgress = resume && resume.querySelector("[data-reading-resume-progress]");
  const storageKey = `rxxldq:reading:v1:${window.location.pathname}`;
  const maxStorageAge = 90 * 24 * 60 * 60 * 1000;
  let savedPosition = null;
  let saveTimer = 0;

  const removeSavedPosition = () => {
    try { window.localStorage.removeItem(storageKey); } catch (_) {}
    savedPosition = null;
  };

  const readSavedPosition = () => {
    if (storageDisabled || !resume) return null;
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (!value || !Number.isFinite(value.ratio) || !Number.isFinite(value.updatedAt)) return null;
      if (Date.now() - value.updatedAt > maxStorageAge || value.ratio < 0.05 || value.ratio >= 0.96) {
        removeSavedPosition();
        return null;
      }
      return { ratio: Math.min(0.95, Math.max(0.05, value.ratio)), updatedAt: value.updatedAt };
    } catch (_) {
      return null;
    }
  };

  const persistPosition = () => {
    if (storageDisabled || maximumScroll() <= window.innerHeight) return;
    const ratio = currentRatio();
    if (ratio >= 0.96) {
      removeSavedPosition();
      return;
    }
    if (ratio < 0.05) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ratio, updatedAt: Date.now() }));
    } catch (_) {}
  };

  const schedulePersist = () => {
    if (storageDisabled) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistPosition, 250);
  };

  const showResume = () => {
    savedPosition = readSavedPosition();
    if (!savedPosition || window.scrollY > 32 || maximumScroll() <= window.innerHeight) return;
    resumeProgress.textContent = ` · ${Math.round(savedPosition.ratio * 100)}%`;
    resume.hidden = false;
  };

  if (resumeOpen) {
    resumeOpen.addEventListener("click", () => {
      if (!savedPosition) return;
      window.scrollTo({ top: savedPosition.ratio * maximumScroll(), behavior: "auto" });
      resume.hidden = true;
    });
  }
  if (resumeDismiss) {
    resumeDismiss.addEventListener("click", () => {
      removeSavedPosition();
      resume.hidden = true;
    });
  }

  updateProgress();
  window.addEventListener("scroll", () => {
    updateProgress();
    schedulePersist();
  }, { passive: true });
  window.addEventListener("resize", updateProgress);
  window.addEventListener("pagehide", persistPosition);
  if (document.readyState === "complete") showResume();
  else window.addEventListener("pageshow", showResume, { once: true });

  const navigation = document.querySelector(".article-navigation");
  const sequenceElement = document.querySelector("#reading-sequence");
  if (!navigation || !sequenceElement) return;

  let entries;
  try {
    entries = JSON.parse(sequenceElement.textContent);
  } catch {
    return;
  }

  entries.sort((left, right) => (right.year - left.year) || (left.order - right.order));
  const language = navigation.dataset.language === "en" ? "en" : "zh";
  const urlKey = language === "en" ? "enUrl" : "zhUrl";
  const titleKey = language === "en" ? "enTitle" : "zhTitle";
  const normalize = (value) => new URL(value, window.location.origin).pathname.replace(/\/+$/, "") || "/";
  const destinationUrl = (value) => {
    if (!preserveProofread || language !== "en") return value;
    const url = new URL(value, window.location.origin);
    url.searchParams.set("proofread", "1");
    return `${url.pathname}${url.search}`;
  };
  const current = normalize(navigation.dataset.currentUrl || window.location.pathname);
  const available = entries.filter((entry) => entry[urlKey]);
  const index = available.findIndex((entry) => normalize(entry[urlKey]) === current);
  if (index < 0) return;

  const setDestination = (selector, entry) => {
    const link = navigation.querySelector(`[data-reading-${selector}]`);
    const title = navigation.querySelector(`[data-reading-${selector}-title]`);
    if (!link || !entry) {
      if (link) link.hidden = true;
      return;
    }
    link.href = destinationUrl(entry[urlKey]);
    if (title) title.textContent = entry[titleKey];
  };

  setDestination("previous", available[index - 1]);
  setDestination("next", available[index + 1]);

  const random = navigation.querySelector("[data-reading-random]");
  if (random) {
    random.addEventListener("click", (event) => {
      const choices = available.filter((_, candidateIndex) => candidateIndex !== index);
      if (!choices.length) return;
      const destination = choices[Math.floor(Math.random() * choices.length)];
      event.preventDefault();
      window.location.assign(destinationUrl(destination[urlKey]));
    });
  }

  navigation.hidden = false;
})();
