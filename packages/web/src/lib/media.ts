/**
 * Which file to actually play for a media item.
 *
 * Every item keeps its original as ingested (`filePath`) plus, when the
 * original isn't in the canonical encoding, a derivative (`normalizedPath`).
 * Playback and streaming always want the canonical one; the original exists so
 * the library keeps an archival copy at full quality and so derivatives can be
 * regenerated if the canonical format ever changes.
 *
 * The stored audioBytes/sampleRate/channels always describe *this* file, not
 * the original, because that's what the playlist stream concatenates.
 */
export function playablePath(item: {
  filePath: string
  normalizedPath?: string | null
}): string {
  return item.normalizedPath || item.filePath
}

/** Every file on disk belonging to an item — originals and derivatives. */
export function ownedPaths(item: {
  filePath: string
  normalizedPath?: string | null
}): string[] {
  const paths = [item.filePath]
  if (item.normalizedPath && item.normalizedPath !== item.filePath) {
    paths.push(item.normalizedPath)
  }
  return paths.filter(Boolean)
}

/** Directory (relative to DATA_DIR) holding canonical derivatives. */
export const NORMALIZED_DIR = 'normalized'
