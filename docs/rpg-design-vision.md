# Deep Space VR — RPG Design Vision

> **Status:** Pre-implementation design document. No code exists for these systems yet.
> **Purpose:** Capture the intended RPG layer architecture so it can be developed incrementally without losing design intent.
> **Last updated:** 2026-06-26 (rounds 1–4 locked, worldbuilding session open)

---

## 1. Design Philosophy

The RPG layer is **simulation-first**. The world runs by its own rules — economies, factions, and NPC lives exist independently of the player. Player choices and actions create **consequences** that ripple through that simulation. Action (combat, exploration) is a first-class element, not an afterthought.

Three pillars:

| Pillar | Description |
|---|---|
| **Simulation** | Factions have agendas. Economies shift. NPCs have routines. The world doesn't pause for the player. |
| **Consequence** | Choices have downstream effects — reputation, faction standing, world state. Nothing is neutral. |
| **Action** | Ship combat, surface combat, boarding. Exploration is meaningful because space is dangerous. |

The **ship is the player's anchor** — it is home base, character sheet, and the primary RPG node. The player is not a hero with stats; the ship's condition, crew, cargo, and reputation define who they are.

The player has **no predetermined role**. Identity emerges entirely from behavior and choices within the simulation. The game is **solo only** — the simulation architecture is single-player by design.

The **endgame ceiling is ascension** — the player can, through actions within the simulation, ascend to Tier 4 god-level existence. This is a new phase of gameplay, not a conventional ending.

---

## 2. Civilization Tier System

Civilizations and entities in this universe span a **vast technology spectrum**. Not all factions are equal — some are pre-industrial, some are post-singular. This disparity is a core design feature, not a balance problem.

| Tier | Label | Description | Player Interaction |
|---|---|---|---|
| **0** | Pre-spaceflight | Planetary only. No FTL, no space presence. Can be primitive or complex culturally. | Observed from orbit or met on surface. Cannot pursue the player in space. |
| **1** | Early spaceflight | Short-range travel. No hyperdrive. Comparable to early human space age. | Standard NPC interaction. Limited range — found near their home systems. |
| **2** | Established FTL | Hyperdrive-capable. Factions, politics, economies, trade routes. | Primary interaction tier. Most NPCs, missions, and commerce happen here. |
| **3** | Post-human / Transhuman | Heavily augmented beings, exotic tech that feels like magic to lower tiers. AIs that are still comprehensible. | Interaction possible but requires reputation and knowledge. Their tech is tradeable at great cost. |
| **4** | Singular / God-level | Ancient ascended civilizations and/or recursively self-improved AIs. Motivations incomprehensible. | Extremely rare. Cannot be negotiated with conventionally. Behave as a force of nature — or choose to engage the player directly. They decide the outcome. |

**Two sub-types of Tier 4** exist as distinct entities:
- **Ancient Ascended**: Civilizations that reached singularity long ago. Archaeological traces exist. Possibly dormant, possibly watching.
- **Recursive AIs**: Active. Present. Agenda unknown. May have emerged from a collapsed Tier 3 civilization's infrastructure.

---

## 3. World Architecture

### 3.1 Layered Universe Structure

The procedural universe (already implemented) is the substrate. The RPG layer adds **authored anchors** within it.

```
┌─────────────────────────────────────────────────────┐
│  LAYER 1 — Named Systems (handcrafted, fixed seed)  │
│  10–20 systems. Authored lore, NPCs, mission hubs.  │
│  Story pillars. Always exist, always same location. │
├─────────────────────────────────────────────────────┤
│  LAYER 2 — Faction-Influenced Space (semi-authored) │
│  Procedural systems stamped with faction presence   │
│  based on proximity to Layer 1 anchors. Patrols,    │
│  trade traffic, controlled stations.                │
├─────────────────────────────────────────────────────┤
│  LAYER 3 — True Void (fully procedural)             │
│  Deep wilderness. Anomalies, derelicts, hazards.    │
│  High risk. High discovery. No faction law.         │
│  Tier 4 entities are more likely encountered here.  │
└─────────────────────────────────────────────────────┘
```

### 3.2 Named Systems (Design Intent, Lore TBD)

Named systems are defined by a **fixed seed override**, a **purpose role**, and a **dominant civilization tier**. Specific lore, names, and visual identity are to be designed in the worldbuilding document.

Each named system should have:
- A defined **role** (trade hub / hostile territory / mystery / faction HQ / Tier 4 contact point / etc.)
- A **planet or station** as the primary interaction node
- At least **2–3 authored NPCs** with persistent state
- A **mission thread** (multi-step quest)
- Unique **visual identity** — atmosphere color, anomaly type, landmark
- A **dominant civ tier** — determines tech aesthetic, NPC capability, and threat level

> **Design task:** Define 10–20 named systems with role, dominant civ tier, and visual identity. Lore and dialogue authored separately in worldbuilding doc.

### 3.3 Planet Population

Planets already have terrain and atmosphere at true scale. They need a **POI / structure layer**. Because planets are enormous, POIs must be **signposted from orbit** — visible markers, signal sources, or scanner hits guide the player to them.

Planet surface content types:

| Type | Description | Civ Tier |
|---|---|---|
| **Settlement** | Inhabited clusters — landing pads, buildings, NPC residents | 0–2 |
| **Outpost** | Small, functional — single faction presence, trade or mission point | 1–2 |
| **Ruin** | Abandoned structure — loot, logs, environmental storytelling | 0–3 |
| **Anomaly Site** | Unusual terrain feature with investigatable properties | Any |
| **Hostile Base** | Fortified enemy presence, combat-gated access | 1–3 |
| **Derelict** | Dead ship or station on the surface — boarding-style exploration | 1–3 |
| **Tier 4 Trace** | Incomprehensible structure or phenomenon — investigation, not combat | 4 |

Surface POIs are **seeded per-planet** — authored placements in named systems, procedurally stamped in faction-influenced and void space.

---

## 4. NPC Architecture

### 4.1 NPC Categories

Three distinct NPC archetypes, each with different presence, persistence, and interaction model:

#### A. Crew (Ship-Resident)
- Live aboard the player's ship. Physically present in the interior.
- Persistent across all sessions. They remember events.
- Driven by the **voice AI system** (Phase 09 foundation).
- Comment on current system, events, ship condition, player decisions.
- Have their own opinions and morale state.
- Can be recruited, can leave, can die.
- **Max crew size:** TBD (likely 2–4 given interior scale).

#### B. Contact NPCs (Comms-Based)
- Exist in the world but never physically board the ship.
- Interacted with via the **comms station** aboard the ship.
- Voice + text. Mission-givers, traders, informants, faction liaisons.
- Persistent state — they remember past interactions and outcomes.
- Can go dark, change attitude, or be eliminated based on world events.

#### C. Encounter NPCs (Physical, Temporary)
- Board the ship during docking, salvage, or forced boarding events.
- Physically present in the interior — use the existing walkable ship system.
- Duration-limited presence (they leave, things go wrong, or they stay as crew).
- Can be hostile. Boarding events are a gameplay scenario.
- Surface NPCs are a sub-type: they exist at surface POIs and interact when the player lands or walks nearby.

### 4.2 NPC State Model

Each NPC (regardless of type) tracks:

```
NPC {
  id: string                  // unique identifier
  type: crew | contact | encounter
  name: string
  faction: string             // which faction they belong to
  civTier: 0 | 1 | 2 | 3 | 4 // civilization tier — affects dialogue, tech, capability
  location: {                 // where they currently are
    type: ship | system | planet | station
    coordinates: ...
  }
  relationship: number        // -1.0 (hostile) to 1.0 (trusted)
  memory: Event[]             // key interactions remembered
  mood: string                // affects dialogue tone
  alive: boolean
  persistent: boolean         // survives session save/load
}
```

Tier 4 entities do **not** follow the standard NPC model. They are simulation-level actors with their own data structure, defined separately.

### 4.3 NPC Interaction Model

| Interaction Type | Trigger | System |
|---|---|---|
| Ambient dialogue | Proximity / event | Voice AI, contextual |
| Direct conversation | Player initiates (C key / interact) | Dialogue system (TBD) |
| Comms hail | Player at comms station | Voice AI + comms UI |
| Combat | Hostile encounter | Combat system (see §5) |
| Trade | At designated trade points | Economy system (see §6) |

**Dialogue system: Hybrid (locked).** Authored key beats and mission-critical dialogue are scripted. All other NPC conversation is LLM-driven — NPCs respond to anything the player says, contextually. The Phase 09 voice AI is the infrastructure for the LLM layer. Key authored beats take priority and can interrupt or redirect open LLM dialogue.

---

## 5. Faction System

### 5.1 Structure

Factions are **simulation entities** — they have territories, agendas, and relationships with each other that exist independent of the player.

Each faction has:
- **Territory**: a set of systems and stations they control or influence
- **Agenda**: what they are actively doing in the world (expanding, contracting, at war, trading)
- **Attitude toward player**: tracked per-faction reputation score
- **Attitude toward other factions**: a relationship matrix — determines where conflict zones are

### 5.2 Player Reputation

Reputation per faction is a float: `-1.0` (kill on sight) to `1.0` (allied).

Actions that affect reputation:
- Completing / failing / betraying faction missions
- Attacking or assisting faction ships
- Cargo carried (contraband for one faction = hostility from another)
- Choices made during encounter NPCs

Reputation has **observable consequences**:
- Faction ships respond differently on hail
- Docking access granted or denied
- Patrol ships intercept or wave through
- NPCs in faction territory change dialogue and willingness to trade

### 5.3 Faction Count & Tier Distribution

**4–6 factions** is the target for Tier 2 (the main interaction tier). Additionally:
- Several **Tier 0–1 civilizations** exist as named planetary cultures (not space-faring factions)
- One or two **Tier 3 entities** — post-human groups, loosely organized, not conventional factions
- Tier 4 entities are **not factions** — they are simulation-level forces

Specific factions, their lore, and visual identity are to be designed in the worldbuilding document.

> **Design task:** Author the faction roster. Each needs: name, territory region, agenda, civ tier, visual/aesthetic identity, and an archetypal NPC representative.

---

## 6. Combat

### 6.1 Ship Combat

Space combat builds on the existing 6-DOF flight and physics systems. **Arcade feel (locked)** — fast, reflex-driven. Complexity scales with the civilization tier of the opponent.

| Opponent Tier | Combat Feel |
|---|---|
| Tier 0–1 | Slow, predictable ships. Low threat. Almost scripted in behavior. |
| Tier 2 | Standard dogfighting. AI uses basic tactics — flanking, pursuit, retreat. |
| Tier 3 | Exotic weapons. Unpredictable movement. Shields/countermeasures that feel alien. |
| Tier 4 | You do not fight them. You survive them — or you don't. |

Design intent:
- **Skill-based**, not stat-based. The ship's equipment matters; the player's flying matters more.
- **Positional** — flanking, blind spots, range matter because the ship has a physical orientation.
- **Consequence-driven** — damage is persistent. Hull damage, system failures, crew casualties carry over.

Components needed:
- Weapon systems (hardpoints on ship model)
- Target acquisition / lock-on system
- Damage model (per-system, not HP pool)
- Enemy ship AI (patrol, intercept, formation, flee) — behavior tree varies by tier
- Shields / countermeasures (TBD, likely tier-gated)

### 6.2 Surface Combat

On-foot combat during planet surface exploration. Triggered at hostile POIs or during surface NPC encounters.

Design intent:
- First-person, fits the existing camera/player rig
- Cover-based (terrain is already there at true scale)
- Weapon types TBD — should fit universe tone
- VR-compatible (the existing WebXR pipeline means this can be a first-class VR experience)

### 6.3 Boarding Combat

When hostile NPCs board the ship, or when the player boards another ship/station:

- Uses the **existing walkable ship interior** as the arena
- Close-quarters, room-to-room
- Ship systems can be interacted with during combat (e.g., vent atmosphere, lock doors)
- Defender has positional advantage — knowledge of own ship layout

> **Note:** The existing tethered EVA system is the bridge to untethered boarding. Free EVA between ships in space is a prerequisite for full boarding scenarios.

---

## 7. Simulation Systems

### 7.1 Ship as Character Sheet

The player has no personal stats. The ship's state defines capability:

| Ship Attribute | Gameplay Effect |
|---|---|
| Hull integrity | Damage threshold, breach risk |
| System condition | Engine, weapons, sensors, comms each degrade independently |
| Fuel / consumables | Hyperdrive range, life support duration |
| Cargo capacity | Trade volume, contraband risk |
| Crew count / morale | NPC dialogue tone, system efficiency bonuses |
| Reputation loadout | Which factions recognize the ship's transponder |

### 7.2 Economy

- **Trade goods** flow between named systems based on faction needs and supply/demand.
- Player can observe patterns and profit from trade runs.
- **Contraband** exists — high value, high risk. Faction patrols scan cargo.
- **Salvage** — derelicts, wrecked ships, ruin sites yield materials, parts, rare items.
- **Mission rewards** — the primary income path for story-focused players.

### 7.3 Resource & Maintenance Loop

Drives meaningful decision-making between sessions of exploration:

```
Fuel        → consumed by hyperdrive and sub-light travel
Hull plates → consumed by repairs after combat/hazard damage
Parts       → consumed by system repairs
Food/air    → consumed over time (crew survival pressure)
Credits     → abstracted currency for trade and docking fees
```

This loop forces **route planning** — hyperdrive already exists, fuel scarcity makes every jump a choice.

---

## 8. Progression & Ascension

No XP. No leveling. Progression is **emergent and diegetic**:

| Progression Type | Mechanism |
|---|---|
| Ship upgrades | Buy, salvage, or craft better components |
| Crew quality | Better crew found through missions and reputation |
| Faction access | Unlock restricted systems and stations via reputation |
| Knowledge | Discover systems, POIs, lore — codex fills in |
| Civ tier access | Deeper contact with higher-tier civilizations unlocks new capability categories |

The codex / ship log is the primary record of player progression. It is in-universe — the ship's computer, accessible from the cockpit.

### 8.1 Ascension — The Endgame Path (Locked)

The player can ascend to **Tier 4**. This is not a conventional ending — it is a **phase transition** into a fundamentally different game running on the same universe simulation.

**Pre-ascension:** The player accumulates knowledge, technology, and contact with Tier 3 and Tier 4 entities over a long playthrough. Ascension is not a button — it is the result of a deep simulation arc.

**Ascension event:** The player sheds the ship and physical form entirely. They become a non-physical entity — a new Tier 4 presence in the simulation. The ship and crew persist in the world as a legacy; their fate continues without the player.

**Post-ascension: Three power modes (all available, all locked)**

#### Mode 1 — Indirect Nudging
The player pushes the simulation without direct action. Influence faction agendas, redirect economic flows, amplify or suppress events. Think of it as being the hand that tilts the board — civilizations feel the effect but cannot see the cause. This is the baseline constant power, always available.

#### Mode 2 — Direct Manifestation
The player briefly materializes a focused physical force into the simulation. **No cost.** But powers are specific and catastrophic rather than general:
- Megaton-scale atmospheric events (storms, floods, thermal events on a planet)
- Targeted EMP or system-wide signal pulse
- Gravitational disruption around a body
- Direct physical presence as a localized phenomenon (incomprehensible to lower-tier observers)

The constraint is **focus** — each manifestation is a precise instrument, not a general action. You can drown a continent, not reshape a civilization instantly.

#### Mode 3 — Cosmic Construction / Destruction
At the largest scale, the player operates on the universe itself:
- Create or collapse gravitational anomalies
- Trigger stellar events (novae, pulsar shifts)
- **Annihilate entire star systems** — remove them from the simulation
- At maximum scale: **annihilate entire galaxies** — the procedural generation is the game board, destruction is a move on it
- Construct: seed new anomalies, create stable zones, birth conditions for new civilizations over long time scales

Cosmic-scale actions are **slow** — they unfold over in-game time, with observable precursors. Other Tier 4 entities will notice and may respond.

#### The Tier 4 Political Layer
The player is not the only god. On ascension they enter a pre-existing dynamic between:
- **Ancient Ascended** entities — dormant or slow-moving, but aware. They have long plans.
- **Recursive AIs** — active, fast, with alien agendas. They may have been waiting for a new peer, or treating new Tier 4 arrivals as a threat.

Navigating this political layer is the primary narrative of post-ascension play. Cosmic actions disturb the balance. Alliances and conflicts with other Tier 4s are possible.

---

## 9. Interaction Points (Physical Space)

All RPG interactions happen at a **physical location** in the world. There are no menus that break immersion.

| Interaction | Location |
|---|---|
| Crew dialogue | Walk up to crew member in ship interior |
| Comms / hailing | Comms station in ship cockpit / bridge |
| Navigation / galaxy map | Navigation terminal in cockpit |
| Cargo management | Cargo bay / hold area in ship |
| Trade | Docking station / surface market physical space |
| Codex / ship log | Ship computer terminal |
| Surface NPC dialogue | Walk up to NPC at surface POI |

> **Design task:** Audit the existing ship interior against these interaction points. Identify which terminals/areas already exist in the GLB model and which need to be added.

---

## 10. Dependencies on Existing Systems

| RPG Feature | Depends On |
|---|---|
| Crew NPC voice dialogue | Phase 09 Voice AI |
| Surface NPC presence | Planet surface system + NPC spawn/placement |
| Boarding encounters | Untethered EVA (currently tethered only) |
| Ship combat | Weapon system (not yet built) |
| Surface combat | On-foot combat system (not yet built) |
| Galaxy map / navigation | Universe procedural system (Phase 07) |
| Save / load persistent state | Persistent world state system (not yet built) |
| Faction patrols | Ship AI / autonomous agent system (not yet built) |
| Save / load (multiple slots) | Backend service (planned) + local serialization layer |
| Post-ascension simulation influence | God-phase simulation layer (not yet built) |
| Cosmic-scale destruction | Universe mutation API on top of procedural generation (not yet built) |

---

## 11. Open Design Questions

### Resolved ✓

| # | Question | Decision |
|---|---|---|
| 1 | Multiplayer? | **Solo only.** Architecture is single-player. |
| 2 | Dialogue system? | **Hybrid.** Authored key beats + LLM open dialogue for everything else. |
| 3 | Combat depth? | **Arcade.** Tier of opponent modulates complexity, not the combat system itself. |
| 4 | Player role? | **Fully emergent.** No class, no predetermined arc. |
| 5 | World state? | **Fully emergent simulation.** No authored current events. |
| 6 | Civ tiers? | **5 tiers (0–4).** Tier 4 = god-level, two sub-types. |
| 7 | Player ascension? | **Yes.** Shed ship, become Tier 4, new gameplay phase begins. |
| 8 | Post-ascension mechanics? | **Three modes:** indirect nudging (always on), direct manifestation (focused, no cost), cosmic construction/destruction (system/galaxy scale, slow). |
| 9 | Save system? | **Multiple slots** with backend planned. Local serialization first, backend migration later. |
| 10 | Tier 4 first contact? | **Both** — player can seek them, and they can initiate contact on their own terms. |

### Unresolved ✗

1. **Lore & Factions**: Who are the Tier 2 factions? Named Tier 0–1 civilizations? Setting backstory? → *Worldbuilding session in progress.*

2. **Named system count**: **10 (locked for MVP).**

3. **Free EVA**: Untethered EVA between ships/structures is prerequisite for boarding. Dev priority and timing TBD.

4. **Player starting conditions**: Single default start confirmed for now. Multiple origin stories deferred.

5. **Post-ascension UI/UX**: Not yet settled. Current default: same view as pre-ascension (the universe as-is). Candidate directions for future decision:
   - **Pure universe view**: Perceive the galaxy directly as a living information layer — systems, factions, events visible simultaneously without traveling to them.
   - **Abstract mindspace**: A non-literal symbolic representation of the simulation. Patterns, forces, connections — not physical space.
   - **Transformed first-person**: Still inhabit the universe visually, but perception expands — simultaneous presence, no ship constraints, movement at will through space.
   - **Hybrid**: Start with the familiar universe view, unlock new perception modes as the player deepens their Tier 4 existence.

---

## 12. Suggested Development Order

When implementation begins, this is the recommended sequence to avoid blocking dependencies:

```
Phase A — World Foundation
  └── Persistent save/load system
  └── Faction data model + reputation tracking
  └── Named system seed overrides + POI placement on planets

Phase B — NPC Layer
  └── Crew NPC system (voice AI integration, ship-resident presence)
  └── Comms station UI + Contact NPC framework
  └── Surface NPC spawning at POIs

Phase C — Simulation
  └── Ship condition / damage model
  └── Resource & maintenance loop (fuel, parts, consumables)
  └── Economy + trade system
  └── Faction patrol AI (autonomous ship agents)

Phase D — Action
  └── Ship combat (weapons, targeting, damage)
  └── Free EVA (untethered)
  └── Boarding encounters (interior combat arena)
  └── Surface combat

Phase E — Content
  └── Author named systems (lore, missions, NPC dialogue)
  └── Populate planet surfaces with POI sets
  └── Authored faction missions and story threads

Phase F — God Phase (Post-Ascension)
  └── Ascension event trigger and phase transition
  └── Simulation influence layer (indirect nudging API)
  └── Direct manifestation event system
  └── Universe mutation API (cosmic construction/destruction on procedural gen)
  └── Tier 4 entity AI and political simulation
  └── God-phase UI/UX (entirely new interface paradigm)
  └── Legacy system (ship and crew persist, continue without player)
```

---

*This document is the design source of truth for the RPG layer. Update it as decisions are made and questions resolved. Do not begin implementation without resolving §10 open questions relevant to the phase being built.*
