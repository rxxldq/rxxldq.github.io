(() => {
  const progress = document.querySelector(".reading-progress span");
  const updateProgress = () => {
    if (!progress) return;
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 1;
    progress.style.transform = `scaleX(${ratio})`;
  };

  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);

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
    link.href = entry[urlKey];
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
      window.location.assign(destination[urlKey]);
    });
  }

  navigation.hidden = false;
})();
