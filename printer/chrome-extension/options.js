// The extension's options page only points at the settings page (8.3.0). With
// internet it goes there at once; without, the card stays and offers the print
// dashboard on this computer. A page that is already open in this tab keeps the
// card (navigator.onLine can say "online" with no route, so the link stays too).
(function () {
  var SETTINGS_URL = 'https://awana.kvbchurch.org/settings';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try { window.location.replace(SETTINGS_URL); } catch (e) { /* the card's link still works */ }
})();
