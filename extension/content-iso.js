/*
 * Content script, ISOLATED world. Bridge between the page and the service
 * worker.
 *
 * In normal times it does nothing but relay: the worker already returns
 * decoded PNG, off the page's main thread.
 *
 * It still keeps a fallback decoder. Running WebAssembly in an MV3 service
 * worker depends on the extension's CSP ('wasm-unsafe-eval') and on the Chrome
 * version; if that fails, the worker returns the raw bytes with aDecoder:true
 * and we decode here. Slower, but the extension works all the same.
 */

const PREFIX = 'wv:';

/*
 * The labels follow the language of WPLACE, not that of the browser.
 *
 * The reasoning is at the top of language.js, loaded just before this one in the
 * same ISOLATED world. In short: wplace keeps its language in the page's
 * localStorage, and a content script shares that localStorage.
 *
 * chrome.i18n stays as the safety net: it answers according to the BROWSER's
 * language, which is the right fallback while the page has declared nothing.
 */
let cachedTexts = null;
let cachedLocale = null;

async function textsFor(keys) {
  const locale = wvLang.fromSite();

  if (locale && cachedLocale !== locale) {
    try {
      // the service worker is the one that reads the bundle: for that a content
      // script would have to expose the file to the page, which we avoid
      const r = await toWorker({ type: 'wv:texts', locale });
      cachedTexts = (r && r.ok && r.messages) || null;
      cachedLocale = cachedTexts ? locale : null;
    } catch (e) { cachedTexts = null; cachedLocale = null; }
  }

  // The extension popup cannot see the page's localStorage: here we leave it
  // the last language spotted on the site.
  if (locale) { try { chrome.storage.local.set({ siteLanguage: locale }); } catch (e) {} }

  const texts = {};
  for (const key of keys) {
    texts[key] = (cachedTexts && cachedTexts[key]) || chrome.i18n.getMessage(key);
  }
  return texts;
}

const toWorker = (msg) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(msg, (r) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(r);
  });
});

// Base64 decoding handed to the browser: an atob() loop in JS over 500 KB
// costs a dozen milliseconds, the data: route is native and far faster.
const fromBase64 = (b64, type) =>
  fetch(`data:${type};base64,${b64}`).then((r) => r.arrayBuffer());

let pathAnnounced = false;
function announcePath(res) {
  if (pathAnnounced) return;
  pathAnnounced = true;
  console.log(res.via === 'worker'
    ? '[worldview] decoding in the service worker (fast)'
    : '[worldview] decoding in the page (fallback, WASM unavailable in the worker)');
}

// The service worker now returns nothing but RAW .zst: the page is the one that
// decodes, in a pool of Web Workers. Three times fewer bytes across the bridge
// (267-538 KB instead of 651-1687 KB), and above all no PNG encoding at all.
async function serveTile(z, x, y) {
  const res = await toWorker({ type: 'wv:tile', z, x, y });
  if (!res?.ok) throw new Error(res?.error || 'worker failed');
  if (!res.cache) announcePath(res);
  if (res.empty) return { empty: true };             // 404: nothing painted here
  if (res.zstB64) return { zst: await fromBase64(res.zstB64, BYTES) };
  if (res.quadrants) {
    return { quadrants: await Promise.all(res.quadrants.map(async (q) =>
      ({ dx: q.dx, dy: q.dy, zst: await fromBase64(q.b64, BYTES) }))) };
  }
  throw new Error('unexpected worker response');
}
const BYTES = 'application/octet-stream';

// A Worker must be same-origin with the page: a chrome-extension:// URL is
// refused. So we bring the sources back as TEXT, and the MAIN world rechains
// them into blob: — see buildUrls() in content-main.js.
const MODULES = ['vendor/fzstd.js', 'vendor/zstddec.js', 'decoder.js', 'image.js',
                 'worker.js'];
async function workerSources() {
  const texts = {};
  await Promise.all(MODULES.map(async (f) => {
    texts[f] = await (await fetch(chrome.runtime.getURL(f))).text();
  }));
  return { order: MODULES, texts: texts };
}

/*
 * "Show me the button", requested from the extension popup.
 *
 * chrome.tabs.sendMessage targets ONLY the content scripts of that tab: the
 * service worker, which has its own onMessage, never sees this one go by.
 * All we do is relay to the MAIN world, where the interface lives.
 */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.type !== PREFIX + 'show-button') return;
  window.postMessage({ type: PREFIX + 'show-button' }, '*');
  respond({ ok: true });
  return false;
});

// Fallback flag: the popup sets it when the tab could not answer (page still
// loading, or a tab we have only just opened). We pick it up when answering the
// first settings request — by then the MAIN world interface is necessarily
// alive, since it is the one asking.
const FLAG_MAX_AGE = 2 * 60 * 1000;

async function showRequested() {
  try {
    const { showButton } = await chrome.storage.local.get('showButton');
    if (!showButton) return false;
    await chrome.storage.local.remove('showButton');
    return Date.now() - showButton < FLAG_MAX_AGE;
  } catch (e) { return false; }
}

// --------------------------------------------------- protocol with the MAIN
// window.postMessage crosses the MAIN <-> ISOLATED boundary: both worlds share
// the same window object, only the JS contexts are separate.
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== window || !d || typeof d !== 'object') return;

  if (d.type === PREFIX + 'request') {
    try {
      const r = await serveTile(d.z, d.x, d.y);
      // transfer, not copy: the buffers change world without being duplicated
      const handedOver = r.zst ? [r.zst] : r.quadrants ? r.quadrants.map((q) => q.zst) : [];
      window.postMessage({ type: PREFIX + 'response', id: d.id, ok: true, ...r }, '*', handedOver);
    } catch (err) {
      window.postMessage({ type: PREFIX + 'response', id: d.id, ok: false,
                           error: String(err && err.message || err) }, '*');
    }
    return;
  }

  // Preloading: we ask the service worker to download and cache, and NOTHING
  // more. No byte comes back, no decoding takes place.
  if (d.type === PREFIX + 'prewarm') {
    try { await toWorker({ type: 'wv:prewarm', z: d.z, x: d.x, y: d.y }); }
    catch (err) { /* a failed preload is not an error */ }
    window.postMessage({ type: PREFIX + 'response', id: d.id, ok: true, prechauffe: true }, '*');
    return;
  }

  if (d.type === PREFIX + 'sources?') {
    try {
      window.postMessage({ type: PREFIX + 'sources', ...(await workerSources()) }, '*');
    } catch (err) {
      window.postMessage({ type: PREFIX + 'sources', error: String(err && err.message || err) }, '*');
    }
    return;
  }

  // actions requested by the built-in interface (MAIN world, no chrome.* access)
  if (d.type === PREFIX + 'action') {
    const respond = (value) =>
      window.postMessage({ type: PREFIX + 'return', id: d.id, valeur: value }, '*');
    try {
      if (d.action === 'settings') {
        // The MAIN world has no chrome.i18n: we push it the translated texts
        // along with the settings. Single source: _locales/.
        const keys = ['panelTitle', 'panelIntro', 'enable', 'quality', 'qualityLight', 'qualitySharp',
                      'qualityLive', 'helpLight', 'helpSharp', 'helpLive', 'opacity', 'clearCache',
                      'clearing', 'close', 'archiveUnreachable', 'freshnessLive',
                      'freshnessArchive', 'behind', 'cacheState',
                      'welcomeTitle', 'welcomeText', 'welcomeGotIt',
                      'clearTitle', 'clearText', 'clearConfirm', 'cancel',
                      'reserveTitle', 'reserveText', 'reserveWorld', 'reserveDetailed',
                      'reserveProgress', 'reserveStop', 'reserveReady',
                      'reserveDelete', 'reserveCourtesy', 'reserveRemaining',
                      'reserveClearTitle', 'reserveClearText', 'reserveDated', 'reserveUpdate',
                      'reserveDoneTitle', 'reserveDoneText',
                      'safetyNet', 'safetyNetHelp',
                      'showTitle', 'showText'];
        const texts = await textsFor(keys);
        respond({
          ...(await chrome.storage.sync.get({ active: true, opacity: 1, minZoom: 0, quality: 'net', safetyNet: false })),
          texts: texts,
          showIt: await showRequested(),
        });
      } else if (d.action === 'set') {
        await chrome.storage.sync.set(d.charge || {});
        respond({ ok: true });
      } else if (d.action === 'stats') {
        respond(await toWorker({ type: 'wv:stats' }));
      } else if (d.action === 'clear') {
        respond(await toWorker({ type: 'wv:clear' }));
      } else if (d.action === 'reserve') {
        respond(await toWorker({ type: 'wv:reserve',
                                 profile: d.charge && d.charge.profile,
                                 force: !!(d.charge && d.charge.force) }));
      } else if (d.action === 'reserveStop') {
        respond(await toWorker({ type: 'wv:reserve-stop' }));
      } else if (d.action === 'reserveState') {
        respond(await toWorker({ type: 'wv:reserve-state' }));
      } else if (d.action === 'reserveClear') {
        respond(await toWorker({ type: 'wv:reserve-clear' }));
      } else if (d.action === 'welcome') {
        // how many reminders are left to show (0 = never again)
        const { welcome } = await chrome.storage.local.get({ welcome: 0 });
        respond({ remaining: welcome | 0 });
      } else if (d.action === 'welcomeSeen') {
        // `permanent`: the user acknowledged explicitly, we stop insisting.
        // Otherwise they merely clicked elsewhere: we decrement, the bubble will
        // come back on the next load — but not forever.
        if (d.charge && d.charge.permanent) {
          await chrome.storage.local.remove('welcome');
        } else {
          const { welcome } = await chrome.storage.local.get({ welcome: 0 });
          if (welcome > 1) await chrome.storage.local.set({ welcome: welcome - 1 });
          else await chrome.storage.local.remove('welcome');
        }
        respond({ ok: true });
      } else {
        respond(null);
      }
    } catch (err) { respond({ ok: false, error: String(err && err.message || err) }); }
    return;
  }

  // the MAIN asks for its settings at startup
  if (d.type === PREFIX + 'settings?') {
    const r = await chrome.storage.sync.get({ active: true, opacity: 1, minZoom: 0, quality: 'net', safetyNet: false });
    window.postMessage({ type: PREFIX + 'settings', settings: r }, '*');
  }
});

// propagation of the changes made from the popup
chrome.storage.onChanged.addListener((chg, zone) => {
  if (zone !== 'sync') return;
  const updates = {};
  for (const k of ['active', 'opacity', 'minZoom', 'quality', 'safetyNet']) if (k in chg) updates[k] = chg[k].newValue;
  if (Object.keys(updates).length) window.postMessage({ type: PREFIX + 'settings', settings: updates }, '*');
});

window.postMessage({ type: PREFIX + 'bridge-ready' }, '*');
