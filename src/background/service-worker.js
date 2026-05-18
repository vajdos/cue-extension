/**
 * Cue — Service Worker (Background Script)
 *
 * Runs as the extension's background process in Manifest V3.
 * Responsibilities:
 *   - Detect when the user navigates to a supported video call URL
 *   - Manage extension lifecycle (install, update)
 *   - Open Integration Tape after session ends
 *   - Coordinate between popup and content scripts
 */

// -- Offscreen Document Management --
// Offscreen documents are Chrome's blessed pattern for MV3 extensions to
// call getUserMedia. They run invisibly, don't require a user gesture, and
// persist across side panel open/close.

const OFFSCREEN_PATH = 'offscreen/offscreen.html';

async function hasOffscreenDocument() {
  if (!chrome.offscreen) return false;
  try {
    if (chrome.offscreen.hasDocument) {
      return await chrome.offscreen.hasDocument();
    }
    // Fallback for older Chrome versions
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts && contexts.length > 0;
  } catch (e) {
    console.warn('[Cue] hasOffscreenDocument check failed:', e);
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error('chrome.offscreen API not available (requires Chrome 109+)');
  }
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Real-time voice analytics for conversation coaching.',
    });
    console.log('[Cue] Offscreen document created.');
  } catch (e) {
    // "Only a single offscreen document may be created" is fine — already exists
    if (e.message && e.message.includes('single offscreen')) return;
    throw e;
  }
}

async function closeOffscreenDocument() {
  if (!chrome.offscreen) return;
  if (!(await hasOffscreenDocument())) return;
  try {
    await chrome.offscreen.closeDocument();
    console.log('[Cue] Offscreen document closed.');
  } catch (e) {
    console.warn('[Cue] closeOffscreenDocument failed:', e);
  }
}

// -- Lifecycle Events --

chrome.runtime.onInstalled.addListener(async (details) => {
  const version = chrome.runtime.getManifest().version;
  console.log('[Cue] Extension installed:', details.reason, 'v' + version);

  // Configure side panel to open on icon click (every install/update)
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) { console.warn('[Cue] sidePanel setPanelBehavior failed:', e); }

  if (details.reason === 'install') {
    console.log('[Cue] Welcome to Cue! First-time setup complete.');
    // Store initial version — no banner on first install
    await chrome.storage.local.set({
      cueCurrentVersion: version,
      cueLastSeenVersion: version
    });

    // Open the onboarding flow in a new tab — only if the user has not
    // already completed it (defensive against reinstall / dev-reload edge cases)
    try {
      const stored = await chrome.storage.local.get(['cueOnboarded']);
      if (!stored.cueOnboarded) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL('onboarding/onboarding.html'),
          active: true
        });
        console.log('[Cue] First-run onboarding tab opened.');
      }
    } catch (e) {
      console.warn('[Cue] Failed to open onboarding tab:', e);
    }
  } else if (details.reason === 'update') {
    const prev = details.previousVersion || 'unknown';
    console.log('[Cue] Updated from v' + prev + ' → v' + version);
    // Store new version but leave lastSeen at old version so popup shows the banner
    await chrome.storage.local.set({ cueCurrentVersion: version });

    // Show "UPD" badge so the user knows something changed
    try {
      await chrome.action.setBadgeText({ text: 'UPD' });
      await chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
    } catch (e) {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Cue] Service worker started (browser launch).');

  // Always-on: show green badge so user knows Cue is active
  try {
    await chrome.action.setBadgeText({ text: ' ' });
    await chrome.action.setBadgeBackgroundColor({ color: '#2DD4A0' });
  } catch (e) {}

  // Ensure side panel is set to open on action click
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) { console.warn('[Cue] sidePanel API unavailable:', e); }

  // Start heartbeat alarm for persistent presence
  chrome.alarms.create('cue-heartbeat', { periodInMinutes: 1 });

  // Browser startup reminder notification — click Cue icon to open panel
  try {
    await chrome.notifications.create('cue-startup-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'Cue is ready',
      message: 'Click the Cue icon in your Chrome toolbar to open the side panel.',
      priority: 1,
      requireInteraction: false,
      silent: true,
    });
  } catch (e) {}
});

// ---------------------------------------------------------------------------
// Always-On: Heartbeat alarm — keeps Cue alive and aware
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'cue-heartbeat') return;

  try {
    const tabs = await chrome.tabs.query({});
    const callTab = tabs.find(t => t.url && isSupportedUrl(t.url));

    if (callTab) {
      // User is on a call — show red LIVE badge
      await chrome.action.setBadgeText({ text: 'LIVE' });
      await chrome.action.setBadgeBackgroundColor({ color: '#E94560' });
    } else {
      // No call — green dot (ready state)
      const stored = await chrome.storage.local.get(['cueCurrentVersion', 'cueLastSeenVersion']);
      if (stored.cueCurrentVersion && stored.cueLastSeenVersion &&
          stored.cueCurrentVersion !== stored.cueLastSeenVersion) {
        // Update pending — keep the blue UPD badge
        await chrome.action.setBadgeText({ text: 'UPD' });
        await chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
      } else {
        await chrome.action.setBadgeText({ text: ' ' });
        await chrome.action.setBadgeBackgroundColor({ color: '#2DD4A0' });
      }
    }
  } catch (e) {
    // Tab query may fail on restricted pages — ignore
  }
});

// Start heartbeat on install too
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('cue-heartbeat', { periodInMinutes: 1 });
});

// v1.1.4 — Wispr-style global hotkey: Alt+Shift+C toggles a Cue session.
// Three-key combo for collision-free invocation (Fitts's Law gives spacebar the
// edge for speed, but spacebar conflicts with typing — modifier combo wins for
// toggle semantics over a 30+min session). User can remap in chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-session') return;
  console.log('[Cue] Hotkey toggle-session fired.');

  // Make sure the side panel is open so the user can see what's happening
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.windowId !== undefined && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (e) {}

  // Tell the side panel to start or stop based on its current state.
  // The panel listens for this message and figures out whether to call start() or stop().
  try {
    chrome.runtime.sendMessage({
      target: 'cue-ui',
      type: 'hotkey-toggle-session',
      timestamp: Date.now(),
    }).catch(() => {});
  } catch (e) {
    console.warn('[Cue] Failed to dispatch hotkey toggle:', e);
  }
});

// ---------------------------------------------------------------------------
// Context Menus — right-click access to Cue
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'cue-settings',
    title: 'Cue Settings',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'cue-progress',
    title: 'View Your Progress',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'cue-sync',
    title: 'Sync Across Devices',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'cue-verify',
    title: 'MVP Verification Tool',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'cue-open-panel-tab',
    title: 'Open Cue in New Tab',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'cue-settings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/settings.html') });
  } else if (info.menuItemId === 'cue-progress') {
    chrome.tabs.create({ url: chrome.runtime.getURL('tape/progress.html') });
  } else if (info.menuItemId === 'cue-sync') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/settings.html') + '#sync' });
  } else if (info.menuItemId === 'cue-verify') {
    chrome.tabs.create({ url: chrome.runtime.getURL('verify/verify.html') });
  } else if (info.menuItemId === 'cue-open-panel-tab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/panel.html') });
  }
});

// ---------------------------------------------------------------------------
// Nudge Notifications — system-level notifications for nudges
// ---------------------------------------------------------------------------

async function showNudgeNotification(nudgeType, message) {
  const icons = {
    pace: 'Pace',
    tension: 'Tension',
    longSpeech: 'Long Speech',
    escalation: 'Escalation',
  };

  try {
    await chrome.notifications.create('cue-nudge-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'Cue — ' + (icons[nudgeType] || 'Nudge'),
      message: message || 'Check your conversation pace',
      priority: nudgeType === 'escalation' ? 2 : 1,
      requireInteraction: false,
      silent: false,
    });
  } catch (e) {
    console.log('[Cue] Notification failed:', e);
  }
}


// -- Tab Navigation Monitoring --

const SUPPORTED_PATTERNS = [
  /^https:\/\/teams\.cloud\.microsoft\//,
  /^https:\/\/teams\.microsoft\.com\//,
  /^https:\/\/teams\.live\.com\//,
  /^https:\/\/meet\.google\.com\//,
  /^https:\/\/zoom\.us\/wc\//,
  /^https:\/\/app\.zoom\.us\//
];

function isSupportedUrl(url) {
  return SUPPORTED_PATTERNS.some(pattern => pattern.test(url));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (isSupportedUrl(tab.url)) {
      console.log(`[Cue] Supported call page detected on tab ${tabId}: ${tab.url}`);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`[Cue] Tab ${tabId} closed.`);
});


// -- Message Handling --

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // CRITICAL: Ignore messages addressed to other extension contexts.
  // Without this, the SW's fallthrough `sendResponse({status:'ok'})` at the
  // end of this listener will hijack replies meant for the offscreen doc or
  // side panel, causing `await chrome.runtime.sendMessage(...)` in callers to
  // receive {status:'ok'} instead of the real response — which makes the
  // panel think startAudio failed even though it succeeded.
  if (message && (message.target === 'offscreen' || message.target === 'cue-ui')) {
    return false; // let the intended recipient respond
  }

  console.log('[Cue] Message received:', message, 'from:', sender.tab?.id || 'popup');

  // Verify tool ping — confirms service worker is alive
  if (message.type === 'verify-ping') {
    sendResponse({ status: 'alive', timestamp: Date.now(), version: chrome.runtime.getManifest().version });
    return;
  }

  // v1.0 Decision Engine output → system notification + cross-device haptic push
  // PAUSE = 1 pulse, ASK_QUESTION = 2 pulses
  if (message.type === 'decisionFired') {
    (async () => {
      const pulsesByDecision = {
        PAUSE: { pulses: 1, title: 'Cue: Pause', body: 'Stop. Listen.' },
        ASK_QUESTION: { pulses: 2, title: 'Cue: Ask a Question', body: 'Invite them in.' },
      };
      const cfg = pulsesByDecision[message.decision];
      if (!cfg) return sendResponse({ status: 'ignored' });

      try {
        await chrome.notifications.create('cue-decision-' + Date.now(), {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
          title: cfg.title,
          message: cfg.body,
          priority: 2,
          requireInteraction: false,
          silent: false,
        });
      } catch (e) {}

      // Cross-device haptic push via PWA Web Push endpoint
      try {
        const stored = await chrome.storage.local.get(['cueSettings']);
        const email = stored.cueSettings?.syncEmail;
        if (email) {
          await fetch('https://cue-pwa.vercel.app/api/test-haptic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              nudgeType: message.decision === 'PAUSE' ? 'pace' : 'longSpeech',
              // Encode pulses in the vibration pattern (single vs. double tap)
              vibrate: cfg.pulses === 1 ? [400] : [200, 150, 200],
              title: cfg.title,
              body: cfg.body,
            }),
          });
        }
      } catch (e) {}

      sendResponse({ ok: true });
    })();
    return true; // async
  }

  // Panel session lifecycle — update badge
  if (message.type === 'panelSessionStart') {
    chrome.action.setBadgeText({ text: 'ON' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#2DD4A0' }).catch(() => {});
    sendResponse({ status: 'ok' });
    return;
  }
  if (message.type === 'panelSessionEnd') {
    chrome.action.setBadgeText({ text: ' ' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#2DD4A0' }).catch(() => {});
    sendResponse({ status: 'ok' });
    return;
  }

  // Offscreen audio: start
  if (message.type === 'cue-start-audio') {
    (async () => {
      try {
        const options = Object.assign({}, message.options || {});
        const source = options.source === 'tab' ? 'tab' : 'mic';

        // For tab-capture mode: resolve a streamId in the service worker
        // (the SW runs in the extension's trusted context and can call
        // chrome.tabCapture.getMediaStreamId on behalf of the offscreen doc).
        if (source === 'tab' || source === 'both') {
          if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
            sendResponse({
              ok: false,
              error: 'chrome.tabCapture API not available. Requires Chrome 116+ with tabCapture permission.',
              errorName: 'TabCaptureUnavailable',
            });
            return;
          }

          // Find the currently active tab that the user is on.
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (!activeTab || typeof activeTab.id !== 'number') {
            sendResponse({
              ok: false,
              error: 'No active tab found. Switch to your Zoom/Teams/Meet tab and try again.',
              errorName: 'NoActiveTab',
            });
            return;
          }

          // Some URLs (chrome://, edge://, side panel, extension pages) can't be captured.
          const url = activeTab.url || '';
          if (!/^https?:/i.test(url) && !/^file:/i.test(url)) {
            sendResponse({
              ok: false,
              error: 'The active tab cannot be captured. Switch to your call tab (Zoom/Teams/Meet) first.',
              errorName: 'UncapturableTab',
            });
            return;
          }

          let streamId;
          try {
            // No consumerTabId means the offscreen document (same extension) will consume it.
            streamId = await new Promise((resolve, reject) => {
              chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (id) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(id);
                }
              });
            });
          } catch (e) {
            sendResponse({
              ok: false,
              error: 'tabCapture.getMediaStreamId failed: ' + e.message + ' — make sure you clicked the Cue toolbar icon first (required for activeTab consent).',
              errorName: 'TabCaptureDenied',
            });
            return;
          }

          if (!streamId) {
            sendResponse({ ok: false, error: 'tabCapture returned no streamId', errorName: 'TabCaptureNoStreamId' });
            return;
          }

          options.source = 'tab';
          options.streamId = streamId;
          options.tabUrl = url;
        } else {
          options.source = 'mic';
        }

        await ensureOffscreenDocument();
        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'offscreen-start',
          options,
        });
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message, errorName: e.name || 'ServiceWorkerError' });
      }
    })();
    return true; // async
  }

  // Offscreen audio: stop
  if (message.type === 'cue-stop-audio') {
    (async () => {
      try {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'offscreen-stop',
        }).catch(() => {});
        // Optionally close the offscreen doc after stop
        await closeOffscreenDocument();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // Offscreen audio: diagnostics
  if (message.type === 'cue-diagnostics') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'offscreen-diagnostics',
        });
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (message.type === 'sessionEnd') {
    handleSessionEnd(message.sessionId, message.eqScore);
    sendResponse({ status: 'ok' });
    return;
  }

  if (message.type === 'getLatestSession') {
    sendResponse({ status: 'ok' });
    return;
  }

  // Nudge fired — send system notification if enabled
  if (message.type === 'nudgeFired') {
    (async () => {
      const settings = await chrome.storage.local.get(['cueSettings']);
      const channels = settings.cueSettings?.nudgeChannels || ['visual'];
      if (channels.includes('notification')) {
        showNudgeNotification(message.nudgeType, message.text);
      }
      // Push to sync API for cross-device delivery (Apple Watch, phone)
      if (settings.cueSettings?.syncEmail) {
        pushNudgeCrossDevice(settings.cueSettings.syncEmail, message.nudgeType, message.text);
      }
    })();
    sendResponse({ status: 'ok' });
    return;
  }

  // Sync request from settings page
  if (message.type === 'syncNow') {
    handleSync(message.email).then(result => sendResponse(result));
    return true; // Async response
  }

  sendResponse({ status: 'ok' });
});

// Cross-device nudge push (sends to sync API which can relay to Apple Watch / phone)
async function pushNudgeCrossDevice(email, nudgeType, text) {
  try {
    await fetch('https://cue-pwa.vercel.app/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        lastNudge: { type: nudgeType, text, timestamp: Date.now() },
      }),
    });
  } catch (e) {
    console.log('[Cue] Cross-device push failed:', e);
  }
}

// Full sync — pull/push preferences and session data
async function handleSync(email) {
  if (!email) return { error: 'No email' };
  try {
    const stored = await chrome.storage.local.get(['cueSettings', 'cuePro', 'cueSessionCount']);
    const response = await fetch('https://cue-pwa.vercel.app/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        deviceId: 'chrome-extension',
        preferences: stored.cueSettings || {},
        progress: {
          totalSessions: stored.cueSessionCount || 0,
          isPro: stored.cuePro || false,
        },
      }),
    });
    const result = await response.json();
    await chrome.storage.local.set({ cueLastSync: new Date().toISOString() });
    return { ok: true, lastSync: result.lastSync };
  } catch (e) {
    return { error: e.message };
  }
}


// -- Session End: Open Integration Tape --

async function handleSessionEnd(sessionId, eqScore) {
  console.log('[Cue] Session ended:', sessionId, 'EQ Score:', eqScore);

  // Set badge to show "NEW"
  try {
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setBadgeBackgroundColor({ color: '#2DD4A0' });
  } catch (err) {
    console.warn('[Cue] Failed to set badge:', err);
  }

  // Open tape in a new tab after a short delay (let IndexedDB writes settle)
  setTimeout(() => {
    const tapeUrl = chrome.runtime.getURL('tape/tape.html') + '?session=' + sessionId;
    chrome.tabs.create({ url: tapeUrl, active: true });
    console.log('[Cue] Integration Tape opened:', tapeUrl);
  }, 2000);
}
