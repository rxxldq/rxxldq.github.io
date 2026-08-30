(function () {
  "use strict";

  const article = document.querySelector(".article-body");
  const actions = document.querySelector("[data-reader-selection-actions]");
  const readerMessage = document.querySelector("[data-reader-message]");
  const noteButton = document.querySelector("[data-reader-selection-note]");
  const copyButton = document.querySelector("[data-reader-selection-copy]");
  const status = document.querySelector("[data-reader-selection-status]");
  if (!article || !actions || !copyButton) return;

  const parameters = new URLSearchParams(window.location.search);
  const english = (document.documentElement.lang || "").toLowerCase().startsWith("en");
  const blocks = Array.from(article.querySelectorAll("p, h2, h3, blockquote, li"));
  const anchors = new Set();
  let copyLabelTimer = 0;

  if (parameters.has("notrack")) {
    if (readerMessage) readerMessage.hidden = true;
    if (noteButton) noteButton.hidden = true;
  }

  blocks.forEach(function (block, index) {
    if (block.id) {
      anchors.add(block.id);
      return;
    }
    const text = String(block.textContent || "").replace(/\s+/g, " ").trim();
    let hash = 2166136261;
    for (let offset = 0; offset < text.length; offset += 1) {
      hash ^= text.charCodeAt(offset);
      hash = Math.imul(hash, 16777619);
    }
    const base = text ? `passage-${(hash >>> 0).toString(36)}` : `passage-${index + 1}`;
    let anchor = base;
    let duplicate = 2;
    while (anchors.has(anchor) || document.getElementById(anchor)) {
      anchor = `${base}-${duplicate}`;
      duplicate += 1;
    }
    block.id = anchor;
    anchors.add(anchor);
  });

  function revealLinkedPassage() {
    if (!window.location.hash) return;
    let anchor = "";
    try { anchor = decodeURIComponent(window.location.hash.slice(1)); } catch (_) { return; }
    const target = document.getElementById(anchor);
    if (!target || !article.contains(target)) return;
    const reveal = function () { target.scrollIntoView({ block: "center" }); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(reveal);
    else window.setTimeout(reveal, 0);
  }

  function selectionContext() {
    if (typeof window.getSelection !== "function") return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === 1 ? commonNode : commonNode.parentElement;
    if (!commonElement || !article.contains(commonElement)) return null;
    const quote = String(selection).replace(/\s+/g, " ").trim().slice(0, 800);
    if (quote.length < 2) return null;
    const startNode = range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;
    const block = startNode && startNode.closest
      ? startNode.closest("p, h2, h3, blockquote, li")
      : null;
    const position = block && article.contains(block) ? blocks.indexOf(block) : -1;
    return {
      quote,
      paragraphIndex: position >= 0 ? position + 1 : null,
      anchor: position >= 0 ? blocks[position].id : null
    };
  }

  function refreshActions() {
    const context = selectionContext();
    if (!context || !context.anchor) {
      actions.hidden = true;
      delete actions.dataset.quote;
      delete actions.dataset.paragraphIndex;
      delete actions.dataset.anchor;
      return;
    }
    actions.dataset.quote = context.quote;
    actions.dataset.paragraphIndex = context.paragraphIndex ? String(context.paragraphIndex) : "";
    actions.dataset.anchor = context.anchor;
    actions.hidden = false;
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {}
    }
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    document.body.removeChild(helper);
    if (!copied) throw new Error("copy failed");
  }

  function setCopyFeedback(success) {
    const message = success
      ? (english ? "Copied" : "已复制")
      : (english ? "Copy failed" : "复制失败");
    copyButton.textContent = message;
    status.textContent = message;
    window.clearTimeout(copyLabelTimer);
    copyLabelTimer = window.setTimeout(function () {
      copyButton.textContent = english ? "Copy paragraph link" : "复制本段链接";
    }, 1800);
  }

  revealLinkedPassage();
  window.addEventListener("hashchange", revealLinkedPassage);
  document.addEventListener("selectionchange", function () {
    window.setTimeout(refreshActions, 0);
  });
  actions.addEventListener("pointerdown", function (event) {
    event.preventDefault();
  });
  copyButton.addEventListener("click", async function () {
    const anchor = actions.dataset.anchor;
    if (!anchor) return;
    const url = new URL(window.location.href);
    url.hash = anchor;
    try {
      await copyText(url.toString());
      setCopyFeedback(true);
    } catch (_) {
      setCopyFeedback(false);
    }
  });
})();
