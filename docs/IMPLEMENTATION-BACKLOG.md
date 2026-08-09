# MusicBox Implementation Backlog

Tracks where the current implementation diverges from
[`SYSTEM-BEHAVIOR-SPEC.md`](./SYSTEM-BEHAVIOR-SPEC.md), and the work needed to
close the gap.

**The spec describes how the system should behave. This document tracks what's
left to build.** The spec itself never needs editing, because it already
describes the finished state.

When an item is done, delete it rather than checking it off. Once the code
matches the spec, the spec *is* the description, and a second stale copy here
only buries the work still open. `git log -p docs/IMPLEMENTATION-BACKLOG.md`
has every item ever tracked, and the commit that closed each one carries the
reasoning. Phases 1–4 — the streaming-only rebuild agreed 2026-08-02 — were
completed and trimmed on that basis, along with the TanStack Start upgrade.

Designs that are agreed but not yet proven out don't belong here either: the
spec marks those **⚠ Provisional** in place, next to the behaviour they
describe. §3.5's device-side ICY consumption is the current example.

---

## Known limitations — accepted, not planned

- **Buttons lag while the sound machine file downloads.** The download runs on
  the audio task so that flash writes can never overlap playback, and while it
  is writing that task is not draining the command queue — so presses register
  but their effect waits. It lasts a few seconds and only happens when the
  configured sound changes. Moving the download off that task would reintroduce
  exactly the overlap the placement exists to prevent, so this stays.

---

## Transitional — remove once no longer needed

- [ ] **T.1 — Media backfill startup pass** (`services/mediaBackfill.ts`)
  Measures the audio profile and generates a canonical derivative for rows that
  predate those requirements. **Not part of the long-term design** — every
  ingest path now populates these fields itself, so this exists only to carry
  libraries that were created before that was true.

  *Removable once every deployed library has been through it* — currently the
  production server and the local dev copy. Verify with:

  ```sql
  SELECT COUNT(*) FROM media
  WHERE audio_bytes IS NULL OR sample_rate IS NULL OR channels IS NULL;
  ```

  Zero on every deployment means it can go.

  **Worth keeping anyway?** Arguably. When there is nothing to do it costs a
  single query returning no rows, and it doubles as a safety net if a future
  ingest path forgets to populate a field, or if files are placed in `data/`
  by hand. The decision is cheap either way — the reason to note it here is so
  a future reader doesn't mistake it for load-bearing architecture.

---

## Deferred — not planned

- **Security & access control** (spec §13)
  No authentication anywhere: every server function, the whole control-plane UI,
  and the MQTT broker (`allow_anonymous true`) are open to anyone on the network.
  `devices.secret` is generated but never verified. `docs/server-auth-plan.md`
  describes a plan that is not implemented.

  **Consciously deferred.** Accepted risk for a trusted home LAN. Revisit before
  any deployment beyond a single household, or before exposing the server
  remotely. Web UI auth (that plan's Phase 1) is independent of all firmware work
  and could be picked up at any time.
