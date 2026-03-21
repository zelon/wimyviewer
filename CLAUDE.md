# CLAUDE.md — Tauri Image Viewer

## Project Overview

A fast desktop image viewer built with **Tauri (Rust + Web frontend)**.
Supports PSD, PNG, JPG, and other common image formats.
The core design goal is **instant navigation** via a sliding-window preload cache.

---

## Tech Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Backend   | Rust, Tauri v2                    |
| Frontend  | HTML + Vanilla JS (or React/Vue)  |
| Image decode | `image` crate, `psd` crate     |
| Parallelism | `rayon`                         |
| Encoding  | PNG via `image` crate             |

---

## Architecture

```
[Rust Backend]
  - File system access (read file list from directory)
  - Image decoding (PSD, PNG, JPG, etc.)
  - Parallel decoding via rayon
  - Emits "image-ready" events to frontend as each image completes

[Web Frontend]
  - Displays current image on a <canvas> element
  - Maintains a sliding-window cache: Map<index, ImageBitmap>
  - Requests preload of surrounding images on navigation
  - Renders from cache instantly on cache hit
```

---

## Core Features

### 1. Sliding Window Preload Cache
- On navigation to index N, preload indices [N-2 .. N+2]
- Cache stores `ImageBitmap` objects (GPU-uploaded, ready for instant draw)
- Evict cache entries outside the window to limit memory usage
- Preload radius is configurable (default: 2)

### 2. Rust Parallel Decoding
- Use `rayon::par_iter()` to decode multiple images concurrently
- Emit `image-ready` event per image as soon as it finishes (don't wait for all)
- Support formats: `.psd`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`

### 3. PSD Support
- Use the `psd` crate to extract RGBA pixel data
- Convert to PNG bytes using the `image` crate before sending to frontend

### 4. Canvas Rendering
- Use `<canvas>` + `createImageBitmap()` for GPU-optimized rendering
- `createImageBitmap()` pre-decodes blob → GPU upload happens off main thread
- `ctx.drawImage(bitmap, 0, 0)` is nearly instant after bitmap is ready

---

## Project Structure

```
project-root/
├── CLAUDE.md
├── src-tauri/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs          # Tauri app entry point
│   │   ├── commands.rs      # Tauri commands (load_directory, preload_images)
│   │   └── decoder.rs       # Image decoding logic (PSD, PNG, JPG, etc.)
└── src/                     # Web frontend
    ├── index.html
    ├── main.js              # App logic, cache management, navigation
    ├── cache.js             # SlidingWindowCache class
    └── renderer.js          # Canvas rendering helpers
```

---

## Tauri Commands (Rust → JS)

### `load_directory(dir_path: String) -> Vec<String>`
- Scans a directory and returns a list of image file paths
- Filters by supported extensions: psd, png, jpg, jpeg, webp, bmp, gif

### `preload_images(paths: Vec<String>) -> Result<(), String>`
- Accepts a list of file paths to decode
- Decodes in parallel using rayon
- For each completed image, emits `image-ready` event with `{ index, data: base64_png }`
- Does NOT wait for all images; events fire as each finishes

---

## Tauri Events (Rust → JS)

### `image-ready`
```ts
{
  index: number,   // position in the file list
  data: string,    // base64-encoded PNG data (no data URI prefix)
}
```

---

## Frontend Cache Logic

```
SlidingWindowCache:
  - cache: Map<number, ImageBitmap>
  - PRELOAD_RADIUS: number (default 2)

  navigate(index):
    1. If cache.has(index) → renderImage(cache.get(index))  // instant
    2. Else → show loading spinner, wait for image-ready event
    3. Call updateCache(index)

  updateCache(index):
    1. Compute needed = [index-R .. index+R] not in cache
    2. invoke("preload_images", { paths: needed.map(i => filePaths[i]) })
    3. Evict keys outside [index-R-1 .. index+R+1]

  on("image-ready", { index, data }):
    1. blob = base64 → Blob(image/png)
    2. bitmap = await createImageBitmap(blob)
    3. cache.set(index, bitmap)
    4. If index === currentIndex → renderImage(bitmap)
```

---

## Cargo.toml Dependencies

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
image = "0.25"
psd = "0.3"
rayon = "1"
base64 = "0.22"
```

---

## Coding Conventions

- Rust: standard `rustfmt` formatting, `clippy` clean
- All Tauri commands return `Result<T, String>` for error propagation
- Frontend: async/await throughout, no callbacks
- Cache indices are always validated against `filePaths.length` bounds
- All image paths are absolute paths (resolved on directory load)

---

## Performance Goals

| Operation           | Target         |
|---------------------|----------------|
| Cache hit display   | < 5ms          |
| Single image decode | < 200ms        |
| Preload N=5 images  | < 500ms (parallel) |

---

## Known Constraints

- PSD decoding flattens all layers (composite result only)
- Very large PSD files (>100MB) may cause high memory usage — consider limiting cache size
- `createImageBitmap()` is async; avoid blocking the main thread during preload
