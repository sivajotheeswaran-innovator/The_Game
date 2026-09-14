# "Clash Arena" — Full Build Spec (AI + Online PvP + Stylized VFX)

**Stack:** Web (HTML5 Canvas/WebGL + JavaScript). Still browser-based — one link, works cross-campus, no install, but now scoped for real depth since you've got time and credits to spend.

**Format:** Real-time 1v1 top-down arena duel. Best of 7 rounds, first to 4 wins a match. A round = first to land 3 clean hits within a 45-second bout (most hits landed wins if time runs out).

Build phases are ordered so you always have a *playable, demoable game* at the end of every phase — never a half-broken one. **[ASK USER]** marks a real decision point — tell Antigravity to stop and ask you there, not guess.

---

## STAGE A — Core Game (must be rock solid before anything else)

### Phase 0 — Project Setup & Tech Decisions
- Canvas/WebGL scaffold, responsive to mobile + desktop
- Basic game loop (update/render at fixed timestep)
- Placeholder arena (flat rectangle, boundary walls)

**[ASK USER]:** *"Canvas 2D is faster to build and plenty capable for a top-down duel — WebGL (via something like PixiJS) gives smoother VFX/lighting but adds setup time. Given the 'go big on visuals' goal, which do you want as the foundation?"*

**Done when:** empty arena renders, resizes correctly, loop runs at stable framerate.

---

### Phase 1 — Movement & Collision
- WASD/joystick movement for a placeholder character (simple shape for now — art comes later)
- Arena boundary collision
- Camera framing that keeps both fighters in view

**Done when:** character moves smoothly, can't leave the arena, feels responsive (no input lag).

---

### Phase 2 — Attack, Windup, Recovery
- Attack has a visible telegraph (0.2–0.3s windup — color flash or shape change as placeholder)
- Active hit frame (short window where it actually connects)
- Recovery window (brief vulnerability after attacking)
- Test against a static dummy target first — no opponent AI yet, just confirm timing feels fair and readable

**Done when:** you can consistently land or whiff an attack on a stationary target based on spacing and timing alone.

---

### Phase 3 — Dodge & Parry
- Dash/dodge: short burst, brief invincibility frames, cooldown after use
- Parry: tight timing window, big punish on success, punishing whiff on failure (longer recovery than a normal miss)

**Done when:** a second local player (controls #2, same keyboard, for testing only) can duel a first player and both defensive options feel worth using, not just spam-avoidable.

---

### Phase 4 — Round & Match Structure
- Round = first to 3 hits within 45 seconds (most hits wins on timeout)
- Match = best of 7 rounds, first to 4 round wins
- Score display, round-end banner, match-end banner
- Instant "Play Again" — full reset, no reload

**Done when:** two local players can play a full match start to finish with correct scoring at every level.

---

### Phase 5 — AI Opponent (Single Player Mode)
- AI tracks player's habits: attack range preference, dodge timing, aggression level, parry frequency
- AI adapts: if player over-relies on one option (e.g. always dashes in the same direction), AI starts punishing it
- Include a random "wildcard" factor so it's not perfectly predictable/exploitable once learned

**[ASK USER]:** *"Should the AI have distinct difficulty tiers (easy/medium/hard) for practice, or one adaptive AI that scales itself based on how well the player is doing?"*

**Done when:** playtesting shows the AI clearly punishes repeated habits but a player who mixes options can still win consistently.

---

**🔒 MVP CHECKPOINT — Stage A alone is a submittable, complete game.** If anything goes wrong with time later, everything past this point is upside, not requirement. Confirm Stage A is fully stable before touching Stage B.

---

## STAGE B — Online PvP (play with a friend)

### Phase 6 — Networking Foundation
- Real-time state sync between two browser clients (position, action state, timestamps)
- Given this is a windup/recovery-based duel (not ultra-twitch), a lightweight sync approach (10–20 updates/sec) is enough — you don't need frame-perfect rollback netcode

**[ASK USER]:** *"For the backend: Firebase Realtime Database (fastest to stand up, good enough for this pace of game, minimal server code) or a dedicated WebSocket server (more control, more setup work)? Given your timeline, I'd lean Firebase — confirm before we build on it."*

**Done when:** two separate browser windows/devices can see each other's movement update in near-real-time.

---

### Phase 7 — Room Codes / Friend Matchmaking
- "Create Match" generates a short room code
- "Join Match" enters a code to connect to a friend directly (no public matchmaking queue needed unless you want it)
- Reconnect handling if someone briefly drops (don't let one disconnect kill the whole match state)

**[ASK USER]:** *"Do you want open public matchmaking (random opponent) in addition to friend-code rooms, or is friend-vs-friend enough for the contest demo?"*

**Done when:** two people on different devices/networks can reliably find each other and play a full match online.

---

### Phase 8 — Sync the Full Ruleset Online
- Confirm hit detection, round scoring, and match scoring all stay correctly synced between both clients (this is where subtle bugs hide — test heavily)
- Handle simultaneous-hit edge cases (both land a hit in the same frame — decide and document the tie rule)

**Done when:** an online match produces identical results on both players' screens — no "I won on my screen but lost on theirs" bugs.

---

## STAGE C — Reward Systems (from earlier design, now mapped onto arena combat)

### Phase 9 — Clutch Card (Consumable Comeback)
- Trigger: player is behind by 1–3 rounds
- Effect: once per match, grants either an extended parry window or a free dash-cooldown reset for the current round only
- Decays if unused by round 5
- Clear on-screen indicator + urgency cue near expiry

**Done when:** the card only appears when behind, expires correctly, and meaningfully helps a comeback without feeling like cheating.

---

### Phase 10 — Mastery Unlocks (Permanent Progression)
- Earned on full match wins
- Unlocks: new dash trail VFX, victory taunt animations, alternate weapon/character skins, player card border
- Saved persistently (local storage for offline AI mode; account-linked if you want it to follow the player into online PvP — see Phase 6 backend choice)

**Done when:** winning a match grants a visible, equippable cosmetic that persists on return.

---

## STAGE D — "Go Big" Visual Direction

### Phase 11 — Art Direction & Character Design
- Move from placeholder shapes to actual character sprites/models
- Define a visual identity (silhouette-readable characters, clear color-coding for windup/active/recovery states so skill reads visually even to spectators)

**[ASK USER]:** *"Do you have a specific art direction in mind (anime-inspired, cel-shaded, neon/cyberpunk, painterly fantasy, etc.), or reference games/art you want this to feel like? This shapes every asset from here on, so lock it before generating art."*

**Done when:** you have at least 2 finished character looks and an arena background that match the chosen direction.

---

### Phase 12 — VFX & Combat Juice
- Hit sparks/impact frames on successful attacks
- Screen shake scaled to hit importance (small on normal hit, bigger on a match-winning hit)
- Slow-motion micro-freeze on a successful parry (this single effect sells "skill" better than almost anything else — worth prioritizing)
- Particle trails on dashes, charged attacks, or unlocked cosmetics
- Round/match win celebration sequence (not just a text banner — earn the moment)

**Done when:** a first-time viewer visibly reacts to hits and parries without narration — the game "reads" itself.

---

### Phase 13 — Sound Design
- Distinct sound per action: windup, whiff, hit, parry, dash, round win, match win
- Light ambient arena background music, ducking during key moments (parries, match point)

**Done when:** playing with sound on feels noticeably more satisfying than muted — a real gap-check, not a guess.

---

## STAGE E — Systems Around the Game

### Phase 14 — Leaderboard (Cross-Campus)
- Store per-player: wins, current streak, best win, cosmetic unlocks, campus
- Public leaderboard screen, filterable by campus
- This satisfies the contest's cross-campus play requirement directly

**Done when:** match results write to a shared, viewable leaderboard.

---

### Phase 15 — Onboarding (first 30 seconds)
- First match vs. AI is intentionally easy/telegraphed so the player lands a hit almost immediately
- One-time overlay explaining controls (movement, attack, dodge, parry) — dismissible, never shown again

**Done when:** someone who's never seen the game understands it and wins something within 20–30 seconds of starting.

---

### Phase 16 — Testing & Balance Pass
- Get 5+ people playing blind — watch for confusion points, not just bugs
- Tune: windup/recovery timing, AI aggression, Clutch Card power, parry window size

**Done when:** testers ask to play again unprompted, and no one describes it as "random" or "luck-based."

---

### Phase 17 — Submission Package
- Deploy to a public link (Vercel/Netlify) — must work with no login wall
- Record 1–3 min demo: a full match, an online PvP moment, a comeback via Clutch Card, a cosmetic unlock, one clean parry moment (this is your best visual hook — lead the video with it)
- Short "how to play" note
- Confirm cross-campus access with zero friction

**[ASK USER]:** *"Team roster and team lead details for the submission form?"*

---

## Risk & Time Management

Stage A (Phases 0–5) is your **non-negotiable floor** — a complete, polished single-player game against a smart AI. That alone is a strong, legitimate entry.

Stage B (online PvP) is the single riskiest addition — networking bugs eat time unpredictably. Build it only after Stage A is bulletproof, and timebox it: if it's not stably working after a set number of days, ship Stage A + Stage C + D as a phenomenal single-player entry rather than risk a broken PvP demo in front of judges.

Stage D (art/VFX) can be layered in parallel with Stage B by a second team member, since it doesn't depend on networking — good place to split work if your team has more than one person.
