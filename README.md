# Butterfly Effect — Self-Implemented Glyph Dither Video Engine

A watermark-free, browser-native video post-effect system built with three.js. Replicates the Unicorn Studio "Glyph Dither" composition without any external service dependency.

## How to start

This project uses ES modules (`<script type="module">`), which require an HTTP server — you cannot open `app.html` directly via `file://`.

**Option A — Python (from the project root):**

```bash
python -m http.server 8765
```

Then open: `http://localhost:8765/app.html`

**Option B — any static server** also works (`npx serve`, `php -S localhost:8765`, VS Code Live Server, etc.). Just serve this folder over HTTP and open `app.html`.

**Option C — Claude Code MCP preview:** If you use the Claude Code CLI, wire up a `butterfly-effect` entry in `.claude/launch.json` pointing at a local static server, then run `preview_start("butterfly-effect")`.

## How to swap the video

Three ways — all work while the effect is running:

1. **Drag and drop** a `.mp4` / `.webm` / `.mov` file onto the page.
2. **Choose video** button (top-left) → file picker.
3. **Paste a URL** into the URL field → press Enter or click Load.

The default demo video is a Firebase-hosted clip from the original Unicorn Studio project. If it fails (CORS), use a local file instead.

## Layer parameters

### Video
| Param | Effect |
|---|---|
| Scale | Zoom the video inside the canvas (1 = fit, 1.4 = crop in) |
| Rotation | Rotate the video layer in degrees |
| Opacity | Fade the video before it enters the effect chain |
| Displace | Adds a subtle sine-wave warp to the UV coordinates |
| Exposure | EV stops offset — each +1 doubles brightness |
| Saturation | 0 = greyscale, 1 = original, 2 = vivid |
| Contrast | S-curve contrast; 1 = flat, 2 = strong contrast |
| Playback Speed | Multiplies `currentTime` advance rate |

### Blocks
| Param | Effect |
|---|---|
| Color 1 / Color 2 | Two hues interpolated per cell by Variance |
| Density | Grid cells across the short axis |
| Size | Tile fill fraction (negative = gap, positive = bleed) |
| Spread | Edge softness (antialiasing width of tile boundary) |
| Variance | How many cells are dark/silent vs. lit |
| Skew | Horizontal shear applied to the grid |
| Angle | Overall grid rotation in degrees |
| Opacity | Layer opacity before blend |
| Blend | Normal / Difference / Multiply / Screen / Soft Light |
| Speed | Animation rate (grid hash updates per second) |

### Glyph Dither
| Param | Effect |
|---|---|
| Preset | Quick-select a character set (Redacted, ASCII, Blocks, …) |
| Characters | Custom string — edit directly; atlas re-bakes live |
| Scale | Tile size in pixels (each tile = one character cell) |
| Gamma | Luminance curve: < 1 biases toward bright chars, > 1 biases dark |
| Phase | Horizontal atlas scroll — creates an animation shimmer |
| Mix | Crossfade between raw video and the dithered result |
| Color mode | Monochrome (uses Color swatch) vs. Color (video hue) |
| Background | Solid black behind each glyph vs. video pass-through |
| Color | Foreground glyph color in Monochrome mode |
| Opacity | Alpha of the Color swatch (multiplies with Mix) |
| Invert | Reverses luminance → character mapping |

### Blob Tracking
| Param | Effect |
|---|---|
| Max blobs | How many motion blobs to track simultaneously |
| Threshold | Luminance cutoff for blob detection (0–100) |
| Smoothing | EMA smoothing — higher = more lag but less jitter |
| Persistence | Frames a blob survives without a match before being dropped |
| Mix | Opacity of the blob overlay layer |
| Blend | Blend mode with the previous pass |
| Size | Blob dot radius (in UV-fraction units) |
| Fill | Fill amount vs. ring/outline (0 = outline, 100 = solid) |
| Color | Blob color |
| Line width | Connector line width |
| Connector type | None / Loop Straight / Dotted |
| Max distance | Maximum UV distance before two blobs skip a connector |

### Fast Bloom
| Param | Effect |
|---|---|
| Threshold | Luminance below which pixels don't bloom |
| Strength | How bright the bloom halo is |
| Radius | Spread radius of the bloom |

## File layout

```
app.html               Entry point (import map + canvas + upload UI)
src/
  main.js              Renderer, EffectComposer, GUI, animation loop
  ui/
    uploader.js        Drag/drop + file picker + URL input → HTMLVideoElement
  passes/
    videoPass.js       Video layer: exposure, saturation, contrast, scale, rotate
    blocksPass.js      Procedural grid layer with blend modes
    glyphDitherPass.js Atlas-baked character dither shader
    blobTrackingPass.js CPU blob detection + GPU dot/connector renderer
index.html             Original Unicorn Studio embed (kept for visual comparison)
```
