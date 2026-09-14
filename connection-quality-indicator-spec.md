# Clash Arena — Connection Quality Indicator (Free Fire-style Ping Display)

**Goal:** Surface the existing RTT/ping data (already tracked in `network.js`) as a clear, honest, color-coded indicator during online matches — so a player who loses an exchange due to a bad connection can tell the difference between "I got outplayed" and "my connection cost me that." This is a trust/UX feature, not a gameplay-balance change — the 2-tick input delay buffer and server-authoritative resolution stay exactly as they are. This only makes the *existing* fairness system visible to the player.

---

## Phase 1 — Ping Display with Tiered Color Coding

- Reuse the existing ping heartbeat/RTT value already computed in `network.js` — no new measurement logic needed, just presentation
- Display as a small persistent badge during online matches (top corner, similar placement to the existing FPS badge)
- Color tiers (starting point — tune based on playtesting, these aren't hard requirements):
  - **Green, under ~80ms:** "Good" — no gameplay impact expected
  - **Yellow, ~80–150ms:** "Fair" — input delay buffer is absorbing most of this, minor edge-case risk on very tight parries
  - **Red, above ~150ms:** "Poor" — player should expect some parries/attacks to feel unresponsive despite the fairness system doing its best
- **Cap the displayed number at 999**, same as Free Fire — during a real spike or near-disconnect, RTT can briefly read absurd values (multi-second); showing "2847ms" looks broken, while "999+" reads as "your connection is genuinely bad right now," which is the accurate message

**[ASK USER]:** none needed — thresholds are a tuning decision the IDE can propose defaults for and you adjust after playtesting, not a structural decision.

---

## Phase 2 — Pre-Match Connection Check

- Before a match starts (during the room-join/waiting screen), show each player's ping to the server
- If either player's ping is in the red tier *before the match even starts*, show a brief non-blocking warning: something like "Connection quality: Poor — matches may feel less responsive" — informational, not a hard block. Don't prevent the match from starting; let the player decide.

---

## Phase 3 — In-Match Poor-Connection Banner (event-driven, not constant)

- Rather than a permanently visible warning banner (which gets ignored/tuned out), trigger a brief, dismissible toast only when connection quality *changes tier* mid-match (e.g. drops from green to red) — this is the moment the player actually needs to know, not a constant reminder
- Example: a small "Connection unstable" toast that fades after 2–3 seconds when ping crosses into the red tier, and doesn't reappear unless it changes tier again

---

## Phase 4 — Post-Match Context (optional, high-value for a contest demo)

- On the match-end screen, if either player spent significant time in the red tier during the match, add a small note: "This match had unstable connection for X% of playtime" — this is genuinely a nice touch for judges, since it shows the game is honest about network conditions rather than hiding them, and reinforces that outcomes were still server-authoritative and fair despite it

---

## What this explicitly should NOT do

- **Do not use ping to adjust game balance** (e.g. don't give a high-ping player extra input delay tolerance, don't penalize a low-ping player). The 2-tick buffer and server authority already handle fairness structurally — this feature is purely informational. Mixing the two would reintroduce the exact kind of unfairness the Stage B networking rewrite was built to prevent.
- **Do not block matchmaking based on ping** — a friend-code 1v1 game should let players choose to play even on a rough connection if they want to.
- **Do not poll ping more frequently than the existing 1-second heartbeat** just to make the display feel more "live" — that would add the same kind of per-message overhead that caused the earlier FPS/lag issue. The 1Hz update rate is plenty for a human-readable indicator.

---

## Verification

- Confirm color tier changes correctly and promptly as simulated latency is added/removed (reuse the same DevTools throttling approach from the Stage B latency test)
- Confirm the 999 cap actually triggers under a simulated extreme-latency or near-disconnect scenario, rather than showing a raw unbounded number
- Confirm this adds no measurable FPS/CPU cost on mobile — since the underlying ping data already exists, this should be nearly free, but verify rather than assume given the earlier mobile performance issues
