# Phase 15 — Persistent Crew Foundation

> **Status:** Implemented; automated and browser evidence recorded below.
> **Dependency:** Phase 13 complete. Phase 14 is present and integrated.
> **Decision gates:** maximum crew capacity is four; this slice ships one recruited
> crew member using an explicitly temporary primitive avatar and static idle.

## Scope and playable proof

The player can walk to Lyra Venn at the stable `crewMessAnchor` in the
circulation corridor, on the ship's right side directly opposite the radio,
and interact with `C`, Triangle, or XR select. Lyra selects authored text
from authoritative `A Clean Copy` and `The Weight of a Copy` state. The player
can make one relationship choice, leave, reload, and receive the persisted
relationship, mood, memory references, and contextual response.

Deterministic authored text is the required and default path. The optional
presentation adapter receives a deeply frozen, read-only context snapshot and
can only return display text. It cannot complete missions, grant cargo or
credits, alter reputation, damage the ship, or write NPC state.

## State contracts

The save envelope advances from version 3 to version 4 and RPG state advances
from version 2 to version 3. Migration creates the NPC domain without changing
the Phase 14 ship domain or any prior RPG consequence.

`rpg.npcs` contains:

- `crewCapacity`: exactly `4`;
- `crewRoster`: unique stable crew IDs, maximum four;
- `byId.crew_quartermaster_lyra`: stable `id`, `presence` (`aboard|away`),
  `locationId` (`crewMessAnchor`), bounded `relationship` (-1..1), enumerated
  `mood`, unique stable `memoryReferences`, `alive`, and `recruited`.

Physical presence is derived only from `alive && recruited && presence ===
"aboard"`. Interaction state is ephemeral and enumerated as `offline`,
`connecting`, `listening`, `responding`, `interrupted`, or `failed`; it is not
simulation state and is not persisted.

Memories are stable references and are inserted exactly once:

- `mission.port_meridian_route_packet.commonwealth|index`
- `mission.index_archive_delivery.delivered|abandoned|cargo_lost`
- `crew.choice.trusted-judgment|professional-distance`

The shared definition registry uses the same `id`, `kind`, identity, faction,
location, and persistence shape for contacts, crew, and future encounter NPCs.

## Acceptance criteria

- [x] One stand-in avatar occupies a stable ship-local anchor.
- [x] The avatar is visible/interactable only when authoritative state says the
  recruited, living NPC is aboard.
- [x] Both `A Clean Copy` outcomes produce distinct authored reactions.
- [x] Phase 14 active, delivered, and failed outcomes add contextual reactions
  without becoming a prerequisite.
- [x] One relationship choice changes relationship, mood, and memory once.
- [x] All NPC fields validate, sanitize, round-trip, migrate, reset, and appear
  through `window.__deepSpaceDebug.crew`.
- [x] Mission-critical conversation remains completable with no voice provider.
- [x] Late, malformed, empty, disconnected, and mutation-bearing presentation
  responses cannot alter authoritative state.
- [x] Desktop keyboard, gamepad Triangle, and XR select use the existing
  contextual physical-interaction path to open/close/reopen the conversation.
- [x] Flight and rendering continue if crew presentation fails.

## Explicit exclusions

No recruitment flow, roster management UI, schedules or roaming, crew combat,
death gameplay, romance, final character model, facial animation, generated
authoritative dialogue, autonomous voice capture, or ship-condition system.
`alive` and `recruited` are foundational state only; normal play cannot change
them in this phase.

## Manual checklist

- [x] Clean save: walk to the circulation corridor and see Lyra opposite the
  radio on the ship's right side.
- [x] Open with `C`, choose each branch in separate reset runs, close, and reopen.
- [x] Resolve each `A Clean Copy` outcome and confirm distinct text.
- [x] Check Phase 14 unresolved/active/delivered/failed contextual suffixes.
- [x] Save/reload before interaction, after memory capture, and after relationship
  choice; confirm no duplicate memory/event.
- [x] Invoke unavailable presentation and retain usable authored choices.
- [x] Interrupt a pending request and confirm its late response is ignored.
- [x] Reset active slot and confirm default crew state without affecting slots.
- [x] Repeat open/close/reopen with keyboard and emulated gamepad input.
- [ ] Owner headset signoff: approach, start, interrupt/exit, and reopen with a
  physical PCVR controller. Automated WebXR select routing is covered, but this
  environment has no attached headset.

## Verification record

Run all automated RPG tests with:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
```

Browser smoke and final counts are recorded when validation completes. The
PCVR device checkbox remains an explicit external-device limitation rather than
being inferred from desktop emulation.
