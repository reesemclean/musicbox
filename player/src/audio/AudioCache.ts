/**
 * AudioCache - Local caching for audio files
 *
 * Downloads songs to local storage for faster playback and reduced network load.
 * Prefetches upcoming songs in the playlist to minimize latency.
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const CACHE_DIR = "/var/cache/musicbox";
const MAX_CACHE_SIZE_MB = 5000; // 5GB cache limit - keeps ~1000+ songs

interface CacheEntry {
  songId: number;
  filePath: string;
  downloading: boolean;
  downloadPromise?: Promise<string | null>;
}

export class AudioCache {
  private cache = new Map<number, CacheEntry>();
  private initialized = false;

  /**
   * Initialize the cache directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create cache directory if it doesn't exist
    if (!existsSync(CACHE_DIR)) {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
      } catch (err) {
        console.log(`   ⚠️  Could not create cache directory: ${err}`);
        return;
      }
    }

    // Scan existing cached files
    try {
      const files = readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith(".mp3") || file.endsWith(".m4a") || file.endsWith(".opus")) {
          const songId = parseInt(file.split(".")[0], 10);
          if (!isNaN(songId)) {
            this.cache.set(songId, {
              songId,
              filePath: join(CACHE_DIR, file),
              downloading: false,
            });
          }
        }
      }
      console.log(`   💾 Audio cache initialized (${this.cache.size} songs cached)`);
    } catch (err) {
      console.log(`   ⚠️  Could not scan cache directory: ${err}`);
    }

    this.initialized = true;
  }

  /**
   * Get the local path for a song, downloading if necessary
   * @param songId - The song's database ID
   * @param streamUrl - The URL to download from
   * @returns Local file path, or null if download failed
   */
  async getLocalPath(songId: number, streamUrl: string): Promise<string | null> {
    await this.initialize();

    const entry = this.cache.get(songId);

    // Already cached
    if (entry && !entry.downloading && existsSync(entry.filePath)) {
      return entry.filePath;
    }

    // Currently downloading - wait for it
    if (entry?.downloading && entry.downloadPromise) {
      return entry.downloadPromise;
    }

    // Need to download
    return this.download(songId, streamUrl);
  }

  /**
   * Check if a song is cached (without downloading)
   */
  isCached(songId: number): boolean {
    const entry = this.cache.get(songId);
    return !!entry && !entry.downloading && existsSync(entry.filePath);
  }

  /**
   * Get the cached file path for a song (sync - returns null if not cached)
   */
  getCachedPath(songId: number): string | null {
    const entry = this.cache.get(songId);
    if (entry && !entry.downloading && existsSync(entry.filePath)) {
      return entry.filePath;
    }
    return null;
  }

  /**
   * Prefetch songs in the background
   * @param songs - Array of {songId, streamUrl} to prefetch
   */
  prefetch(songs: Array<{ songId: number; streamUrl: string }>): void {
    for (const song of songs) {
      if (!this.isCached(song.songId)) {
        // Fire and forget - don't await
        this.download(song.songId, song.streamUrl).catch(() => {
          // Ignore prefetch failures
        });
      }
    }
  }

  /**
   * Download a song to the cache
   */
  private async download(songId: number, streamUrl: string): Promise<string | null> {
    // Determine file extension from URL or default to opus
    let ext = ".opus";
    if (streamUrl.includes(".mp3")) ext = ".mp3";
    else if (streamUrl.includes(".m4a")) ext = ".m4a";

    const filePath = join(CACHE_DIR, `${songId}${ext}`);

    // Create entry to track download
    const entry: CacheEntry = {
      songId,
      filePath,
      downloading: true,
    };

    const downloadPromise = this.doDownload(songId, streamUrl, filePath, entry);
    entry.downloadPromise = downloadPromise;
    this.cache.set(songId, entry);

    return downloadPromise;
  }

  /**
   * Perform the actual download
   */
  private async doDownload(
    songId: number,
    streamUrl: string,
    filePath: string,
    entry: CacheEntry
  ): Promise<string | null> {
    const tempPath = `${filePath}.tmp`;

    try {
      console.log(`   📥 Caching song ${songId}...`);

      const response = await fetch(streamUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Stream to temp file
      const writeStream = createWriteStream(tempPath);
      await pipeline(Readable.fromWeb(response.body as any), writeStream);

      // Rename temp to final (atomic operation)
      const { renameSync } = await import("fs");
      renameSync(tempPath, filePath);

      entry.downloading = false;
      entry.downloadPromise = undefined;

      console.log(`   ✅ Cached song ${songId}`);

      // Run cleanup in background if we're over the limit
      this.cleanup().catch(() => {});

      return filePath;
    } catch (err) {
      // Clean up temp file
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      entry.downloading = false;
      entry.downloadPromise = undefined;
      this.cache.delete(songId);

      console.log(`   ⚠️  Failed to cache song ${songId}: ${err}`);
      return null;
    }
  }

  /**
   * Clean up old cache entries if over size limit
   */
  async cleanup(): Promise<void> {
    if (!this.initialized) return;

    try {
      const files = readdirSync(CACHE_DIR);
      let totalSize = 0;
      const fileStats: Array<{ file: string; path: string; size: number; mtime: number }> = [];

      for (const file of files) {
        const path = join(CACHE_DIR, file);
        const stat = statSync(path);
        totalSize += stat.size;
        fileStats.push({ file, path, size: stat.size, mtime: stat.mtimeMs });
      }

      const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
      if (totalSize > maxBytes) {
        // Sort by oldest first
        fileStats.sort((a, b) => a.mtime - b.mtime);

        // Delete oldest until under limit
        for (const entry of fileStats) {
          if (totalSize <= maxBytes * 0.8) break; // Target 80% capacity

          try {
            unlinkSync(entry.path);
            totalSize -= entry.size;

            const songId = parseInt(entry.file.split(".")[0], 10);
            if (!isNaN(songId)) {
              this.cache.delete(songId);
            }
          } catch {
            // Ignore deletion errors
          }
        }

        console.log(`   🧹 Cache cleanup complete`);
      }
    } catch (err) {
      console.log(`   ⚠️  Cache cleanup failed: ${err}`);
    }
  }
}
