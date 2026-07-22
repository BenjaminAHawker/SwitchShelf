# SwitchShelf

A self-hosted web app for browsing [blawar/titledb](https://github.com/blawar/titledb) by region, and for matching a local Nintendo Switch title library against it.

> **Note:** This is a personal-use project, built because I couldn't find an existing tool that did exactly what I wanted. It was built with heavy use of AI assistance and reviewed personally by me, but it has not been professionally audited. **Use at your own risk** — especially the Library Scan "Organize" feature, which renames and moves files on your filesystem.

## What it does

- Syncs region catalog files (and the DLC/update metadata file) from `blawar/titledb` on demand, only downloading what you select.
- Search/browse titles by name or nsuId, with filters for platform (Switch / Switch 2), content type (games vs. DLC/updates/demos), language, and ownership.
- Per-title details page: full metadata, screenshots, matched demos, and related DLC/updates.
- **Library Scan**: point the app at a local folder of `.nsp`/`.nsz`/`.xci`/`.xcz` files, match each one against titledb by the title ID in its filename, and manually accept/reject/override each match.
- **Organize**: for accepted matches, preview and optionally apply a rename/move into `<Title> [<TitleId>]/` folders with cleaned-up filenames.

## Screenshots

The main search page — region/DLC sync controls, name/nsuId search, platform/content-type/ownership/language filters, and results:

![Main search page](screenshots/main-region-default.png)

Same page on mobile:

<img src="screenshots/main-region-default-mobile.png" alt="Main search page on mobile" width="400" />

## Requirements

- Docker and Docker Compose

## Setup

1. Copy the env file and point it at your title library (optional — only needed for Library Scan):
   ```sh
   cp .env.example .env
   # edit .env and set TITLES_HOST_DIR to your local folder
   ```
2. Build and start:
   ```sh
   docker compose up -d --build
   ```
3. Open `http://localhost:3000`.

The titles folder is mounted **read-write**, since the Organize feature needs to rename/move files in place. If you don't want that, don't use Organize, or point `TITLES_HOST_DIR` at a copy of your library instead of the original.

## Project layout

- `server.js` — Express app and API routes.
- `lib/` — sync (titledb downloads), store (search/filtering), scanner (local file matching), decisions (accept/reject state), organize (rename/move planning), cnmts (DLC/update relationships).
- `public/` — static frontend (search page, details page, library scan page).
- `data/` — downloaded titledb files and app state (gitignored, persisted in a Docker volume).
- `test/` — unit tests for the `lib/` modules (Node's built-in test runner, no extra dependencies).

## Tests

```sh
npm test
```

Runs the `lib/` unit tests (sync, store, cnmts, decisions, scanner, organize) with `node --test`. Each test file uses an isolated temp directory, so nothing touches your real `data/` or title library. Network calls in the sync tests are mocked — no real requests to GitHub are made.

## Disclaimer

This tool does not host, distribute, or provide any game files. It only reads metadata from the public `blawar/titledb` repository and matches it against filenames already present in a folder you point it at. You are responsible for the legality of any files in that folder.
