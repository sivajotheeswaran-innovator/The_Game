# Clash Arena — Mobile Own-Player Stutter & Heat: Diagnostic Guide

**Symptoms reported (mobile only, laptop unaffected):**
1. Phone heats up during play
2. The player's *own* controlled character moves in visible discrete steps ("teleporting") rather than smoothly, despite being client-predicted every frame

**Why these are almost certainly the same root cause, not two bugs:** the local player's position is predicted client-side on every render frame — it does not wait on network messages. If it's stepping, the most likely explanation isn't broken prediction logic (that would also break on laptop, since the code is identical) — it's that **frames are being dropped on mobile specifically**, so the correct, continuously-updated position is only visible in the frames that actually render, producing a stepped look. Heavy per-frame GPU cost is also the most common cause of a phone heating up under sustained load. Both symptoms point at the same place: the render pipeline is too expensive per frame on mobile hardware.

Investigate in this order:

---

## Step 1 — Get an actual current FPS number on mobile, right now

Before changing anything, confirm whether the earlier network fix pass changed the render FPS at all (it targeted the network/reconciliation path, not rendering, so it may not have). Log/display FPS during a normal play session on the same phone used for testing.

**Confirm:** what's the current number? If it's still well below 50-60, that's the direct explanation for both symptoms and Steps 2-4 are where to look. If FPS is actually fine now (50-60) and stepping still happens, skip to Step 5 — the cause would be something else entirely (e.g. input capture, not rendering).

---

## Step 2 — Check whether the glow/bloom VFX uses live CSS filters

- Search for `filter: blur(...)`, `box-shadow` with large blur radii, or similar CSS-based glow effects that are recalculated by the browser every single frame
- This is one of the most GPU-expensive operations possible on mobile — significantly more expensive than the same visual pre-rendered into a sprite/texture, or drawn once to an offscreen canvas and reused
- If this is how the neon glow is implemented, this is the single highest-probability cause of both the heat and the dropped frames

**Fix if confirmed:** replace live CSS filter blur with either (a) a pre-baked glow sprite/texture drawn normally, or (b) a cheaper canvas-based glow technique (e.g. drawing the shape a few times at increasing size/decreasing opacity) rather than a real-time GPU filter recalculated 60x/sec.

---

## Step 3 — Confirm the render loop uses `requestAnimationFrame`, not `setInterval`/`setTimeout`

- If rendering is driven by a timer instead of `rAF`, the browser can't coordinate it with the display's actual refresh cycle or throttle appropriately, which wastes GPU/CPU cycles and generates unnecessary heat
- The simulation tick (fixed 60Hz accumulator) can and should stay timer/accumulator-based — this check is specifically about what triggers the *draw* call, not the simulation update

**Confirm:** rendering is scheduled via `requestAnimationFrame`.

---

## Step 4 — Check for background/off-screen throttling

- Confirm the render loop respects the Page Visibility API and reduces/pauses rendering when the tab isn't focused or the screen is off
- Won't fix stepping *during* active play, but prevents wasted heat when the phone is idle mid-session (e.g. player alt-tabs or screen briefly locks)

---

## Step 5 — Only if FPS is already good and stepping persists: check input capture path

- Confirm touch/joystick input is read every render frame (as a continuously-available "current input state"), not only inside a `touchmove` event handler that fires less often than the render loop
- If position updates are only applied when a `touchmove` event fires (rather than every frame using the last known input), movement will visibly step at the touch event rate rather than the render rate, even with a perfectly healthy FPS
- Fix: maintain a persistent input state object updated by touch events, but read from it unconditionally every render frame in the main loop — same pattern as keyboard input already uses

---

## Re-test protocol

1. Apply Step 2 (glow/blur) first if confirmed — it's the highest-probability single fix
2. Re-check FPS on the same phone
3. Watch specifically whether the player's own movement now looks continuous rather than stepped
4. Only proceed to Steps 3-5 if Step 2 alone doesn't resolve it

## What NOT to touch

- Do not modify network/reconciliation code for this issue — the symptom is in the *local* player's rendering, which doesn't depend on the network path at all. Conflating this with the earlier networking fix risks re-breaking something that was already verified working.
