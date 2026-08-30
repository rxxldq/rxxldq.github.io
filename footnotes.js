(() => {
  const refs = [...document.querySelectorAll('.note-ref[data-note]')];
  if (!refs.length) return;

  const popover = document.createElement('aside');
  popover.className = 'note-popover';
  popover.id = 'active-note';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-labelledby', 'active-note-title');
  popover.setAttribute('aria-describedby', 'active-note-copy');
  popover.hidden = true;
  popover.innerHTML = `
    <div class="note-popover-header">
      <span class="note-popover-title" id="active-note-title"></span>
      <button class="note-popover-close" type="button" aria-label="Close context note">×</button>
    </div>
    <p class="note-popover-copy" id="active-note-copy"></p>
  `;
  document.body.appendChild(popover);

  const popoverTitle = popover.querySelector('.note-popover-title');
  const popoverCopy = popover.querySelector('.note-popover-copy');
  const popoverClose = popover.querySelector('.note-popover-close');

  let active = null;

  function returnFocus(ref) {
    if (ref) ref.focus({ preventScroll: true });
  }

  function closeNote() {
    if (active) active.setAttribute('aria-expanded', 'false');
    active = null;
    popover.hidden = true;
    popoverTitle.textContent = '';
    popoverCopy.textContent = '';
  }

  function positionNote(ref) {
    if (window.matchMedia('(max-width: 36rem)').matches) return;
    const rect = ref.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2));
    const top = Math.min(window.innerHeight - popover.offsetHeight - 16, rect.bottom + 10);
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(16, top)}px`;
  }

  refs.forEach((ref, index) => {
    const isEnglish = document.documentElement.lang.toLowerCase().startsWith('en');
    const label = isEnglish ? `Context note ${index + 1}` : `语境注释 ${index + 1}`;
    ref.textContent = '※';
    ref.setAttribute('aria-haspopup', 'dialog');
    ref.setAttribute('aria-expanded', 'false');
    ref.setAttribute('aria-controls', popover.id);
    if (!ref.getAttribute('aria-label')) ref.setAttribute('aria-label', label);
    if (!ref.getAttribute('title')) ref.setAttribute('title', isEnglish ? 'Context note' : '语境注释');

    ref.addEventListener('click', event => {
      event.stopPropagation();
      if (active === ref) {
        closeNote();
        return;
      }
      closeNote();
      active = ref;
      ref.setAttribute('aria-expanded', 'true');
      popoverTitle.textContent = label;
      popoverCopy.textContent = ref.dataset.note;
      popoverClose.setAttribute('aria-label', isEnglish ? 'Close context note' : '关闭语境注释');
      popover.hidden = false;
      positionNote(ref);
      popoverClose.focus({ preventScroll: true });
    });
  });

  popover.addEventListener('click', event => event.stopPropagation());
  popoverClose.addEventListener('click', () => {
    const ref = active;
    closeNote();
    returnFocus(ref);
  });
  document.addEventListener('click', closeNote);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const ref = active;
      closeNote();
      returnFocus(ref);
    }
  });
  window.addEventListener('resize', () => active && positionNote(active));
  window.addEventListener('scroll', closeNote, { passive: true });
})();
