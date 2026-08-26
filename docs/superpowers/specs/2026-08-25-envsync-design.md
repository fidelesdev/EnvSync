# EnvSync — Design Spec

**Date:** 2026-08-25  
**Status:** Approved for planning (pending user review of this file)  
**Working name:** `envsync`

## Problem

Between a BigLinux desktop and a BigLinux notebook, environments drift: folders, environment variables, CLI tools, UI apps, and their configs diverge. Manual alignment is slow and error-prone.

## Goal

A LAN peer-to-peer sync app with an intuitive GUI where the user selects **what** to sync at **group** or **item** level (e.g. entire CLI group, or only Chrome + its config), reviews a plan, and only then applies changes—with interactive conflict resolution and backups.

## Success criteria

On the same day, on two BigLinux machines on the same LAN: select “CLI + Chrome” on one side, review the plan on the other (or the initiator), confirm, and have packages/configs applied without surprise overwrites—with a restorable backup if something goes wrong.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Transport | LAN peer-to-peer only |
| Conflicts | Ask in UI per conflict (keep local / accept remote / skip) |
| MVP scope | Configs, folders, env vars, and packages with automatic install |
| Trust | Mutual certificates (SSH/cert-style pairing) |
| UI | Electron + web UI (React + TypeScript) |
| Runtime | Background daemon always listening (`systemd --user`) |
| Architecture | Separate daemon + Electron client + catalog/plugins |
| Apply safety | **No apply without explicit plan confirmation** |

## Architecture

### Processes

1. **`envsyncd` (daemon)** — `systemd --user` service  
   - LAN discovery (mDNS, service `envsync._tcp`)  
   - Mutual TLS authentication after certificate pairing  
   - Local inventory for catalog items  
   - Transfer and apply (packages, files, env)  
   - Sync queue and peer presence state  

2. **`envsync` (Electron UI)** — talks to local daemon only  
   - Unix domain socket + JSON-RPC (or equivalent local IPC)  
   - Catalog tree (groups → items), plan review, conflicts, activity  

```
UI (Electron) ──IPC──► envsyncd (local)
                           │  LAN + mutual TLS
                           ▼
                      envsyncd (peer) ──IPC──► peer UI (if conflict / confirm needed)
```

### Monorepo layout

- `apps/ui` — Electron + React + TypeScript  
- `apps/daemon` — Node.js + TypeScript daemon  
- `packages/catalog` — group/item types and catalog I/O  
- `packages/protocol` — IPC and peer wire messages  
- `packages/plugins-*` — pacman, AUR, flatpak, files, env  

### Persistence

Under `~/.local/share/envsync/`:

- device identity + trusted peer certificates  
- catalog overlays / user custom items  
- last selection + presets  
- sync logs  
- timestamped backups before destructive applies: `backups/`  

## Catalog model

### Group

Named collection (e.g. `cli`, `ui`, `dotfiles`, `folders`, `env`) with label, icon, and child items. Checking a group selects/deselects all children.

### Item

Smallest sync unit (e.g. `chrome`), with:

- `id`, `label`, `groupId`  
- **providers** (what actually syncs), for example:  
  - `package`: `{ manager: "pacman" | "aur" | "flatpak" | "appimage", name: "..." }`  
  - `paths`: list of paths with optional excludes (caches, etc.)  
  - `env`: specific keys or managed snippets (not blind whole-shell overwrite by default)  

### UI item states

| State | Meaning |
|-------|---------|
| Equal | Nothing to do |
| Only local | Offer send / install on peer |
| Only peer | Offer pull / install here |
| Different | Conflict queue |
| Unselected | Ignored this session |

### Discovery

Daemon scans installed packages and known config paths and **suggests** catalog entries. User confirms/edits. Custom folders are added in the UI.

### Selection persistence

Remember last selection; support named presets (e.g. “tools only”, “browsers”).

## Sync flow

1. User selects groups/items.  
2. On “Sync”, local daemon requests peer inventory for **selected** items only.  
3. Compare metadata (package version, path mtime+hash, env key fingerprint).  
4. Build a **plan**: install / copy / skip / conflict.  
5. **UI shows the plan; user must Confirmar before any write.**  
6. Execute in safe order: packages → config files → folders → env.  
7. Before each destructive local change: write backup under `backups/`.  
8. Final report + persistent log.

### Confirmation rule (hard)

- No peer write and no local overwrite without an explicit confirmed plan for that session.  
- Accepting a conflict resolution still counts as an explicit action for that item.  
- Daemon may detect drift in the background; it must **not** auto-apply.

### Conflicts

- Per-item card: local vs remote summary (size, dates; textual diff for small files).  
- Actions: keep local | accept remote | skip.  
- Default: non-conflicting items may proceed while conflicts wait in queue (user can also choose “pause until all conflicts resolved” in UI if offered later; MVP default is continue-with-queue).  

### Errors

- Peer drops mid-session → pause; resume same plan when peer returns (still requires confirmation if plan is regenerated).  
- Package failure → mark item failed; do not abort entire session.  
- Auth failure → block sync; require re-pairing.  

## Security

- First pairing: exchange certificate fingerprints; user confirms once on both sides.  
- Afterwards: mutual TLS on the LAN channel; only trusted peers sync.  
- Untrusted peers: discovery may show them; sync is refused until paired.  

## UI screens

1. **Devices** — peers, online status, cert fingerprint, pair/unpair  
2. **Catalog** — group/item tree, filters, presets  
3. **Sync plan** — proposed actions; mandatory **Confirmar**  
4. **Conflicts** — queue of cards  
5. **Activity** — progress, history, restore-from-backup entry point  

System tray: daemon status, peer online, pending confirmation indicator.

## Plugins (MVP)

Shared interface per plugin family: `detect`, `diff`, `apply` (and backup hook where applicable).

| Plugin | Role |
|--------|------|
| pacman | Official packages |
| aur | yay/paru when present |
| flatpak | Flatpak apps |
| appimage | Path/copy registration (no store install) |
| files | Config/folder sync with excludes |
| env | Selected keys / managed env snippets |

Sensitive browser data (cookies, login DBs) is **opt-in**, not default paths for Chrome-like items.

## Testing

- Unit: inventory compare, plan builder, plugin hash/env helpers  
- Integration: UI ↔ daemon IPC (plan → confirm → mocked apply)  
- Plugin contract tests with fixtures  
- Manual E2E on BigLinux: two machines or two isolated daemon instances on one host  

## Out of scope (MVP)

- Cloud / off-LAN sync  
- Unattended apply (no confirmation)  
- Rich visual diff (meld-style); MVP uses summary + small-file text diff  
- Windows / macOS  
- Default sync of hot credentials (browser logins, etc.)  

## Open naming

Working name `envsync` may be renamed before public release; code layout should keep the name replaceable (package scope / product string centralized).
