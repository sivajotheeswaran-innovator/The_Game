# Clash Arena — Online-Mode Mobile Lag: Diagnostic & Fix Guide

**Symptom reported:** Local/AI mode runs smoothly on the test mobile device. Online PvP mode on the *same device* drops to ~15 FPS, and player actions appear delayed by a large, seemingly growing amount (reported as roughly a minute) rather than a small, steady network lag.

**What this rules out:** Since local mode is smooth on this exact hardware, this is **not** a general rendering/GPU capability problem. Do not spend time on devicePixelRatio, VFX quality tiers, or canvas resolution — the bottleneck is specific to code that only runs in online mode. Investigate in the order below; stop as soon as one step's "Confirm" condition is met and fix that before re-testing.

---

## Step 1 — Check for per-message console logging

**Why this is first:** it's the single most common cause of exactly this symptom, and takes under a minute to check.

- Search `network.js` and the online-mode branch of `game.js` for any `console.log` (or `console.debug`) call inside:
  - the WebSocket `onmessage` handler
  - the per-tick update loop when in `ONLINE` mode
- At a 60Hz (or even 30Hz) broadcast rate, a log call on every message is 30–60 writes/sec. On mobile Chrome — especially with remote debugging/DevTools attached — this alone can drop FPS into the teens.

**Confirm:** if any such log exists, remove it or gate it behind a `DEBUG_NETWORK` flag that defaults to `false`. Re-test immediately after this single change before moving to Step 2 — if this was the cause, everything below is unnecessary.

---

## Step 2 — Check state message size and parse cost

**Why:** local mode never does `JSON.parse`/`JSON.stringify` on a hot path; online mode does it on every incoming message. This work is new overhead that simply doesn't exist in local mode.

- Log (once, temporarily) the byte size of one incoming `state` message (`JSON.stringify(message).length`)
- Confirm the payload only contains what's needed to render + reconcile (player positions, action states, scores, tick number) — not accidentally-included static config, full history, or VFX-only data that doesn't belong in the authoritative snapshot
- If the payload is large or the broadcast rate feels unnecessarily high, throttle server broadcasts to 30Hz instead of 60Hz. This is safe given the existing 2-tick input delay buffer and should not be perceptible to players.

**Confirm:** payload is lean (just gameplay-relevant fields) and broadcast rate is no higher than needed. Re-test after any change here.

---

## Step 3 — Check for per-message allocation and buffer growth

**Why:** if new objects/arrays are created on every message instead of reused, this generates garbage fast enough to trigger frequent GC pauses on mobile — which present as stutter/freezing, distinct from a smooth slowdown, but can look similar to a user.

- In `network.js`, check whether incoming state is spread into a **new** object every message (`{ ...state }`) versus mutating/reusing an existing one
- Check the prediction input buffer (documented as capped at 120 entries) is actually **culled every message**, not just capped in theory — confirm the cull logic runs unconditionally on every `state` message received, not only under some conditional path that might be skipped
- Check the entity interpolation logic (buffer of last 2 opponent snapshots) isn't accidentally accumulating more than 2 snapshots over time

**Confirm:** no unbounded growth in any buffer; state updates mutate/reuse structures where reasonable rather than allocating fresh ones every message.

---

## Step 4 — Confirm reconciliation replay length stays bounded

**Why this matters most for the "growing delay" description specifically:** if server acks (`lastProcessedSeq`) are being processed slower than new inputs are generated — which becomes likely once Steps 1–3 are already causing slowdown — the number of "unacked" inputs waiting to be replayed on each reconciliation grows over time. Each reconciliation then has to replay more inputs than the last one, so the cost **compounds** rather than staying flat. This matches a lag that visibly gets worse the longer you play, rather than a constant, steady delay.

- Log the length of the "unacked inputs to replay" list on every reconciliation for ~30 seconds of online play
- **If this number stays roughly flat (small, e.g. under 5–10):** reconciliation is healthy, this isn't the cause
- **If this number climbs steadily over time:** this is very likely the actual root cause. The fix is upstream — Steps 1–3 are likely what's causing acks to fall behind in the first place. Fixing those should cause this number to stabilize; don't try to fix reconciliation logic directly without first addressing why acks are lagging.

**Confirm:** replay length stays small and stable during a sustained play session, not climbing.

---

## Step 5 — Profile online mode against local mode directly (only if Steps 1–4 didn't already resolve it)

**Why this is last, not first:** profiling tells you *where* time is going, but Steps 1–4 already cover the highest-probability causes and are far cheaper to check first. Only reach for full profiling if the issue persists after all four are addressed.

- Connect the phone via USB, open `chrome://inspect` from a laptop, open the Performance panel
- Record ~10 seconds of local/AI mode play, then ~10 seconds of online mode play on the same device, same session
- Compare the two flame graphs — look specifically at what's consuming main-thread time in the online recording that has no equivalent in the local recording (this will point directly at whichever of Steps 1–4 is the real culprit if the earlier checks were inconclusive)

---

## Re-test protocol after any fix

Do not consider this resolved from a single quick check. After making a change from any step above:

1. Re-run the same cross-network test from before (laptop on home wifi, phone on real cellular data — not the same wifi network, and not a LAN/tunnel workaround)
2. Confirm FPS is stable (ideally 50–60, but meaningfully improved from 15 at minimum)
3. Confirm the input-to-action delay feels roughly constant across a full match, not growing the longer you play
4. Only then move on to the next unresolved step, or declare this fixed

## What NOT to touch during this pass

- Do not modify `simulation.js` — it's confirmed pure and deterministic; this bug is in the networking/client layer, not the simulation rules
- Do not add VFX quality tiers or touch rendering resolution — local mode already proves the device can render this fine
- Do not increase the input delay buffer beyond 2 ticks as a workaround — that would mask the real bug rather than fix it, and would degrade the parry-fairness guarantee already validated in earlier testing
