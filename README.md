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
