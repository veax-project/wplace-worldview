/*
 * The popup is not a settings panel: the settings live on the map, behind the
 * button added to wplace's toolbar. This is where you land when you are after
 * help or after someone to write to — so that is all it does: say where the
 * settings are, and give the means to reach us.
 *
 * No hard-coded string: everything comes from _locales/, like the rest.
 */
const REPO = 'https://github.com/veax-project/wplace-worldview';
const EMAIL = 'veaxproject@gmail.com';

const LINKS = {
  lienAide: `${REPO}#readme`,
  lienBogue: `${REPO}/issues/new`,
  lienVie: `${REPO}/blob/master/PRIVACY.md`,
  lienCourriel: `mailto:${EMAIL}?subject=${encodeURIComponent('Wplace WorldView')}`,
};

const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

/*
 * This page follows the language of WPLACE, like the panel built into the map.
 *
 * It cannot read it itself: the localStorage where wplace keeps it belongs to
 * the page, and this popup is not the page. It is the content script that
 * drops it into chrome.storage.local on every visit (see textsFor() in
 * content-iso.js).
 *
 * So we paint twice: right away with chrome.i18n — the browser's language, our
 * fallback — then again if the site speaks another one. The second pass is a
 * local file, a few milliseconds: no visible flicker, and nothing blank in the
 * meantime.
 */
let messages = null;
const t = (key) => (messages && messages[key]) || chrome.i18n.getMessage(key);

function paint() {
  setText('nom', t('extensionName'));
  setText('version', 'v' + chrome.runtime.getManifest().version);
  setText('quoi', t('extensionDescription'));
  setText('ou', t('settingsInMap'));
  setText('txtAide', t('popupHelp'));
  setText('txtBogue', t('popupBug'));
  setText('txtCourriel', t('popupEmail'));
  setText('courriel', EMAIL);
  setText('txtVie', t('popupPrivacy'));
  setText('txtMontre', t('popupShow'));
  setText('pied', t('popupUnofficial'));
}

paint();

(async () => {
  try {
    const { siteLanguage } = await chrome.storage.local.get('siteLanguage');
    if (!siteLanguage) return;                       // never been to wplace
    // We go back through wvLang rather than trust the raw value: it comes from
    // storage, and it is what picks the entry in texts.json.
    const locale = wvLang.ours(siteLanguage);
    const r = await fetch(chrome.runtime.getURL('texts.json'));
    const all = await r.json();
    if (!all[locale]) return;
    messages = all[locale];
    paint();
  } catch (e) { /* we keep whatever chrome.i18n gave */ }
})();

for (const [id, url] of Object.entries(LINKS)) {
  const a = document.getElementById(id);
  if (a) a.href = url;
}

/*
 * "Show me the button".
 *
 * The settings button is placed in THE SITE's toolbar, in among theirs — that
 * is the whole point, and it is also why it goes unnoticed. This button here
 * lights up again, on the wplace tab, the bubble that points at it.
 *
 * Two paths, because the tab is not always ready:
 *   - it answers: we send it the message, it shows the bubble right away;
 *   - it does not answer (page still loading, or no tab at all): we set a flag
 *     in chrome.storage.local, and the ISOLATED bridge is the one that will
 *     pick it up when answering the page's first settings request.
 * The flag carries a timestamp: once stale it is ignored — without that the
 * bubble would come back on a later visit with nobody having asked for it.
 *
 * ORDER OF THE CALLS, and it is not a detail: an extension popup is DESTROYED
 * as soon as focus leaves it, and its JS context with it. And
 * tabs.update({ active: true }) is precisely what makes focus leave. Everything
 * that follows that call — including the continuation of an `await` — may never
 * run. So we send the message FIRST, and go to the tab afterwards.
 *
 * The bubble, for its part, knows how to wait: ui.js only shows it once the tab
 * is really visible (a hidden tab composes no image, it would show up frozen
 * there). So it appears just after the switch.
 */
const PATTERN = 'https://wplace.live/*';

async function showButton() {
  const openTabs = await chrome.tabs.query({ url: PATTERN });
  // the one being looked at, for preference: that is the map the user has in
  // front of them when they open this popup
  const [front] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = openTabs.find((tab) => front && tab.id === front.id) || openTabs[0];

  if (!target) {
    await chrome.storage.local.set({ showButton: Date.now() });
    await chrome.tabs.create({ url: 'https://wplace.live/' });
    return;
  }

  try {
    // frameId 0: the page itself. Without it, every wplace iframe would get the
    // message and look for a button that only exists in the top frame.
    await chrome.tabs.sendMessage(target.id, { type: 'wv:show-button' }, { frameId: 0 });
  } catch (e) {
    // nobody at the other end: the page has not loaded our scripts yet
    await chrome.storage.local.set({ showButton: Date.now() });
  }

  // From here on the popup may die at any instant: nothing essential is left.
  chrome.tabs.update(target.id, { active: true });
  chrome.windows.update(target.windowId, { focused: true }).catch(() => { /* single window */ });
}

const showBtn = document.getElementById('montre');
if (showBtn) {
  showBtn.addEventListener('click', () => {
    showBtn.disabled = true;
    // window.close() before the promises settle would kill the page AND its
    // in-flight calls: we only close once the message has left.
    showButton().then(() => window.close(), () => { showBtn.disabled = false; });
  });
}
