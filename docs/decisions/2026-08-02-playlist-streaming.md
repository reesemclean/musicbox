# Continuous playlist streaming — prototype findings

**Date:** 2026-08-02
**Status:** Server-side approach validated. Device-side confirmation outstanding.
**Gates:** spec §3.5, §3.6, §8.5 (all marked ⚠ Provisional pending this)

## Question

Can the server hand a device one continuous HTTP response covering a whole
playlist — so crossing a track boundary costs no reconnect and no gap — while
still telling the device which track is playing?

## Verdict

**Yes, with three constraints that the implementation must respect.** Nothing
found here blocks the design. Proceed with Phase 3, honouring the constraints
below.

---

## Findings

### 1. Frame-level extraction is required; naive concatenation is not enough

Simply appending MP3 files leaves three kinds of non-audio bytes mid-stream:
ID3v2 headers, ID3v1 trailers, and Xing/Info/LAME VBR header frames (which are
structurally valid frames that decode to silence).

Measured over three 3.030s tracks (expected total 9.091s):

| Approach | Decoded duration | ffmpeg verdict |
|---|---|---|
| Naive `cat` | 9.066s | `invalid concatenated file detected` |
| Frame extraction | **9.0906s** | clean |

Naive concatenation *lost* ~25ms of audio to resync and confused the container
parser. Stripping the non-audio bytes gives a sample-exact result.

### 2. Uniform encoding concatenates perfectly; sample rate is the hard constraint

Three identically-encoded tracks (44.1kHz / mono / 128kbps) concatenated to
exactly the expected duration with no decoder warnings.

A deliberately mismatched track (stereo / 192kbps) spliced between mono tracks
still decoded to the correct total duration in ffmpeg — it locked to the first
frame's channel layout and carried on. **But ffmpeg is a far more forgiving
decoder than the device's HELIX.** All test material shared a 44.1kHz sample
rate; that is the axis most likely to break a decoder mid-stream.

→ Spec §11.1's normalization requirement is load-bearing, not cosmetic. The
current library is *already* inconsistent: the one real song is stereo/238kbps
VBR, the sound-machine file is stereo/192kbps, system sounds are mono/128kbps.

### 3. ICY metadata works, and the recovered audio is byte-identical

The server interleaves `StreamTitle` blocks per the Shoutcast convention
(`icy-metaint` bytes of audio, then a length-prefixed metadata block). A client
that speaks the protocol recovered:

- all three titles, at byte offsets exactly matching the server's plan
- 145449 audio bytes — **byte-identical** to direct concatenation (`cmp` clean)
- decoding to 9.0906s with no warnings

Title announcement lags the true track boundary by up to one `metaint`:

| | lag |
|---|---|
| observed (track 2) | 42ms |
| observed (track 3) | 84ms |
| worst case @128kbps | 512ms |
| worst case @238kbps | 275ms |

Sub-second in all cases — fine for status reporting. Smaller `metaint` tightens
this at the cost of protocol overhead.

### 4. Content-Length is required — do not let the response fall back to chunked

Node defaults to `Transfer-Encoding: chunked` when no `Content-Length` is set.
This silently corrupted the prototype: a byte-reading client parses chunk-size
headers as audio and desyncs from the metadata framing immediately.

ESP32-audioI2S *can* parse chunked (`m_f_chunked`, `getChunkSize`), so this is
not fatal — but chunked framing interleaved with ICY metadata is an untested
combination, and a known-length body is the library's best-trodden path.

→ **Send an exact `Content-Length`.** It is computable: derive it from the same
pass that builds the byte plan, so the two cannot disagree.

### 5. Frame parsing is cheap, but computing Content-Length needs cached lengths

Parsing the real 6.4MB VBR song: **4ms**, 8261 frames, duration matching ffprobe
exactly (215.80s).

The catch: `Content-Length` depends on every track's *extracted audio* length,
so a naive implementation reads the entire playlist before sending byte one. For
a 50-track playlist that is hundreds of MB and seconds of latency.

→ **Cache each track's extracted audio byte length** (and frame-derived
duration) in the `media` table at ingest. Then the endpoint computes
`Content-Length` from the database and streams files lazily, one at a time, so
time-to-first-byte depends only on track 1.

### 6. Skip has the data it needs

The server knows the playlist order and, from the last `playback_status`, which
track is playing — enough for next/previous. It does *not* know the position
within the current track, which spec §3.6 needs for the "restart if >3s in"
rule.

`Audio.h` exposes `getAudioCurrentTime()`, so the device can include its elapsed
position in the skip event and let the server apply the rule.

---

## Constraints carried into Phase 3

1. Extract audio frames (strip ID3v2 / ID3v1 / Xing) rather than concatenating
   files whole.
2. Normalize all library media to one sample rate and channel count at ingest
   (spec §11.1). Sample rate especially.
3. Always send an exact `Content-Length`; never allow chunked encoding.
4. Cache per-track extracted-audio length in `media` so the endpoint can compute
   that length without reading every file.
5. Include the device's elapsed track position in the skip event.

## Still unvalidated — needs hardware

The prototype proves the *server* produces a correct, standards-shaped stream.
It cannot prove the device consumes it as expected. Before Phase 4 is considered
done, confirm on real hardware:

- the `streamtitle` event fires mid-stream and carries the injected `mediaId`
- the HELIX decoder crosses a track boundary without an audible artifact
- real time-to-first-audio over WiFi (the prototype measured localhost only)

If the boundary proves audible on-device despite being sample-exact on the
server, the fallback is server-side transcoding to a single uniform stream —
more CPU, same interface, no change to the device contract.

## Reproducing

Prototype lives outside the repo (scratchpad). It comprises: an MP3
frame-extraction module, an HTTP server that builds the interleaved byte plan,
and an ICY-speaking client that de-interleaves and verifies. The
frame-extraction module is written to be lifted directly into Phase 3.2.
