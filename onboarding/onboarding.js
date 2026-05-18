// Cue — Onboarding consent screen (v1.1.32)
//
// Single-screen install-time consent. User clicks "Enable Cue" once.
// This sets `cueOnboarded: true` in chrome.storage.local so future
// service-worker installs don't re-open this tab.

(function () {
  'use strict';

  const COURTESY_TEXT = 'I use a listening coach called Cue during my calls. It measures my conversation patterns on my device — no audio recorded or transcribed.';

  // --- Courtesy script: click to copy ---
  const courtesyEl = document.getElementById('copyCourtesy');
  const copyHint   = document.getElementById('copyHint');
  if (courtesyEl) {
    courtesyEl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(COURTESY_TEXT);
        if (copyHint) {
          const original = copyHint.textContent;
          copyHint.textContent = '✓ Copied to clipboard';
          setTimeout(() => { copyHint.textContent = original; }, 1800);
        }
      } catch (e) {
        if (copyHint) copyHint.textContent = 'Copy failed — select the text manually';
      }
    });
  }

  // --- Technical details disclosure ---
  const moreBtn = document.getElementById('moreBtn');
  const details = document.getElementById('details');
  if (moreBtn && details) {
    moreBtn.addEventListener('click', () => {
      const isOpen = details.classList.toggle('open');
      moreBtn.textContent = isOpen ? 'Hide technical details ↑' : 'Show technical details ↓';
    });
  }

  // --- v1.1.33 — Generate a 96-bit random device ID for the corpus.
  // This is the ONLY identifier the corpus endpoint ever sees; never linked
  // to email, IP (Vercel strips it), name, or browser fingerprint.
  function _generateDeviceId() {
    const buf = new Uint8Array(12); // 96 bits
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- Enable Cue: persist consent + close the tab ---
  const enableBtn = document.getElementById('enableBtn');
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      const corpusOptinEl = document.getElementById('corpusOptin');
      const corpusOptIn = !!(corpusOptinEl && corpusOptinEl.checked);
      try {
        const payload = {
          cueOnboarded: true,
          // v2 (v1.1.33): consent flow now includes corpus telemetry disclosure
          // with default-on opt-out checkbox. Bumped from v1 (v1.1.32 — no
          // telemetry disclosure) so existing users get re-prompted if we
          // ever ship a re-onboarding migration.
          cueConsentVersion: 2,
          cueConsentAt: new Date().toISOString(),
          cueCorpusOptIn: corpusOptIn,
          cueCorpusOptInAt: corpusOptIn ? new Date().toISOString() : null,
        };
        // Only generate a device ID if the user opted in; never persist one
        // for users who declined.
        if (corpusOptIn) {
          payload.cueDeviceId = _generateDeviceId();
        }
        await chrome.storage.local.set(payload);
      } catch (e) {
        console.warn('[Cue Onboarding] could not persist consent:', e);
      }
      // Open the side panel so the user lands directly in the product.
      // sidePanel.open() requires user gesture; this click qualifies.
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && chrome.sidePanel && chrome.sidePanel.open) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (e) { /* not all browsers expose sidePanel.open from extension page */ }
      // Close the onboarding tab (best-effort).
      try {
        const [self] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (self && self.id) chrome.tabs.remove(self.id);
      } catch (e) { /* user can close manually */ }
    });
  }

  // --- "Maybe later" — close without persisting consent ---
  const laterBtn = document.getElementById('laterBtn');
  if (laterBtn) {
    laterBtn.addEventListener('click', async () => {
      try {
        const [self] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (self && self.id) chrome.tabs.remove(self.id);
      } catch (e) { /* user can close manually */ }
    });
  }
})();
