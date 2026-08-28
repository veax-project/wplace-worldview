/*
 * Where the extension's language comes from.
 *
 * From WPLACE, not from the browser. It is the only choice that makes sense:
 * our button sits in THEIR toolbar, our panel imitates THEIR windows. A panel
 * in Portuguese in the middle of an English interface would clash, even if the
 * browser is set to something else.
 *
 * How we find it. wplace translates its interface with Paraglide, and
 * Paraglide keeps the chosen language in the page's localStorage, under the
 * key PARAGLIDE_LOCALE. Lifted from their bundle:
 *
 *     const f = ["en","pt","ch","de","es","fr","it","jp","pl","ru","uk","vi"],
 *           g = "PARAGLIDE_LOCALE",
 *           u = ["localStorage","preferredLanguage","baseLocale"];
 *
 * Three lessons:
 *   - the value is ALWAYS written on the very first resolution, so it is there
 *     from the first load onwards;
 *   - the site knows twelve languages, even though its menu only offers two to
 *     the public (the other ten are reserved for staff accounts) — a French
 *     browser therefore gets a French wplace without having chosen anything;
 *   - changing language on their side reloads the page
 *     (`o.reload && window.location && e !== a && window.location.reload()`),
 *     so there is nothing for us to watch at runtime.
 *
 * We only have two locales: en and pt_BR. Portuguese lands on pt_BR,
 * everything else on English, which is also our default_locale.
 *
 * This file is loaded in the ISOLATED world before content-iso.js, and in the
 * popup before popup.js: both need it, and so does the test bench.
 */

(function (scope) {
  'use strict';

  const KEY = 'PARAGLIDE_LOCALE';
  // wplace's codes are not Chrome's: "pt" on their side, "pt_BR" on ours
  // (Chrome demands the region, and rejects the hyphen)
  const MAPPING = { pt: 'pt_BR' };

  /** Any language code -> one of OUR _locales folders. */
  function ours(raw) {
    if (!raw) return null;
    const short = String(raw).toLowerCase().split(/[-_]/)[0];
    return MAPPING[short] || 'en';
  }

  /**
   * The site's language, as the page carries it.
   * `storage` and `document` are passed in so the bench can fake them.
   * Returns null when nothing was found: it is up to the caller to fall back
   * on chrome.i18n, that is, on the browser's language.
   */
  function fromSite(doc, storage) {
    let raw = null;
    // 1. the choice kept by wplace: the source of truth
    try { raw = (storage || localStorage).getItem(KEY); }
    catch (e) { /* storage blocked by the browser */ }
    // 2. failing that, what the site declares itself on <html lang>
    if (!raw) {
      const d = doc || document;
      raw = d.documentElement && d.documentElement.getAttribute('lang');
    }
    return ours(raw);
  }

  scope.wvLang = { KEY, ours, fromSite };
})(typeof globalThis !== 'undefined' ? globalThis : self);
