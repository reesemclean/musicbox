/**
 * Player Updates
 * Download and install player updates.
 */

import {
  existsSync,
  readFileSync,
  mkdirSync,
  createWriteStream,
  rmSync,
  writeFileSync,
} from "fs";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";


const PLAYER_DIR = "/opt/musicbox/player";
const VERSION_FILE = `${PLAYER_DIR}/.version`;

/**
 * Get currently installed player version
 */
function getCurrentVersion(): string | null {
  if (existsSync(VERSION_FILE)) {
    return readFileSync(VERSION_FILE, "utf-8").trim();
  }
  return null;
}

/**
 * Ensure player is at the desired version
 * Returns true if player was updated
 */
export async function ensurePlayer(
  serverUrl: string,
  version: string,
  url: string,
  _checksum: string
): Promise<boolean> {
  const currentVersion = getCurrentVersion();

  if (currentVersion === version) {
    return false;
  }

  console.log(`Downloading player ${version}...`);

  // Build full URL
  const downloadUrl = url.startsWith("http") ? url : `${serverUrl}${url}`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download player: ${response.status}`);
  }

  const tarballPath = "/tmp/player.tar.gz";
  const writeStream = createWriteStream(tarballPath);

  if (!response.body) {
    throw new Error("No response body");
  }

  // Download tarball
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream),
    writeStream
  );

  // TODO: Verify checksum

  console.log(`Installing player ${version}...`);

  // Backup and remove old version
  if (existsSync(PLAYER_DIR)) {
    rmSync(PLAYER_DIR, { recursive: true });
  }
  mkdirSync(PLAYER_DIR, { recursive: true });

  // Extract tarball (contains pre-bundled player with all dependencies)
  execSync(`tar -xzf ${tarballPath} -C ${PLAYER_DIR}`, { stdio: "inherit" });

  // Write version file
  writeFileSync(VERSION_FILE, version);

  // Cleanup
  rmSync(tarballPath);

  return true;
}
