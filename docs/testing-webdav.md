# Testing WebDAV Backup on Your PC

This guide walks you through testing the WebDAV backup integration locally using a Docker-based WebDAV server.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed
- Hydra built and running from source (`yarn dev`)
- At least one game added to your Hydra library with save files detected by Ludusavi

---

## Step 1 — Start the local WebDAV server

From the root of the repository run:

```bash
docker compose up -d
```

This starts a lightweight WebDAV server at **http://localhost:8080** with:

| Field    | Value      |
|----------|------------|
| URL      | `http://localhost:8080` |
| Username | `hydra`    |
| Password | `hydra123` |

To check it is running:

```bash
docker compose ps
```

You should see the `webdav` container with status `Up`.

---

## Step 2 — Launch Hydra in development mode

```bash
yarn dev
```

---

## Step 3 — Configure WebDAV in Hydra

1. Open **Settings** (gear icon in the sidebar)
2. Go to the **Integrations** tab
3. Scroll down to the **WebDAV** section
4. Fill in the fields:
   - **Server URL** → `http://localhost:8080`
   - **Username** → `hydra`
   - **Password** → `hydra123`
   - **Backup path** → `/hydra-backups` *(or leave blank, this is the default)*
5. Click **Test connection**

You should see a success toast: *"WebDAV connection successful"*.

6. Click **Save changes**

---

## Step 4 — Trigger a manual backup

1. Open any game in your library that has save files
2. Click the three-dot menu → **Game options**
3. In the **Hydra Cloud** section, click **New backup**

> **Note:** The manual WebDAV upload button `uploadSaveGameToWebDav` is wired up as an IPC call. You can also trigger it from the DevTools console in the renderer window:
> ```js
> await window.electron.uploadSaveGameToWebDav("<objectId>", "steam", null)
> ```

---

## Step 5 — Verify the auto-backup on game close

1. Open any game that has `automaticCloudSync` enabled (toggle it on in **Game options → Hydra Cloud**)
2. Launch the game, play for a moment, then close it
3. Hydra will automatically bundle the save and upload it to WebDAV

---

## Step 6 — Inspect the uploaded files

List the backups stored on the WebDAV server:

```bash
docker compose exec webdav ls /var/lib/dav/data/hydra-backups/
```

Each game gets a sub-directory named `<shop>-<objectId>`, and each backup is a `.tar` file named `<hostname>_<timestamp>.tar`.

To extract and inspect a specific backup:

```bash
# Copy the tar out of the container
docker compose cp webdav:/var/lib/dav/data/hydra-backups/<game-dir>/<file>.tar /tmp/backup.tar

# Extract it
mkdir /tmp/backup-inspect && tar xf /tmp/backup.tar -C /tmp/backup-inspect
ls /tmp/backup-inspect/
```

---

## Stopping the test server

```bash
docker compose down
```

To also remove the stored backup data:

```bash
docker compose down -v
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "WebDAV connection failed" | Server not running | Run `docker compose up -d` |
| "WebDAV connection failed" | Wrong credentials | Double-check URL/username/password |
| "WebDAV not configured" in logs | Settings not saved | Click **Save changes** after filling the form |
| No backup file created | Ludusavi found no saves for the game | Check Hydra logs; game may have no detectable saves |
| Port 8080 already in use | Another service on 8080 | Edit `docker-compose.yml` and change `8080:80` to e.g. `8081:80`, then update the Server URL in settings |
