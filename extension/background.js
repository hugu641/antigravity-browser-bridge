/**
 * Antigravity Browser Bridge - Service Worker (Manifest V3)
 * Gère la communication WebSocket avec le pont local et l'exécution
 * d'actions de contrôle Chrome (CDP / Debugger, Tabs, Groupes).
 */

const WS_URL = 'ws://127.0.0.1:8765';
let ws = null;
let reconnectTimer = null;
const attachedTabs = new Set();
let lastTargetTabId = null;

// Enregistrement d'état pour la popup
let statusInfo = {
  connected: false,
  lastCommand: null,
  lastError: null,
  activeProject: null,
  tabCount: 0
};

function updateStorage() {
  chrome.storage.local.set({ statusInfo }).catch(() => {});
}

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
// Helpers Onglets & Tab Groups
// ==========================================

async function getActiveOrTargetTab(tabId) {
  if (tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (tab) {
      lastTargetTabId = tab.id;
      return tab;
    }
  }

  if (lastTargetTabId) {
    try {
      const tab = await chrome.tabs.get(lastTargetTabId);
      if (tab) return tab;
    } catch (_) {}
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) {
    lastTargetTabId = activeTab.id;
    return activeTab;
  }

  const allTabs = await chrome.tabs.query({});
  if (allTabs.length > 0) {
    lastTargetTabId = allTabs[0].id;
    return allTabs[0];
  }

  throw new Error("Aucun onglet Chrome disponible.");
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
  switch (action) {
    // 1. Navigation
    case 'navigate': {
      let targetTab = null;
      if (params.new_tab) {
        targetTab = await chrome.tabs.create({ url: params.url, active: true });
      } else {
        targetTab = await getActiveOrTargetTab(params.tab_id);
        await chrome.tabs.update(targetTab.id, { url: params.url, active: true });
      }

      lastTargetTabId = targetTab.id;

      if (params.project) {
        await assignTabToProjectGroup(targetTab.id, params.project);
      }

      // Attendre la fin du chargement
      await waitTabComplete(targetTab.id, params.timeout_ms || 20000);
      await sleep(1000); // Laisse le temps au DOM React/Vue de s'hydrater

      const finalTab = await chrome.tabs.get(targetTab.id);
      return {
        tab_id: finalTab.id,
        url: finalTab.url,
        title: finalTab.title,
        status: finalTab.status
      };
    }

    // 2. Capture d'écran
    case 'screenshot': {
      const tab = await getActiveOrTargetTab(params.tab_id);
      await ensureDebugger(tab.id);

      // Assurer que la fenêtre est visible
      await chrome.tabs.update(tab.id, { active: true });

      let base64Data = null;
      try {
        const snap = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', {
          format: params.format || 'png',
          quality: params.quality || 85,
          fromSurface: true
        });
        base64Data = snap.data;
      } catch (cdpErr) {
        // Fallback sur captureVisibleTab
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      }

      return {
        tab_id: tab.id,
        format: params.format || 'png',
        image_base64: base64Data
      };
    }

    // 3. Clic souris (par coordonnées ou par sélecteur / texte)
    case 'click': {
      const tab = await getActiveOrTargetTab(params.tab_id);
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

    // 4. Frappe de texte
    case 'type': {
      const tab = await getActiveOrTargetTab(params.tab_id);
      await ensureDebugger(tab.id);

      // Si un sélecteur est donné, focaliser l'élément d'abord
      if (params.selector) {
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
      const tab = await getActiveOrTargetTab(params.tab_id);
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
      const tab = await getActiveOrTargetTab(params.tab_id);
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
      const tab = await getActiveOrTargetTab(params.tab_id);
      const res = await executeInPage(tab.id, (code) => {
        try {
          return { value: window.eval(code) };
        } catch (e) {
          return { error: e.message };
        }
      }, [params.script]);

      return res;
    }

    // 8. Extraction d'état intelligent de la page (DOM, boutons interactifs, écran blanc)
    case 'get_page_info': {
      const tab = await getActiveOrTargetTab(params.tab_id);
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
      const tab = await getActiveOrTargetTab(params.tab_id);
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
      const tab = await getActiveOrTargetTab(params.tab_id);
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
      target = all.find(el => el.innerText && el.innerText.trim().toLowerCase().includes(txt.toLowerCase()));
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
