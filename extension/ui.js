/*
 * Interface embedded in wplace (MAIN world).
 *
 * Rather than a separate extension popup, we add a button to the vertical bar
 * on the right, just under "Overlays", and a panel in the same format as the
 * ones the site uses.
 *
 * Why this is simple: wplace is built on Tailwind + daisyUI, and our script
 * runs INSIDE the page. So it is enough to reuse their classes
 * (btn btn-square shadow-md, bg-base-100, rounded-box, join, range...) for the
 * styling to apply on its own -- no stylesheet to copy, and the look follows
 * the site's light/dark theme automatically.
 *
 * Careful: Tailwind only generates the utilities actually used in the site's
 * sources. A plausible-looking class can therefore be entirely absent from
 * their stylesheet. Every one used here was found in the CSS they serve --
 * btn-square, join-item, range, toggle, menu, rounded-xl, bg-base-100/200,
 * border-base-300, diemptyr, btn-primary, btn-active, shadow-md/xl, size-5/9,
 * leading-snug, text-primary. `rotate-45`, on the other hand, is ABSENT: hence
 * the in-house rule for the welcome bubble's arrow.
 */

(function () {
  'use strict';

  const PREFIX = 'wv:';
  const ID_BUTTON = 'wv-bouton';
  const ID_PANEL = 'wv-panneau';
  const ID_BUBBLE = 'wv-bulle';
  const ID_STYLE = 'wv-style';
  const ID_CONFIRM = 'wv-confirme';

  // Material Symbols "public" (globe) icon, same grid as their own icons
  const GLOBE = 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-82v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm276-102q20-22 36-47.5t26.5-53q10.5-27.5 16-56.5t5.5-59q0-98-54.5-179T600-776v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h240q17 0 28.5 11.5T600-440v120h40q26 0 47 15.5t29 40.5Z';

  // The labels come from _locales/ through the ISOLATED bridge (the MAIN world
  // has no chrome.i18n). These fallback values only serve until the first
  // answer arrives.
  let T = {
    panelTitle: 'World view', panelIntro: '', enable: 'Enable', quality: 'Quality',
    qualityLight: 'Light', qualitySharp: 'Sharp', qualityLive: 'Live',
    helpLight: '', helpSharp: '', helpLive: '', opacity: 'Opacity',
    clearCache: 'Clear cache', clearing: 'Clearing…', close: 'close',
    archiveUnreachable: 'Archive unreachable.',
    freshnessLive: 'Close-up: <b>live</b><br>Wide view: <b>{DATE}</b>',
    freshnessArchive: 'Snapshot from <b>{DATE}</b>{BEHIND}',
    behind: ' — <b>{H} h</b> behind', cacheState: 'Cache: <b>{N}</b> / {MAX} tiles',
    welcomeTitle: 'WorldView is installed',
    welcomeText: "Its settings live right here, in wplace's own toolbar.",
    welcomeGotIt: 'Got it',
    showTitle: 'Right here',
    showText: "This is WorldView's button, in wplace's own toolbar.",
    clearTitle: 'Clear the cache?',
    clearText: 'Stored tiles will be deleted. They come back on their own as you browse, '
              + 'so nothing is lost — the map will just be slower for a moment.',
    clearConfirm: 'Clear', cancel: 'Cancel',
    reserveTitle: 'Download the world', reserveText: '',
    reserveWorld: 'World · 175 MB', reserveDetailed: 'Detailed · 510 MB',
    reserveProgress: '{DONE} / {TOTAL} tiles · {MB} MB', reserveStop: 'Stop',
    reserveReady: 'Ready · {N} tiles stored', reserveDelete: 'Delete',
    reserveRemaining: ' · ~{MIN} min left',
    reserveClearTitle: 'Delete the downloaded map?', reserveClearText: '',
    reserveDoneTitle: 'Map downloaded', reserveDoneText: '{N} tiles stored.',
    reserveDated: 'Wide view: snapshot of {DATE}', reserveUpdate: 'Update',
    safetyNet: 'Safety net', safetyNetHelp: '',
    reserveCourtesy: '',
  };
  // Markers in braces, NOT in dollars. Chrome reserves $NAME$ for itself in
  // _locales/: its parser looks for a '$', skips the name when it is empty,
  // then moves on -- so even $$NAME$$ protects nothing, it finds $NAME$ right
  // behind and refuses to load the whole extension when the name is not
  // declared. Not using its syntax is the only safe way.
  const fill = (template, values) =>
    Object.entries(values).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), template);
  const HELP = () => ({ eco: T.helpLight, net: T.helpSharp, max: T.helpLive });

  // ----------------------------------------------------- talking to the bridge
  let seq = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d) return;
    if (d.type === PREFIX + 'return' && pending.has(d.id)) {
      pending.get(d.id)(d.valeur);
      pending.delete(d.id);
    }
    if (d.type === PREFIX + 'settings') { Object.assign(settings, d.settings); paint(); }
    if (d.type === PREFIX + 'show-button') { showButton(); }
  });
  const ask = (action, payload) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    window.postMessage({ type: PREFIX + 'action', id, action, charge: payload }, '*');
    setTimeout(() => { if (pending.delete(id)) resolve(null); }, 15000);
  });

  const settings = { active: true, opacity: 1, quality: 'net', safetyNet: false };

  // ------------------------------------------------------------- the modal
  // wplace uses the daisyUI pattern: <dialog class="modal"> + .modal-box +
  // .modal-backdrop. Going through a real <dialog> and showModal() gets us the
  // dimmed backdrop, the transition, keyboard trapping and above all the map
  // being blocked behind -- none of which a plain floating div does.
  // `closedby=any` matches their setting: click outside = close.
  function buildModal() {
    const dlg = document.createElement('dialog');
    dlg.id = ID_PANEL;
    dlg.className = 'modal';
    dlg.setAttribute('closedby', 'any');
    // Classes taken as-is from the site. daisyUI sets --radius-box: 2rem by
    // default (very rounded); wplace overrides it everywhere with rounded-xl
    // (0.75 rem). Without that override, our window clashed with all of theirs.
    // The max-sm:! block makes the modal full screen on mobile, like they do.
    dlg.innerHTML = `
      <div class="modal-box p-0 flex flex-col w-11/12 max-h-11/12 rounded-xl max-w-md
                  max-sm:!w-full max-sm:!h-full max-sm:!max-w-none max-sm:!max-h-none max-sm:!rounded-none">
        <div class="flex items-center justify-between border-b border-base-300 px-5 py-3">
          <h3 class="text-lg font-bold">${T.panelTitle}</h3>
          <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost">✕</button></form>
        </div>
        <div class="overflow-y-auto px-5 py-4">
        <p class="mb-4 text-sm opacity-60">${T.panelIntro}</p>

        <div class="flex items-center justify-between">
          <span class="font-medium">${T.enable}</span>
          <input type="checkbox" class="toggle toggle-primary" id="wv-active">
        </div>

        <!-- The safety net touches wplace's own rendering: it has to be
             switchable off without uninstalling the extension. -->
        <div class="mt-3 flex items-center justify-between">
          <span class="font-medium">${T.safetyNet}</span>
          <input type="checkbox" class="toggle toggle-primary" id="wv-safetyNet">
        </div>
        <p class="mt-1 text-sm opacity-60 leading-snug">${T.safetyNetHelp}</p>

        <div class="diemptyr my-3"></div>

        <div class="mb-2 font-medium">${T.quality}</div>
        <div class="join w-full">
          <button class="btn join-item flex-1" data-q="eco">${T.qualityLight}</button>
          <button class="btn join-item flex-1" data-q="net">${T.qualitySharp}</button>
          <button class="btn join-item flex-1" data-q="max">${T.qualityLive}</button>
        </div>
        <div class="mt-2 min-h-8 text-sm opacity-60" id="wv-aide"></div>

        <div class="mt-4 mb-2 flex justify-between font-medium">
          <span>${T.opacity}</span><span class="opacity-60" id="wv-opv"></span>
        </div>
        <input type="range" min="20" max="100" step="5" class="range range-primary" id="wv-op">

        <div class="diemptyr my-3"></div>

        <!-- The reserve: download the wide zoom levels once, and never wait
             again when zooming out. 175 MB measured for z0-z6, 5,461 tiles
             (tools/weigh-archive.py). -->
        <div class="mb-2 font-medium">${T.reserveTitle}</div>
        <p class="mb-3 text-sm opacity-60 leading-snug">${T.reserveText}</p>
        <div id="wv-reserve"></div>
        <p class="mt-2 text-xs opacity-50 leading-snug">${T.reserveCourtesy}</p>

        <div class="diemptyr my-3"></div>

        <div class="text-sm opacity-60" id="wv-infos">…</div>
        <!-- w-full and not btn-block: that daisyUI class is ABSENT from
             wplace's CSS (Tailwind only generates what the site uses), so the
             button stayed as wide as its text. -->
        <button class="btn btn-sm w-full mt-3" id="wv-emptyr">${T.clearCache}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>${T.close}</button></form>`;
    document.body.appendChild(dlg);

    dlg.querySelector('#wv-active').onchange = (e) => save({ active: e.target.checked });
    dlg.querySelector('#wv-safetyNet').onchange = (e) => save({ safetyNet: e.target.checked });
    dlg.querySelectorAll('[data-q]').forEach((b) => {
      b.onclick = () => save({ quality: b.dataset.q }).then(refreshInfo);
    });
    dlg.querySelector('#wv-op').oninput = (e) => {
      settings.opacity = e.target.value / 100;
      dlg.querySelector('#wv-opv').textContent = e.target.value + ' %';
      save({ opacity: settings.opacity });
    };
    dlg.querySelector('#wv-emptyr').onclick = (e) => {
      e.preventDefault();
      confirmClear(e.target);
    };
    return dlg;
  }

  // Clearing the cache cannot be undone and costs network traffic: we ask for
  // confirmation. A second <dialog> on top of the first rather than an inline
  // step: the top layer stacks them in opening order, so the confirmation sits
  // in front of the settings and its dimmed backdrop absorbs clicks -- and
  // closing it brings the settings back.
  function buildConfirm() {
    const dlg = document.createElement('dialog');
    dlg.id = ID_CONFIRM;
    dlg.className = 'modal';
    dlg.setAttribute('closedby', 'any');       // click outside = cancel
    dlg.innerHTML = `
      <div class="modal-box rounded-xl max-w-sm">
        <h3 class="text-lg font-bold" id="wv-confirme-panelTitle">${T.clearTitle}</h3>
        <p class="mt-2 text-sm opacity-70 leading-snug" id="wv-confirme-texte">${T.clearText}</p>
        <div class="modal-action gap-2">
          <button class="btn btn-sm" id="wv-confirme-non">${T.cancel}</button>
          <button class="btn btn-sm btn-error" id="wv-confirme-oui">${T.clearConfirm}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>${T.close}</button></form>`;
    document.body.appendChild(dlg);
    return dlg;
  }

  /**
   * Asks for confirmation before an action that cannot be undone.
   *
   * A single window for both cases: clearing the cache, and deleting the
   * reserve. The second one deserves the question JUST AS MUCH -- several
   * hundred megabytes and several minutes of downloading go away with it.
   */
  function confirmAction({ title, text, confirm, run }) {
    const conf = document.getElementById(ID_CONFIRM) || buildConfirm();
    conf.querySelector('#wv-confirme-panelTitle').textContent = title;
    conf.querySelector('#wv-confirme-texte').textContent = text;
    const yes = conf.querySelector('#wv-confirme-oui');
    yes.textContent = confirm;
    conf.querySelector('#wv-confirme-non').onclick = () => conf.close();
    yes.onclick = async () => { conf.close(); await run(); };
    conf.showModal();
    // focus lands on "Cancel": that is the choice without consequences
    conf.querySelector('#wv-confirme-non').focus();
  }

  const confirmClear = (button) => confirmAction({
    title: T.clearTitle, text: T.clearText, confirm: T.clearConfirm,
    run: async () => {
      button.disabled = true;
      button.textContent = T.clearing;
      await ask('clear');
      button.disabled = false;
      button.textContent = T.clearCache;
      refreshInfo();
    },
  });

  const save = (update) => { Object.assign(settings, update); paint(); return ask('set', update); };

  function paint() {
    const p = document.getElementById(ID_PANEL);
    if (!p) return;
    p.querySelector('#wv-active').checked = settings.active;
    p.querySelector('#wv-safetyNet').checked = settings.safetyNet === true;
    p.querySelectorAll('[data-q]').forEach((b) =>
      b.classList.toggle('btn-active', b.dataset.q === settings.quality));
    p.querySelector('#wv-aide').textContent = HELP()[settings.quality] || '';
    p.querySelector('#wv-op').value = Math.round(settings.opacity * 100);
    p.querySelector('#wv-opv').textContent = Math.round(settings.opacity * 100) + ' %';
    // Note: we do NOT colour the toolbar button. No button on the site stays
    // lit, and a permanent btn-primary looked like a button stuck down.
  }

  /*
   * The world reserve.
   *
   * Three states, and a single block of HTML for each: at rest we offer the
   * two volumes, during the download we show the progress, and once it is
   * built we announce it along with a way to delete it.
   *
   * Progress is read by polling rather than pushed: the MV3 service worker can
   * be stopped between two tiles, and a port would go down with it. So it
   * writes its state to chrome.storage.local, which survives -- and we read it
   * back.
   */
  let reserveTimer = null;
  let reserveTracked = false;
  let latestVersion = null;   // archive version, used to date the reserve

  function paintReserve(state) {
    const area = document.querySelector('#wv-reserve');
    if (!area) return;

    if (state && state.active) {
      const pct = Math.round((state.done / state.total) * 100);
      // remaining time derived from the rate observed since the start, not
      // from a constant: it depends on latency, which varies from one
      // connection to the next
      const elapsed = (Date.now() - state.startedAt) / 1000;
      const rate = state.done / Math.max(1, elapsed);
      const left = rate > 0.5
        ? fill(T.reserveRemaining, { MIN: Math.max(1, Math.ceil((state.total - state.done) / rate / 60)) })
        : '';
      area.innerHTML = `
        <div class="wv-barre w-full"><i style="width:${pct}%"></i></div>
        <div class="mt-1 flex items-center justify-between gap-2 text-sm">
          <span class="opacity-60 tabular-nums">${fill(T.reserveProgress, {
            DONE: state.done.toLocaleString(), TOTAL: state.total.toLocaleString(),
            MB: Math.round(state.bytes / 1048576) })}${left}</span>
          <span class="flex items-center gap-2">
            <span class="opacity-60 tabular-nums">${pct} %</span>
            <button class="btn btn-xs" id="wv-reserve-stop">${T.reserveStop}</button>
          </span>
        </div>`;
      area.querySelector('#wv-reserve-stop').onclick = async () => {
        await ask('reserveStop');
        refreshReserve();
      };
      return;
    }

    if (state && state.finished) {
      /*
       * We DATE the reserve, because otherwise the question "what I see when
       * zooming out, how old is it?" has no visible answer.
       *
       * The archive does not write one file per snapshot: it appends every new
       * snapshot to the end of the week's file. So a reserve freezes the wide
       * view at the day it was downloaded, until it is made again.
       */
      const stale = state.version && latestVersion && state.version < latestVersion;
      area.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm text-success">${fill(T.reserveReady, {
            N: state.total.toLocaleString() })}</span>
          <span class="flex items-center gap-2">
            ${stale ? `<button class="btn btn-xs btn-primary" id="wv-reserve-maj">${T.reserveUpdate}</button>` : ''}
            <button class="btn btn-xs" id="wv-reserve-emptyr">${T.reserveDelete}</button>
          </span>
        </div>
        ${state.date ? `<div class="mt-1 text-xs opacity-50">${fill(T.reserveDated, { DATE: state.date })}</div>` : ''}`;
      const updateBtn = area.querySelector('#wv-reserve-maj');
      if (updateBtn) updateBtn.onclick = async () => {
        updateBtn.disabled = true;
        await ask('reserve', { profile: state.profile, force: true });
        refreshReserve();
      };
      // Deleting the reserve deserves the question JUST AS MUCH as clearing
      // the cache: several hundred megabytes and several minutes go away.
      area.querySelector('#wv-reserve-emptyr').onclick = () => confirmAction({
        title: T.reserveClearTitle, text: T.reserveClearText,
        confirm: T.reserveDelete,
        run: async () => { await ask('reserveClear'); refreshReserve(); },
      });
      return;
    }

    // at rest -- including after a stop: it can be restarted, and what has
    // already been downloaded is not fetched again
    area.innerHTML = `
      <div class="join w-full">
        <button class="btn btn-sm join-item flex-1" data-profile="world">${T.reserveWorld}</button>
        <button class="btn btn-sm join-item flex-1" data-profile="detailed">${T.reserveDetailed}</button>
      </div>`;
    area.querySelectorAll('[data-profile]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        await ask('reserve', { profile: b.dataset.profile });
        refreshReserve();
      };
    });
  }

  /*
   * The gauge on the toolbar button.
   *
   * Two reasons, not one:
   *  - the settings window can be closed and you can keep browsing without
   *    losing sight of the progress;
   *  - and above all, the regular polling that feeds it KEEPS the service
   *    worker from stopping. Without it, Chrome shuts it down after some
   *    thirty seconds of inactivity and the download stops silently.
   */
  function paintGauge(state) {
    const b = document.getElementById(ID_BUTTON);
    if (!b) return;
    let gauge = b.querySelector('.wv-jauge');
    if (!state || !state.active) {
      if (gauge) gauge.remove();
      if (b.title !== T.panelTitle) b.title = T.panelTitle;
      return;
    }
    injectStyle();
    if (!gauge) {
      gauge = document.createElement('span');
      gauge.className = 'wv-jauge';
      gauge.innerHTML = '<i></i>';
      b.appendChild(gauge);
    }
    const pct = Math.round((state.done / state.total) * 100);
    gauge.firstChild.style.width = pct + '%';
    b.title = `${T.reserveTitle} — ${pct} %`;
  }

  /*
   * The completion notice.
   *
   * The download can take several minutes with the window closed: without a
   * word at the end, you never know it is ready. We reuse the daisyUI `toast`
   * pattern, present in wplace's CSS, with rounded-xl on top -- their
   * --radius-box is 2 rem, which would clash with the rest of the interface.
   */
  const ID_NOTICE = 'wv-annonce';

  /**
   * Places an element next to the toolbar button, like the welcome bubble.
   *
   * A notice in the bottom-right corner of the screen has no visual relation
   * to what it is about. Anchored to the button, you know at once where it
   * comes from.
   */
  function anchorToButton(el) {
    const button = document.getElementById(ID_BUTTON);
    if (!button) return;
    const r = button.getBoundingClientRect();
    if (!r.width) return;
    const l = el.offsetWidth, h = el.offsetHeight;
    const GAP = 14, EDGE = 8;
    if (r.left >= l + GAP + EDGE) {
      el.style.left = `${r.left - l - GAP}px`;
      el.style.top = `${clamp(r.top + r.height / 2 - h / 2, EDGE, innerHeight - h - EDGE)}px`;
    } else {
      el.style.left = `${clamp(r.right - l, EDGE, innerWidth - l - EDGE)}px`;
      el.style.top = `${clamp(r.bottom + GAP, EDGE, innerHeight - h - EDGE)}px`;
    }
  }

  function announce(title, text) {
    document.getElementById(ID_NOTICE)?.remove();
    injectStyle();
    const t = document.createElement('div');
    t.id = ID_NOTICE;
    t.innerHTML = `
      <div class="rounded-xl shadow-xl border border-base-300 bg-base-100 text-base-content
                  flex items-start gap-3 p-4">
        <span class="shrink-0 flex items-center justify-center size-9 rounded-xl
                     bg-base-200 text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"
               fill="currentColor" class="size-5"><path d="${GLOBE}"></path></svg>
        </span>
        <span class="flex-1">
          <span class="block text-sm font-bold">${title}</span>
          <span class="block mt-1 text-sm opacity-70 leading-snug">${text}</span>
        </span>
        <button class="btn btn-xs btn-circle btn-ghost shrink-0"
                aria-label="${T.close}">✕</button>
      </div>`;
    document.body.appendChild(t);
    if (typeof t.showPopover === 'function') {
      t.setAttribute('popover', 'manual');
      try { t.showPopover(); } catch (e) { t.removeAttribute('popover'); }
    }
    anchorToButton(t);
    const follow = () => anchorToButton(t);
    addEventListener('resize', follow);
    const dismiss = () => { removeEventListener('resize', follow); t.remove(); };
    t.querySelector('button').onclick = dismiss;
    setTimeout(dismiss, 12000);
  }

  // We announce ONLY ONCE per download: the completion timestamp is the
  // marker, otherwise every poll would show the message again.
  let endAnnounced = 0;
  function checkFinished(state) {
    if (!state || !state.finished || !state.finishedAt || state.finishedAt === endAnnounced) return;
    endAnnounced = state.finishedAt;
    // not on the very first pass: if the reserve was already ready before the
    // page was opened, there is nothing to announce
    if (Date.now() - state.finishedAt > 60000) return;
    announce(T.reserveDoneTitle, fill(T.reserveDoneText, { N: state.total.toLocaleString() }));
  }

  async function refreshReserve() {
    const r = await ask('reserveState');
    const state = r && r.etat;
    paintReserve(state);
    paintGauge(state);
    checkFinished(state);
    clearTimeout(reserveTimer);
    if (!state || !state.active) return;
    // window open: we follow closely. Closed: we settle for keeping the
    // service worker and the gauge alive, without stirring the map for nothing.
    const dlg = document.getElementById(ID_PANEL);
    reserveTimer = setTimeout(refreshReserve, dlg && dlg.open ? 300 : 5000);
  }

  async function refreshInfo() {
    const area = document.querySelector('#wv-infos');
    if (!area) return;
    const r = await ask('stats');
    if (r && r.version && r.version.valeur) latestVersion = r.version.valeur;
    if (!r?.ok) { area.innerHTML = `<span class="text-error">${T.archiveUnreachable}</span>`; return; }
    const d = r.version?.date || '?';
    let freshness;
    if (r.quality === 'max') {
      freshness = fill(T.freshnessLive, { DATE: d });
    } else {
      let behind = '';
      if (r.version?.date) {
        const t = new Date(d.replace(/T(\d+)$/, 'T$1:00:00Z'));
        behind = fill(T.behind, { H: Math.round((Date.now() - t) / 3600000) });
      }
      freshness = fill(T.freshnessArchive, { DATE: d, BEHIND: behind });
    }
    area.innerHTML = freshness + '<br>' + fill(T.cacheState, { N: r.entries, MAX: r.max });
  }

  // -------------------------------------------------------- first-time bubble
  // The button reuses the site's button classes exactly: that was the point,
  // but the consequence is that it goes completely unnoticed -- nothing shows
  // that it has just appeared. This bubble is shown on first launch, anchored
  // to the button, and makes it blink until it gets noticed.
  //
  // Every class used here was found in wplace's CSS: bg-base-100, bg-base-200,
  // border-base-300, rounded-xl, shadow-xl, text-primary, btn-sm, btn-primary,
  // size-9, leading-snug... `rotate-45` on the other hand DOES NOT EXIST on
  // their side (Tailwind only generates the utilities actually used): so the
  // arrow is rotated by a rule of our own.

  let bubbleShown = false;
  let welcomeStarted = false;
  // The same bubble serves twice: on first install, and on request from the
  // popup. In the second case it says something else, and above all it does
  // not touch the welcome counter -- it was asked for, not imposed.
  let bubbleForced = false;

  function injectStyle() {
    if (document.getElementById(ID_STYLE)) return;
    const s = document.createElement('style');
    s.id = ID_STYLE;
    // The shadow reused in wv-halo is the exact value of their `shadow-md`:
    // animating box-shadow wipes out the button's shadow, so we carry it
    // through every step to keep it from flattening during the blink.
    s.textContent = `
      @keyframes wv-entree {
        from { opacity: 0; transform: translateX(10px) scale(.96) }
        to   { opacity: 1; transform: none }
      }
      @keyframes wv-halo {
        0%   { box-shadow: 0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a, 0 0 0 0 var(--wv-halo) }
        70%  { box-shadow: 0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a, 0 0 0 12px #0000 }
        100% { box-shadow: 0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a, 0 0 0 0 #0000 }
      }
      #${ID_BUBBLE} {
        position: fixed; inset: auto; margin: 0; padding: 0;
        width: 18rem; max-width: calc(100vw - 1rem);
        overflow: visible; z-index: 2147483000;
        animation: wv-entree .22s cubic-bezier(.2,.9,.3,1) both;
      }
      #${ID_BUBBLE} .wv-fleche {
        position: absolute; width: 10px; height: 10px;
        background: var(--color-base-100); border: 0 solid var(--color-base-300);
        transform: rotate(45deg);
      }
      /* Download gauge, discreet, on the button itself: the window can be
         closed and you keep browsing, the progress stays visible. */
      /* The notice is anchored to the button like the bubble: a notification
         at the bottom of the screen has no visual relation to its subject. */
      #${ID_NOTICE} {
        position: fixed; inset: auto; margin: 0; padding: 0;
        width: 19rem; max-width: calc(100vw - 1rem);
        overflow: visible; z-index: 2147483000;
        animation: wv-entree .22s cubic-bezier(.2,.9,.3,1) both;
      }
      #${ID_BUTTON} { position: relative }
      /* In-house progress bar rather than <progress>: a <progress> jumps from
         one value to the next, it accepts no transition. */
      .wv-barre {
        height: .75rem; border-radius: 999px; overflow: hidden;
        background: color-mix(in oklch, var(--color-base-content) 15%, transparent);
      }
      .wv-barre > i {
        display: block; height: 100%; width: 0;
        background: var(--color-primary); transition: width .45s linear;
      }
      #${ID_BUTTON} .wv-jauge {
        position: absolute; left: 50%; bottom: 15%; transform: translateX(-50%);
        width: 58%; height: 3px; border-radius: 3px; overflow: hidden;
        background: color-mix(in oklch, currentColor 25%, transparent);
        pointer-events: none;
      }
      #${ID_BUTTON} .wv-jauge > i {
        display: block; height: 100%; width: 0;
        background: var(--color-primary); transition: width .5s linear;
      }
      #${ID_BUTTON}.wv-signale {
        --wv-halo: color-mix(in oklch, var(--color-primary) 55%, transparent);
        animation: wv-halo 1.9s ease-out 3;
      }
      @media (prefers-reduced-motion: reduce) {
        #${ID_BUBBLE}, #${ID_BUTTON}.wv-signale { animation: none }
      }`;
    document.head.appendChild(s);
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));

  function placeBubble() {
    const bubble = document.getElementById(ID_BUBBLE);
    const button = document.getElementById(ID_BUTTON);
    if (!bubble || !button) return;
    const r = button.getBoundingClientRect();
    if (!r.width) return;                     // button hidden: nothing to point at
    // offsetWidth/Height and NOT getBoundingClientRect: the latter includes the
    // entry animation's transform (scale .96), so it measures a bubble 4 % too
    // small until the animation is over -- and places it crooked.
    const bl = bubble.offsetWidth, bh = bubble.offsetHeight;
    const arrow = bubble.querySelector('.wv-fleche');
    const GAP = 14, EDGE = 8;

    if (r.left >= bl + GAP + EDGE) {
      // normal case: the bar is stuck to the right edge, the bubble fits left
      const y = clamp(r.top + r.height / 2 - bh / 2, EDGE, innerHeight - bh - EDGE);
      bubble.style.left = `${r.left - bl - GAP}px`;
      bubble.style.top = `${y}px`;
      Object.assign(arrow.style, {
        left: 'auto', right: '-6px', bottom: 'auto',
        top: `${clamp(r.top + r.height / 2 - y - 5, 12, bh - 22)}px`,
        borderWidth: '1px 1px 0 0',           // the two edges facing the button
      });
    } else {
      // narrow screen: under the button, right-aligned, arrow pointing up
      const x = clamp(r.right - bl, EDGE, innerWidth - bl - EDGE);
      bubble.style.left = `${x}px`;
      bubble.style.top = `${clamp(r.bottom + GAP, EDGE, innerHeight - bh - EDGE)}px`;
      Object.assign(arrow.style, {
        top: '-6px', bottom: 'auto', right: 'auto',
        left: `${clamp(r.left + r.width / 2 - x - 5, 12, bl - 22)}px`,
        borderWidth: '1px 0 0 1px',
      });
    }
  }

  const onResize = () => placeBubble();
  const onKey = (e) => { if (e.key === 'Escape') dismissBubble(false); };

  // On purpose: NO closing on outside click. Moving around the map is the first
  // thing everyone does, and the bubble disappeared before it had been read. It
  // only leaves on acknowledgement -- "Got it", or the button itself. Escape
  // stays, as for any persistent overlay, but does not acknowledge.

  function dismissBubble(permanent) {
    if (!bubbleShown) return;
    bubbleShown = false;
    removeEventListener('resize', onResize);
    removeEventListener('keydown', onKey, true);
    const button = document.getElementById(ID_BUTTON);
    if (button) button.classList.remove('wv-signale');
    const bubble = document.getElementById(ID_BUBBLE);
    if (bubble) {
      try { if (bubble.matches(':popover-open')) bubble.hidePopover(); } catch (e) { /* no popover */ }
      bubble.remove();
    }
    if (bubbleForced) { bubbleForced = false; return; }
    ask('welcomeSeen', { permanent: !!permanent });
  }

  function buildBubble(forced) {
    if (bubbleShown || document.getElementById(ID_BUBBLE)) return;
    const title = forced ? T.showTitle : T.welcomeTitle;
    const text = forced ? T.showText : T.welcomeText;
    injectStyle();
    const bubble = document.createElement('div');
    bubble.id = ID_BUBBLE;
    bubble.className = 'bg-base-100 border border-base-300 rounded-xl shadow-xl text-base-content';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-label', title);
    bubble.innerHTML = `
      <span class="wv-fleche"></span>
      <div class="flex items-start gap-3 p-4">
        <span class="shrink-0 flex items-center justify-center size-9 rounded-xl bg-base-200 text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"
               fill="currentColor" class="size-5"><path d="${GLOBE}"></path></svg>
        </span>
        <div class="flex-1">
          <div class="text-sm font-bold">${title}</div>
          <div class="mt-1 text-sm opacity-70 leading-snug">${text}</div>
          <div class="mt-3 flex justify-end">
            <button class="btn btn-sm btn-primary" id="wv-bulle-ok">${T.welcomeGotIt}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bubble);

    // Top layer: the bubble sits above the map and the toolbar without our
    // having to guess a z-index, and without blocking the page like showModal().
    if (typeof bubble.showPopover === 'function') {
      bubble.setAttribute('popover', 'manual');
      try { bubble.showPopover(); } catch (e) { bubble.removeAttribute('popover'); }
    }

    bubble.querySelector('#wv-bulle-ok').onclick = () => dismissBubble(true);
    bubbleShown = true;
    placeBubble();

    const button = document.getElementById(ID_BUTTON);
    if (button) button.classList.add('wv-signale');
    addEventListener('resize', onResize);
    addEventListener('keydown', onKey, true);
  }

  // `delay`: how long we give the site before trying. Long on load (wplace is
  // still settling in), zero when the user has just clicked -- they expect an
  // answer right away.
  function whenTheCoastIsClear(run, delay) {
    const start = Date.now();
    const attempt = () => {
      if (Date.now() - start > 60000) return;          // we give up rather than insist
      const button = document.getElementById(ID_BUTTON);
      // wplace opens windows of its own on load (release notes, events):
      // sitting on top of them would be as unreadable as it is rude.
      const busy = document.querySelector('dialog[open]');
      // Background tab: animations do not run, the bubble would show frozen on
      // its first frame. We wait for the tab to come back -- and if the wait
      // expires, the counter is not decremented: nothing is lost.
      const visible = document.visibilityState === 'visible';
      if (visible && button && button.getBoundingClientRect().width > 0 && !busy) { run(); return; }
      setTimeout(attempt, 400);
    };
    setTimeout(attempt, delay === undefined ? 1500 : delay);
  }

  /*
   * Requested from the extension popup: "where is that button?"
   *
   * If the bubble is already there (first-install welcome in progress), we do
   * not double it: we reposition it and light the halo again, which already
   * answers the question.
   */
  function showButton() {
    if (bubbleShown) {
      placeBubble();
      const b = document.getElementById(ID_BUTTON);
      if (b) b.classList.add('wv-signale');
      return;
    }
    bubbleForced = true;
    whenTheCoastIsClear(() => buildBubble(true), 0);
  }

  async function offerWelcome() {
    if (welcomeStarted) return;
    welcomeStarted = true;
    const r = await ask('welcome');
    // null = the ISOLATED bridge did not answer (timed out). We re-arm rather
    // than lose the bubble for this whole page load; the flag blocks bursts of
    // requests in the meantime.
    if (!r) { welcomeStarted = false; return; }
    if (r.remaining > 0) whenTheCoastIsClear(buildBubble);
  }

  // ------------------------------------------------------------- the button
  function placeButton() {
    // We locate the bar through a known button, but we ALWAYS put ourselves
    // last: wplace regularly adds buttons, and inserting ourselves right after
    // "Overlays" would leave us in the middle at the next update.
    const marker = document.querySelector('button[title="Overlays"]')
                || document.querySelector('button[title="Alliance"]')
                || document.querySelector('button[title="Leaderboard"]');
    const bar = marker && marker.parentElement;
    if (!bar) return false;

    const existing = document.getElementById(ID_BUTTON);
    if (existing) {
      // already placed: we only check that it is still at the end of the bar
      if (existing.parentElement === bar && bar.lastElementChild !== existing) {
        bar.appendChild(existing);
      }
      return true;
    }

    const b = document.createElement('button');
    b.id = ID_BUTTON;
    b.title = T.panelTitle;
    b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"
      fill="currentColor" class="size-5"><path d="${GLOBE}"></path></svg>`;
    b.className = marker.className;             // exactly the same style as theirs
    bar.appendChild(b);                         // always at the bottom of the bar

    b.onclick = (e) => {
      e.stopPropagation();
      dismissBubble(true);      // also on the keyboard, where no pointerdown arrives
      const dlg = document.getElementById(ID_PANEL) || buildModal();
      paint();
      refreshInfo();
      refreshReserve();
      dlg.showModal();          // dimmed backdrop + map blocked behind
    };

    paint();
    return true;
  }

  // One full pass: the button is in place, the bubble is offered if it is due,
  // and if it is on screen it follows the button, which may have moved.
  function check() {
    if (placeButton()) offerWelcome();
    // A download may be running from another tab or an earlier visit: we pick
    // it back up as soon as the button exists.
    if (!reserveTracked) { reserveTracked = true; refreshReserve(); }
    if (!bubbleShown) return;
    placeBubble();
    // A Svelte re-render replaces the button with a new one, which has no halo:
    // the bubble then pointed at a button that no longer blinked. We put it back.
    const b = document.getElementById(ID_BUTTON);
    if (b && !b.classList.contains('wv-signale')) b.classList.add('wv-signale');
  }

  // wplace is a Svelte application: it rebuilds pieces of its interface.
  // Without watching, our button would disappear on the first re-render.
  //
  // BUT: the map triggers mutations continuously. Running placeButton() on
  // every batch of mutations made the page lag. So we only arm a timer, and a
  // single check happens per 500 ms slice.
  let checkPending = false;
  function watch() {
    check();
    new MutationObserver(() => {
      if (checkPending) return;
      checkPending = true;
      setTimeout(() => { checkPending = false; check(); }, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }

  ask('settings').then((r) => {
    if (!r) return;
    if (r.texts) Object.assign(T, r.texts);
    const { texts, showIt, ...rest } = r;
    Object.assign(settings, rest);
    paint();
    // request made from the popup while the page was not ready yet
    if (showIt) showButton();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
})();
