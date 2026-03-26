import axios from "axios";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type {
  GameShop,
  LudusaviBackupMapping,
  UserPreferences,
  WebDavBackupEntry,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { CloudSync } from "./cloud-sync";
import { Wine } from "./wine";
import { backupsPath, publicProfilePath } from "@main/constants";
import { addTrailingSlash, normalizePath } from "@main/helpers";
import YAML from "yaml";

const transformBackupPathIntoWindowsPath = (
  backupPath: string,
  winePrefixPath?: string | null
) => {
  return backupPath
    .replace(winePrefixPath ? addTrailingSlash(winePrefixPath) : "", "")
    .replace("drive_c", "C:");
};

const addWinePrefixToWindowsPath = (
  windowsPath: string,
  winePrefixPath?: string | null
) => {
  if (!winePrefixPath) {
    return windowsPath;
  }
  return path.join(winePrefixPath, windowsPath.replace("C:", "drive_c"));
};

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

  private static parsePropfindListing(xml: string): WebDavBackupEntry[] {
    const entries: WebDavBackupEntry[] = [];

    const responseRegex =
      /<[^:>\s]+:response\b[^>]*>([\s\S]*?)<\/[^:>\s]+:response>/gi;

    let match: RegExpExecArray | null;
    while ((match = responseRegex.exec(xml)) !== null) {
      const block = match[1];

      // Skip directories
      if (/<[^:>\s]+:collection\b/i.test(block)) continue;

      const hrefMatch = block.match(
        /<[^:>\s]+:href[^>]*>([\s\S]*?)<\/[^:>\s]+:href>/i
      );
      if (!hrefMatch) continue;

      const href = hrefMatch[1].trim();

      // Only include .tar files
      if (!href.endsWith(".tar")) continue;

      const filename = href.split("/").pop() ?? href;

      const sizeMatch = block.match(
        /<[^:>\s]+:getcontentlength[^>]*>([\s\S]*?)<\/[^:>\s]+:getcontentlength>/i
      );
      const sizeInBytes = sizeMatch ? parseInt(sizeMatch[1].trim()) || 0 : 0;

      const modifiedMatch = block.match(
        /<[^:>\s]+:getlastmodified[^>]*>([\s\S]*?)<\/[^:>\s]+:getlastmodified>/i
      );
      const createdAt = modifiedMatch ? modifiedMatch[1].trim() : "";

      entries.push({ href, filename, sizeInBytes, createdAt });
    }

    return entries.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  private static restoreBackup(
    backupPath: string,
    objectId: string,
    homeDir: string,
    winePrefixPath?: string | null
  ) {
    const gameBackupPath = path.join(backupPath, objectId);
    const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

    const data = fs.readFileSync(mappingYamlPath, "utf8");
    const manifest = YAML.parse(data) as {
      backups: LudusaviBackupMapping[];
      drives: Record<string, string>;
    };

    const userProfilePath =
      CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

    manifest.backups.forEach((backup) => {
      Object.keys(backup.files).forEach((key) => {
        const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
          (prev, [driveKey, driveValue]) => {
            return prev.replace(driveValue, driveKey);
          },
          key
        );

        const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);

        logger.info(`WebDAV restore source path: ${sourcePath}`);

        const destinationPath = transformBackupPathIntoWindowsPath(
          key,
          winePrefixPath
        )
          .replace(
            homeDir,
            addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
          )
          .replace(
            publicProfilePath,
            addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
          );

        logger.info(`WebDAV restore destination path: ${destinationPath}`);

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

        if (fs.existsSync(destinationPath)) {
          fs.unlinkSync(destinationPath);
        }

        fs.renameSync(sourcePath, destinationPath);
      });
    });
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

  public static async listBackups(
    objectId: string,
    shop: GameShop
  ): Promise<WebDavBackupEntry[]> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      return [];
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;

    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;
    const url = WebDavBackup.buildUrl(webDavHost!, gameDir);

    const response = await axios.request({
      method: "PROPFIND",
      url,
      auth: { username: webDavUsername!, password: webDavPassword! },
      headers: { Depth: "1", "Content-Type": "application/xml" },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 207 || status === 404,
    });

    if (response.status === 404) return [];

    return WebDavBackup.parsePropfindListing(response.data as string);
  }

  public static async downloadAndRestoreBackup(
    objectId: string,
    shop: GameShop,
    href: string
  ): Promise<void> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword } = preferences!;

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const homeDir = normalizePath(
      CloudSync.getWindowsLikeUserProfilePath(effectiveWinePrefixPath)
    );

    const downloadUrl = WebDavBackup.buildUrl(webDavHost!, href);

    const filename = href.split("/").pop() ?? `${objectId}.tar`;
    const zipLocation = path.join(backupsPath, filename);
    const backupRestorePath = path.join(backupsPath, `${shop}-${objectId}`);

    if (fs.existsSync(backupRestorePath)) {
      fs.rmSync(backupRestorePath, { recursive: true, force: true });
    }

    try {
      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        auth: { username: webDavUsername!, password: webDavPassword! },
        onDownloadProgress: (progressEvent) => {
          WindowManager.mainWindow?.webContents.send(
            `on-webdav-backup-download-progress-${objectId}-${shop}`,
            progressEvent
          );
        },
      });

      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(zipLocation);
        response.data.pipe(writer);
        writer.on("error", reject);
        writer.on("close", resolve);
      });

      fs.mkdirSync(backupRestorePath, { recursive: true });

      await tar.x({ file: zipLocation, cwd: backupRestorePath });

      WebDavBackup.restoreBackup(
        backupRestorePath,
        objectId,
        homeDir,
        effectiveWinePrefixPath
      );

      WindowManager.mainWindow?.webContents.send(
        `on-webdav-backup-download-complete-${objectId}-${shop}`,
        true
      );

      logger.info(
        `WebDAV backup restored for ${shop}-${objectId} from ${href}`
      );
    } catch (err) {
      logger.error("Failed to download/restore WebDAV backup", err);

      WindowManager.mainWindow?.webContents.send(
        `on-webdav-backup-download-complete-${objectId}-${shop}`,
        false
      );
    } finally {
      try {
        if (fs.existsSync(zipLocation)) {
          await fs.promises.unlink(zipLocation);
        }
      } catch (err) {
        logger.error("Failed to remove WebDAV restore tar file", {
          zipLocation,
          err,
        });
      }
    }
  }

  public static async deleteBackup(
    _objectId: string,
    _shop: GameShop,
    href: string
  ): Promise<void> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword } = preferences!;

    const deleteUrl = WebDavBackup.buildUrl(webDavHost!, href);

    const response = await axios.request({
      method: "DELETE",
      url: deleteUrl,
      auth: { username: webDavUsername!, password: webDavPassword! },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    });

    if (response.status === 404) {
      throw new Error("WebDAV backup not found");
    }
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
