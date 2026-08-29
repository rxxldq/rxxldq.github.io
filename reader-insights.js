(function () {
  "use strict";

  const body = document.body;
  const endpoint = (body.dataset.insightsEndpoint || "").replace(/\/$/, "");
  if (!endpoint || new URLSearchParams(window.location.search).has("notrack")) return;

  const article = document.querySelector(".article-body");
  const path = body.dataset.articlePath || window.location.pathname;
  const slug = path.replace(/^\/+|\/?(?:-en)?\.html$/g, "") || "home";
  const title = body.dataset.articleTitle || document.title;
  const lang = body.dataset.articleLanguage || document.documentElement.lang || "zh";
  const viewId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let viewSent = false;
  let completionSent = false;
  const openedAt = Date.now();

  function payload(type) {
    return JSON.stringify({ type, viewId, slug, title, lang, path });
  }

  function send(type) {
    const data = payload(type);
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(`${endpoint}/api/track`, blob)) return;
    }
    fetch(`${endpoint}/api/track`, {
      method: "POST",
      mode: "cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: data
    }).catch(function () {});
  }

  function markView() {
    if (viewSent || document.visibilityState !== "visible") return;
    viewSent = true;
    send("view");
  }

  window.setTimeout(function () {
    if (document.visibilityState === "visible") {
      markView();
    }
  }, 3000);
  document.addEventListener("visibilitychange", function () {
    if (Date.now() - openedAt >= 3000) markView();
  });

  if (article) {
    const completionMarker = article.querySelector("[data-reading-completion-marker]");
    if (completionMarker && "IntersectionObserver" in window) {
      function markCompletionIfReady() {
        if (completionSent || Date.now() - openedAt < 15000) return;
        const rect = completionMarker.getBoundingClientRect();
        const visible = rect.top < window.innerHeight && rect.bottom > 0;
        if (visible) {
          completionSent = true;
          markView();
          send("complete");
          observer.disconnect();
        }
      }
      const observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        if (Date.now() - openedAt < 15000) {
          window.setTimeout(markCompletionIfReady, 15000 - (Date.now() - openedAt));
          return;
        }
        markCompletionIfReady();
      }, { threshold: 0 });
      observer.observe(completionMarker);
    }
  }

  const form = document.querySelector("[data-reader-message-form]");
  if (!form) return;
  const dialog = document.querySelector("[data-reader-message-dialog]");
  const openButton = document.querySelector("[data-reader-message-open]");
  const closeButton = document.querySelector("[data-reader-message-close]");
  const selectionActions = document.querySelector("[data-reader-selection-actions]");
  const selectionButton = document.querySelector("[data-reader-selection-note]");
  const selectionCopy = document.querySelector("[data-reader-selection-copy]");
  const selectionStatus = document.querySelector("[data-reader-selection-status]");
  const contextPanel = form.querySelector("[data-reader-message-context]");
  const contextQuote = form.querySelector("[data-reader-message-quote]");
  const quoteInput = form.querySelector('input[name="quote"]');
  const paragraphInput = form.querySelector('input[name="paragraph_index"]');
  const clearContextButton = form.querySelector("[data-reader-message-context-clear]");
  const status = form.querySelector("[data-reader-message-status]");
  const submit = form.querySelector('button[type="submit"]');
  const english = lang === "en";
  const passageBlocks = article
    ? Array.from(article.querySelectorAll("p, h2, h3, blockquote, li"))
    : [];
  let pendingContext = null;
  let copyLabelTimer = 0;

  const passageAnchors = new Set();
  passageBlocks.forEach(function (block, index) {
    if (block.id) {
      passageAnchors.add(block.id);
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
    while (passageAnchors.has(anchor) || document.getElementById(anchor)) {
      anchor = `${base}-${duplicate}`;
      duplicate += 1;
    }
    block.id = anchor;
    passageAnchors.add(anchor);
  });

  function revealLinkedPassage() {
    if (!article || !window.location.hash) return;
    let anchor = "";
    try { anchor = decodeURIComponent(window.location.hash.slice(1)); } catch (_) { return; }
    const target = document.getElementById(anchor);
    if (!target || !article.contains(target)) return;
    const reveal = function () { target.scrollIntoView({ block: "center" }); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(reveal);
    else window.setTimeout(reveal, 0);
  }

  revealLinkedPassage();
  window.addEventListener("hashchange", revealLinkedPassage);

  function clearContext() {
    contextPanel.hidden = true;
    contextQuote.textContent = "";
    quoteInput.value = "";
    paragraphInput.value = "";
  }

  function applyContext(context) {
    if (!context || !context.quote) {
      clearContext();
      return;
    }
    contextPanel.hidden = false;
    contextQuote.textContent = context.quote;
    quoteInput.value = context.quote;
    paragraphInput.value = context.paragraphIndex ? String(context.paragraphIndex) : "";
  }

  function openDialog(context) {
    applyContext(context);
    status.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const messageField = form.querySelector('textarea[name="message"]');
    if (messageField) messageField.focus();
  }

  function closeDialog() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function selectionContext() {
    if (!article || typeof window.getSelection !== "function") return null;
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
    const blockPosition = block && article.contains(block) ? passageBlocks.indexOf(block) : -1;
    return {
      quote,
      paragraphIndex: blockPosition >= 0 ? blockPosition + 1 : null,
      anchor: blockPosition >= 0 ? passageBlocks[blockPosition].id : null
    };
  }

  function refreshSelectionAction() {
    const context = selectionContext();
    if (!context) {
      selectionActions.hidden = true;
      pendingContext = null;
      return;
    }
    pendingContext = context;
    selectionActions.hidden = false;
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
    selectionCopy.textContent = message;
    selectionStatus.textContent = message;
    window.clearTimeout(copyLabelTimer);
    copyLabelTimer = window.setTimeout(function () {
      selectionCopy.textContent = english ? "Copy paragraph link" : "复制本段链接";
    }, 1800);
  }

  if (openButton && dialog) {
    openButton.addEventListener("click", function () { openDialog(null); });
    closeButton.addEventListener("click", closeDialog);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog();
    });
  }
  if (selectionActions && selectionButton && selectionCopy && article && dialog) {
    document.addEventListener("selectionchange", function () {
      window.setTimeout(refreshSelectionAction, 0);
    });
    selectionActions.addEventListener("pointerdown", function (event) {
      event.preventDefault();
    });
    selectionButton.addEventListener("click", function () {
      const context = pendingContext;
      selectionActions.hidden = true;
      openDialog(context);
    });
    selectionCopy.addEventListener("click", async function () {
      if (!pendingContext || !pendingContext.anchor) return;
      const url = new URL(window.location.href);
      url.hash = pendingContext.anchor;
      try {
        await copyText(url.toString());
        setCopyFeedback(true);
      } catch (_) {
        setCopyFeedback(false);
      }
    });
  }
  clearContextButton.addEventListener("click", clearContext);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const data = new FormData(form);
    const message = String(data.get("message") || "").trim();
    if (!message) {
      status.textContent = english ? "Please write a message." : "请先写下留言。";
      return;
    }
    submit.disabled = true;
    status.textContent = english ? "Sending…" : "正在发送……";
    try {
      const response = await fetch(`${endpoint}/api/message`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, title, lang, path,
          message,
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim(),
          website: String(data.get("website") || ""),
          quote: String(data.get("quote") || "").trim(),
          paragraphIndex: String(data.get("paragraph_index") || "").trim()
        })
      });
      if (!response.ok) throw new Error("send failed");
      form.reset();
      clearContext();
      status.textContent = english ? "Sent. Thank you." : "已发送，谢谢。";
    } catch (_) {
      status.textContent = english ? "Could not send. Please try again later." : "暂时未能发送，请稍后再试。";
    } finally {
      submit.disabled = false;
    }
  });
})();
