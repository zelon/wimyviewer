# How to Build


## Prequisition
```
cargo install create-tauri-app --locked
cargo install tauri-cli
```

``` apt in linux
sudo apt install -y \
  libcairo2-dev \
  libpango1.0-dev \
  libgdk-pixbuf2.0-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libssl-dev \
  librsvg2-dev \
  pkg-config
```

## Build and Development Run
```
cargo tauri dev
```

## Make release build
```
cargo tauri build
```

### Raw executable
```
./src-tauri/target/release/wimy-viewer.exe
```

# Shortcuts

## Keyboard
| Key | Action |
|---|---|
| `←` / `→` | Previous / next image |
| `Home` / `End` | First / last image |
| `1` | Actual size (100%) |
| `0` | Fit to window |
| `R` or `]` | Rotate 90° clockwise |
| `[` | Rotate 90° counterclockwise |
| `F`, `F11`, `Alt+Enter` | Toggle fullscreen |
| `Esc` | Close context menu / exit fullscreen |
| `Delete` | Delete current image |
| `F2` | Rename current image |
| `Alt+X`, `Ctrl+W`, `Ctrl+Q` | Quit |

## Mouse
| Input | Action |
|---|---|
| Wheel | Previous / next image |
| `Ctrl` + Wheel | Zoom in / out |
| Left drag | Pan (when the image is larger than the window) |
| Right click | Context menu |
