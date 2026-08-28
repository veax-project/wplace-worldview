# Wplace WorldView

Chrome extension that shows [wplace.live](https://wplace.live) drawings **when
you zoom out**, where the site itself displays nothing.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/pjfiggbefafimahechioeelablbkgno)**

---

## The problem

wplace publishes a single zoom level. Zoom out and the site shows
*"Zoom in to see the pixels"* — the map goes blank. You cannot look at a whole
region, let alone the whole world.

## What the extension does

It rebuilds the missing zoom levels and draws them **inside wplace's own map**,
underneath the site's own pixel layer. Nothing about how you play changes.

- Drawings stay visible all the way out to the entire planet
- A button is added to wplace's toolbar, styled like the site's own
- Three quality modes, an opacity slider
- Local cache, so a place you have already visited comes back instantly
- Optional one-time download of the whole world, for instant zoom-out
- If wplace's own tiles stop loading, the extension quietly takes over

### The three modes

| Mode | What it does |
|---|---|
| **Light** | Least data. Slightly blurry over one zoom band. |
| **Sharp** | Rebuilds the missing level at full quality. Data is 1–3 days old. |
| **Live** | Rebuilds from wplace's own tiles, up to the second. |

---

## How it works

```
wplace map (MapLibre)
        |
        |  window.fetch hooked in the page's own JS context
        v
  service worker  -->  public map images  -->  worker pool
                                                (zstd + palette -> BMP)
```

Three pieces, because each one can do something the others cannot:

- a **MAIN-world content script**, which shares the page's JS context and can
  reach the MapLibre instance and patch `fetch`
- an **ISOLATED content script**, the only one with access to `chrome.*`
- a **service worker**, the only one that can fetch cross-origin images

Decoding runs in a pool of Web Workers on the page side. Tiles come out as BMP
rather than PNG: MapLibre accepts either, and encoding is more than ten times
cheaper.

The interface reuses wplace's own daisyUI classes, so it follows the site's
light and dark themes on its own. Its language follows **wplace's**, not the
browser's — English and Brazilian Portuguese, the two the site offers.

---

## Privacy

No data collection, no tracking, no ads. Everything stays on your device.
The extension reads public map images and nothing else — it never touches your
account, your pixels, or your actions, and it places nothing automatically.

Full policy: [PRIVACY.md](PRIVACY.md).

---

## Development

```bash
py -3 _devserve.py          # test server on port 8792
py -3 package.py            # build the Store zip, validating locales
```

Load `extension/` through `chrome://extensions` → **Developer mode** →
**Load unpacked**.

**190 automated tests** run in the browser against the real wplace stylesheet:

| Bench | Tests |
|---|---|
| `test-extension.html` | 48 |
| `test-ui.html` | 53 |
| `test-welcome.html` | 69 |
| `test-decoder.html` | 10 |
| `test-z10.html` | 10 |

`bench-*.html` are performance benches, not part of the suite.

---

## Licence

MIT — see [LICENSE](LICENSE), which also lists the bundled third-party
decoders.

Unofficial extension. Not affiliated with wplace.live.
