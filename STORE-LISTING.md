# Chrome Web Store listing — copy & paste

Package to upload: **`wplace-worldview-1.0.0.zip`**
Rebuild anytime with `py -3 package.py`.

> **Language.** wplace exists in **two** languages only: English and Brazilian
> Portuguese. The extension follows exactly the same two, and so does this
> listing: English first, Brazilian Portuguese added afterwards (see below). The
> extension itself switches language on its own, following the browser — a
> browser set to anything else (French, Spanish…) gets English.

---

## Primary language
```
English (United States)
```

## Name
```
Wplace WorldView
```

## Short description *(132 characters max)*
```
See wplace.live drawings even when zoomed out, where the site shows nothing.
```

## Detailed description

```
wplace.live only publishes a single zoom level. As soon as you zoom out, the site
shows "Zoom in to see the pixels" and the map goes blank — you can't see a whole
region, let alone the whole world.

WorldView fills that gap. It rebuilds the missing zoom levels and draws them
straight into wplace's own map, without changing anything about how you play.

■ WHAT IT DOES

• Drawings stay visible when you zoom out, all the way to the entire planet
• Adds a button to wplace's toolbar, styled exactly like the site's own
• Three quality levels to choose from
• Opacity control
• Local cache: a place you've already visited shows up instantly
• Download the whole world once, and zooming out is instant from then on
• If wplace's own tiles stop loading, WorldView quietly takes over

■ THE THREE MODES

• Light — least data, slightly blurry over one zoom band
• Sharp — rebuilds the missing level at full quality
• Live — rebuilds from wplace's own tiles in real time

■ WHAT IT DOES NOT DO

• No data collection, no tracking, no ads
• No changes to your account, your pixels or your actions
• No automated pixel placing — it only displays, nothing else

■ TECHNICAL

Fully open source and auditable:
https://github.com/veax-project/wplace-worldview

Unofficial extension. Not affiliated with wplace.live.
```

## Category
```
Tools
```

---

## Single purpose

The Store asks for one sentence describing the extension's single purpose,
before the permissions. Ready-made answer:

```
WorldView has one purpose: to display wplace.live's pixel-art drawings at zoom
levels where the site itself stops rendering them. It rebuilds the missing zoom
levels from public map images and draws them inside wplace's own map. It does
nothing else.
```

---

## Permission justifications

The Store asks you to justify **each** permission. Ready-made answers:

### `storage`
```
Stores the user's settings (enabled state, quality level, opacity) and a local
cache of already-downloaded map images, so they are not re-downloaded every time
the map moves. No personal data is stored.
```

### Host permissions — **one single field for all three**

The dashboard does NOT give one box per host: there is a single "Host permission
justification" field. Paste this, it covers the three at once (817 characters,
limit 1000):

```
The extension shows wplace.live's pixel-art at zoom levels where the site itself
renders nothing. Three hosts, all read-only, all public map images:

- https://wplace.live/* - the site the extension runs on. Its content script
already runs here; the host permission additionally lets the popup find an open
wplace.live tab, in order to point at the extension's button on request. Only
tabs whose address is wplace.live are matched.

- https://backend.wplace.live/* - wplace's own image server. Reads the same
public map images the site already loads itself, to rebuild the zoom levels
wplace does not publish.

- https://wplace.eralyon.net/* - a public archive of aggregated wplace map
images, the only existing source for very wide zoom levels. Read-only.

No user data is read, stored or transmitted to any of them.
```

### Remote code
```
None. All code ships inside the package.
```

---

## Privacy

**Does this extension collect user data?** → **No**

Tick all three declarations:
- ✅ I do not sell or transfer user data to third parties
- ✅ I do not use or transfer user data for purposes unrelated to the item's core functionality
- ✅ I do not use or transfer user data to definitively creditworthiness or for lending purposes

**Privacy policy URL:**
```
https://github.com/veax-project/wplace-worldview/blob/master/PRIVACY.md
```

---

## Screenshots

Required: **at least one**, **1280×800** or 640×400, PNG or JPEG.

### Ready to upload

```
proof/store-capture-1280x800.png
```

The whole world at wide zoom, covered in drawings, with wplace's own "Zoom in to
see the pixels" still on screen — the site saying you cannot see the pixels,
while you are looking at them. No account, no personal data, no other
extension's UI in frame.

Kept alongside it: `proof/store-capture-source-2556x1335.png`, the untouched
capture, in case another crop is ever wanted. The world repeats every **1338 px**
at that zoom (measured by autocorrelation), so any 1338-wide window shows one
complete world map — only the edge meridian changes.

### If you want more

2. The settings window open, to show how it blends into the site
3. A before/after at the same zoom, if you want to drive the point home

Tip: press wplace's **Hide UI** button before capturing — it removes the avatar,
the paint gauge and the toolbar in one click.

---

## Adding Brazilian Portuguese afterwards

Once the English listing is submitted, the Store lets you add other languages
(*Store listing → language selector → Add a language*). Pick **Portuguese
(Brazil)** — the same and only second language wplace itself offers.

**Short description**
```
Veja os desenhos do wplace.live mesmo com o zoom afastado, onde o site não mostra mais nada.
```

**Detailed description**
```
O wplace.live publica um único nível de zoom. Assim que você afasta o zoom, o
site mostra « Amplie para ver os pixels » e o mapa fica vazio: não dá para ver
uma região inteira, muito menos o mundo.

O WorldView preenche essa lacuna. A extensão reconstrói os níveis que faltam e
mostra os desenhos direto no mapa do wplace, sem mudar nada no seu jeito de
jogar.

■ O QUE ELA FAZ

• Os desenhos continuam visíveis com o zoom afastado, até a Terra inteira
• Um botão entra na barra de ferramentas do wplace, no mesmo formato dos deles
• Três níveis de qualidade, você escolhe
• Ajuste de opacidade
• Cache local: uma área já visitada aparece na hora
• Baixe o mundo inteiro de uma vez e afaste o zoom instantaneamente

■ OS TRÊS MODOS

• Leve — menos dados, um pouco borrado numa faixa de zoom
• Nítida — reconstrói o nível que falta, qualidade completa
• Ao vivo — reconstrói a partir dos blocos do wplace em tempo real

■ O QUE ELA NÃO FAZ

• Nenhum dado pessoal coletado, nenhum rastreamento, nenhum anúncio
• Nenhuma alteração na sua conta, nos seus pixels ou nas suas ações
• Nenhum pixel colocado automaticamente: é exibição, e mais nada

■ TÉCNICO

O código é totalmente aberto e verificável:
https://github.com/veax-project/wplace-worldview

Extensão não oficial, sem vínculo com o wplace.live.
```

> Wording aligned on wplace's own: "Amplie para ver os pixels" is their own
> message, "blocos" their word for *tiles*, likewise "Configurações", "Ao vivo",
> "Deletar", "Entendi". Read off their bundle, not guessed.
