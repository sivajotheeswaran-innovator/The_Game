# Clash Arena — Graphics Quality Presets (Smooth / Max / Ultra / Ultra Max)

**Goal:** Replace the current automatic mobile/desktop branching (DPR clamp, shadowBlur gating, backdrop-filter removal) with four explicit, player-selectable presets. Auto-detection still picks a sensible *default* on first load, but the player can override it — this matters because "mobile" isn't one tier of hardware; a mid-range phone that still struggles and a high-end phone that could handle more both currently get treated identically.

**Hard rule for every phase below:** these settings control the **renderer only**. Nothing here may touch `simulation.js`, hit timing, windup/recovery frames, the parry window, or network payload/broadcast rate. If a preset changes anything that could affect a match outcome, that's a bug, not a feature — graphics settings must never become a gameplay advantage/disadvantage between two players in an online match.

---

## Phase 1 — Define the Four Tiers as a Parameter Table

Build this as a single config object each preset maps to, so switching tiers is just swapping which object the renderer reads from — not scattered if/else branches through the render code.

| Setting | Smooth | Max | Ultra | Ultra Max |
|---|---|---|---|---|
| Canvas DPR cap | 1.0 | 1.5 | 2.0 | Native (uncapped) |
| `shadowBlur` glow passes | Off (flat shapes/colors) | Reduced (~4-6 key passes: attack telegraph, hit flash) | Most passes (~10-12) | All passes (~18, current desktop-max level) |
| Backdrop blur on UI (joystick/buttons) | Off (solid translucent, current mobile fix) | Off | Light blur | Full blur |
| Particle/VFX density (dash trails, hit sparks — Stage D) | Minimal/off | Reduced (~40%) | Near-full (~75%) | Full |
| Screen shake | Reduced | Standard | Standard | Standard + subtle extras |
| Arena background detail (grid glow, ambient effects) | Static/simple | Standard | Enhanced | Enhanced + extra ambient layers |
| Parry slow-mo freeze effect | Kept (this is a core *feedback* cue, not decoration — never strip this even at lowest tier) | Kept | Kept | Kept |

**[ASK USER]:** none needed for the table itself — these are reasonable starting values the IDE can implement and you tune after testing on your actual device lineup.

**Important inclusion note:** the parry slow-mo freeze stays in every tier deliberately — it's core game-feel feedback (you flagged it yourself as the single best "sells the skill" moment), not pure decoration. Cutting it at low settings would make the game feel worse to play, not just look plainer. Distinguish "decorative VFX" (cut freely) from "feedback VFX" (keep everywhere) when implementing this.

---

## Phase 2 — Settings Menu UI

- Add a "Graphics" option to the main menu (and accessible from a pause/settings icon during matches, since a player might want to drop tier mid-session if they notice stutter)
- Simple 4-button selector: Smooth / Max / Ultra / Ultra Max, current selection clearly highlighted
- Persist choice in `localStorage` so it's remembered next session — don't make players reselect every time
- Show the current FPS badge (already built) right next to this menu so players can visually confirm the impact of a tier change immediately

---

## Phase 3 — Apply Settings Without Touching Simulation

- Renderer reads the active preset's config object at draw time — confirm no simulation/gameplay code path reads from or branches on this config at all
- Switching tiers mid-match should be safe and instant — no reload, no match interruption, since it's purely a render-layer change
- Explicitly verify: two players in the same online match can run *different* tiers from each other with zero effect on match fairness (e.g. player on laptop runs Ultra Max, player on phone runs Smooth — outcome must be identical to both running the same tier, since the server doesn't know or care about either client's render settings)

**Confirm:** run a quick manual test — one client on Smooth, one on Ultra Max, play a match, confirm hit/parry resolution matches on both screens exactly as it would if both were on the same tier.

---

## Phase 4 — Auto-Detect Suggested Default (First Launch Only)

- On first load (no saved preference in `localStorage`), suggest a starting tier using the existing mobile-detection heuristic (touch points + viewport width) already built for the DPR/shadowBlur work: mobile → default to **Smooth** or **Max**, desktop → default to **Ultra** or **Ultra Max**
- This is a *suggestion*, not a lock — show it briefly as the pre-selected option in the settings menu, but the player can immediately change it
- Do not re-run auto-detection on every load once a player has made an explicit choice — respect their saved preference

**[ASK USER]:** *"Should Smooth or Max be the default suggestion for mobile — I'd lean Max as the starting point since your recent perf fixes should handle it well on most phones now, with Smooth available for anyone who still needs it. Confirm or adjust."*

---

## Phase 5 — Verification

- Test all four tiers render correctly with no visual glitches (e.g. confirm turning `shadowBlur` fully off doesn't leave orphaned glow artifacts or broken hit-flash feedback)
- Re-run the FPS check from the earlier mobile diagnostic at each tier on your actual test phone — confirm Smooth meaningfully outperforms Max/Ultra on that device, so the setting is actually doing something, not just a placebo toggle
- Confirm settings persist correctly across a page reload
- Confirm the cross-tier online match test from Phase 3 passes

---

## Why this is worth the time before the deadline

This directly solves a real problem you already hit personally (your phone overheating and stepping on Max-tier defaults) in a way that scales to judges' unknown hardware too — a judge testing on an older phone can drop to Smooth and still get a fair, playable match, while one on a powerful device sees the full Ultra Max presentation. That range is a legitimate selling point in your demo: "runs well from budget phones to high-end, player's choice" is a stronger technical claim than a game that only works well on one tier of hardware.
