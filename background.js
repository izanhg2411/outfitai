'use strict';
// Abre OutfitAI en el panel lateral al pulsar el icono. A diferencia del popup, el panel lateral
// NO se cierra al abrir pestañas, mostrar avisos de permisos o hacer clic en la página.
function enableSidePanel() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    }
  } catch (e) {
    /* versión de Chrome sin panel lateral */
  }
}
enableSidePanel();
chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);
