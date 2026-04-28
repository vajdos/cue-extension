/**
 * Cue — First-run Onboarding
 *
 * Four-step intro shown on fresh install (service worker opens this page).
 * On finish, writes cueOnboarded=true + cueNudgePack=<selected> to
 * chrome.storage.local, which the content script reads on session start.
 *
 * Defaults to the 'gentle' pack rather than 'directive' — field testing
 * (2026-04-16) showed directive phrasing contributed to nudges feeling
 * erratic in real meetings.
 */
(function () {
  'use strict';

  const TOTAL_STEPS = 4;
  let currentStep = 1;
  let selectedPack = 'gentle';
  let selectedLocale = detectDefaultLocale();

  function detectDefaultLocale() {
    const supported = ['en-US', 'en-GB', 'es', 'de', 'fr', 'pt', 'it'];
    const lang = (navigator.language || 'en-US').toLowerCase();
    if (lang.startsWith('en-gb')) return 'en-GB';
    if (lang.startsWith('en')) return 'en-US';
    const prefix = lang.split('-')[0];
    return supported.includes(prefix) ? prefix : 'en-US';
  }

  const dots = document.querySelectorAll('.step-indicator .dot');
  const steps = document.querySelectorAll('.step');

  function goTo(step) {
    if (step < 1 || step > TOTAL_STEPS) return;
    currentStep = step;
    steps.forEach(el => el.classList.toggle('active', Number(el.dataset.step) === step));
    dots.forEach(el => {
      const n = Number(el.dataset.step);
      el.classList.toggle('active', n === step);
      el.classList.toggle('done', n < step);
    });
    window.scrollTo(0, 0);
  }

  // --- Step navigation ---
  document.getElementById('btn-next-1').addEventListener('click', () => goTo(2));
  document.getElementById('btn-next-2').addEventListener('click', () => goTo(3));
  document.getElementById('btn-next-3').addEventListener('click', () => goTo(4));

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goTo(currentStep - 1));
  });

  // --- Pack selection ---
  const packEls = document.querySelectorAll('.pack');
  function selectPack(pack) {
    selectedPack = pack;
    packEls.forEach(el => el.classList.toggle('selected', el.dataset.pack === pack));
  }
  packEls.forEach(el => {
    el.addEventListener('click', () => selectPack(el.dataset.pack));
  });
  // Default to gentle (tested best in field 2026-04-16)
  selectPack('gentle');

  // Wire the inline "Teams desktop" setup link on step 2 — opens the
  // guide in a new tab using the extension-local URL so it loads with
  // the correct permissions and styling.
  const teamsPwaLink = document.getElementById('onb-teams-pwa-link');
  if (teamsPwaLink) {
    teamsPwaLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) {
        chrome.tabs.create({ url: chrome.runtime.getURL('docs/teams-pwa-setup.html') });
      } else {
        window.open('docs/teams-pwa-setup.html', '_blank');
      }
    });
  }

  // Wire the "Verify privacy" link on step 4 — opens the built-in
  // privacy verifier in a new tab so the user can confirm zero network
  // calls without leaving onboarding.
  const verifyLink = document.getElementById('onb-open-verify');
  if (verifyLink) {
    verifyLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) {
        chrome.tabs.create({ url: chrome.runtime.getURL('verify/verify.html') });
      } else {
        window.open('verify/verify.html', '_blank');
      }
    });
  }

  // Wire locale dropdown: default to detected browser language
  const localeSel = document.getElementById('onb-locale');
  if (localeSel) {
    localeSel.value = selectedLocale;
    localeSel.addEventListener('change', () => {
      selectedLocale = localeSel.value;
    });
  }

  // --- Finish ---
  document.getElementById('btn-finish').addEventListener('click', () => {
    const payload = {
      cueOnboarded: true,
      cueOnboardedAt: Date.now(),
      cueNudgePack: selectedPack,
      cueLocale: selectedLocale
    };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(payload, () => {
        // Close the onboarding tab — user is ready to start a real call
        if (chrome.tabs && typeof chrome.tabs.getCurrent === 'function') {
          chrome.tabs.getCurrent(tab => {
            if (tab && tab.id && chrome.tabs.remove) {
              chrome.tabs.remove(tab.id);
            } else {
              window.close();
            }
          });
        } else {
          window.close();
        }
      });
    } else {
      // Standalone preview fallback (no chrome API) — just acknowledge
      console.log('[Cue Onboarding] Would save:', payload);
      alert('Onboarding complete. Selected pack: ' + selectedPack);
    }
  });
})();
