(function () {
  var trigger = document.querySelector('[data-translation-statement-open]');
  var dialog = document.getElementById('translation-statement-dialog');
  var closeButton = dialog && dialog.querySelector('[data-translation-statement-close]');

  if (!trigger || !dialog || !closeButton) return;

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  trigger.addEventListener('click', function () {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  });

  closeButton.addEventListener('click', function () {
    closeDialog();
  });

  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    closeDialog();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.hasAttribute('open')) closeDialog();
  });
}());
