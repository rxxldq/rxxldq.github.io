(function () {
  var triggers = document.querySelectorAll('[data-subscription-open]');
  var dialog = document.getElementById('subscription-dialog');
  var closeButton = dialog && dialog.querySelector('[data-subscription-close]');
  var lastTrigger = null;

  if (!triggers.length || !dialog || !closeButton) return;

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (lastTrigger) lastTrigger.focus();
  }

  triggers.forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      lastTrigger = trigger;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  });

  closeButton.addEventListener('click', closeDialog);

  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) closeDialog();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.hasAttribute('open')) closeDialog();
  });
}());
