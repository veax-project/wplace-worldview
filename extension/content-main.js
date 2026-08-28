/*
 * Content script, MAIN world.
 *
 * It runs in the same JS context as the page, so it can:
 *   - grab the MapLibre instance that wplace keeps in module scope
 *   - patch window.fetch to serve our own tiles
 * An ISOLATED content script could do neither.
 *
 * ---------------------------------------------------------------------------
 * The problem we solve
 * ---------------------------------------------------------------------------
 * wplace stores ONLY ONE zoom level (source declared minzoom = maxzoom = 11,
 * tileSize 550 on desktop / 400 on mobile). MapLibre therefore loads nothing
 * below   threshold = 10.5 - log2(512 / tileSize)   i.e. 10.603 on desktop.
 * Measured on the site: z10.5 hidden, z10.7 shown.
 *
 * Below that threshold we show the overview tiles already aggregated by the
 * archive site instead. One of its level-z tiles covers 2^(11-z) z11 tiles in
 * 1000 px, so the pyramid is exactly MapLibre's with tileSize 512.
 */

(function () {
  'use strict';

  const PREFIX = 'wv:';
  const FAKE_URL = 'https://wplace.live/__worldview__/';
  const RE = /__worldview__\/(\d+)\/(\d+)\/(\d+)\.png/;
  const ID_SOURCE = 'worldview';
  const ID_LAYER = 'worldview';

  const threshold = () => 10.5 - Math.log2(512 / (innerWidth > 640 ? 550 : 400));

  // The archive publishes z0 to z9 and z11, but NOT z10 (checked over several
  // regions). We build that level from the four z11 tiles it covers: twice the
  // detail of an upscaled z9.
  //
  // And we go all the way to level 11, served as-is from wplace. Without it the
  // Z 10.5 - 10.6375 band showed a z10 tile upscaled twice over -- the "really
  // bad quality" right before wplace takes over with its real pixels. With it,
  // both layers show exactly the same image.
  //
  // 'eco': neither z10 nor z11, MapLibre upscales the z9 tiles (less data, a
  //        bit blurry between Z 9.5 and 10.6 -- the trade-off this mode accepts)
  // 'net': z10 rebuilt from the archive, z11 live
  // 'max': z10 rebuilt from the LIVE tiles, z11 live
  const maxSource = () => (state.quality === 'eco' ? 9 : 11);
  // small overlap with wplace's native layer: without it the two switch over at
  // exactly the same zoom and an image can go missing in between. Our layer
  // sits UNDER pixel-art-layer, so the real pixels cover it.
  /*
   * Two possible heights for our layer.
   *
   * At rest it stops just past wplace's threshold: their layer takes over, and
   * we touch nothing.
   *
   * When the safety net deploys (see below) it goes down to native zoom,
   * INSERTED UNDER pixel-art-layer. Invisible as long as theirs works, it shows
   * up the moment theirs falters -- the case where you click, the site says a
   * pixel is painted, and you see nothing.
   *
   * MAX_LAYER rather than an infinite value: past level 11 there is nothing
   * left to show, MapLibre would merely upscale.
   */
  const OVERLAP = 0.35;
  const MAX_LAYER = 24;                       // beyond this MapLibre upscales
  const maxLayer = () =>
    (state.safetyNet || netDeployed) ? MAX_LAYER : threshold() + OVERLAP;

  const state = { active: true, opacity: 1, minZoom: 0, quality: 'net', safetyNet: false };

  // Settings live in chrome.storage, unreachable from the MAIN world: it is the
  // ISOLATED bridge that pushes them to us, at startup and then on every change
  // made in the popup.
  function applySettings(s) {
    const wasActive = state.active, prevQuality = state.quality;
    Object.assign(state, s);

    // A source's maxzoom cannot be changed on the fly: going to or from 'eco'
    // means rebuilding source and layer.
    if (state.quality !== prevQuality && MAP) {
      removeLayer();
      try { if (MAP.getSource(ID_SOURCE)) MAP.removeSource(ID_SOURCE); } catch (e) {}
      if (state.active) installLayer();
      return;
    }

    if (state.active !== wasActive) { state.active ? installLayer() : removeLayer(); }
    else if (state.active && MAP && MAP.getLayer(ID_LAYER)) {
      MAP.setPaintProperty(ID_LAYER, 'raster-opacity', state.opacity);
      MAP.setLayerZoomRange(ID_LAYER, state.minZoom, maxLayer());
    }
  }

  // ------------------------------------------------ bridge to the ISOLATED world
  let counter = 0;
  const pending = new Map();

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d) return;

    if (d.type === PREFIX + 'settings') { applySettings(d.settings); return; }
    if (d.type === PREFIX + 'bridge-ready') { window.postMessage({ type: PREFIX + 'settings?' }, '*'); return; }
    if (d.type === PREFIX + 'sources') { resolveSources(d); return; }
    if (d.type !== PREFIX + 'response') return;

    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    // the answer carries { empty } | { zst } | { quadrants }: we pass it whole
    d.ok ? p.resolve(d) : p.reject(new Error(d.error));
  });
  // the bridge may be ready before us: we ask again in every case
  window.postMessage({ type: PREFIX + 'settings?' }, '*');

  function requestTile(z, x, y) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.postMessage({ type: PREFIX + 'request', id, z, x, y }, '*');
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('timed out'));
      }, 30000);
    });
  }

  const LIVE = 'https://backend.wplace.live/files/s0/tiles';

  // ---------------------------------------------------------- decoding pool
  // All decoding now lives in Web Workers owned by the PAGE. The reasoning is
  // spelled out at the top of worker.js; in short, measured over twelve tiles:
  //
  //     old path (single-threaded service worker, PNG)   1241 ms, main thread 57 ms
  //     pool of 4 workers, BMP output                     283 ms, main thread  0 ms
  //
  /*
   * Four, and no more -- checked rather than assumed.
   *
   * Measured end-to-end cost of one tile (bench-map.html, real MapLibre):
   *     z11, served as-is                 25 ms
   *     z5-z10, full pipeline        110-230 ms   (median 114, p90 229)
   *
   * I tried eight workers thinking the queue was to blame: median 119 ms, p90
   * 233 ms. No gain at all. So the pool is NOT the bottleneck -- those 114 ms
   * are SERIAL work per tile, not waiting:
   *
   *     base64 + data: decoding   ~15 ms   (part of it on the main thread)
   *     zstd in JavaScript        ~23 ms   <- the biggest single item
   *     palette -> BGRA -> BMP     ~6 ms
   *     createImageBitmap         ~12 ms   (done by MapLibre, irreducible)
   *     five message hops         ~15 ms
   *
   * Four workers are enough to absorb that. The next real gain is elsewhere: a
   * zstd decoder in WebAssembly would cut the biggest item by four.
   */
  const WORKER_COUNT = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

  let resolveSources;
  const sourcesReceived = new Promise((r) => { resolveSources = r; });

  /** Resolves a relative specifier the way the browser would. */
  function resolvePath(from, spec) {
    const base = from.split('/').slice(0, -1);
    for (const p of spec.split('/')) {
      if (p === '.' || p === '') continue;
      if (p === '..') base.pop();
      else base.push(p);
    }
    return base.join('/');
  }

  // A Worker must be SAME ORIGIN as the page: a chrome-extension:// URL is
  // flatly refused. So we fetch the modules as text -- through the bridge, the
  // only side with chrome.runtime.getURL -- and rechain them as blob:, rewriting
  // every relative specifier to the blob: already created. A blob: inherits the
  // page's origin, so imports between them work.
  //
  // (wplace serves no CSP at all, neither header nor meta tag: checked. If it
  //  ever added one without blob:, creation would fail and we would fall back
  //  to inline decoding, slower but correct.)
  let urlsPromise = null;
  function buildUrls() {
    if (urlsPromise) return urlsPromise;
    urlsPromise = (async () => {
      window.postMessage({ type: PREFIX + 'sources?' }, '*');
      const { order, texts, error } = await sourcesReceived;
      if (error || !texts) throw new Error(error || 'sources unavailable');
      const urls = {};
      for (const f of order) {
        const code = texts[f].replace(
          /(\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]*)\2/g,
          (all, word, quote, spec) => {
            const target = resolvePath(f, spec);
            return urls[target] ? `${word}${quote}${urls[target]}${quote}` : all;
          });
        urls[f] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      }
      return urls;
    })();
    return urlsPromise;
  }

  function createPool(url) {
    const waiting = new Map();
    const idle = [];
    const queue = [];
    let n = 0;

    const serve = () => {
      while (idle.length && queue.length) {
        const worker = idle.pop();
        const { task, transfer, resolve, reject } = queue.shift();
        const id = ++n;
        waiting.set(id, { resolve, reject, worker });
        worker.postMessage({ id, tache: task }, transfer || []);
      }
    };

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(url, { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.pret) { idle.push(worker); serve(); return; }
        const a = waiting.get(e.data.id);
        if (!a) return;
        waiting.delete(e.data.id);
        idle.push(a.worker);
        if (e.data.error) a.reject(new Error(e.data.error));
        else a.resolve(e.data);
        serve();
      };
      worker.onerror = (err) => console.warn('[worldview] worker', err.message || err);
    }

    return {
      submit: (task, transfer) => new Promise((resolve, reject) => {
        queue.push({ task, transfer, resolve, reject });
        serve();
      }),
    };
  }

  let poolPromise = null;
  function getPool() {
    if (!poolPromise) {
      poolPromise = buildUrls()
        .then((urls) => createPool(urls['worker.js']))
        .catch((e) => {
          console.warn('[worldview] pool unavailable, inline decoding:', e.message);
          return null;
        });
    }
    return poolPromise;
  }

  // Fallback: if the workers cannot start, we decode on the main thread. Three
  // times slower and it stutters, but the extension keeps working.
  let fallbackPromise = null;
  function inlineDecoder() {
    if (!fallbackPromise) {
      fallbackPromise = buildUrls().then((urls) => Promise.all([
        import(urls['decoder.js']), import(urls['image.js']),
      ]).then(([d, i]) => ({ ...d, ...i })));
    }
    return fallbackPromise;
  }

  const toBlob = (bmp) => new Blob([bmp], { type: 'image/bmp' });

  // ---------------------------------------------------------- prefetching
  // MapLibre only asks for a tile the moment it enters the screen: hence the
  // small loading delay on every move. So we go and fetch the surrounding ring
  // of tiles ahead of time.
  //
  // Three guard rails, otherwise the cure is worse than the disease:
  //  - we only start after 350 ms with no real request (visible tiles always
  //    come first);
  //  - at most 2 prefetches in parallel;
  //  - a tile already seen is never asked for again.
  const seen = new Set();
  const preQueue = [];
  let preActive = 0, preTimer = null;
  let lastLevel = 11;              // level of the last tile actually requested
  // Our source uses tileSize 512, so MapLibre asks for round(Z). We read the
  // zoom off the map rather than trusting the last requested tile: coming back
  // to a level already visited, MapLibre has everything cached and asks for
  // nothing -- the marker would then stay stuck on the previous level.
  const currentLevel = () => (MAP ? Math.round(MAP.getZoom()) : lastLevel);

  function enqueue(z, x, y) {
    // NEVER level 11: those are wplace's tiles, on THEIR host. Chrome caps at
    // six connections per host, and wplace needs them for its own layer.
    // Prefetching level 11 means taking their slots -- measured in
    // bench-map.html: thirty requests of ours for three of theirs in the
    // overlap band. Their pixels no longer showed up.
    // They ask for those tiles themselves right afterwards anyway.
    if (z < 0 || z >= 11) return;
    const n = 2 ** z;
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const key = `${z}/${x}/${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    preQueue.push([z, x, y]);
  }

  function schedulePrefetch(z, x, y) {
    // A stale queue is worse than an empty one: we were still draining it of z5
    // tiles while the user had gone back to z9, which ate bandwidth exactly
    // when it was needed elsewhere. So we keep only what is near the current
    // level.
    for (let i = preQueue.length - 1; i >= 0; i--) {
      if (Math.abs(preQueue[i][0] - z) > 1) preQueue.splice(i, 1);
    }

    // the ring of eight neighbours: covers lateral movement
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) enqueue(z, x + dx, y + dy);
      }
    }
    // And the PARENT: the ring only helps panning, whereas the complaint is
    // about ZOOMING OUT. Going down one level reuses no tile from the current
    // level -- everything was cold, hence the wait at every notch.
    enqueue(z - 1, x >> 1, y >> 1);

    if (preQueue.length > 64) preQueue.splice(0, preQueue.length - 64);
    if (seen.size > 3000) seen.clear();             // memory bound
    clearTimeout(preTimer);
    preTimer = setTimeout(pumpPrefetch, 350);
  }

  /*
   * Prefetching is ONLY about warming up the network.
   *
   * It used to call loadTile() -- so base64, a trip across the bridge, data:
   * decoding, zstd decoding, palette, BMP... and then it threw the resulting
   * Blob away. All that work was redone at display time. A prefetched tile thus
   * cost ~10 ms of main thread and ~30 ms of worker, for nothing.
   *
   * Now we simply ask the service worker to download and cache. Nothing comes
   * back: no bytes, no decoding. When the tile is actually displayed, it will
   * come out of the cache.
   */
  function prewarm(z, x, y) {
    // level 11 comes from wplace: a plain fetch is enough to fill the browser
    // cache, which the real request will read back
    if (z >= 11) return originalFetch(`${LIVE}/${x}/${y}.png`).then(() => {}, () => {});
    return new Promise((resolve) => {
      const id = ++counter;
      pending.set(id, { resolve, reject: resolve });
      window.postMessage({ type: PREFIX + 'prewarm', id, z, x, y }, '*');
      // Short guard: a prefetch with no answer must not hold one of the two
      // slots for thirty seconds. This is comfort only, so we give up quickly
      // rather than delay the next ones.
      setTimeout(() => { if (pending.delete(id)) resolve(); }, 8000);
    });
  }

  function pumpPrefetch() {
    while (preActive < 2 && preQueue.length) {
      const [z, x, y] = preQueue.pop();           // the most recent ones first
      // The level may have changed since queuing. We were still draining z5
      // tiles while the user had gone back up to z9: bandwidth spent exactly
      // where it is no longer of any use.
      // Sorting on insert is not enough -- it only happens when a tile is
      // actually requested, and coming back to a level already seen, MapLibre
      // has them cached and asks for nothing.
      if (Math.abs(z - currentLevel()) > 1) continue;
      preActive++;
      prewarm(z, x, y)
        .catch(() => {})
        .finally(() => { preActive--; pumpPrefetch(); });
    }
  }

  // -------------------------------------------------------------- fetch hook
  const originalFetch = window.fetch.bind(window);

  /**
   * Level 11, served AS-IS from wplace.
   *
   * This is what removes the quality jump. Before, the source stopped at z10:
   * between Z 10.5 and 10.6375 MapLibre upscaled a z10 tile by a factor of 2,
   * and that tile had already lost three pixels out of four when downscaled.
   * Then at 10.6375 wplace's native layer appeared with its real pixels --
   * hence "it goes from really bad quality to amazing quality".
   *
   * Now that band shows the SAME image wplace is about to show. And it costs
   * nothing: it is the same URL, so the browser cache and wplace's service
   * worker serve it only once. 7.4 ms measured, i.e. only the single
   * createImageBitmap MapLibre would do anyway.
   *
   * True in all three modes: continuity with the immediate neighbour beats
   * purity of the source.
   */
  /* =======================================================================
   * Relaying the live tiles: never ask for the same thing twice.
   * =======================================================================
   *
   * wplace's tiles answer with:
   *
   *     Cache-Control: s-maxage=5, must-revalidate, no-store
   *
   * `no-store` forbids the browser from keeping them. Asking for the same tile
   * they do is therefore ONE MORE real request, on their host, where Chrome
   * opens only six connections. That is what was taking their slots.
   *
   * But their requests go through our hook -- we replaced window.fetch before
   * their application started. So we keep, in passing, what they ALREADY
   * download, and our layer helps itself from that. Zero extra requests.
   *
   * A valuable side effect: we hold the last known version of every tile. If
   * their layer falters, ours has something to show.
   */
  const RE_LIVE = /backend\.wplace\.live\/files\/s0\/tiles\/(\d+)\/(\d+)\.png/;
  const CACHE_MAX = 200;                // ~200 tiles: enough for several screens
  const CACHE_TTL = 10 * 60 * 1000;     // past that, better ask again than lie
  const liveCache = new Map();
  const liveWaiters = new Map();

  function storeLive(x, y, bytes) {
    const key = `${x}/${y}`;
    liveCache.delete(key);                    // re-inserting at the end = usage order
    liveCache.set(key, { bytes, t: Date.now() });
    if (liveCache.size > CACHE_MAX) liveCache.delete(liveCache.keys().next().value);
    const waiter = liveWaiters.get(key);
    if (waiter) { liveWaiters.delete(key); waiter(bytes); }
  }

  function readLive(x, y) {
    const e = liveCache.get(`${x}/${y}`);
    if (!e) return null;
    if (Date.now() - e.t > CACHE_TTL) { liveCache.delete(`${x}/${y}`); return null; }
    return e.bytes;
  }

  /** Waits a short moment for wplace to ask for this tile on its own. */
  function watchLive(x, y, ms) {
    return new Promise((resolve) => {
      const key = `${x}/${y}`;
      const timer = setTimeout(() => { liveWaiters.delete(key); resolve(null); }, ms);
      liveWaiters.set(key, (b) => { clearTimeout(timer); resolve(b); });
    });
  }

  /*
   * One single request per tile, even if both layers claim it at the same time.
   *
   * The relay alone was not enough: our two layers cover the same screen, so
   * they ask for the same tiles at the same instant, and neither one yet finds
   * what the other is bringing back. Measured on the bench: 26 requests for 15
   * distinct tiles, i.e. eleven duplicates.
   *
   * Here the first caller makes the request and the later ones latch onto it.
   * Nothing is served from the past: it really is the SAME response, at the
   * same instant, handed to everyone -- these tiles change with every pixel
   * placed, we do not allow ourselves to let them age.
   */
  const liveInFlight = new Map();

  /*
   * The safety net deploys ALL BY ITSELF, and only when it is useful.
   *
   * Keeping it out all the time is expensive: measured on the bench, covering
   * native zoom takes requests to wplace's host from 15 to 24, i.e. +60 %. On a
   * host where Chrome opens only six connections, that is precisely what was
   * taking their slots -- the very failure we want to fix.
   *
   * So we keep it stowed, and we watch: three failures of their tiles within
   * one minute, and our layer goes down to cover native zoom. Nothing fails for
   * two minutes, and it retracts. Zero cost as long as all is well.
   *
   * Then checked on the bench, same route (tools/measure-map.py):
   *     default, net stowed        181 requests,  pan at z11.5: 2
   *     forced on by the user      200 requests,  pan at z11.5: 4
   * And once DEPLOYED, it asks them for nothing at all any more: the tile comes
   * from the archive, on another host (see liveTile, step 3).
   */
  const FAILURES_TO_DEPLOY = 3;
  const FAILURE_WINDOW = 60 * 1000;
  const RETRACT_AFTER = 120 * 1000;
  const LIVE_STALL = 12 * 1000;
  let netDeployed = false;
  let liveFailures = [];
  let netTimer = null;

  function setNet(deployed) {
    if (netDeployed === deployed) return;
    netDeployed = deployed;
    if (MAP && MAP.getLayer(ID_LAYER)) {
      MAP.setLayerZoomRange(ID_LAYER, state.minZoom, maxLayer());
    }
    console.log(deployed
      ? '[worldview] wplace tiles failing: the layer drops down as a safety net'
      : '[worldview] wplace tiles are back: the safety net retracts');
  }

  /*
   * `res`: wplace's response, or null if the request failed / stalled.
   *
   * A 404 is NOT an outage: their backend returns it for any tile outside the
   * world (checked: 2047/2047 -> 200, 2048/2048 -> 404). Counting those would
   * keep the net deployed permanently as soon as we follow an edge.
   */
  function noteLive(res) {
    if (res && (res.ok || res.status === 404)) return;
    const t = Date.now();
    liveFailures = liveFailures.filter((x) => t - x < FAILURE_WINDOW);
    liveFailures.push(t);
    if (liveFailures.length >= FAILURES_TO_DEPLOY) setNet(true);
    clearTimeout(netTimer);
    netTimer = setTimeout(() => { liveFailures = []; setNet(false); }, RETRACT_AFTER);
  }

  function fetchLive(x, y, input, init) {
    const key = `${x}/${y}`;
    const running = liveInFlight.get(key);
    if (running) return running.then((r) => r.clone());

    // A request that never answers never rejects: on mobile that is the most
    // frequent case, and precisely the one the user describes. We count it as a
    // failure after LIVE_STALL without aborting it.
    const stallWatch = setTimeout(() => noteLive(null), LIVE_STALL);

    const p = originalFetch(input || `${LIVE}/${x}/${y}.png`, init).then((res) => {
      clearTimeout(stallWatch);
      noteLive(res);
      if (res.ok) {
        res.clone().arrayBuffer()
          .then((buf) => storeLive(x, y, buf))
          .catch(() => { /* a failed copy is not an error */ });
      }
      return res;
    }, (err) => { clearTimeout(stallWatch); noteLive(null); throw err; });
    // we only remove it afterwards: simultaneous callers must still be able to
    // latch on while this one is finishing
    p.then(() => setTimeout(() => liveInFlight.delete(key), 0),
           () => liveInFlight.delete(key));
    liveInFlight.set(key, p);
    return p.then((r) => r.clone());
  }

  // Returned when wplace did not answer -- to be distinguished from null, which
  // means "answered, and there is nothing painted here".
  const LIVE_FAILED = Symbol('live unavailable');

  async function liveTile(x, y) {
    // 1. already went through the relay: free
    const cached = readLive(x, y);
    if (cached) return cached.byteLength < 200 ? null : new Blob([cached]);

    // 2. wplace is in the middle of asking for it: we wait for theirs rather
    //    than firing a second one. Briefly, or we would make the map sluggish.
    const watched = await watchLive(x, y, 900);
    if (watched) return watched.byteLength < 200 ? null : new Blob([watched]);

    // 3. The net is already deployed: their host has just dropped us three
    //    times. No point hounding it a fourth -- we go straight to the archive.
    //    Zero extra requests for them, and the image arrives right away.
    //    Detecting their return still happens on its own: wplace asks for ITS
    //    tiles, they go through our hook, and every healthy response restarts
    //    the retract countdown.
    if (netDeployed) return LIVE_FAILED;

    // 4. nobody has asked for it: we go, through the same single entry point
    const r = await fetchLive(x, y).catch(() => null);
    if (!r) return LIVE_FAILED;
    if (!r.ok) return r.status === 404 ? null : LIVE_FAILED;
    const b = await r.blob();
    // wplace's service worker returns a 1x1 PNG for blank tiles
    return b.size < 200 ? null : b;
  }

  async function viaFallback(task) {
    const m = await inlineDecoder();
    if (task.type === 'zst') {
      const { width, height, index } = m.decodeTile(new Uint8Array(task.zst));
      return { bmp: m.toBmp(width, height, m.toBgra(width, height, index, m.PALETTE)) };
    }
    const decoded = [];
    for (const q of task.quadrants) {
      try { decoded.push({ dx: q.dx, dy: q.dy, ...m.decodeTile(new Uint8Array(q.zst)) }); }
      catch (e) { /* one unreadable quadrant does not stop the others */ }
    }
    const bgra = m.composeBgra(decoded, m.PALETTE);
    return bgra ? { bmp: m.toBmp(1000, 1000, bgra) } : { empty: true };
  }

  const runTask = async (task, transfer) => {
    const pool = await getPool();
    const r = pool ? await pool.submit(task, transfer) : await viaFallback(task);
    return r.empty || !r.bmp ? null : toBlob(r.bmp);
  };

  // One single load path, taken by rendering AND by prefetching: what is
  // prefetched therefore goes through exactly the same caches.
  async function loadTile(z, x, y) {
    if (z >= 11) {
      const live = await liveTile(x, y);
      if (live !== LIVE_FAILED) return live;
      /*
       * wplace did not answer. This is exactly the moment when their layer
       * shows nothing: rather than a blank, we serve the z11 tile from the
       * ARCHIVE.
       *
       * It lives on another host (Cloudflare), which answers when theirs is on
       * its knees. The image is one to three days behind, but we finally see
       * the drawings -- that is the whole point of the safety net.
       */
      z = 11;
    }

    // Direct mode: the worker goes and fetches the four live PNGs itself. It
    // inherits the page's origin, so its requests go through wplace's service
    // worker just like the site's -- same cache, no double download. This
    // composition used to happen on the main thread: 45 ms per tile, 0.5 s of
    // stutter per screen.
    if (state.quality === 'max' && z === 10) {
      const pool = await getPool();
      if (pool) {
        const r = await pool.submit({ type: 'live', x, y });
        if (!r.empty && r.bmp) return toBlob(r.bmp);
        if (r.empty) return null;
      }
      // without a worker, we fall back to the archive through the bridge
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await requestTile(z, x, y);
        if (!r || r.empty) return null;
        if (r.quadrants) {
          return runTask({ type: 'quadrants', quadrants: r.quadrants },
                         r.quadrants.map((q) => q.zst));
        }
        return runTask({ type: 'zst', zst: r.zst }, [r.zst]);
      } catch (e) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 400)); continue; }
        throw e;
      }
    }
    return null;
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input
              : (input && input.url) ? input.url : String(input);

    // wplace is asking for one of its tiles: we let it through as-is, and we
    // keep a copy in passing. Nothing is delayed -- the copy is read alongside.
    const live = RE_LIVE.exec(url);
    if (live) return fetchLive(live[1], live[2], input, init);

    const m = RE.exec(url);
    if (!m) return originalFetch(input, init);

    const [z, x, y] = [+m[1], +m[2], +m[3]];
    lastLevel = z;
    seen.add(`${z}/${x}/${y}`);
    try {
      const data = await loadTile(z, x, y);
      schedulePrefetch(z, x, y);
      // 204 = there is REALLY nothing painted here. Observed in MapLibre 5.21.1:
      // a 204 has response.ok, so no exception; then byteLength === 0 leads to
      // createImageBitmap(new ImageData(1,1)) and the tile goes to "loaded".
      // So it counts as covering -- which is correct for an empty area.
      if (!data) return new Response(null, { status: 204 });
      return new Response(data, { status: 200, headers: { 'Content-Type': 'image/bmp' } });
    } catch (e) {
      // But a FAILURE is not an empty area. With 204, the tile became "loaded
      // and empty": it prevented falling back to the ancestor over its whole
      // surface, was never retried, and stayed in MapLibre's tile cache.
      // A simple network hiccup thus created a PERMANENT white hole.
      // With 404, response.ok is false: the tile goes to "errored",
      // wasRequested() becomes true, falling back to the ancestor works again,
      // and it will be requested again on the next pass.
      console.warn('[worldview] tile abandoned', `${z}/${x}/${y}`, e.message);
      return new Response(null, { status: 404 });
    }
  };

  // ------------------------------------------ capturing the MapLibre instance
  // Nothing exposes the map: neither .maplibregl-map nor .maplibregl-canvas has
  // a property of its own. The Map constructor, however, assigns
  // this._controlPositions, and wplace's bundle keeps property names. So a trap
  // on Object.prototype is enough, laid before the application builds the map
  // (hence run_at: document_start).
  let MAP = null;
  (function trap() {
    const KEY = '_controlPositions';
    if (Object.getOwnPropertyDescriptor(Object.prototype, KEY)) return;
    Object.defineProperty(Object.prototype, KEY, {
      configurable: true,
      set(v) {
        Object.defineProperty(this, KEY,
          { value: v, writable: true, configurable: true, enumerable: true });
        if (!MAP && typeof this.getZoom === 'function' && typeof this.addSource === 'function') {
          MAP = this;
          delete Object.prototype[KEY];
          MAP.on('styledata', installLayer);
          MAP.on('load', installLayer);
          setTimeout(installLayer, 800);
          console.log('[worldview] map captured');
        }
      },
      get() { return undefined; },
    });
  })();

  function installLayer() {
    if (!MAP || !state.active) return;
    try {
      if (!MAP.style || !MAP.isStyleLoaded()) return;
      if (MAP.getLayer(ID_LAYER)) return;
      if (!MAP.getSource(ID_SOURCE)) {
        MAP.addSource(ID_SOURCE, {
          type: 'raster',
          tiles: [FAKE_URL + '{z}/{x}/{y}.png'],
          minzoom: 0,
          maxzoom: maxSource(),
          tileSize: 512,          // 1000 px of bitmap on a 512 tile -> archive pyramid
        });
      }
      // inserts under the native pixel layer if it already exists, so we never
      // hide the real pixels in the overlap band
      const before = MAP.getLayer('pixel-art-layer') ? 'pixel-art-layer' : undefined;
      MAP.addLayer({
        id: ID_LAYER,
        type: 'raster',
        source: ID_SOURCE,
        minzoom: state.minZoom,
        maxzoom: maxLayer(),     // fades out when wplace shows its own pixels
        paint: {
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
          'raster-opacity': state.opacity,
        },
      }, before);
      console.log(`[worldview] layer added: quality ${state.quality}, tiles z0-z${maxSource()}` +
                  `, visible below z${maxLayer().toFixed(2)}`);
    } catch (e) {
      console.warn('[worldview] adding the layer', e);
    }
  }

  function removeLayer() {
    if (!MAP) return;
    try { if (MAP.getLayer(ID_LAYER)) MAP.removeLayer(ID_LAYER); } catch (e) {}
  }

  // the threshold depends on innerWidth (tileSize 550 above 640 px, 400 below):
  // it has to be recomputed if the window crosses that limit.
  let prevWidth = innerWidth;
  addEventListener('resize', () => {
    if ((prevWidth > 640) === (innerWidth > 640)) return;
    prevWidth = innerWidth;
    if (MAP && MAP.getLayer(ID_LAYER)) MAP.setLayerZoomRange(ID_LAYER, state.minZoom, maxLayer());
  });

  // minimal surface exposed for the panel and the tests
  window.__worldview = {
    state,
    get map() { return MAP; },
    enable(v) { state.active = v; v ? installLayer() : removeLayer(); },
    setOpacity(v) {
      state.opacity = v;
      if (MAP && MAP.getLayer(ID_LAYER)) MAP.setPaintProperty(ID_LAYER, 'raster-opacity', v);
    },
    threshold,
    maxLayer,
    maxSource,
    // state of the safety net, and what is needed to work it by hand from the
    // console or the test bench (waiting two minutes for it to retract would
    // not be workable there)
    net: {
      get deployed() { return netDeployed; },
      note: noteLive,
      retract() { liveFailures = []; clearTimeout(netTimer); setNet(false); },
    },
  };
})();
