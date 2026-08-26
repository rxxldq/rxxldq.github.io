(() => {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("proofread") !== "1") return;

  const main = document.querySelector("main[data-alternate-url]");
  const englishArticle = main && main.querySelector(".article-body");
  if (!main || !englishArticle) return;

  document.body.classList.add("proofread-mode");

  const toolbar = document.createElement("div");
  toolbar.className = "proofread-toolbar";
  toolbar.innerHTML = '<span>Proofreading view</span><a href="' + window.location.pathname + '">Return to reading view</a>';
  englishArticle.before(toolbar);

  const status = document.createElement("p");
  status.className = "proofread-status";
  status.textContent = "Loading the Chinese source…";
  toolbar.after(status);

  const blockSelector = ":scope > p, :scope > h2, :scope > h3, :scope > blockquote, :scope > section, :scope > div, :scope > figure, :scope > ul, :scope > ol";

  fetch(main.dataset.alternateUrl, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      return response.text();
    })
    .then((html) => {
      const sourceDocument = new DOMParser().parseFromString(html, "text/html");
      const chineseArticle = sourceDocument.querySelector(".article-body");
      if (!chineseArticle) throw new Error("Chinese article body was not found");

      const chineseBlocks = [...chineseArticle.querySelectorAll(blockSelector)];
      const englishBlocks = [...englishArticle.querySelectorAll(blockSelector)];
      const pairCount = Math.max(chineseBlocks.length, englishBlocks.length);
      const grid = document.createElement("section");
      grid.className = "proofread-grid";
      grid.setAttribute("aria-label", "Chinese and English paragraph comparison");

      for (let index = 0; index < pairCount; index += 1) {
        const pair = document.createElement("div");
        pair.className = "proofread-pair";

        const number = document.createElement("span");
        number.className = "proofread-number";
        number.textContent = String(index + 1).padStart(2, "0");
        number.setAttribute("aria-label", `Paragraph ${index + 1}`);

        const chinese = document.createElement("div");
        chinese.className = "proofread-column proofread-zh";
        chinese.lang = "zh-CN";
        if (chineseBlocks[index]) chinese.append(chineseBlocks[index].cloneNode(true));

        const english = document.createElement("div");
        english.className = "proofread-column proofread-en";
        english.lang = "en";
        if (englishBlocks[index]) english.append(englishBlocks[index]);

        pair.append(number, chinese, english);
        grid.append(pair);
      }

      englishArticle.replaceChildren(grid);
      englishArticle.classList.add("article-body-proofread");
      status.textContent = chineseBlocks.length === englishBlocks.length
        ? `${pairCount} aligned blocks · Chinese / English`
        : `${pairCount} blocks · source ${chineseBlocks.length}, translation ${englishBlocks.length}; check alignment manually`;
      status.classList.toggle("proofread-status-warning", chineseBlocks.length !== englishBlocks.length);
    })
    .catch(() => {
      status.textContent = "The Chinese source could not be loaded. Return to the reading view and try again.";
      status.classList.add("proofread-status-warning");
    });
})();
