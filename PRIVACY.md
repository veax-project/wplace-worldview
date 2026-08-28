# Privacy Policy — Wplace WorldView

*Last updated: 26 August 2026*

## In short

**This extension collects no personal data.**

There is no tracking, no advertising, no analytics, and nothing is ever sent to
any server belonging to its author — no such server exists.

## What is stored, and where

Everything stays **on your device**, and nothing leaves it.

| Data | Where | Why |
|---|---|---|
| Your settings (enabled, quality, opacity, safety net) | `chrome.storage.sync` | So they survive from one session to the next |
| Map images already downloaded | IndexedDB, local | So they are not downloaded again every time the map moves |
| The downloaded world, if you ask for it | IndexedDB, local | So zooming out is instant — up to about 510 MB, only if you press the button |
| The language wplace is displayed in | `chrome.storage.local` | So the extension's own window speaks the same language as the site |
| Whether the welcome bubble still needs showing | `chrome.storage.local` | So it stops appearing once you have seen it |

The browsing cache is capped at 500 images and purges itself. The downloaded
world is never purged on its own. Both can be cleared at any time from the
extension's settings window.

## Network requests

The extension downloads **public map images only** — the same ones the site
already loads:

- `backend.wplace.live` — wplace.live's own map images
- `wplace.eralyon.net` — the public archive's aggregated map images

These requests carry **no identifier**: no account, no added cookie, no
fingerprint. They are plain image requests, like the ones a browser makes to
display a page.

## Browser tabs

The **Show me the button** action in the extension popup looks for an open
`wplace.live` tab so it can point at the extension's button on the map. It
matches tabs by address against `wplace.live` and nothing else. No other tab is
read, and nothing about your tabs is stored or sent anywhere.

## What the extension does not do

- It does not read your wplace account, your pixels, or your actions
- It places no pixels and automates nothing
- It changes no data on wplace.live
- It runs on no other site: it activates only on `wplace.live`

## Source code

Fully open and verifiable:
<https://github.com/veax-project/wplace-worldview>

## Affiliation

Unofficial extension. Not affiliated with wplace.live or with
wplace.eralyon.net.

## Contact

Through the repository's GitHub issues above, or by email at
<veaxproject@gmail.com>.
