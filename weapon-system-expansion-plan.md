# Clash Arena — Weapon System Expansion Plan (Bow / Shotgun / Bomb)

**Scope:** Add three new weapon archetypes alongside the existing melee (Spear-equivalent) core, each locked to a distinct character, unlocked progressively through the existing Mastery win-based system.

**Non-negotiable design principle — read this before building anything:**
The existing Mastery track was built cosmetic-only specifically to prevent win-based unlocks from creating a competitive advantage. Unlocking actual weapons breaks that guarantee **unless every weapon is balanced as a different playstyle, not a different power level.** Every phase below treats "no weapon should have a higher win rate than another at equal skill" as a hard requirement, equal in priority to the determinism rules already enforced in `simulation.js`. If playtesting shows one weapon dominating, that is a blocking bug, not a balance nice-to-have.

---

## Part 1 — Weapon Archetype Specs

Each weapon reuses the existing state-machine pattern (WINDUP → ACTIVE → RECOVERY) already proven in Phase 2, but with different timing, range, and — for Bow/Bomb — a new concept: **projectile/area entities that exist in the simulation state**, not just instant hit resolution.

### Spear (existing — no changes)
- Current melee Strike. Baseline reference point for balancing the other three.

### Bow — long range, spacing-and-prediction weapon
- **Windup (draw):** ~0.35–0.45s — longer than Spear's, visibly telegraphed (charging glow), giving the opponent real reaction time
- **Release:** spawns a projectile entity with a fixed travel speed (not instant hit) — this is the key new simulation concept
- **Recovery:** ~0.25s after release
- **Range:** full arena length
- **Countered by:** Dodge (i-frames avoid it entirely) or Parry timed against the projectile's arrival, not the draw — same "parry the actual hit" principle as melee, just with a travel-time delay to read
- **Weakness (for balance):** poor at point-blank range — either a minimum effective range, or a forced awkward recovery if the opponent closes distance during the draw, so Bow players can't just draw-and-hold safely up close

### Shotgun — close range burst weapon
- **Windup:** short, ~0.12s
- **Active:** brief, wide-arc hit area but very short range — only connects if the opponent is already close
- **Recovery:** longer than Spear's — successful hits should feel high-commitment, not spammable
- **Countered by:** Dash away before the active frame, or simply maintaining distance — Shotgun should be genuinely bad at range, not just less good
- **Weakness (for balance):** essentially non-threatening beyond close range, so a Shotgun player is forced to take real risk closing distance — that risk is the balancing factor against its burst power

### Bomb — medium range, area denial/prediction weapon
- **Throw (windup):** ~0.3s, throws toward a targeted ground location within a fixed max range
- **Landing → detonation delay:** a clearly telegraphed impact zone (visual circle) appears before it explodes — this is a *prediction* weapon: the opponent has time to see where it will land and choose to not be there
- **Active (detonation):** area-of-effect hit on anyone standing in the telegraphed zone at detonation tick
- **Recovery:** longest of the four — this is a zone-control tool, not a spammable attack
- **Countered by:** Dodge/movement only — **deliberately not parryable**, since there's no single "hit moment" to time a parry against, just an area and a countdown. This asymmetry (Bomb's only counter is positioning, not timing) is intentional and adds real variety to matchups rather than making every weapon just "a Spear with different numbers."

---

## Part 2 — Character-Weapon Binding & Roster

- 4 characters, each locked to one weapon (Spear / Bow / Shotgun / Bomb), matching Zooba's model
- Visual identity per character should read clearly at a glance even at low graphics tiers — reuse the Stage D "silhouette-readable, color-coded" principle already planned, since players need to identify an opponent's weapon type instantly to counter-play correctly
- Pre-match character select screen (new UI, doesn't exist yet) — shows locked/unlocked state per character

---

## Part 3 — Determinism & State Schema Changes

This is the part with real technical risk, so treat it carefully given how much work went into proving `simulation.js` deterministic and pure.

- **New state additions:** `GameState` needs a `projectiles: []` array (Bow) and `hazards: []` or similar (Bomb's telegraphed/detonating zones) — both must be plain, JSON-serializable data, exactly like existing player state, with zero renderer/DOM references
- **Update loop:** `update(state, inputs, dt)` needs to also advance projectile positions and hazard timers deterministically every tick, using only `dt` — no `Math.random()`, no wall-clock reads, matching the existing determinism audit that already passed for melee combat
- **Collision resolution:** projectile-vs-player and hazard-vs-player collision checks happen inside the same authoritative server tick as melee hit detection — client prediction can show a projectile visually in flight, but only the server's tick decides an actual hit, exactly like the existing melee combat resolution
- **Reconciliation:** the existing replay-on-reconcile logic needs to account for projectiles/hazards that may have spawned or expired between the client's prediction and the server's authoritative correction — this is the trickiest new edge case and deserves its own explicit test pass, not just "it probably works like melee did"

**[ASK USER]:** none — this is a direct technical requirement, not a preference decision.

---

## Part 4 — Progression Model (Reconciling Mastery Unlocks With Fairness)

Given the fairness tension flagged at the top, here's the concrete mitigation:

- **Front-load the unlock curve.** Don't gate the 2nd weapon-character behind a long grind — reuse the earlier "first permanent unlock within the first session" pacing principle. A player should have access to at least 2 of the 4 characters within their first few matches, not after dozens of wins. This limits how long any player is stuck with only Spear against a more varied opponent.
- **Balance is the real fix, not the unlock curve.** If all four weapons are genuinely balanced against each other (Part 1's design goal), a Spear-only player isn't at a disadvantage against a Bow/Shotgun/Bomb-unlocked opponent — they're just facing more *variety* of matchup, which is a skill test, not an unfair fight. The unlock curve softens the early-game feeling of it; balance is what actually makes it fair.
- **Consider an explicit practice/offline unlock path** separate from competitive wins — e.g. beating the AI opponent on higher difficulty tiers also grants access, so a player who's bad at PvP specifically isn't permanently locked out of trying other weapons.

---

## Part 5 — Build Phases (in order, with a clear cutline)

### Phase W1 — Bow only (pilot for the whole system)
Build just Bow first, alongside the existing Spear, with the full character-select UI. This proves out the projectile/state-schema/reconciliation work in isolation before committing to three new weapons at once.
**Checkpoint:** Bow vs Spear matches are fair, fun, and deterministic across a real online match (same rigor as the original Stage B latency test) before proceeding.

### Phase W2 — Shotgun
Simpler than Bow (no projectile travel time, just range/timing tuning on the existing hit-detection pattern) — lower risk, build second.

### Phase W3 — Bomb
Most complex (new hazard/telegraph system, non-parryable counter-play) — build last, and only if W1/W2 are solid and there's still runway before the deadline.

### Phase W4 — Progression & Unlock UI
Wire the character-select screen to the Mastery system per Part 4's front-loaded curve.

---

## Priority Note Given the Deadline

**This entire weapon system is upside, not requirement** — Stage A + Stage B (Spear-only combat, online PvP) is already a complete, submittable, impressive game on its own. Treat Phase W1 (Bow) as an experiment with its own checkpoint: if it's not clean and fun within a reasonable time budget, it's genuinely fine to ship the contest entry as Spear-only and treat this whole document as a "if there's time left" track, not a must-finish list. Do not let weapon variety work put the already-working Stage A/B core at risk.

## Testing Plan (Balance-Specific, in addition to the existing determinism/network tests)

- Play enough Spear-vs-Bow, Spear-vs-Shotgun, Spear-vs-Bomb, and cross matchups (Bow-vs-Shotgun, etc.) matches to get a rough sense of whether any single weapon is winning far more than the others at similar skill levels
- If one weapon is clearly dominant or clearly weak, that's a tuning bug — adjust its numbers (windup/recovery/range) before adding the next weapon, don't stack an imbalanced weapon under more imbalanced weapons
- Re-run the existing cross-network and simulated-latency tests specifically with a Bow match, since projectile travel time interacting with network latency is a genuinely new risk the melee-only testing never covered
