import axios from "axios";
import fs from "node:fs";
import os from "node:os";
import type { GameShop, UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { CloudSync } from "./cloud-sync";
import { Wine } from "./wine";

export class WebDavBackup {
  private static buildUrl(host: string, remotePath: string) {
    const base = host.endsWith("/") ? host.slice(0, -1) : host;
    const normalized = remotePath.startsWith("/")
      ? remotePath
      : `/${remotePath}`;
    return `${base}${normalized}`;
  }

  private static async ensureDirectory(
    host: string,
    remotePath: string,
    username: string,
    password: string
  ) {
    const url = this.buildUrl(host, remotePath);
    try {
      await axios.request({
        method: "MKCOL",
        url,
        auth: { username, password },
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 405,
      });
    } catch (err) {
      logger.warn(`WebDAV MKCOL failed for ${url}`, err);
    }
  }

  public static async testConnection(
    host: string,
    username: string,
    password: string
  ) {
    const url = host.endsWith("/") ? host : `${host}/`;
    await axios.request({
      method: "PROPFIND",
      url,
      auth: { username, password },
      headers: { Depth: "0" },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 207,
    });
  }

  public static isConfigured(preferences: UserPreferences | null) {
    return Boolean(
      preferences?.webDavHost &&
        preferences?.webDavUsername &&
        preferences?.webDavPassword
    );
  }

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    _downloadOptionTitle: string | null,
    label?: string
  ) {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;

    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const bundleLocation = await CloudSync.bundleBackup(
      shop,
      objectId,
      effectiveWinePrefixPath
    );

    try {
      await WebDavBackup.ensureDirectory(
        webDavHost!,
        location,
        webDavUsername!,
        webDavPassword!
      );

      await WebDavBackup.ensureDirectory(
        webDavHost!,
        gameDir,
        webDavUsername!,
        webDavPassword!
      );

      const timestamp = Date.now();
      const hostname = os.hostname();
      const safeLabel = label
        ? `_${label.replace(/[^a-z0-9_-]/gi, "_")}`.slice(0, 64)
        : "";
      const filename = `${hostname}_${timestamp}${safeLabel}.tar`;
      const uploadPath = `${gameDir}/${filename}`;
      const uploadUrl = WebDavBackup.buildUrl(webDavHost!, uploadPath);

      const fileBuffer = await fs.promises.readFile(bundleLocation);

      await axios.put(uploadUrl, fileBuffer, {
        auth: { username: webDavUsername!, password: webDavPassword! },
        headers: { "Content-Type": "application/octet-stream" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );

      logger.info(
        `WebDAV backup uploaded for ${shop}-${objectId}: ${uploadPath}`
      );
    } finally {
      try {
        await fs.promises.unlink(bundleLocation);
      } catch (err) {
        logger.error("Failed to remove WebDAV tar file", {
          bundleLocation,
          err,
        });
      }
    }
  }
}
