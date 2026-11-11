document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('statusBadge');
  const activeProject = document.getElementById('activeProject');
  const lastAction = document.getElementById('lastAction');
  const errorBox = document.getElementById('errorBox');
  const errorMessage = document.getElementById('errorMessage');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const pingBtn = document.getElementById('pingBtn');

  function renderStatus(info) {
    if (!info) return;

    if (info.connected) {
      statusBadge.textContent = 'Connecté';
      statusBadge.className = 'badge connected';
    } else {
      statusBadge.textContent = 'Déconnecté';
      statusBadge.className = 'badge disconnected';
    }

    activeProject.textContent = info.activeProject ? `${info.activeProject}-antigravity` : 'Aucun';
    lastAction.textContent = info.lastCommand || 'Aucune';

    if (info.lastError) {
      errorBox.classList.remove('hidden');
      errorMessage.textContent = info.lastError;
    } else {
      errorBox.classList.add('hidden');
    }
  }

  // Charger l'état sauvegardé
  chrome.storage.local.get(['statusInfo'], (result) => {
    if (result && result.statusInfo) {
      renderStatus(result.statusInfo);
    }
  });

  // Écouter les mises à jour
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.statusInfo) {
      renderStatus(changes.statusInfo.newValue);
    }
  });

  reconnectBtn.addEventListener('click', () => {
    chrome.runtime.reload();
    window.close();
  });

  pingBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        lastAction.textContent = `Test: Onglet #${tab.id}`;
      }
    } catch (_) {}
  });
});
