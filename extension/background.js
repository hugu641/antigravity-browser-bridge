/**
 * Antigravity Browser Bridge - Service Worker (Manifest V3)
 * Gère la communication WebSocket avec le pont local et l'exécution
 * d'actions de contrôle Chrome (CDP / Debugger, Tabs, Groupes).
 */

const WS_URL = 'ws://127.0.0.1:8765';
let ws = null;
let reconnectTimer = null;
const attachedTabs = new Set();
let activeWorkerTabId = null;
let isPaused = false;

// Enregistrement d'état pour la popup
let statusInfo = {
  connected: false,
  lastCommand: null,
  lastError: null,
  activeProject: null,
  tabCount: 0,
  isPaused: false
};

function updateStorage() {
  statusInfo.isPaused = isPaused;
  chrome.storage.local.set({ statusInfo }).catch(() => {});
}

// Écoute des messages venant du HUD injecté dans les pages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'toggle_pause') {
    isPaused = !isPaused;
    updateStorage();
    sendResponse({ paused: isPaused });
    return true;
  }
  if (msg && msg.action === 'get_pause_state') {
    sendResponse({ paused: isPaused });
    return true;
  }
});

// ==========================================
// Connexion WebSocket avec Auto-Reconnect
// ==========================================

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[Antigravity Bridge] Connecté au serveur local.');
      statusInfo.connected = true;
      statusInfo.lastError = null;
      updateStorage();

      // Signaler la présence de l'extension
      ws.send(JSON.stringify({
        type: 'handshake',
        client: 'chrome_extension',
        version: '1.0.0'
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        const { id, action, params } = message;

        if (!id || !action) return;

        statusInfo.lastCommand = action;
        updateStorage();

        try {
          const result = await handleCommand(action, params || {});
          ws.send(JSON.stringify({
            id,
            status: 'success',
            result
          }));
        } catch (err) {
          console.error(`[Antigravity Bridge] Erreur commande ${action}:`, err);
          statusInfo.lastError = err.message || String(err);
          updateStorage();
          ws.send(JSON.stringify({
            id,
            status: 'error',
            error: err.message || String(err)
          }));
        }
      } catch (parseErr) {
        console.error('[Antigravity Bridge] Erreur parsing message:', parseErr);
      }
    };

    ws.onclose = () => {
      statusInfo.connected = false;
      updateStorage();
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      statusInfo.connected = false;
      updateStorage();
      try { ws.close(); } catch (_) {}
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWebSocket, 3000);
}

// Initialisation au démarrage
connectWebSocket();

// Alarm keep-alive pour empêcher Chrome d'endormir le service worker (Manifest V3)
chrome.alarms.create('bridgeKeepAlive', { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bridgeKeepAlive') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (_) {}
    }
  }
});

// Ping régulier toutes les 10 secondes tant que le socket est ouvert
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  } else {
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch (_) {}
  }
}, 10000);

// Réveiller la connexion si nécessaire
chrome.runtime.onStartup.addListener(connectWebSocket);
chrome.runtime.onInstalled.addListener(connectWebSocket);

// ==========================================
// Gestion de Chrome Debugger (CDP)
// ==========================================

async function ensureDebugger(tabId) {
  if (attachedTabs.has(tabId)) {
    return;
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    
    // Activer les domaines utiles
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');

    // Émuler le focus pour que l'onglet en arrière-plan fonctionne sans voler le focus de l'utilisateur
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch (_) {}
  } catch (err) {
    if (err.message && err.message.includes('Already attached')) {
      attachedTabs.add(tabId);
      return;
    }
    throw err;
  }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source && source.tabId) {
    attachedTabs.delete(source.tabId);
  }
});

// ==========================================
// Gestion de l'Onglet Dédié Antigravity & HUD Visuel
// ==========================================

async function getWorkerTab(params = {}) {
  // 1. Si tab_id spécifique fourni
  if (params.tab_id) {
    try {
      const tab = await chrome.tabs.get(params.tab_id);
      if (tab) {
        activeWorkerTabId = tab.id;
        return tab;
      }
    } catch (_) {}
  }

  // 2. Si un worker tab actif est déjà mémorisé et toujours ouvert
  if (activeWorkerTabId) {
    try {
      const tab = await chrome.tabs.get(activeWorkerTabId);
      if (tab) return tab;
    } catch (_) {
      activeWorkerTabId = null;
    }
  }

  // 3. Chercher dans les groupes d'onglets du projet
  const projectName = params.project || statusInfo.activeProject || 'Antigravity Cloud Web';
  const groupTitle = `${projectName}-antigravity`;

  try {
    const allGroups = await chrome.tabGroups.query({});
    const matched = allGroups.find(g => g.title === groupTitle);
    if (matched) {
      const tabsInGroup = await chrome.tabs.query({ groupId: matched.id });
      if (tabsInGroup.length > 0) {
        activeWorkerTabId = tabsInGroup[0].id;
        return tabsInGroup[0];
      }
    }
  } catch (_) {}

  // 4. Si aucun onglet dédié n'existe : NE PAS VOLER L'ONGLET ACTIF DE L'UTILISATEUR !
  // Créer un nouvel onglet dédié EN ARRIÈRE-PLAN (active: false)
  const newTab = await chrome.tabs.create({
    url: params.url || 'about:blank',
    active: false
  });
  activeWorkerTabId = newTab.id;
  await assignTabToProjectGroup(newTab.id, projectName);
  return newTab;
}

async function showVisualCursor(tabId, { x = null, y = null, action = 'move', text = '' } = {}) {
  try {
    await executeInPage(tabId, (px, py, act, txt) => {
      let hud = document.getElementById('antigravity-worker-hud');
      let cursor = document.getElementById('antigravity-ghost-cursor');

      if (!document.getElementById('antigravity-styles')) {
        const style = document.createElement('style');
        style.id = 'antigravity-styles';
        style.textContent = `
          #antigravity-ghost-cursor {
            position: fixed;
            top: 0;
            left: 0;
            width: 32px;
            height: 32px;
            pointer-events: none;
            z-index: 2147483647;
            transition: transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1);
            transform: translate(-100px, -100px);
          }
          #antigravity-ghost-cursor .cursor-pointer {
            width: 24px;
            height: 24px;
            fill: #00d2ff;
            filter: drop-shadow(0 0 8px rgba(0, 210, 255, 0.9)) drop-shadow(0 2px 4px rgba(0,0,0,0.5));
          }
          #antigravity-ghost-cursor .cursor-badge {
            position: absolute;
            left: 26px;
            top: 6px;
            background: rgba(15, 23, 42, 0.92);
            color: #38bdf8;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 9999px;
            border: 1px solid rgba(56, 189, 248, 0.5);
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          }
          .antigravity-click-ripple {
            position: fixed;
            border-radius: 50%;
            pointer-events: none;
            z-index: 2147483646;
            transform: translate(-50%, -50%);
            border: 2px solid #00d2ff;
            background: rgba(0, 210, 255, 0.25);
            animation: antigravity-ripple-anim 0.45s ease-out forwards;
          }
          @keyframes antigravity-ripple-anim {
            0% { width: 4px; height: 4px; opacity: 1; border-width: 3px; }
            100% { width: 60px; height: 60px; opacity: 0; border-width: 1px; }
          }
          #antigravity-worker-hud {
            position: fixed;
            top: 14px;
            right: 20px;
            z-index: 2147483645;
            background: rgba(15, 23, 42, 0.90);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(56, 189, 248, 0.4);
            border-radius: 9999px;
            padding: 5px 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            color: #f1f5f9;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            user-select: none;
          }
          #antigravity-worker-hud button {
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid rgba(56, 189, 248, 0.4);
            color: #38bdf8;
            border-radius: 6px;
            padding: 3px 9px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
          }
          #antigravity-worker-hud button:hover {
            background: rgba(56, 189, 248, 0.35);
            color: #ffffff;
          }
          #antigravity-worker-hud .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
            box-shadow: 0 0 8px #22c55e;
          }
          #antigravity-worker-hud.paused .status-dot {
            background: #f59e0b;
            box-shadow: 0 0 8px #f59e0b;
          }
        `;
        document.documentElement.appendChild(style);
      }

      // Initialiser le curseur
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = 'antigravity-ghost-cursor';
        cursor.innerHTML = `
          <svg class="cursor-pointer" viewBox="0 0 24 24">
            <path d="M4 2 L19 12 L12 14 L15 21 L12 22 L9 15 L4 18 Z" />
          </svg>
          <span class="cursor-badge" id="antigravity-cursor-label">🤖 Antigravity</span>
        `;
        document.documentElement.appendChild(cursor);
      }

      // Initialiser le HUD
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'antigravity-worker-hud';
        hud.innerHTML = `
          <span class="status-dot" id="antigravity-hud-dot"></span>
          <span id="antigravity-hud-label" style="font-weight: 500;">🤖 Antigravity</span>
          <button id="antigravity-pause-btn">⏸ Pause</button>
        `;
        document.documentElement.appendChild(hud);

        const btn = hud.querySelector('#antigravity-pause-btn');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'toggle_pause' }, (res) => {
            if (res && res.paused) {
              btn.textContent = '▶ Reprendre';
              hud.classList.add('paused');
              hud.querySelector('#antigravity-hud-label').textContent = '🤖 En pause';
            } else {
              btn.textContent = '⏸ Pause';
              hud.classList.remove('paused');
              hud.querySelector('#antigravity-hud-label').textContent = '🤖 Actif';
            }
          });
        });
      }

      // Déplacer le curseur
      if (px !== null && py !== null) {
        cursor.style.transform = `translate(${px}px, ${py}px)`;
      }

      const labelEl = document.getElementById('antigravity-cursor-label');
      const hudLabel = document.getElementById('antigravity-hud-label');

      if (act === 'click') {
        const ripple = document.createElement('div');
        ripple.className = 'antigravity-click-ripple';
        ripple.style.left = `${px}px`;
        ripple.style.top = `${py}px`;
        document.documentElement.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);

        if (labelEl) labelEl.textContent = '🖱️ Clic';
        if (hudLabel) hudLabel.textContent = `🤖 Clic (${px}, ${py})`;
      } else if (act === 'type') {
        if (labelEl) labelEl.textContent = `⌨️ ${txt ? txt.slice(0, 16) : 'Saisie...'}`;
        if (hudLabel) hudLabel.textContent = `🤖 Saisie de texte...`;
      } else if (act === 'navigate') {
        if (hudLabel) hudLabel.textContent = `🤖 Chargement...`;
      } else {
        if (labelEl) labelEl.textContent = '🤖 Antigravity';
        if (hudLabel) hudLabel.textContent = '🤖 Prêt';
      }
    }, [x, y, action, text]);
  } catch (_) {
    // Si page protégée (chrome:// etc.)
  }
}

async function assignTabToProjectGroup(tabId, projectName) {
  if (!projectName) return null;
  const groupTitle = `${projectName}-antigravity`;
  statusInfo.activeProject = projectName;
  updateStorage();

  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  // Rechercher si le groupe existe déjà dans cette fenêtre
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const matched = existingGroups.find(g => g.title === groupTitle);

  if (matched) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: matched.id });
    return matched.id;
  } else {
    const newGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(newGroupId, {
      title: groupTitle,
      color: 'blue',
      collapsed: false
    });
    return newGroupId;
  }
}

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let timer = null;
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ==========================================
// Exécuteur de commandes
// ==========================================

async function handleCommand(action, params) {
  // Vérification de mise en pause par l'utilisateur
  if (isPaused && !['list_tabs', 'resume', 'pause', 'status'].includes(action)) {
    throw new Error("Action suspendue : Antigravity est en pause par l'utilisateur. Cliquez sur 'Reprendre' sur la page.");
  }

  switch (action) {
    // Gestion de la pause
    case 'pause': {
      isPaused = true;
      updateStorage();
      return { success: true, paused: true };
    }
    case 'resume': {
      isPaused = false;
      updateStorage();
      return { success: true, paused: false };
    }

    // 1. Navigation
    case 'navigate': {
      let targetTab = null;
      const shouldActivate = params.active === true; // En arrière-plan par défaut pour ne pas voler le focus de l'utilisateur

      if (params.new_tab) {
        targetTab = await chrome.tabs.create({ url: params.url, active: shouldActivate });
      } else {
        targetTab = await getWorkerTab(params);
        await chrome.tabs.update(targetTab.id, { url: params.url, active: shouldActivate });
      }

      activeWorkerTabId = targetTab.id;

      if (params.project) {
        await assignTabToProjectGroup(targetTab.id, params.project);
      }

      // Attendre la fin du chargement
      await waitTabComplete(targetTab.id, params.timeout_ms || 20000);
      await sleep(800);

      // Initialiser le HUD sur la page
      await showVisualCursor(targetTab.id, { action: 'navigate' });

      const finalTab = await chrome.tabs.get(targetTab.id);
      return {
        tab_id: finalTab.id,
        url: finalTab.url,
        title: finalTab.title,
        status: finalTab.status
      };
    }

    // 2. Capture d'écran (fonctionne 100% en arrière-plan sans voler le focus)
    case 'screenshot': {
      const tab = await getWorkerTab(params);
      await ensureDebugger(tab.id);

      let base64Data = null;
      try {
        const snap = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', {
          format: params.format || 'png',
          quality: params.quality || 85,
          fromSurface: true
        });
        base64Data = snap.data;
      } catch (cdpErr) {
        // Fallback capture visible si besoin
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      }

      return {
        tab_id: tab.id,
        format: params.format || 'png',
        image_base64: base64Data
      };
    }

    // 3. Clic souris (avec curseur fantôme visuel et ripple)
    case 'click': {
      const tab = await getWorkerTab(params);
      await ensureDebugger(tab.id);

      let clickX = params.x;
      let clickY = params.y;

      // Si sélecteur ou texte fourni, calculer les coordonnées via injection
      if ((clickX === undefined || clickY === undefined) && (params.selector || params.text)) {
        const coords = await getElementCoordinates(tab.id, params.selector, params.text);
        if (!coords || !coords.found) {
          throw new Error(`Élément introuvable pour le clic : selector="${params.selector}" text="${params.text}"`);
        }
        clickX = Math.round(coords.x);
        clickY = Math.round(coords.y);
      }

      if (clickX === undefined || clickY === undefined) {
        throw new Error("Veuillez fournir (x, y) ou un sélecteur/texte.");
      }

      // Afficher le curseur fantôme visuel sur la page avec animation ripple
      await showVisualCursor(tab.id, { x: clickX, y: clickY, action: 'click' });
      await sleep(50);

      // Événements souris natifs via CDP
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: clickX,
        y: clickY
      });
      await sleep(30);

      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: clickX,
        y: clickY,
        button: params.button || 'left',
        clickCount: 1
      });
      await sleep(50);

      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: clickX,
        y: clickY,
        button: params.button || 'left',
        clickCount: 1
      });

      return { success: true, clicked_at: { x: clickX, y: clickY } };
    }

    // 4. Frappe de texte (avec indicateur visuel de saisie)
    case 'type': {
      const tab = await getWorkerTab(params);
      await ensureDebugger(tab.id);

      // Si un sélecteur est donné, focaliser l'élément et afficher le curseur
      if (params.selector) {
        const coords = await getElementCoordinates(tab.id, params.selector, "");
        if (coords && coords.found) {
          await showVisualCursor(tab.id, { x: coords.x, y: coords.y, action: 'type', text: params.text });
        } else {
          await showVisualCursor(tab.id, { action: 'type', text: params.text });
        }

        await executeInPage(tab.id, (sel, clear) => {
          const el = document.querySelector(sel);
          if (el) {
            el.focus();
            if (clear) {
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value = '';
              } else if (el.isContentEditable) {
                el.innerText = '';
              }
            }
          }
        }, [params.selector, params.clear]);
        await sleep(100);
      } else {
        await showVisualCursor(tab.id, { action: 'type', text: params.text });
      }

      if (params.text) {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.insertText', {
          text: params.text
        });
      }

      if (params.press_enter) {
        await sleep(100);
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13
        });
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13
        });
      }

      return { success: true, text: params.text, pressed_enter: !!params.press_enter };
    }

    // 5. Touche clavier unitaire
    case 'press_key': {
      const tab = await getWorkerTab(params);
      await ensureDebugger(tab.id);

      const key = params.key || 'Enter';
      const keyMap = {
        'Enter': 13,
        'Escape': 27,
        'Tab': 9,
        'Backspace': 8,
        'ArrowDown': 40,
        'ArrowUp': 38,
        'Space': 32
      };

      const vk = keyMap[key] || 0;

      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: key,
        code: key,
        windowsVirtualKeyCode: vk
      });
      await sleep(40);
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: key,
        code: key,
        windowsVirtualKeyCode: vk
      });

      return { success: true, key };
    }

    // 6. Scroll
    case 'scroll': {
      const tab = await getWorkerTab(params);
      const deltaX = params.deltaX || 0;
      const deltaY = params.deltaY !== undefined ? params.deltaY : 500;

      await executeInPage(tab.id, (dx, dy) => {
        window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      }, [deltaX, deltaY]);

      await sleep(300);
      return { success: true, scrolled: { deltaX, deltaY } };
    }

    // 7. Évaluation de code JS dans la page
    case 'eval': {
      const tab = await getWorkerTab(params);
      await ensureDebugger(tab.id);
      try {
        const evalRes = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
          expression: params.script,
          returnByValue: true,
          awaitPromise: true
        });
        if (evalRes.exceptionDetails) {
          return { error: evalRes.exceptionDetails.text || evalRes.exceptionDetails.exception?.description };
        }
        return { value: evalRes.result?.value };
      } catch (cdpErr) {
        return { error: cdpErr.message };
      }
    }

    // 8. Extraction d'état intelligent de la page (DOM, boutons interactifs, écran blanc)
    case 'get_page_info': {
      const tab = await getWorkerTab(params);
      const info = await executeInPage(tab.id, () => {
        const bodyText = (document.body ? document.body.innerText : '').trim();
        const isBlank = bodyText.length === 0 && (!document.body || document.body.children.length <= 1);

        // Collecter les éléments interactifs majeurs avec leurs coordonnées
        const interactive = [];
        const selectors = 'button, a, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"]';
        const elements = Array.from(document.querySelectorAll(selectors));

        elements.slice(0, 75).forEach((el, index) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden') {
            const text = (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 60);
            interactive.push({
              index,
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              text: text || null,
              placeholder: el.getAttribute('placeholder') || null,
              type: el.type || null,
              role: el.getAttribute('role') || null,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
          }
        });

        return {
          url: window.location.href,
          title: document.title,
          is_blank: isBlank,
          text_snippet: bodyText.slice(0, 500),
          elements_count: elements.length,
          interactive_elements: interactive
        };
      });

      return {
        tab_id: tab.id,
        ...info
      };
    }

    // 9. Rechargement de page (utile si écran blanc)
    case 'reload': {
      const tab = await getWorkerTab(params);
      await chrome.tabs.reload(tab.id);
      await waitTabComplete(tab.id, 15000);
      await sleep(1000);
      return { success: true, reloaded_tab_id: tab.id };
    }

    // 10. Liste des onglets et groupes
    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      const groups = await chrome.tabGroups.query({});
      return {
        tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, groupId: t.groupId })),
        groups: groups.map(g => ({ id: g.id, title: g.title, color: g.color }))
      };
    }

    // 11. Attente active d'un élément ou texte (polling)
    case 'wait_for': {
      const tab = await getWorkerTab(params);
      const timeout = params.timeout_ms || 10000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const found = await executeInPage(tab.id, (sel, txt) => {
          if (sel) {
            const el = document.querySelector(sel);
            if (el) return true;
          }
          if (txt) {
            return document.body && document.body.innerText.includes(txt);
          }
          return false;
        }, [params.selector, params.text]);

        if (found) {
          return { found: true, elapsed_ms: Date.now() - startTime };
        }
        await sleep(500);
      }

      return { found: false, timeout: true };
    }

    // 12. Regrouper des onglets sous un nom de projet
    case 'group_tabs': {
      const tabIds = params.tab_ids || [];
      const project = params.project || 'Antigravity Cloud Web';
      const groupTitle = `${project}-antigravity`;

      if (tabIds.length === 0) {
        throw new Error("Aucun tab_id spécifié.");
      }

      const firstTab = await chrome.tabs.get(tabIds[0]);
      const windowId = firstTab.windowId;

      const existingGroups = await chrome.tabGroups.query({ windowId });
      const matched = existingGroups.find(g => g.title === groupTitle);

      let groupId = null;
      if (matched) {
        groupId = await chrome.tabs.group({ tabIds, groupId: matched.id });
      } else {
        groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: groupTitle,
          color: 'blue',
          collapsed: false
        });
      }

      statusInfo.activeProject = project;
      updateStorage();

      return { success: true, groupId, groupTitle, tabIds };
    }

    default:
      throw new Error(`Action inconnue : "${action}"`);
  }
}

// ==========================================
// Script Execution Helper
// ==========================================

async function executeInPage(tabId, func, args = []) {
  const safeArgs = args.map(a => a === undefined ? null : a);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: func,
    args: safeArgs
  });
  if (results && results.length > 0) {
    return results[0].result;
  }
  return null;
}

async function getElementCoordinates(tabId, selector, text) {
  return await executeInPage(tabId, (sel, txt) => {
    let target = null;
    if (sel) {
      target = document.querySelector(sel);
    }
    if (!target && txt) {
      const all = Array.from(document.querySelectorAll('button, a, input, [role="button"], span, p, h1, h2, h3, label, div, li'));
      const matches = all.filter(el => el.innerText && el.innerText.trim().toLowerCase().includes(txt.toLowerCase()));
      if (matches.length > 0) {
        matches.sort((a, b) => (a.innerText.trim().length - b.innerText.trim().length) || (a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height));
        target = matches[0];
      }
    }

    if (target) {
      target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      const rect = target.getBoundingClientRect();
      return {
        found: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    return { found: false };
  }, [selector, text]);
}
