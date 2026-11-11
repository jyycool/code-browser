# Clearcote fingerprint reference

This page lists every fingerprint surface the Clearcote engine (Chromium `151.0.7922.108`, see
[`UPSTREAM_REVISION`](../../UPSTREAM_REVISION)) **actually changes** relative to upstream Chromium /
ungoogled-chromium, and the command-line switch that controls it. Each item maps to a patch in
[`patches/`](../../patches/); the per-patch notes are in [`patches/README.md`](../../patches/README.md).

Activation rule (`977-persona-active-predicate`):

| How it is launched | Result |
|---|---|
| No `--fingerprint` / `--fingerprint-profile` | Host values (individual override switches still apply) |
| `--fingerprint=<seed>` | The seed derives one **coherent persona**, plus per-site noise |
| `--fingerprint-profile=<capture>` | Presents the imported real-machine capture, **no noise**; fields the capture lacks come from the seed |

Precedence for every individual switch: **switch > persona > host**.

---

## 1. Seed and persona model

Clearcote does not randomise each API on its own. One seed derives a whole machine, so the APIs agree with each other.

- **`--fingerprint=<seed>`**: a number or any string (strings are hashed to a number; a bad seed cannot crash
  the renderer). The same seed gives the same machine on every launch; a new seed gives a new, unlinkable one.
- **Per-site noise** (`001-farble-seed-core`): the noise seed mixes the global seed with the site's eTLD+1.
  One site is stable within a session; different sites get uncorrelated noise and cannot be linked.
- **Persona engine** (`002-persona-profile`): draws platform, GPU, screen, fonts, languages, memory, cores and so
  on from weighted real-device distributions, and keeps them consistent (for example Windows persona → D3D11 GPU
  string → Segoe UI → Windows voices).
- **`--fingerprint-schema=2`** (`980` / `981`): persona schema 2. Screen and GPU class follow the hardware tier,
  and `jsHeapSizeLimit` is sized from the persona's RAM; touch, colour gamut, `navigator.connection` and the audio
  sample rate are drawn from measured shares. Schema 1 is the default and is unchanged for every seed.
- **Self-check**: `--clearcote-validate-persona=<N|a,b,c|current>` derives the personas, checks cross-surface
  invariants, prints a report and exits (0 = clean, 3 = contradictions) (`974`).

---

## 2. Render noise (Canvas / WebGL / Audio)

| Surface | Change | Patch |
|---|---|---|
| Canvas 2D | `toDataURL` / `toBlob` / `getImageData` / `measureText` farbled per site; every export path reads the same pixels (partial reads included); uniform regions get position-keyed noise | `060` |
| WebGL | `readPixels` and the WebGL canvas snapshot are farbled | `070` |
| Audio | Samples get **no noise** (`getChannelData`, `copyFromChannel` and offline rendering match stock Chrome); only `sampleRate` / `baseLatency` / `outputLatency` come from the persona | `020` |
| ClientRects | **No noise**, reported exactly | `050` |

Why ClientRects and audio samples are left alone:

- Client rects are an **output** of fonts, DPR and viewport. Perturbing them on their own only creates
  contradictions (for example `getClientRects()` disagreeing with `getBoundingClientRect()`), so the rects noise
  inherited from upstream was removed.
- Audio noise produces values no real Chrome can output. The offline sample rate is not perturbed either:
  a non-standard value such as 44099.99 is itself a tell.

Switches that turn noise off:

| Switch | Effect |
|---|---|
| `--disable-fingerprint-noise` | Turns off all per-site noise (Canvas, WebGL and the rest); the persona identity stays |
| `--cc-no-farble` | Same: keeps the whole persona (UA, screen, GPU, TLS) and only turns the noise off (`220`) |
| `--disable-canvas-noise` | Turns off Canvas 2D readback noise only; WebGL and the other surfaces are unchanged |

> Some detection services classify render noise as "tampering". If looking like an unmodified browser matters
> more, turn the noise off and keep the persona, or import a real capture with `--fingerprint-profile` (no noise).

---

## 3. Navigator / UA / UA-CH / hardware

| Switch | Changes | Patch |
|---|---|---|
| `--fingerprint-platform=` | `navigator.platform`, the UA and UA-CH platform: `windows` / `macos` / `linux` / `android` (case-insensitive) | `002` `010` |
| `--fingerprint-platform-version=` | UA-CH `platformVersion` | `010` |
| `--fingerprint-brand=` | UA-CH brand: `chrome` / `edge` / `opera` / `vivaldi` | `010` |
| `--fingerprint-brand-version=` | The brand's full version (`fullVersionList`); with `chrome` it sets the Chromium version | `010` |
| `--fingerprint-hardware-concurrency=` | `navigator.hardwareConcurrency` | `030` |
| `--fingerprint-device-memory=` | `navigator.deviceMemory` and the `Device-Memory` header (one number, rounded to Chrome's power-of-two steps) | `030` |
| `--fingerprint-storage-quota=` | `navigator.storage.estimate()` quota | `145` |

Defaults (seed given, no individual switch):

- The UA / UA-CH version is picked by seed from a pool of real Chromium 151 stable builds; `bitness=64`, `wow64=false`, `model=""`.
- `navigator.webdriver` is `false`, and the automation and headless tells are removed (`010`, `110`, `120`).
- `performance.memory.jsHeapSizeLimit` is a realistic desktop value and does not vary with host RAM (`146`).

---

## 4. Screen / DPR / pointer

| Switch | Changes |
|---|---|
| `--fingerprint-screen-width=` / `--fingerprint-screen-height=` | `screen.width/height` (CSS pixels) |
| `--fingerprint-avail-width=` / `--fingerprint-avail-height=` | `screen.availWidth/availHeight` |
| `--fingerprint-color-depth=` | `screen.colorDepth` / `pixelDepth` |
| `--fingerprint-device-pixel-ratio=` | `devicePixelRatio` |
| `--fingerprint-max-touch-points=` | `navigator.maxTouchPoints`, and the `(pointer)` / `(hover)` media queries |

The DPR reaches every place that reports it (`961` / `962`): the `Sec-CH-DPR` header, the CSS `resolution`
media query, `srcset` and `image-set()` selection, and the screen coordinates of pointer events.

**Set screen size and DPR together.** The "physical resolution" a detection page computes is
`screen.width × devicePixelRatio`; changing only one gives a resolution that does not exist. Left unset, both
come from the persona and already match.

Other screen coherence (no switch, active with a seed):

- `getScreenDetails()`, `window.outer*` and `screenX/Y` come from the persona; the real display is never exposed (`140`).
- `outerWidth/outerHeight` use the real window frame and agree with pointer coordinates (`972`); the initial window fits the persona's work area (`975`).
- CSS `@media` `device-width/height`, `resolution`, colour depth and `color-gamut` follow the persona (`141`).
- A desktop persona with touch points keeps a mouse as the primary pointer (a touch laptop); only a mobile persona has a coarse primary pointer (`142`).

---

## 5. GPU / WebGL / WebGPU

| Switch | Changes |
|---|---|
| `--fingerprint-gpu-vendor=` | WebGL `UNMASKED_VENDOR_WEBGL` |
| `--fingerprint-gpu-renderer=` | WebGL `UNMASKED_RENDERER_WEBGL` |
| `--fingerprint-webgpu-vendor=` / `-architecture=` / `-device=` / `-description=` | WebGPU `GPUAdapterInfo` |
| `--disable-gpu-string-spoof` | Reports **only** the real vendor/renderer strings; the parameter table and extensions stay on the persona |
| `--disable-gpu-fingerprint` | All of WebGL/WebGPU reports the host's real GPU (strings, parameter table, extensions, readback untouched) |
| `--fingerprint-gpu-backend-real` | Declares a real GPU backend on the host; only then does schema 2 use a discrete-GPU class |

The persona GPU is constant for the whole session (every site sees the same GPU), and these surfaces all follow it:

- The full WebGL1/WebGL2 `getParameter` table, `getSupportedExtensions` (a separate list per context type),
  `getShaderPrecisionFormat`, and the stencil masks (`070` `071` `955` `968` `985`).
- WebGPU: `requestAdapter()` vendor/architecture (per model), `limits` (never above the real adapter),
  `features` (intersected with the real adapter), `getPreferredCanvasFormat()` (`075` `967` `970` `982` `983`).
- The hardware-decode matrix of `MediaCapabilities.decodingInfo()` (`147`).
- A Windows persona on a non-D3D host does not expose the ASTC/ETC extensions D3D11 cannot have (`969`); the
  optional environment variable `CLEARCOTE_SHADER_DIALECT=hlsl` makes `WEBGL_debug_shaders` report HLSL (`966`).

**Vendor and renderer must be the matching pair from one real GPU.** A mismatched pair, or a mobile UA with a
desktop discrete GPU, reads as tampering. When unsure, leave them to the persona.

---

## 6. Fonts / voices / Math

| Surface | Behaviour | Patch |
|---|---|---|
| Fonts | Only the persona's font set is exposed: by default about 300 families modelled on real Windows installs, or an imported capture's `fonts.detected`; on a Linux host, 231 metric-compatible substitutes | `040` |
| `system-ui` | Resolves to Segoe UI for a Windows persona | `971` |
| Voices | `speechSynthesis.getVoices()` returns the persona's voices: by default the Windows SAPI en-US David / Zira / Mark, or a capture's `speech[]`; never empty | `170` |
| `Math.tanh` | Bit-exact Windows result for a Windows persona on any host | `965` |

macOS personas have three more font patches; see [`patches/macos-150/`](../../patches/macos-150/) and [`MACOS-FONTS.md`](MACOS-FONTS.md).

---

## 7. Timezone / language / geolocation

| Switch | Changes | Patch |
|---|---|---|
| `--timezone=` | The IANA timezone of JS `Intl` / `Date` (for example `America/New_York`) | `090` |
| `--lang=` | UI language, `navigator.language`, the default `Intl` locale | Chromium + `092` |
| `--accept-lang=` | The `Accept-Language` header and `navigator.languages` (stock Chromium) | |
| `--fingerprint-location=lat,lng` | `navigator.geolocation` returns this position directly (accuracy 100 m) | `180` |

The renderer's ICU/`Intl` default locale follows the persona language (`092`), so `Intl.DateTimeFormat` and
`toLocaleString` agree with `navigator.language`; the default speech voice follows it too, so no host language leaks.

**Timezone, language and geolocation should match the egress IP's location.** Look them up from the proxy's exit
IP before launch. These switches are read at startup and cannot change while the process runs; restart to change them.

---

## 8. Network: WebRTC / proxy / TLS

| Switch | Effect | Patch |
|---|---|---|
| `--webrtc-ip=<IP>` | Fabricates the srflx candidate at this IP (use the proxy's exit IP), sends **no real STUN**, suppresses host candidates; the real LAN/public IP does not leak | `100` |
| `--proxy-server=` | Stock Chromium proxy (HTTP / HTTPS / SOCKS5) | |
| `--proxy-auth=user:pass` | The engine answers HTTP/HTTPS proxy authentication (Basic, Digest) itself; no CDP interception needed | `978` |
| `--socks5-credentials=user:pass` | SOCKS5 username/password authentication (RFC 1929) | `963` `984` |
| `--socks5-udp` | Relays WebRTC and other UDP through SOCKS5 UDP ASSOCIATE | `973` |
| `--fingerprint-tls-profile=chrome-<major>` | Makes the version-variant ClientHello fields (post-quantum key-share group, ALPS codepoint) match the persona's Chromium major; `off` / `native` / unset = unchanged | `210` |

**Authenticated residential proxies work directly in the engine; no local unauthenticated SOCKS5 relay is needed.**

The TLS persona only changes the version-variant fields. The cipher list, version bounds, signature algorithms
and extension-order permutation stay exactly as real Chrome.

---

## 9. Other device APIs (active with a seed)

| API | Persona value | Patch |
|---|---|---|
| `navigator.getBattery()` | Desktop on AC: charging, 100%; the getters and the `chargingchange` / `levelchange` events agree | `150` `979` |
| `navigator.connection` | Residential 4g (schema 2 draws rtt / downlink from measured shares) | `150` `981` |
| `navigator.keyboard.getLayoutMap()` | US-QWERTY | `150` |
| `enumerateDevices()` | A real Windows onboard-audio mic/speaker set; `deviceId` / `groupId` from the seed; empty labels before permission | `148` |
| `navigator.share` / `canShare` | Present for a Windows persona | `160` |
| `new URL("C:/").protocol` | `"file:"` (Windows behaviour) | `160` |

---

## 10. Importing a real-machine capture

```
--fingerprint-profile=<base64 of gzip-compressed JSON>
```

Capture one on a real machine with [`tools/fingerprint-collect`](../../tools/fingerprint-collect/), or convert a
record from a public dataset. The capture drives the GPU (strings, the full `getParameter` table, extensions,
WebGPU), screen, fonts, voices, audio, Chrome version, CSS `@media`, touch points, codec support and the media-device
list. Fields the capture lacks come from the `--fingerprint` seed, so a partial capture stays coherent.
An imported capture gets **no render noise**.

---

## 11. Canvas bridge (optional)

`--canvas-bridge-url=ws://host:port/path` forwards Canvas/WebGL **draw operations** to a render host with a real
GPU and returns the pixels that machine actually rendered. Readbacks then come from the kind of GPU the persona
claims, instead of only a changed string.

| Switch | Effect |
|---|---|
| `--canvas-bridge-auth=user:secret` | HTTP Basic credentials |
| `--canvas-bridge-mode=off\|all\|allow\|deny` | Per-site policy; default `all` |
| `--canvas-bridge-allow=` / `--canvas-bridge-deny=` | Comma-separated eTLD+1 lists |
| `--canvas-bridge-fallback=block\|local` | On a cold cache miss, wait, or render locally |

Server: [`tools/canvas-bridge-server`](../../tools/canvas-bridge-server/); details: [`CANVAS-BRIDGE.md`](CANVAS-BRIDGE.md).

---

## 12. Profiles and input

| Switch | Effect | Patch |
|---|---|---|
| `--portable-profile` | Stores the cookie encryption key inside the profile, so a copied profile keeps its cookies | `964` |
| `--profile-encryption-key=<secret>` | Derives the cookie encryption key from this secret | `964` |
| `--agent-llm-url=` / `--agent-llm-key=` | The in-browser AI agent (your own OpenAI-compatible endpoint); off by default | `200` |

Mouse and keyboard input sent over CDP goes through the normal input router with curved, jittered motion and is
not marked as a debugger-synthesised event (`130` `200`).

---

## 13. How to launch it

The engine reads **command-line switches** only, so any language can start it as a process. Windows example:

```bat
chrome.exe ^
  --fingerprint=7423 ^
  --fingerprint-platform=windows ^
  --timezone=America/New_York ^
  --lang=en-US --accept-lang=en-US,en ^
  --proxy-server=socks5://1.2.3.4:1080 --socks5-credentials=user:pass ^
  --webrtc-ip=1.2.3.4 ^
  --fingerprint-location=40.7128,-74.0060 ^
  --fingerprint-tls-profile=chrome-151 ^
  --user-data-dir=D:\profiles\7423 ^
  --remote-debugging-port=9222
```

The SDK is the recommended way: it downloads and verifies the browser, builds the switches, and returns a
standard Playwright `Browser`:

```python
from clearcote import launch

browser = launch(fingerprint="user-7423", platform="windows")
```

See the [Python SDK](../../sdk/python/README.md), [Node SDK](../../sdk/node/README.md) and [.NET SDK](../../sdk/dotnet).
**Do not add stealth plugins** (`puppeteer-extra-plugin-stealth`, `playwright-stealth`); the values they patch
from JavaScript conflict with the engine persona.

---

## 14. Recommendations

1. **One identity = one seed + one profile directory.** The seed decides the machine; `--user-data-dir` holds cookies and storage.
2. **Prefer the persona over hand-set values.** Any hand-set value that disagrees with another surface gives you away; when unsure, let the persona choose.
3. **Set timezone, language, geolocation and `--webrtc-ip` from the proxy's exit IP.**
4. **Set screen and DPR together, and GPU vendor and renderer as a pair.**
5. **To look like an unmodified browser**, import a real capture with `--fingerprint-profile`, or add `--disable-fingerprint-noise`.
6. Run `--clearcote-validate-persona=current` to check that the persona your command line produces is coherent.

Use it only where you are authorised to, and follow the target sites' terms of service; see [DISCLAIMER.md](../../DISCLAIMER.md).
