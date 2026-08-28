/*
 * Service worker — network and cache. NOTHING else.
 *
 * Why the network lives here: eralyon sends NO Access-Control-Allow-Origin header
 * (checked). Only the extension worker, covered by host_permissions, can read its
 * tiles. The cache follows naturally — it lives in the worker, so it is shared
 * across every tab.
 *
 * Why decoding NO LONGER happens here: an MV3 service worker is single-threaded.
 * It used to decode the zstd, expand the palette, encode a PNG then hand it over
 * as base64 — ~63 ms per tile, and MAX_PARALLEL only interleaved those tasks on a
 * single core. Twelve tiles = ~756 ms serialised. The page then paid for the
 * data: decoding and the createImageBitmap on its MAIN THREAD, ~432 ms of stutter
 * per screen.
 *
 * All that work moved into a pool of page-side Web Workers (worker.js), which
 * can occupy several cores: 1241 ms -> 283 ms for twelve tiles, and zero long
 * task on the main thread (measured in bench-perf2.html).
 *
 * Consequence here: we hand back the RAW .zst bytes. They are three times lighter
 * than decoded PNGs (267-538 KB against 651-1687 KB), so the MV3 bridge carries
 * that much less, and the cache holds three times more tiles for the same volume.
 */

import { quadrantsOf } from './image.js';

const ARCHIVE = 'https://wplace.eralyon.net';
const LIVE = 'https://backend.wplace.live/files/s0/tiles';
const HOURS_PER_WEEK = 7 * 24;
const ONE_HOUR = 3600 * 1000;
// We now store raw .zst (267-538 KB) rather than decoded PNGs (651-1687 KB): for
// the same volume the cache therefore holds three times more tiles. 1200 entries
// ~ 400 MB at worst, and above all enough to cover several zoom tiers in a row —
// exactly what was missing while zooming out.
const MAX_ENTRIES = 1200;
const MAX_PARALLEL = 6;             // network only: no computation left here

// ---------------------------------------------------------------- welcome
// The button added to the toolbar is deliberately indistinguishable from the
// site's own: that was the point, but as a result nobody guesses that it has
// just appeared. So we arm a reminder counter on first launch.
// It lives in storage.local and not sync: the question "where is the button?"
// comes up on EVERY browser where the extension is installed.
const WELCOME_REMINDERS = 3;
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.storage.local.set({ welcome: WELCOME_REMINDERS });
});

// Quality: 'eco' (no reconstruction) | 'net' (z10 from the archive)
//        | 'max' (z10 from the wplace LIVE tiles, current to the second)
let quality = 'net';
chrome.storage.sync.get({ quality: 'net' }).then((r) => { quality = r.quality; });
chrome.storage.onChanged.addListener((c, z) => {
  if (z === 'sync' && c.quality) quality = c.quality.newValue;
});

// ---------------------------------------------------------------- version
let versionCache = { valeur: null, date: null, obtenue: 0 };

async function currentVersion() {
  if (versionCache.valeur && Date.now() - versionCache.obtenue < ONE_HOUR) return versionCache;
  const r = await fetch(`${ARCHIVE}/en/`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('archive unreachable: ' + r.status);
  const html = await r.text();
  const all = [...html.matchAll(/\{version: '(\d+)', date: '([^']*)'\}/g)];
  if (!all.length) throw new Error('unexpected home page format');
  const [, v, d] = all[all.length - 1];
  versionCache = { valeur: parseInt(v, 10), date: d, obtenue: Date.now() };
  return versionCache;
}

// ----------------------------------------------------------------- cache
// TWO distinct stores:
//
//   'tiles' — the opportunistic cache. Whatever we ran into while browsing.
//              Capped, oldest entries purged first.
//   'world'  — the PERMANENT reserve. The wide tiers downloaded once and for
//              all. Never purged: that is the whole point.
//
// Why this second store. Measured on the archive (tools/weigh-archive.py):
//
//     tier      tiles    average   total
//     z0-z4       341        —      25 MB
//     z5        1,024     31 KB     31 MB
//     z6        4,096     30 KB    119 MB
//     sum       5,461              175 MB
//
// One hundred and seventy-five megabytes for the whole Earth in wide view. Once
// the reserve is built, zooming out is no longer a load: it is a local read. And
// it is not even wasteful towards the archive — without it, the opportunistic
// cache caps out and re-downloads the same tiles endlessly.
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('worldview', 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v4 renamed the stores from French to English. Drop the old ones rather
      // than leave them behind: the world reserve can hold half a gigabyte, and
      // an orphaned store would keep it forever with nothing able to read it.
      for (const old of ['tuiles', 'monde']) {
        if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
      }
      // v1 stored base64 without a timestamp: incompatible, we start over
      if (db.objectStoreNames.contains('tiles')) db.deleteObjectStore('tiles');
      db.createObjectStore('tiles').createIndex('t', 't');
      if (!db.objectStoreNames.contains('world')) db.createObjectStore('world');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Every key already in the reserve, in ONE transaction instead of 21,845. */
function worldKeys() {
  return openDb().then((db) => new Promise((resolve) => {
    const r = db.transaction('world').objectStore('world').getAllKeys();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  })).catch(() => []);
}

function readWorld(key) {
  return openDb().then((db) => new Promise((resolve) => {
    const r = db.transaction('world').objectStore('world').get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  })).catch(() => null);
}

// Live tiles no longer go through here: in Direct mode it is the page worker that
// fetches them, in the same move as the wplace service worker. The key therefore
// depends on nothing but the archive version.
const tileKey = (version, z, x, y) => `${version}/${z}/${x}/${y}`;

async function readCache(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const r = db.transaction('tiles').objectStore('tiles').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}

let entryCount = null;
async function writeCache(key, value) {
  try {
    const db = await openDb();
    // value: ArrayBuffer, or null for an empty tile
    db.transaction('tiles', 'readwrite').objectStore('tiles')
      .put({ buf: value, t: Date.now() }, key);
    if (entryCount === null) entryCount = await countCache();
    if (++entryCount > MAX_ENTRIES) purge();
  } catch {}
}

function countCache() {
  return openDb().then((db) => new Promise((resolve) => {
    const r = db.transaction('tiles').objectStore('tiles').count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(0);
  })).catch(() => 0);
}

// Purge the OLDEST first, through the index on the timestamp. Walking the keys in
// alphabetical order would have deleted archive tiles before stale live tiles,
// exactly the opposite of what we want.
async function purge() {
  const db = await openDb();
  const st = db.transaction('tiles', 'readwrite').objectStore('tiles');
  let left = Math.floor(MAX_ENTRIES * 0.25);
  st.index('t').openCursor().onsuccess = (e) => {
    const c = e.target.result;
    if (!c || left-- <= 0) { entryCount = null; return; }
    st.delete(c.primaryKey);
    c.continue();
  };
}

async function clearCache() {
  const db = await openDb();
  await new Promise((resolve) => {
    const r = db.transaction('tiles', 'readwrite').objectStore('tiles').clear();
    r.onsuccess = r.onerror = resolve;
  });
  entryCount = 0;
}

// ---------------------------------------------------------------- queue
let running = 0;
const queue = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const { task, resolve, reject } = queue.shift();
    running++;
    task().then(resolve, reject).finally(() => { running--; pump(); });
  }
}

// ------------------------------------------------------------ serialisation
// MV3 TRAP: chrome.runtime.sendMessage serialises to JSON, NOT to a structured
// clone. An ArrayBuffer therefore crosses the bridge as {} — and the decoder
// receives an empty array, hence the WASM "Empty data" error.
// So we send the bytes as base64. Encoding in slices: String.fromCharCode applied
// to 400,000 bytes at once overflows the call stack.
// The cache stores binary, but the bridge demands base64: with no memo we would
// re-encode ~900 KB on EVERY re-read of an already cached tile, so on every pan.
// Small store of the most recently converted ones.
const memoB64 = new Map();
const MEMO_MAX = 40;
function base64Memo(key, buf) {
  const hit = memoB64.get(key);
  if (hit) return hit;
  const b64 = toBase64(buf);
  memoB64.set(key, b64);
  if (memoB64.size > MEMO_MAX) memoB64.delete(memoB64.keys().next().value);
  return b64;
}

function toBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// ---------------------------------------------------------- one archive tile
// A single path, cached and de-duplicated. Decoding no longer happens here: we
// hand back the bytes exactly as the archive serves them.
//
// inFlight: two requests can target the same tile at the same time — the display
// and the prefetch, or two neighbouring z10 tiles. Without this registry we
// downloaded it twice.
const inFlight = new Map();

async function zstArchive(z, x, y, version, week) {
  const key = tileKey(version, z, x, y);

  // The permanent reserve first: it is filed by WEEK, not by version, because the
  // archive stores one file per week and appends its snapshots to it.
  const stored = await readWorld(`${week}/${z}/${x}/${y}`);
  if (stored) return { buf: stored.buf, key, cache: true, reserve: true };

  const cached = await readCache(key);
  if (cached) return { buf: cached.buf, key, cache: true };   // buf null = known 404

  const pending = inFlight.get(key);
  if (pending) return pending;

  // Only LEAVES go through the scheduler. If a z10 tile took a slot there while
  // waiting for its four quadrants, the queue could block itself: parents
  // occupying every slot, and their children stuck behind them.
  const promise = schedule(async () => {
    // another request may have filled it while we waited in the queue
    const again = await readCache(key);
    if (again) return { buf: again.buf, key, cache: true };

    const r = await fetch(`${ARCHIVE}/tiles/${week}/${z}/${x}/${y}.zst`);
    if (r.status === 404) { writeCache(key, null); return { buf: null, key }; }
    if (!r.ok) throw new Error('tile ' + r.status);   // network error: conclude NOTHING
    const buf = await r.arrayBuffer();
    writeCache(key, buf);
    return { buf, key };
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

// ------------------------------------------------------------------- tile
async function tile(z, x, y) {
  const { valeur: version } = await currentVersion();
  const week = Math.floor(version / HOURS_PER_WEEK);

  // z10 is absent from the archive: we hand back the four z11 tiles it covers,
  // raw, and it is the page worker that assembles them. Each one is cached in its
  // own right — they are reused as they are at tier 11.
  if (z === 10) {
    const pieces = await Promise.all(quadrantsOf(x, y).map(async (q) => {
      try {
        const { buf } = await zstArchive(11, q.x, q.y, version, week);
        return buf ? { dx: q.dx, dy: q.dy, key: tileKey(version, 11, q.x, q.y), buf } : null;
      } catch (e) { return null; }                    // a missing quadrant does not cancel the others
    }));
    const found = pieces.filter(Boolean);
    if (!found.length) return { empty: true, version };
    return {
      quadrants: found.map((p) => ({ dx: p.dx, dy: p.dy, b64: base64Memo(p.key, p.buf) })),
      version,
      via: 'worker',
    };
  }

  const { buf, key, cache } = await zstArchive(z, x, y, version, week);
  if (!buf) return { empty: true, version, cache };
  // we only encode to base64 at the last moment: storage stays binary
  return { zstB64: base64Memo(key, buf), version, cache, via: 'worker' };
}

/*
 * Prewarm: download and cache, returning nothing.
 *
 * Prefetching only exists to warm the network up. Sending the bytes back — let
 * alone encoding them to base64 — would be pure wasted work: the page would throw
 * them away, then ask for them again at display time.
 */
async function prewarm(z, x, y) {
  const { valeur: version } = await currentVersion();
  const week = Math.floor(version / HOURS_PER_WEEK);
  const targets = z === 10
    ? quadrantsOf(x, y).map((q) => [11, q.x, q.y])
    : [[z, x, y]];
  await Promise.all(targets.map(([zz, xx, yy]) =>
    zstArchive(zz, xx, yy, version, week).catch(() => {})));
  return { prechauffe: true };
}

/* =========================================================================
 * Building the reserve: download the whole Earth, once.
 * =========================================================================
 *
 * The problem it solves: zooming out over a region never visited means twelve
 * tiles to download at once. Even fast, it shows. And the opportunistic cache
 * caps out, so the same region turns cold again later.
 *
 * The weight makes it possible (tools/weigh-archive.py): 175 MB for z0-z6, that
 * is 5,461 tiles. We stay courteous with the archive — three requests in
 * parallel, no more, and nothing starts without an explicit click.
 *
 * Progress goes through chrome.storage.local rather than through a port: an MV3
 * service worker can be stopped at any time, and a port dies with it. Storage
 * survives, and the interface re-reads it on wake-up.
 */
const TIERS = { world: 6, detailed: 7 };

/*
 * The limiting factor is NOT bandwidth, it is the number of round trips. A tile
 * weighs ~23 KB and takes ~115 ms to come back: on fibre you wait for the ping,
 * not for the bytes.
 *
 * But the DOMINANT factor is elsewhere, and I had it wrong. The archive is served
 * by Cloudflare (Cache-Control: public, max-age=14400), and everything depends on
 * the state of its edge cache. Measured, same set of tiles, two passes in a row:
 *
 *                            16 threads     32-48 threads
 *     COLD cache (MISS)       72 tiles/s    117 tiles/s
 *     WARM cache (HIT)       415 tiles/s    538 tiles/s
 *
 * Five to six times. My first measurement pulled tiles at random from tier 8 — so
 * never requested, so nothing but MISSes going all the way back to the origin
 * machine. Hence the 87 tiles/s announced, which only described the worst case.
 *
 * Practical consequence: the first person to download a week pays full price, the
 * next ones read the CDN cache. And parallelism helps in BOTH states, contrary to
 * what I believed — hence 32 and not 16.
 */
const DOWNLOAD_PARALLEL = 32;
const BACKOFF_AFTER_FAILURES = 8;  // failures in a row before easing off
const BACKOFF_MS = 4000;

let reserveRunning = null;

async function markReserve(state) {
  await chrome.storage.local.set({ reserve: state });
  return state;
}

async function reserveState() {
  const { reserve } = await chrome.storage.local.get({ reserve: null });
  return reserve;
}

function tilesUpTo(maxZoom) {
  const list = [];
  for (let z = 0; z <= maxZoom; z++) {
    const side = 2 ** z;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) list.push([z, x, y]);
  }
  return list;
}

/*
 * `force`: make the trip again even for tiles already in the reserve.
 *
 * The archive does not write one file per snapshot: it APPENDS each new snapshot
 * to the end of the week's file, as a delta. A reserve built on Monday therefore
 * does not contain the Tuesday-to-Sunday snapshots — it freezes the wide view on
 * the day it was downloaded.
 *
 * Re-downloading the same week brings back the complete file, deltas included. So
 * we erase nothing beforehand: if the update is interrupted, the old reserve is
 * still there.
 */
async function buildReserve(profile, resume, force) {
  if (reserveRunning) return { already: true };
  const maxZoom = TIERS[profile] ?? TIERS.world;

  const { valeur: version } = await currentVersion();
  const week = Math.floor(version / HOURS_PER_WEEK);
  const db = await openDb();
  const list = tilesUpTo(maxZoom);

  const progress = resume
    ? { ...resume, active: true, total: list.length }
    : { active: true, profile: profile, semaine: week, total: list.length,
        done: 0, bytes: 0, echecs: 0, startedAt: Date.now(),
        // the archive version at download time: it is what dates the wide view,
        // and what says whether an update makes sense
        version, date: versionCache.date };
  reserveRunning = progress;
  await markReserve(progress);

  // On resume we start again a little before the point reached: the list is
  // walked in order, so `done` is a good approximation of it, and the set of
  // keys already in the reserve rules out whatever is already there anyway.
  let cursor = resume ? Math.max(0, (resume.done | 0) - 64) : 0;
  let lastWrite = 0;
  let sinceCheck = 0;

  /*
   * TWO IndexedDB accesses per tile — a get then a put — on the service worker's
   * single thread. At 400 tiles/s that makes 800 transactions per second, with
   * buffers of 400 to 500 KB: storage becomes the bottleneck before the network.
   *
   * So we read ALL the keys at once on startup, and we group the writes. The
   * batch is deliberately small: if the worker is stopped, we only lose that
   * batch, and the cursor goes back anyway.
   */
  const already = new Set(await worldKeys());
  let batch = [];

  const flushBatch = async () => {
    if (!batch.length) return;
    const chunk = batch;
    batch = [];
    await new Promise((resolve) => {
      const tx = db.transaction('world', 'readwrite');
      const st = tx.objectStore('world');
      for (const [c, b] of chunk) st.put({ buf: b }, c);
      tx.oncomplete = tx.onerror = tx.onabort = resolve;
    });
  };

  const stash = (key, buf) => {
    batch.push([key, buf]);
    already.add(key);
    return batch.length >= 24 ? flushBatch() : null;
  };

  // Automatic backoff: if the archive starts refusing, we ease off instead of
  // pushing. Reset as soon as a response comes back.
  let failuresInARow = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const worker = async () => {
    while (progress.active && cursor < list.length) {
      // The stop flag is authoritative in STORAGE, not in memory: an MV3 service
      // worker can be stopped at any time, and it then comes back with empty
      // variables. That is what made the "Stop" button useless — it no longer
      // found anything to stop.
      // We re-read it every sixteen tiles: often enough to answer quickly,
      // rarely enough not to slow the download down.
      if (++sinceCheck >= 16) {
        sinceCheck = 0;
        const seen = await reserveState();
        if (!seen || !seen.active) { progress.active = false; break; }
      }
      const [z, x, y] = list[cursor++];
      const key = `${week}/${z}/${x}/${y}`;
      try {
        if (force || !already.has(key)) {
          // A guard timeout is ESSENTIAL: a fetch without a signal can wait
          // forever. That is what blocked the download at 21,799 out of 21,845 —
          // a few requests never came back, their workers stayed suspended, and
          // the count never reached the total.
          const r = await fetch(`${ARCHIVE}/tiles/${week}/${z}/${x}/${y}.zst`,
                                { signal: AbortSignal.timeout(20000) });
          if (r.ok) {
            const buf = await r.arrayBuffer();
            await stash(key, buf);
            progress.bytes += buf.byteLength;
            failuresInARow = 0;
          } else if (r.status === 404) {
            await stash(key, null);
            failuresInARow = 0;
          } else {
            progress.echecs++;
            if (++failuresInARow >= BACKOFF_AFTER_FAILURES) await sleep(BACKOFF_MS);
          }
        }
      } catch (e) {
        progress.echecs++;
        if (++failuresInARow >= BACKOFF_AFTER_FAILURES) await sleep(BACKOFF_MS);
      }
      // Progress is the POSITION in the list. A separate counter drifted on every
      // resume (we start again 64 notches back) and therefore never reached the
      // total exactly.
      progress.done = Math.min(cursor, list.length);
      // Progress is written eight times per second. More often and storage would
      // become the bottleneck; less often and the bar advances in jerks.
      if (Date.now() - lastWrite > 120) {
        lastWrite = Date.now();
        markReserve(progress);
      }
    }
  };

  const threads = Array.from({ length: DOWNLOAD_PARALLEL }, worker);
  Promise.all(threads).then(async () => {
    await flushBatch();               // the last batch must not be lost
    progress.active = false;
    // Being finished means having WALKED the whole list. Trusting the counter
    // left the download stuck just short of the total when a few requests had
    // failed.
    progress.finished = cursor >= list.length;
    if (progress.finished) progress.done = list.length;
    progress.finishedAt = Date.now();
    reserveRunning = null;
    await markReserve(progress);
  });

  return { lance: true, total: list.length };
}

async function stopReserve() {
  if (reserveRunning) reserveRunning.active = false;
  // And above all in storage, even if nothing is running in memory any more: that
  // is what the workers re-read, and what the interface displays.
  const seen = await reserveState();
  if (seen) await markReserve({ ...seen, active: false, arrete: true });
  return { arrete: true };
}

/*
 * Reserve state, and RESUME if needed.
 *
 * An MV3 service worker is stopped after some thirty seconds without activity. If
 * the user closes wplace in the middle of a download, the workers die with it —
 * but storage keeps `active: true`. On the next wake-up we notice it here and pick
 * up where we left off.
 *
 * The interface polls this state regularly while a download is running, which has
 * a second useful effect: every message pushes back the worker's shutdown.
 */
async function reserveStateOrResume() {
  const state = await reserveState();
  if (state && state.active && !reserveRunning) {
    buildReserve(state.profile, state);           // deliberately without await
  }
  return { etat: state };
}

async function clearReserve() {
  const db = await openDb();
  await new Promise((resolve) => {
    const r = db.transaction('world', 'readwrite').objectStore('world').clear();
    r.onsuccess = r.onerror = resolve;
  });
  await chrome.storage.local.remove('reserve');
  return { empty: true };
}

// --------------------------------------------------------------- messages
/*
 * The labels for a given language, read from our own package.
 *
 * Why here and not in the content script: a content script only reads a file from
 * the package if it is declared in web_accessible_resources, hence exposed to the
 * page. The service worker is an extension context: it reads texts.json without
 * declaring anything and without exposing anything.
 *
 * And why texts.json rather than _locales/ directly: see the header of
 * tools/generate_texts.py. In short, `_locales/` is a folder reserved by Chrome
 * and its accessibility over fetch is not guaranteed; texts.json is an ordinary
 * copy of it, generated, never hand-edited.
 *
 * The cache disappears with the worker, and that is fine: re-reading a local file
 * costs less than a message round trip.
 */
let allLocales = null;

async function localeTexts(locale) {
  if (!allLocales) {
    const r = await fetch(chrome.runtime.getURL('texts.json'));
    if (!r.ok) throw new Error('texts.json ' + r.status);
    allLocales = await r.json();
  }
  // The locale comes from the page: we only use it if we know it.
  return { messages: allLocales[locale] || null };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const routes = {
    'wv:tile': () => tile(msg.z, msg.x, msg.y),
    'wv:prewarm': () => prewarm(msg.z, msg.x, msg.y),
    'wv:reserve': () => buildReserve(msg.profile, null, msg.force),
    'wv:reserve-stop': () => stopReserve(),
    'wv:reserve-state': () => reserveStateOrResume(),
    'wv:reserve-clear': () => clearReserve(),
    'wv:version': () => currentVersion(),
    'wv:stats': async () => ({ entries: await countCache(), max: MAX_ENTRIES,
                               quality: quality, version: await currentVersion() }),
    'wv:clear': async () => { await clearCache(); return { empty: true }; },
    'wv:texts': () => localeTexts(msg.locale),
  };
  const route = routes[msg?.type];
  if (!route) return;
  route().then((r) => respond({ ok: true, ...r }))
         .catch((e) => respond({ ok: false, error: String(e && e.message || e) }));
  return true;                             // asynchronous response
});
