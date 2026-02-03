# Admin (Tauri v2)

Minimal Tauri v2 desktop app scaffold for the admin UI. The frontend is a tiny static page in `frontend/`.

## Prerequisites

- Rust toolchain (stable)
- Node.js + pnpm

## Run (dev)

Tauri v2 requires a dev server URL. We use Vite to serve `frontend/` and Tauri is configured to
start it automatically.

```bash
cd apps/admin
pnpm install
pnpm tauri:dev
```

## Build (release)

```bash
cd apps/admin
pnpm install
pnpm tauri:build
```

## Notes

- Vite config lives at `apps/admin/vite.config.js` (root = `frontend/`, build output = `dist/`).
- Tauri config is `apps/admin/src-tauri/tauri.conf.json` with:
  - `build.beforeDevCommand = pnpm dev`
  - `build.beforeBuildCommand = pnpm build`
  - `build.devUrl = http://127.0.0.1:5173`
  - `build.frontendDist = ../dist`

