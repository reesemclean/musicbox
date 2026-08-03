import { describe, expect, it } from 'vitest'
import { parseRange } from './httpRange'

const SIZE = 1000

describe('parseRange', () => {
  it('parses a fully specified range', () => {
    expect(parseRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 })
    expect(parseRange('bytes=500-999', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('treats an open end as "to EOF"', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('handles the suffix form as "last N bytes"', () => {
    expect(parseRange('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 })
  })

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past EOF rather than rejecting', () => {
    expect(parseRange('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=0-99  ', SIZE)).toEqual({ start: 0, end: 99 })
  })

  // Everything below must be rejected so the caller can answer 416 rather
  // than serving wrong bytes or computing a negative Content-Length.
  it('rejects a start at or past EOF', () => {
    expect(parseRange('bytes=1000-', SIZE)).toBeNull()
    expect(parseRange('bytes=1500-1600', SIZE)).toBeNull()
  })

  it('rejects an inverted range', () => {
    expect(parseRange('bytes=500-100', SIZE)).toBeNull()
  })

  it('rejects malformed headers', () => {
    expect(parseRange('bytes=-', SIZE)).toBeNull()
    expect(parseRange('bytes=abc-def', SIZE)).toBeNull()
    expect(parseRange('items=0-99', SIZE)).toBeNull()
    expect(parseRange('0-99', SIZE)).toBeNull()
    expect(parseRange('', SIZE)).toBeNull()
  })

  it('rejects multi-range requests rather than serving only the first part', () => {
    expect(parseRange('bytes=0-99,200-299', SIZE)).toBeNull()
  })

  it('rejects a zero-length suffix', () => {
    expect(parseRange('bytes=-0', SIZE)).toBeNull()
  })
})
