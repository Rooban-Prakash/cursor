# File Manager Widget

A compact desktop file and directory management widget built with **HTML**, **CSS**, **JavaScript**, and **Tauri**.

## Features

- **Quick Access** — pinned locations (Desktop, Documents, Downloads, Pictures, Music, Videos, Home)
- **Recent Files** — recently modified files from common folders
- **Desktop** — live listing with file/folder counts in the tab label (e.g. `Desktop — 8 files · 3 folders`)
- **Preview** — inspect selected files and folders (metadata, text preview, folder contents)
- Double-click any item to open it with the system default app
- Refresh button to reload all tabs

## Prerequisites

1. [Node.js](https://nodejs.org/) (v18+)
2. [Rust](https://rustup.rs/) — required for Tauri
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — required on Windows for Rust/Tauri

Install Rust:

```powershell
winget install Rustlang.Rustup
```

Restart your terminal after installing Rust, then verify:

```powershell
rustc --version
cargo --version
```

## Setup & Run

```powershell
cd file-manager
npm install
npm run dev
```

## Build

```powershell
npm run build
```

The installer/executable will be in `src-tauri/target/release/bundle/`.

## Usage

| Action | How |
|--------|-----|
| Switch tabs | Click **Quick Access**, **Recent Files**, **Desktop**, or **Preview** |
| Select item | Single-click a file or folder |
| Open item | Double-click, or select then click **Open** in Preview |
| Preview | Select any item, then switch to the **Preview** tab |
| Browse a location | Double-click a Quick Access entry |
| Refresh | Click the refresh icon in the header |

## Project Structure

```
file-manager/
├── src/                  # Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── styles.css
│   └── main.js
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── lib.rs        # File system commands
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## Icons

To generate app icons from a source image (512×512 PNG recommended):

```powershell
npm run tauri icon path/to/your-icon.png
```
