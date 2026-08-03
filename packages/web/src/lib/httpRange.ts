/**
 * Parse a single-range HTTP `bytes=` header against a known file size.
 *
 * Returns null for anything malformed or unsatisfiable, so the caller can
 * answer 416 rather than serving wrong bytes or computing a negative
 * Content-Length.
 */
export function parseRange(
  header: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match

  // Neither side specified: "bytes=-" is malformed.
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number

  if (rawStart === '') {
    // Suffix form: last N bytes.
    const suffixLength = parseInt(rawEnd, 10)
    if (suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = parseInt(rawStart, 10)
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= size) return null
  if (end < start) return null

  // Clamp a range that runs past EOF rather than rejecting it.
  if (end >= size) end = size - 1

  return { start, end }
}
