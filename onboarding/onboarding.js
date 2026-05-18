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

  // --- Enable Cue: persist consent + close the tab ---
  const enableBtn = document.getElementById('enableBtn');
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      try {
        await chrome.storage.local.set({
          cueOnboarded: true,
          cueConsentVersion: 1,
          cueConsentAt: new Date().toISOString(),
        });
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
