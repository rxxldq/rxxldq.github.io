(() => {
  const themeKey = "rxxldq:theme:v1";
  const sizeKey = "rxxldq:text-size:v1";
  const colors = { light: "#f8f5ee", dark: "#1c1915" };
  const root = document.documentElement;
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const safeWrite = (key, value) => {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  };
  const safeRemove = (key) => {
    try { window.localStorage.removeItem(key); } catch (_) {}
  };
  const systemTheme = () => (media && media.matches ? "dark" : "light");
  const manualTheme = () => (root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : null);
  const currentTheme = () => manualTheme() || systemTheme();

  const toggles = Array.from(document.querySelectorAll(".theme-toggle"));
  const sizeButtons = Array.from(document.querySelectorAll("[data-text-size]"));
  const syncThemeColor = () => {
    const manual = manualTheme();
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const own = /dark/.test(meta.getAttribute("media") || "") ? "dark" : "light";
      meta.setAttribute("content", colors[manual || own]);
    });
  };
  const syncTheme = () => {
    toggles.forEach((button) => button.setAttribute("aria-pressed", String(currentTheme() === "dark")));
    syncThemeColor();
  };
  const syncSize = () => {
    const large = root.classList.contains("text-large");
    sizeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String((button.dataset.textSize === "large") === large));
    });
  };

  toggles.forEach((button) => button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    if (next === systemTheme()) {
      delete root.dataset.theme;
      safeRemove(themeKey);
    } else {
      root.dataset.theme = next;
      safeWrite(themeKey, next);
    }
    syncTheme();
  }));
  sizeButtons.forEach((button) => button.addEventListener("click", () => {
    const large = button.dataset.textSize === "large";
    root.classList.toggle("text-large", large);
    if (large) safeWrite(sizeKey, "large");
    else safeRemove(sizeKey);
    syncSize();
  }));
  if (media) {
    const onChange = () => { if (!manualTheme()) syncTheme(); };
    if (typeof media.addEventListener === "function") media.addEventListener("change", onChange);
    else if (typeof media.addListener === "function") media.addListener(onChange);
  }
  syncTheme();
  syncSize();
})();