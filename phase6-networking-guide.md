# Clash Arena — Phase 6 Implementation Guide: Authoritative Server Networking

**Supersedes the original Firebase recommendation in the build spec.** Reason: the parry window is 140ms. Firebase Realtime Database round-trips (typically 100–300ms) put legitimate parries on a coin flip against latency alone — unacceptable for the mechanic the entire skill ceiling is built on. This guide replaces Phase 6 with a **Node.js WebSocket server running the existing `simulation.js` as authoritative ground truth**, using client-side prediction + reconciliation to keep input feeling instant despite network delay.

This is not a rewrite. `simulation.js` is already pure (`update(state, inputs, dt)`, zero DOM/renderer references) — that purity is exactly what makes it reusable on the server unchanged. The work here is the networking layer around it, not new game logic.

---

## Architecture Overview

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│   Client A       │◄──────────────────────────►│   Server         │
│                   │                             │                   │
│ - input.js        │  sends: PlayerInput         │ - simulation.js   │
│ - simulation.js    │  (same file, reused)        │   (authoritative) │
│   (local predict)  │                             │ - Tracks both     │
│ - renderer.js      │  receives: authoritative     │   players' state  │
│                   │  GameState snapshots         │ - Ticks at fixed  │
│                   │  (~30-60Hz)                   │   60Hz, same as   │
│                   │                             │   client loop      │
└─────────────────┘                             └────────┬──────────┘
                                                             │
┌─────────────────┐         WebSocket                       │
│   Client B       │◄──────────────────────────────────────┘
│  (same as A)      │
└─────────────────┘
```

**Core principle:** the server is the only source of truth for what actually happened (hits, parries, round/match outcomes). Clients predict locally so movement/attacks feel instant, then snap to corrected state if their prediction was wrong. Because `simulation.js` is shared code, "predict" and "authoritative" runs are bit-for-bit the same logic — no drift from reimplementing rules twice.

---

## Phase 6.1 — Server Scaffold

**Goal:** A running Node WebSocket server that can host a single 1v1 room and tick the existing simulation.

- New `server/` directory, separate from client code
- `server/room.js` — holds one match's `GameState`, both players' latest inputs, and the tick loop
- `server/index.js` — WebSocket connection handling (`ws` npm package is sufficient, no need for Socket.IO's overhead here since you don't need fallback transports for a contest demo)
- Import `simulation.js` directly (should work as-is in Node since it has no browser-only dependencies — confirm this during setup; if it accidentally references `window` or `document` anywhere, that's a Phase 0 architecture leak to fix first)
- Server tick loop: same fixed 60Hz accumulator pattern as the client's `game.js`, calling `update(state, inputs, dt)` each tick
- Broadcast resulting `GameState` to both connected clients after each tick (or batched every 2 ticks = 30Hz if bandwidth becomes a concern — decide based on testing, not upfront guessing)

**[ASK USER]:** *"Do you have a hosting target already in mind for the WebSocket server (Render, Railway, Fly.io, a VPS), or should this default to whatever's fastest to deploy for a contest demo?"*

**Done when:** server starts, accepts two WebSocket connections, logs received inputs, and runs a visible tick loop in the console.

---

## Phase 6.2 — Input Protocol

**Goal:** Define exactly what goes over the wire, in both directions, before writing more code — protocol drift is the #1 source of multiplayer bugs.

**Client → Server (every input change, not every frame):**
```json
{
  "type": "input",
  "seq": 1042,
  "timestamp": 1699999999999,
  "input": { "moveX": 0.7, "moveY": -0.3, "attack": false, "dash": false, "parry": true }
}
```
- `seq` is a monotonically increasing sequence number per client — required for reconciliation in Phase 6.3, don't skip it even though it's not used yet.

**Server → Clients (every broadcast tick):**
```json
{
  "type": "state",
  "tick": 50221,
  "lastProcessedSeq": { "playerA": 1042, "playerB": 998 },
  "state": { /* full GameState snapshot */ }
}
```
- `lastProcessedSeq` per player is what makes reconciliation possible — the client uses it to know which of its own predicted inputs have already been confirmed by the server, so it only needs to replay inputs *after* that point.

**Done when:** both message shapes are implemented and logged correctly on both ends, even before prediction logic exists.

---

## Phase 6.3 — Client-Side Prediction & Reconciliation

**Goal:** Local input feels instant; corrections are invisible unless there's a real conflict (e.g., a contested parry).

- Client runs `simulation.js` locally the instant a key is pressed — same as offline mode, no waiting for server confirmation
- Client keeps a short buffer of recent inputs (keyed by `seq`) it has predicted but not yet had confirmed
- When a `state` message arrives from the server:
  1. Snap the client's own player state to the server's authoritative version
  2. Re-apply (replay) any buffered inputs with `seq` greater than `lastProcessedSeq` on top of that authoritative state — this reproduces "what should have happened since the server's snapshot," using local prediction only for the small gap, not the whole timeline
- The **opponent's** character is never predicted the same way — interpolate their position/state smoothly between the last two received server snapshots (standard "entity interpolation") so their movement doesn't look jittery even at 30Hz updates

**[ASK USER]:** none — this is a direct technical requirement of the approach already chosen, not a preference decision.

**Done when:** a player can move and attack with zero felt input delay locally, while the opponent's movement stays smooth despite being on a network tick.

---

## Phase 6.4 — Combat Fairness: Server-Authoritative Hit/Parry Resolution

**Goal:** No client can claim a hit or parry landed — only the server's simulation tick decides. This is the part that actually fixes the original latency problem.

- Attack windup/active/recovery timing and parry window timing run identically on server and client (same `simulation.js`), but **only the server's resolution counts** for score, round state, and match state
- If a client's local prediction shows a successful parry but the server's authoritative tick (using the actual arrival order of both players' inputs) resolves it differently, the server's result wins — the client corrects via the reconciliation flow in Phase 6.3
- Because both players' inputs arrive at the server with real network jitter, the server needs a small **input delay buffer** (e.g., hold and apply inputs ~2-3 ticks after receipt, same for both players) so neither player gets an unfair "arrived first" advantage purely from having lower ping. This is standard practice in competitive netcode and directly protects the 140ms parry window's integrity.

**[ASK USER]:** *"What's an acceptable input delay buffer for fairness vs. responsiveness — I'd suggest starting at 2 ticks (~33ms) and tuning up only if playtesting shows unfair wins tied to connection speed. Confirm you want to tune this empirically rather than picking a fixed number now."*

**Done when:** two clients on genuinely different network conditions (test with one on wifi, one on throttled/mobile data) produce the same match outcome on both screens, with no systematic advantage to the lower-latency player beyond normal skill.

---

## Phase 6.5 — Disconnect & Edge Case Handling

**Goal:** A dropped connection doesn't corrupt or hang the match.

- Brief disconnect (under ~5s): pause the match clock, attempt reconnect using the same room code, resume from last authoritative state
- Extended disconnect: award the match to the remaining player, show a clear "opponent disconnected" result (not a silent hang)
- Server should reject a second client trying to join a room that's already full

**Done when:** manually closing one browser tab mid-match produces a clean, understandable outcome on the other player's screen — never a frozen or crashed UI.

---

## Phase 7 (renumbered from original spec) — Room Codes / Friend Matchmaking

Unchanged from the original spec, now built on top of the real server instead of Firebase:
- "Create Match" → server generates a short room code, creates a `room.js` instance
- "Join Match" → client connects with that code, server pairs it into the existing room
- Reconnect logic from Phase 6.5 applies here too

**[ASK USER]:** *"Public random matchmaking in addition to friend codes, or is friend-vs-friend sufficient for the contest demo?"* (carried over from original spec — still open)

---

## Testing Plan for Stage B

Do not consider Stage B done on "it worked once on localhost." Verify explicitly:

1. **Same-network test:** two browser tabs on the same wifi — confirm baseline works with near-zero latency
2. **Cross-network test:** one player on a different network entirely (e.g., mobile hotspot vs. home wifi) — this is the real test of the reconciliation and input-delay-buffer logic
3. **Simulated latency test:** use browser devtools or a throttling proxy to add artificial 150–250ms latency to one client — confirm parries still resolve fairly and the game doesn't feel broken, just slightly less snappy
4. **Disconnect test:** kill one client mid-match (close tab, kill wifi) — confirm the other client gets a clean result, not a hang
5. **Simultaneous-action stress test:** have both players spam attack/parry/dash rapidly at the same time — confirm server resolution stays consistent and no double-counted hits occur

Record short clips of tests 2 and 3 specifically — "it stayed fair even with real latency" is a genuinely strong point to show judges, since most contest entries won't have tested this at all.

---

## What Not to Change

- `simulation.js` stays untouched in terms of game rules — Phase 6 is purely a networking wrapper around it. If Stage B work starts requiring changes to hit detection or timing rules themselves, stop and reassess — that's a sign the netcode is being built around the wrong assumptions rather than the reverse.
- Do not let this phase creep into visual/VFX work (Stage D) — keep them fully separable so a second team member can work on art/VFX in parallel without touching this code at all.

---

## Rollback Safety

Before starting Phase 6.1, confirm:
- [ ] Stage A demo video recorded and saved (per the earlier checkpoint recommendation)
- [ ] Single-player build deployed and working on a public link independent of any networking code
- [ ] Current codebase tagged/committed as a known-good state (`git tag stage-a-complete` or equivalent) so Stage B work can be safely abandoned and reverted if it doesn't stabilize in time, without losing Stage A
