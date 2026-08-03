import { describe, expect, it } from 'vitest'
import {
  decodeTrackAnnouncement,
  encodeTrackAnnouncement,
  icyMetadataBlock,
  ICY_EMPTY_BLOCK,
} from './icy'

/** Parse a block the way a client does: length byte, then payload. */
function readBlock(block: Buffer) {
  const blocks = block[0]
  const payload = block.toString('latin1', 1, 1 + blocks * 16).replace(/\0+$/, '')
  return { blocks, payload, totalLength: 1 + blocks * 16 }
}

describe('icyMetadataBlock', () => {
  it('declares its length in 16-byte units', () => {
    const block = icyMetadataBlock('101|Track One')
    const { blocks, totalLength } = readBlock(block)

    // "StreamTitle='101|Track One';" is 28 bytes -> 2 units.
    expect(blocks).toBe(2)
    expect(totalLength).toBe(33)
    expect(block.length).toBe(33)
  })

  it('round-trips the title through the StreamTitle field', () => {
    const { payload } = readBlock(icyMetadataBlock('42|Hello World'))
    expect(payload).toBe("StreamTitle='42|Hello World';")
  })

  it('pads to a whole number of 16-byte units', () => {
    for (const title of ['a', 'ab'.repeat(20), 'x'.repeat(100)]) {
      const block = icyMetadataBlock(title)
      expect((block.length - 1) % 16).toBe(0)
      expect(block.length).toBe(1 + block[0] * 16)
    }
  })

  it('strips single quotes, which the format cannot escape', () => {
    const { payload } = readBlock(icyMetadataBlock("1|Don't Stop"))
    expect(payload).toBe("StreamTitle='1|Dont Stop';")
    // Exactly two quotes: the delimiters.
    expect(payload.split("'").length - 1).toBe(2)
  })

  it('zero-pads rather than leaving uninitialised bytes', () => {
    const block = icyMetadataBlock('short')
    const payloadLen = "StreamTitle='short';".length
    expect(block.subarray(1 + payloadLen).every((b) => b === 0)).toBe(true)
  })
})

describe('ICY_EMPTY_BLOCK', () => {
  it('is a single zero byte meaning "unchanged"', () => {
    expect(ICY_EMPTY_BLOCK.length).toBe(1)
    expect(ICY_EMPTY_BLOCK[0]).toBe(0)
  })
})

describe('track announcements', () => {
  it('round-trips a mediaId and title', () => {
    const encoded = encodeTrackAnnouncement(107, 'Some Song')
    expect(decodeTrackAnnouncement(encoded)).toEqual({
      mediaId: 107,
      title: 'Some Song',
    })
  })

  it('keeps separators that appear inside the title', () => {
    const encoded = encodeTrackAnnouncement(9, 'A|B|C')
    expect(decodeTrackAnnouncement(encoded)).toEqual({ mediaId: 9, title: 'A|B|C' })
  })

  it('rejects values that are not announcements', () => {
    expect(decodeTrackAnnouncement('no separator')).toBeNull()
    expect(decodeTrackAnnouncement('|leading')).toBeNull()
    expect(decodeTrackAnnouncement('abc|title')).toBeNull()
    expect(decodeTrackAnnouncement('')).toBeNull()
  })

  it('survives the full encode -> block -> parse path', () => {
    const { payload } = readBlock(
      icyMetadataBlock(encodeTrackAnnouncement(55, 'Round Trip'))
    )
    const value = /StreamTitle='([^']*)'/.exec(payload)![1]
    expect(decodeTrackAnnouncement(value)).toEqual({ mediaId: 55, title: 'Round Trip' })
  })
})
