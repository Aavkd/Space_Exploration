# Phase 07 - Procedural Universe Spec

> **Status: IMPLEMENTED (desktop / PCVR target).** Phase 7 now replaces the old
> `DeepSpaceEnvironment` placeholder with the procedural `Universe` facade and
> the subsystem modules described below. Manual validation on June 24, 2026
> confirmed a dense spawn sector, full-sphere star field, galaxies, nebulae,
> black holes, POI navigation, and the F10 universe panel in the running app.
>
> This document keeps the original design contract for context. See
> [Implementation Status](#implementation-status) for what landed and the
> deferred hooks that remain intentionally uncabled.

> **Statut historique : SPEC FIGÉE.** Ce document reste le contrat de design
> d'une refonte complète de l'espace. Il est issu de 4 rounds de design avec le
> propriétaire du projet et sert de source de vérité pour les agents codeurs.
> Les valeurs numériques sont des **défauts raisonnables et tunables** (la
> plupart sont exposées dans le panneau F10), pas des constantes sacrées.

L'ancien espace (`src/space/DeepSpaceEnvironment.js`) était un placeholder :
6000 étoiles dans un demi-cube qui s'effaçaient à 28k, **un seul** trou noir,
**une seule** galaxie, **une seule** anomalie et **une seule** coquille de
nébuleuse, tous agglutinés près de l'origine. Cette phase l'a remplacé par un
véritable univers procédural via `src/space/Universe.js`.

---

## Implementation Status

### Landed

- `src/space/Universe.js` is the new facade. It keeps the previous public API
  (`group`, `update`, `getAttractors`, `setRuntimeConfig`, `setVisualGlow`) and
  adds regeneration, POIs, counts, current-node state, and compatibility aliases
  for older XR glow code.
- `src/space/universe/CosmicWeb.js` generates a finite seeded region with a
  forced dense spawn node (`Origin Cradle`), themed nodes, filaments, and void
  scatter.
- `StarField.js` creates near/mid/background star layers in a full sphere, with
  no premature 28k fade. Background stars follow the camera for the "always
  something beyond" read.
- `GalaxyField.js` creates spiral, elliptical, and irregular galaxies with
  particle detail near the player and billboard impostors at distance.
- `Landmarks.js` generates black holes, pulsars, and anomalies while reusing
  `BlackHole.js` and `SpatialAnomaly.js`. Only the nearest black holes use the
  expensive raymarch mesh; distant landmarks use impostors.
- `NebulaField.js` creates traversable nebula clouds, star clusters, and dust
  bands along filaments.
- `UniverseLighting.js` owns the dynamic directional light driven by the nearest
  hero light source, while IBL remains the fill.
- `UniverseEvents.js` schedules rare visual events: supernova flash, pulsar/ion
  pulse, and comet trail.
- `src/rendering/UniversePanel.js` adds the F10 tabbed universe panel with
  live/Regen badges, seed randomization, JSON export/import, named presets, and
  counters.
- `src/ui/UniverseNavigation.js` adds desktop POI markers and feeds the same
  marker source to the VR diegetic panel.
- `App.js` now uses `WebGLRenderer({ logarithmicDepthBuffer: true })`, raises the
  camera/sky scale, loads optional `assets/config/universe.json`, and separates
  universe tuning from F2 post-FX.
- `PostProcessingPanel.js` and `postFxPresets.js` no longer expose the old Deep
  Space sliders; F2 is post-FX/comfort/ship only.

### Deferred by design

- Full "everything is physical" gravity gameplay and danger effects remain
  uncabled. Generated objects already expose `mass` and `dangerProfile`, and the
  app still feeds nearby attractors to the existing `GravityField`.
- The 3D map/radar remains deferred. `getPOIs`, `getCurrentNode`, and the
  `SpatialIndex` hook are ready for it.
- Warp / fast travel remains unchanged. Named nodes are available as future
  destinations.

### Validation Notes

- The app was run from a static server and opened in-browser.
- F10 opens the universe panel and shows the new tabbed control surface.
- The desktop HUD shows POI markers and current sector state.
- Screenshots captured on June 24, 2026 show the spawn region filled with
  nebulae, galaxies, a visible black hole, dense stars, and POI markers.
- `node --check` passed for all `src/**/*.js` files after implementation.

---

## 1. Décisions figées (les 4 rounds)

| Axe | Décision | Conséquence d'implémentation |
| --- | --- | --- |
| **Étendue** | Grande **région finie** seedée, frontière douce | Une génération unique, pas de chunk streaming. |
| **Plateforme** | **PCVR** : Quest streamé depuis le PC = même cible que desktop. Pas de preset VR dégradé séparé | Budget = GPU PC, **mais rendu stéréo à ~90 fps** → instancing + LOD obligatoires, pas de bridage du contenu. |
| **Style** | **Crédible mais dramatisé** : base astrophysique, échelle/saturation/densité poussées | Couleurs par température stellaire mais rehaussées ; galaxies plus proches/grandes que la réalité. |
| **Reload** | **Hybride** : sliders live + bouton **Regen** | Classification claire live-vs-regen de chaque knob (§ 11). |
| **Catalogue** | 4 familles : Étoiles multi-couches, Galaxies variées, Trous noirs/Pulsars/Anomalies, Nébuleuses/Amas/Poussière | Un module générateur par famille (§ 5). |
| **Distribution** | **Toile cosmique** : nœuds (clusters) + filaments + grands vides | `CosmicWeb` pilote le placement de toutes les familles (§ 6). |
| **Taille** | **~1M unités**, « infini ressenti » | `logarithmicDepthBuffer`, `cameraFar`/`skyRadius` à 1M+, couche far en impostors (§ 4.4, § 10). |
| **Gravité** | « Tout est physique + dangers » — **DIFFÉRÉ**. On prépare l'architecture | Chaque objet porte `mass` + `dangerProfile` ; `SpatialIndex` prêt pour beaucoup d'attracteurs ; gameplay de danger non câblé (§ 12). |
| **Éclairage** | Directionnelle dynamique depuis **l'objet héros le plus proche**, teintée par sa température, transitions douces | `UniverseLighting` recalcule 1 light/frame ; IBL conservé en fill (§ 7). |
| **Vie** | **Vivant + événements rares** | Mouvement ambiant continu + `UniverseEvents` (supernova, balayage pulsar, comète, éclair ionique) (§ 8). |
| **Navigation** | **Boussole + markers** maintenant ; **carte/radar 3D différée** (hook prévu) | `UniverseNavigation` interroge le `SpatialIndex` pour les POI (§ 9). |
| **Traversée** | **Inchangée pour l'instant** ; warp/fast-travel **traité plus tard** | Le joueur **spawn dans un nœud dense** pour du contenu immédiat (§ 6.3). |
| **Panneau** | **F10**, **onglets par famille**, contrôle profond, badges live/Regen | `UniversePanel` (§ 10). Le groupe « Deep Space » **quitte F2** ; F2 devient post-FX pur. |

---

## 2. Scope de la phase

**Dans le scope (à implémenter)**
- Génération procédurale seedée d'un univers fini ~1M unités, distribution en
  toile cosmique, spawn dans un nœud dense.
- Les 4 familles d'objets, chacune en plusieurs variantes, avec LOD/impostors.
- Correction du champ d'étoiles (multi-couches, sphère complète, plus de fade
  prématuré, étoiles proches qui éclairent).
- Éclairage dynamique « objet héros le plus proche ».
- Mouvement ambiant + système d'événements rares.
- Boussole + markers de POI (HUD desktop + diégétique VR).
- Panneau F10 à onglets, contrôle profond par famille, outils (seed+randomize,
  export/import JSON, presets nommés, compteurs+perf), Regen à chaud.
- Migration : sortir le groupe « Deep Space » de F2.

**Préparé mais NON câblé (différé — voir § 12)**
- Gravité « tout est physique » + dangers (surchauffe, spaghettification).
- Carte / radar 3D manipulable.
- Régime warp / fast-travel pour la traversée.

**Hors scope**
- Vrai chunk streaming infini (on a choisi une région finie).
- Systèmes planétaires jouables, atterrissage, ressources.

---

## 3. Vue d'ensemble de l'architecture

### 3.1 Layout des modules (nouveaux fichiers)

Convention projet (cf. `docs/project-foundation.md`) : ES Modules vanilla,
imports avec extension `.js`, Three.js via l'import-map de `index.html`, **aucun
build**. `src/space/` possède la génération de l'environnement.

```text
src/space/
  Universe.js                 # Façade : génère, possède, met à jour, expose attractors/POI/counts.
  universe/
    CosmicWeb.js              # Nœuds + filaments + vides. Pilote le placement.
    SpatialIndex.js           # Grille/octree : culling + (futur) gravité + requêtes nav.
    StarField.js              # Étoiles multi-couches.
    GalaxyField.js            # Galaxies (particules proche + impostors loin).
    Landmarks.js              # Trous noirs / pulsars / anomalies (réutilise BlackHole.js, SpatialAnomaly.js).
    NebulaField.js            # Nébuleuses + amas + bandes de poussière.
    UniverseLighting.js       # Lumière directionnelle dynamique « héros le plus proche ».
    UniverseEvents.js         # Ordonnanceur d'événements rares.
    impostors.js              # Génération de sprites/impostors procéduraux (galaxies/objets lointains).
src/rendering/
  UniversePanel.js            # Panneau F10 à onglets.
src/ui/
  UniverseNavigation.js       # Boussole + markers (HUD desktop + diégétique).
src/config/
  universePresets.js          # UNIVERSE_CONFIG défaut + UNIVERSE_PRESETS nommés + résolution de noms.
assets/config/
  universe.json               # (optionnel) override chargé au boot, comme post_processing.json.
```

`src/space/DeepSpaceEnvironment.js` est **remplacé** par `Universe.js`. Pour
minimiser le churn dans `App.js`, `Universe` **conserve la surface d'API
publique actuelle** de `DeepSpaceEnvironment` et l'étend :

```js
class Universe {
  group                       // THREE.Group ajouté à la scène (inchangé)
  update(shipPosition, dt)    // (inchangé) + culling LOD, events, lighting, ambient motion
  getAttractors()             // (inchangé) mais retourne désormais N attracteurs (pas 2 fixes)
  setRuntimeConfig(cfg)       // (inchangé) params LIVE uniquement (opacity/brightness/size/tints...)
  setVisualGlow({...})        // (inchangé) compat XR glow
  // --- nouveau ---
  regenerate(config)          // reconstruit tout depuis (seed + params REGEN), sans reload app
  getPOIs(shipPosition)       // points d'intérêt triés par distance, pour la nav
  getCounts()                 // { stars, galaxies, blackHoles, pulsars, anomalies, nebulae, clusters }
  getCurrentNode(shipPosition)// nœud de toile cosmique courant (nom + thème), pour le HUD
}
```

### 3.2 Pipeline de génération (déterministe)

```
masterSeed (string, ex. "deep-space-vr-foundation")
  -> hash -> seeds dérivés par sous-système :
     seedCosmicWeb, seedStars, seedGalaxies, seedLandmarks, seedNebulae, seedEvents
  -> CosmicWeb.generate(seedCosmicWeb, regionConfig) => { nodes[], filaments[], voids[] }
  -> chaque générateur de famille place ses objets en échantillonnant la toile :
       position = sampleCosmicWeb(rng, nodes, filaments, biasParams)
  -> SpatialIndex.build(tous les objets) pour culling/nav/(futur) gravité
```

Réutiliser le générateur seedé existant (mulberry32-like) de
`DeepSpaceEnvironment.js` (`createSeededRandom`) — l'extraire dans un util
partagé (`src/space/universe/rng.js` ou garder inline). Dériver un sous-seed =
hacher `masterSeed + ":" + subsystemName`.

**Déterminisme garanti** : même `masterSeed` + mêmes params Regen => univers
identique au pixel près. C'est ce qui rend le champ Seed + l'export JSON utiles.

### 3.3 Couches de rendu & profondeur

Région de 1M d'unités => le depth buffer par défaut (near 0.1, far 1.2M)
z-fight violemment. **Obligatoire :**

- `WebGLRenderer({ logarithmicDepthBuffer: true })` (à ajouter dans `App.js`).
  ⚠️ Valider en WebXR (le log depth peut interagir avec le rendu stéréo —
  tester sur Quest 3 streamé, cf. checklist).
- `camera.far` -> ~1_200_000 ; `DEEP_SPACE_PRESET.cameraFar` et `skyRadius`
  montent en conséquence. `near` peut rester 0.1 (intérieur du vaisseau).
- Le fog `FogExp2` actuel (`density 0.00002`) doit être recalculé pour une brume
  douce qui mange la frontière de région (~vers 700k–1M), sans noyer le contenu
  proche.

**4 couches LOD par distance** (seuils tunables) :
1. **Hero (proche)** : raymarch/particules pleine qualité. Cap dur sur le nombre
   simultané (ex. 1–2 trous noirs raymarchés, 3–5 galaxies en particules).
2. **Mid** : version allégée (moins de particules / shader simplifié).
3. **Far** : **impostor** = billboard texturé (sprite procédural généré une fois,
   cf. `impostors.js`) orienté caméra. C'est ce qui permet des dizaines de
   galaxies sans exploser le budget.
4. **Background** : coquille d'étoiles très lointaines qui **suit la caméra**
   (parallaxe ~0), garantit le « toujours quelque chose au fond » même au bord.

`SpatialIndex` fournit le culling distance/frustum : les objets hors champ ou
au-delà de la couche far ne sont pas mis à jour.

---

## 4. Échelle & frontière

- **Région** : sphère de rayon ~500k (diamètre 1M). `regionRadius` tunable
  (presets « infini ressenti » -> 500k, « compact dense » -> 100k).
- **Frontière douce** : densité d'objets qui décroît vers le bord + brume fog qui
  monte ; pas de mur dur, pas de collision. Au-delà du rayon, plus de spawn.
- **Spawn** : le vaisseau démarre dans un **nœud dense** (§ 6.3) placé à
  l'origine, pour du contenu immédiat tout autour (la traversée étant lente et
  différée).

---

## 5. Spécification par famille

> Toutes les valeurs sont des défauts tunables. « LIVE » = modifiable sans Regen,
> « REGEN » = nécessite reconstruction (voir § 11).

### 5.1 Étoiles multi-couches (`StarField.js`) — corrige le bug principal

**Bugs actuels à corriger** (cf. `DeepSpaceEnvironment._createStars`) :
- Distribution seulement en `z` négatif -> **passer à une sphère complète** (toutes
  directions).
- `fade = 1.0 - smoothstep(10000.0, 28000.0, length)` efface presque tout ->
  **supprimer ce fade prématuré** ; ne garder qu'une atténuation de taille par
  distance + un fade très doux uniquement à la frontière de région.
- Trop peu d'étoiles et trop ternes -> densité fortement augmentée + 3 couches.

**3 couches** (un `THREE.Points` + `ShaderMaterial` additif par couche, pas
d'alloc par frame) :

| Couche | Rôle | Count défaut (REGEN) | Rayon | Taille | Notes |
| --- | --- | --- | --- | --- | --- |
| **near** | proches & brillantes, biaisées vers les nœuds | ~5 000 | 0–80k | grande | source des étoiles « héros » qui éclairent (§ 7). |
| **mid** | corps du champ | ~25 000 | 80k–400k | moyenne | suit la toile cosmique. |
| **background** | fond lointain, suit la caméra | ~60 000 | coquille | petite | parallaxe ~0, « infini ressenti ». |

- **Température de couleur** (LIVE tint) : échelle bleu chaud (`#aaccff`) ->
  blanc (`#ffffff`) -> jaune (`#fff0c0`) -> rouge froid (`#ffb080`), distribution
  pondérée (plus de naines rouges/jaunes, peu de bleues) mais **saturation
  rehaussée** (style dramatisé). Palette éditable dans le panneau.
- **Scintillement** : conserver/améliorer le `twinkle` du shader actuel (vitesse
  LIVE).
- **Étoiles héros** : les `N` étoiles `near` les plus brillantes/proches sont
  marquées `isHeroLight = true` et candidates source lumineuse (§ 7) ; rendues
  avec un léger halo/lens-flare.
- Knobs : `enabled`, `nearCount`/`midCount`/`bgCount` (REGEN), `brightness`,
  `size`, `opacity`, `twinkleSpeed`, `temperatureBias`, `saturation` (LIVE).

### 5.2 Galaxies variées (`GalaxyField.js`)

- **Count** : ~30–60 galaxies sur la région (REGEN), placées sur nœuds/filaments.
- **Types** (REGEN, proportions tunables) :
  - **Spirale** : bras logarithmiques (réutiliser/améliorer la génération de
    `_createLandmarkGalaxy`), bandes de poussière sombres, bulbe central chaud.
  - **Elliptique** : nuage gaussien diffus, gradient chaud->froid, peu de structure.
  - **Irrégulière** : amas bruité, asymétrique, riche en régions bleues.
- **LOD** :
  - **proche** (`< ~120k`) : `THREE.Points` détaillé (~3 600–8 000 particules,
    comme aujourd'hui mais varié).
  - **loin** : **impostor** sprite billboard (texture procédurale par type,
    générée une fois dans `impostors.js`). Cap des galaxies « particules »
    simultanées (LOD par distance).
- **Couleur** (LIVE) : cœur bleu/blanc chaud -> périphérie magenta/rouge
  (dramatisé), par type. Palettes éditables.
- **Taille** : rayon 3k–30k (REGEN range), orientation aléatoire (REGEN).
- **Mouvement** : rotation lente sur l'axe propre (LIVE speed), cf. § 8.
- Knobs : `enabled`, `count`, `spiralRatio`/`ellipticalRatio`/`irregularRatio`,
  `sizeMin`/`sizeMax` (REGEN) ; `opacity`, `brightness`, `colorInner`/`colorOuter`,
  `rotationSpeed`, `pointSize` (LIVE).

### 5.3 Trous noirs, pulsars & anomalies (`Landmarks.js`)

Réutilise **`src/space/BlackHole.js`** (raymarch disque d'accrétion + jets
pulsar) et **`src/space/SpatialAnomaly.js`** tels quels (paramétrés).

- **Counts** (REGEN) : trous noirs ~4–8 (dont **1 garanti dans le nœud spawn**),
  pulsars ~2–5 (sous-ensemble `isPulsar = true`, avec jets), anomalies ~6–15.
- **LOD trou noir** (le raymarch à 240 steps est **cher**) :
  - nearest 1–2 -> raymarch plein.
  - au-delà -> billboard glow (sprite : disque lumineux + halo), pas de raymarch.
  - C'est un point de perf critique : ne **jamais** raymarcher tous les trous
    noirs simultanément.
- **Pulsars** : `isPulsar` active les jets ; le **balayage de phare** est un
  événement (§ 8).
- **Couleur/glow** : `colorInner`/`colorOuter`, `bloomIntensity` (LIVE),
  `diskRadius`, `distortion`, `scale` (mix LIVE/REGEN).
- Chaque landmark porte `mass` (réutilise `ATTRACTOR_MASS`) + `dangerProfile`
  (§ 12), même si la gravité étendue est différée.
- Knobs par sous-type : counts (REGEN) ; bloom/couleurs/distortion/scale (LIVE).

### 5.4 Nébuleuses, amas & poussière (`NebulaField.js`)

Réutilise/étend le shader de nébuleuse volumétrique actuel
(`_createNebula`, FBM + soft sprites).

- **Nébuleuses** : ~8–20 grands nuages (REGEN), **traversables** (placés pour
  qu'on puisse voler dedans), palettes variées (émission rouge Hα, réflexion
  bleue, planétaires vertes/cyan — dramatisées). Tailles 15k–60k.
- **Amas** : ~10–30 (REGEN) globulaires (sphère dense de points) / ouverts
  (groupe lâche de jeunes étoiles bleues), placés sur nœuds.
- **Poussière** : bandes de poussière faibles le long des **filaments** de la
  toile cosmique (particules sombres/teintées), donnent la structure « toile ».
- **Mouvement** : dérive/rotation très lente (LIVE).
- Knobs : `enabled`, counts (REGEN) ; `opacity`, `brightness`, `scale`,
  palettes, `driftSpeed` (LIVE).

---

## 6. Distribution en toile cosmique (`CosmicWeb.js`)

### 6.1 Génération

1. **Nœuds** : tirer `nodeCount` (REGEN, ex. 12–24) centres dans la région
   (biais vers une distribution non uniforme — quelques gros nœuds, plusieurs
   petits). Chaque nœud : `position`, `radius`, `densité`, **`theme`** (poids de
   familles, voir § 6.2), `name` (généré, pour la nav et la future carte).
2. **Filaments** : relier chaque nœud à ses ~2–3 plus proches voisins ->
   segments le long desquels on sème poussière + galaxies + étoiles diffuses.
3. **Vides** : l'espace restant ; densité de spawn quasi nulle (mais le champ
   d'étoiles `background` reste visible -> jamais « noir total »).

`sampleCosmicWeb(rng, web, bias)` : choisit un nœud (pondéré densité) ou un
filament, puis tire une position gaussienne autour ; une petite fraction
(`voidScatter`, REGEN) tombe dans les vides pour ne pas avoir des frontières
trop nettes.

### 6.2 Thèmes de nœuds

Chaque nœud a un thème qui module les proportions de familles qui y spawnent
(crée de la variété de « paysage » et alimente les noms de POI / la future carte
nommée) :

| Thème | Dominante |
| --- | --- |
| `nursery` (pouponnière) | nébuleuses d'émission + amas ouverts + étoiles bleues |
| `graveyard` (cimetière) | trous noirs + pulsars + anomalies, peu d'étoiles |
| `galactic` | concentration de galaxies |
| `mixed` | un peu de tout (thème du **nœud spawn**) |
| `deep_void` | quasi vide, contemplation |

Les thèmes pondèrent ; ils ne sont pas exclusifs. Tunable globalement (un knob
« theme variety »).

### 6.3 Nœud de spawn

Un nœud `mixed` **dense est forcé à l'origine** (`(0,0,0)`), avec garantie d'au
moins : 1 trou noir héros visible, 1–2 galaxies proches, 1 nébuleuse
traversable, des amas, un champ d'étoiles dense. Objectif : dès le lancement,
l'espace est **plein tout autour** (la traversée vers les autres nœuds étant
lente et différée).

---

## 7. Éclairage dynamique (`UniverseLighting.js`)

- Conserver l'IBL (`RoomEnvironment` PMREM) et l'ambient en **fill**.
- Remplacer le `DirectionalLight` fixe de `SkyDeepSpace` par une **lumière
  directionnelle dynamique** pilotée chaque frame :
  - trouver l'**objet héros le plus proche** émetteur de lumière (étoile héros
    `near`, ou glow d'accrétion d'un trou noir proche) via `SpatialIndex`.
  - direction = de l'objet vers le vaisseau ; **couleur = température** de l'objet
    (réutilise l'échelle de couleur stellaire) ; **intensité** ~ 1/d² clampée.
  - **lerp doux** de la direction/couleur/intensité d'une frame à l'autre pour
    éviter les sauts quand l'objet le plus proche change pendant un voyage.
- Coût : 1 light recalculée par frame (quasi nul). **Pas** de multi-lumières en
  cette phase (option « multi-sources » écartée au round 3).
- Knobs (LIVE) : `intensity`, `range`, `temperatureInfluence`, `lerpSpeed`,
  `ambientLevel`.

---

## 8. Vie & événements (`UniverseEvents.js`)

### 8.1 Mouvement ambiant (continu, LIVE)

- Galaxies : rotation propre lente (étend le `galaxy.rotation.z += dt*0.01`
  actuel, par-galaxie).
- Pulsars : pulsation du glow.
- Nébuleuses : dérive/rotation très lente (étend le `nebula.rotation.y` actuel).
- Étoiles : scintillement (existant).
- Anomalies : distorsion existante.

### 8.2 Événements rares (ordonnancés)

Ordonnanceur Poisson (taux global tunable `eventRate`, LIVE) qui déclenche
ponctuellement, sur un objet/position choisi par le RNG d'events :

| Événement | Effet |
| --- | --- |
| **Supernova** | une étoile lointaine flambe (flash intense + bloom), une **coquille en expansion** se dilate puis s'estompe ; peut laisser un rémanent (petit nuage). |
| **Balayage de pulsar** | cône/faisceau lumineux rotatif qui balaie depuis un pulsar. |
| **Comète** | traînée lumineuse en mouvement qui traverse le champ de vision, puis sort. |
| **Éclair ionique** | arcs électriques scintillants à l'intérieur d'une nébuleuse. |

- Chaque événement est court, seedé (déterminisme si même seed + même horloge
  logique), et **n'altère pas** la structure générée (pas de Regen).
- Knobs (LIVE) : `eventRate`, activation par type, intensité.

---

## 9. Navigation (`UniverseNavigation.js`)

**Maintenant : boussole + markers.**
- Interroge `Universe.getPOIs(shipPosition)` : nœuds nommés + landmarks proches,
  triés par distance.
- **Desktop** : bandeau/boussole léger + markers (nom + distance) intégrés au HUD
  télémétrie existant (`App._createTelemetryHud` / `_updateTelemetry`).
- **VR** : markers diégétiques via `DiegeticStatusPanel` (`src/ui/`), même source
  de données.
- Faible coût UI, garde le cap, évite de se perdre dans 1M d'unités.

**Différé (hook à prévoir) : carte / radar 3D.** Concevoir
`UniverseNavigation` pour qu'une future vue radar holographique manipulable
(surtout en VR) puisse consommer la **même** API `getPOIs` / `getCurrentNode` /
`SpatialIndex` sans refonte. Ne pas l'implémenter cette phase.

---

## 10. Panneau F10 (`UniversePanel.js`)

### 10.1 Activation & comportement

- **Touche F10** (libre : F2/F3/F4/F6/F7, H, V, P, L, C, Z, chiffres sont pris).
  Câbler dans `App._bindEvents` à côté de F2 ; toggle visibilité ; relâche le
  pointer lock à l'ouverture (comme F2). Mettre à jour la liste d'aide dans
  `index.html` (#hud).
- Réutiliser le style/squelette de `PostProcessingPanel.js` (mêmes CSS de base,
  fieldsets, contrôles range/checkbox/color/select) mais en **onglets**.

### 10.2 Onglets

Barre d'onglets en haut ; un seul groupe visible à la fois :

`Global` · `Étoiles` · `Galaxies` · `Trous noirs` · `Nébuleuses` · `Éclairage` ·
`Événements` · `Outils`

- **Global** : `seed` (champ texte), `regionRadius`, `masterDensity`,
  `nodeCount`, `filamentStrength`, `voidScatter`, `themeVariety`, `gravityScale`
  (déplacé de F2), `fogDensity`.
- **Étoiles / Galaxies / Trous noirs / Nébuleuses** : les knobs de § 5 (chaque
  knob marqué **LIVE** ou **REGEN** par un badge).
- **Éclairage** : knobs de § 7.
- **Événements** : taux + activation par type + intensité (§ 8.2).
- **Outils** : voir § 10.3.

### 10.3 Onglet Outils

- **Seed** : champ texte éditable + bouton **Randomize** (tire un seed aléatoire)
  + bouton **Regen** (reconstruit avec seed + params REGEN courants).
- **Export / Import JSON** : exporte la config univers complète (comme
  `PostProcessingPanel._createExportButton`) ; importe et ré-applique (live) /
  Regen ; chargement initial depuis `assets/config/universe.json` au boot
  (miroir de `App._loadInitialJsonPreset`).
- **Presets univers nommés** : boutons un clic (cf. `UNIVERSE_PRESETS`) :
  `dense_cluster`, `deep_void`, `black_hole_graveyard`, `stellar_nursery`,
  `default`.
- **Indicateurs live** : compteurs d'objets par famille (`Universe.getCounts()`),
  **fps**, nœud/secteur courant (`getCurrentNode`). Mis à jour dans la boucle.

### 10.4 Bouton Regen (sémantique)

- Les knobs **LIVE** appellent `Universe.setRuntimeConfig(...)` (+
  `UniverseLighting`/events) immédiatement, comme aujourd'hui via
  `App._applyRuntimeConfig`.
- Les knobs **REGEN** ne s'appliquent qu'au clic sur **Regen**, qui appelle
  `Universe.regenerate(config)` : dispose propre des géométries/matériaux/textures
  existants (éviter les fuites GPU), reconstruit, **sans recharger la page**, et
  re-`setAttractors` le `GravityField`.
- Un badge visuel sur chaque knob REGEN + un indicateur « changements en attente
  de Regen » pour ne pas laisser l'utilisateur croire que rien ne se passe.

### 10.5 Migration depuis F2

- **Supprimer** le groupe `Deep Space` de `PostProcessingPanel._render`
  (les knobs `starOpacity`, `starBrightness`, `starSize`, `nebulaOpacity`,
  `nebulaBrightness`, `nebulaScale`, `galaxyDensity`, `blackHoleChance`,
  `anomalyChance`, `gravityScale`).
- Déplacer ces réglages (et les **brancher réellement** — `galaxyDensity` /
  `blackHoleChance` / `anomalyChance` sont aujourd'hui **des sliders morts**) dans
  `UNIVERSE_CONFIG` + le panneau F10.
- F2 ne garde que : Bloom, Warp, Relativistic Stars, Retro/Pixel, ASCII,
  Halftone, VR Comfort, XR Post FX, Ship. Mettre à jour `App._applyRuntimeConfig` pour séparer le tuning
  univers (vers `Universe`) du post-FX (vers `RenderPipeline`).
- Le titre F2 (`POST FX / F2`) reste ; le F10 affiche `UNIVERS / F10`.

---

## 11. Schéma de config & classification LIVE/REGEN

### 11.1 `UNIVERSE_CONFIG` (défaut, dans `src/config/universePresets.js`)

Structure miroir de `postFxPresets.js` (objet plat par section, presets clonés,
résolution de noms). Esquisse :

```js
const universeDefault = {
  global: { seed: 'deep-space-vr-foundation', regionRadius: 500000, masterDensity: 1,
            nodeCount: 18, filamentStrength: 1, voidScatter: 0.06, themeVariety: 1,
            gravityScale: 1, fogDensity: 0.0000015 },
  stars:  { enabled: true, nearCount: 5000, midCount: 25000, bgCount: 60000,
            brightness: 2.4, size: 8, opacity: 1, twinkleSpeed: 1,
            temperatureBias: 0.5, saturation: 1.1 },
  galaxies: { enabled: true, count: 45, spiralRatio: 0.5, ellipticalRatio: 0.3,
              irregularRatio: 0.2, sizeMin: 3000, sizeMax: 30000,
              opacity: 0.82, brightness: 1, rotationSpeed: 1, pointSize: 24,
              colorInner: '#88ccff', colorOuter: '#ff44cc' },
  blackHoles: { enabled: true, blackHoleCount: 6, pulsarCount: 3, anomalyCount: 10,
                bloomIntensity: 1.6, distortion: 0.18, diskRadius: 6, scale: 115 },
  nebulae: { enabled: true, nebulaCount: 14, clusterCount: 20, dust: true,
             opacity: 0.72, brightness: 2.1, scale: 1.18, driftSpeed: 1 },
  lighting: { intensity: 1, range: 120000, temperatureInfluence: 1,
              lerpSpeed: 1.5, ambientLevel: 0.3 },
  events: { eventRate: 0.05, supernova: true, pulsarSweep: true,
            comet: true, ionStorm: true, intensity: 1 }
};
```

Et `UNIVERSE_PRESETS = { default, dense_cluster, deep_void, black_hole_graveyard,
stellar_nursery }` + `resolveUniversePresetName(name)`.

### 11.2 Classification

| LIVE (appliqué sans Regen) | REGEN (nécessite reconstruction) |
| --- | --- |
| toutes les `*opacity`, `*brightness`, `*size`, `pointSize` | `seed` |
| couleurs / palettes / `temperatureBias`, `saturation` | `regionRadius`, `masterDensity`, `fogDensity` |
| `bloomIntensity`, `distortion`, `diskRadius`, `scale` | tous les `*Count` (par famille + `nodeCount`) |
| `rotationSpeed`, `driftSpeed`, `twinkleSpeed` | `filamentStrength`, `voidScatter`, `themeVariety` |
| tout l'onglet `Éclairage` et `Événements` | les `*Ratio` de types, `sizeMin`/`sizeMax`, `enabled` par famille |
| `gravityScale` | |

(`enabled` par famille en REGEN par défaut : éteindre une famille libère sa
mémoire GPU à la reconstruction. On peut aussi proposer un masquage LIVE via
`group.visible` si on veut un toggle instantané — au choix de l'implémenteur,
documenter le comportement retenu.)

---

## 12. Hooks différés (préparer sans câbler)

### 12.1 Gravité « tout est physique » + dangers

- Chaque objet généré porte déjà `mass` et un **`dangerProfile`** (ex.
  `{ type: 'blackhole', lethalRadius, heatRadius, tidalRadius }`).
- `Universe.getAttractors()` peut retourner **tous** les objets massifs ; mais
  `GravityField` ne prend aujourd'hui que les **3 plus proches dans 70k**
  (`maxAttractors`, `maxDistance`). Pour passer à « beaucoup d'attracteurs » sans
  O(n) par frame, **brancher la requête sur `SpatialIndex`** (voisinage par
  cellule) — prévoir l'API maintenant, garder le comportement actuel (peu
  d'attracteurs) tant que le gameplay de danger n'est pas activé.
- Ne **pas** implémenter les effets de danger (surchauffe, distorsion visuelle,
  spaghettification) cette phase. Laisser les champs/données prêts.

### 12.2 Carte / radar 3D

- `UniverseNavigation` + `SpatialIndex` + `getPOIs`/`getCurrentNode` doivent
  suffire à alimenter une future vue radar manipulable (desktop + diégétique VR).
  Ne rien rendre en 3D cette phase.

### 12.3 Traversée (warp / fast-travel)

- Inchangée. Le spawn dans un nœud dense compense la lenteur. Quand le warp
  arrivera, les nœuds nommés deviennent des destinations ; rien à préparer de
  spécial sinon garder les positions de nœuds accessibles via `getPOIs`.

---

## 13. Plan de performance

Budget = **GPU PC en rendu stéréo à 90 fps** (PCVR). Donc :

- **Instancing GPU** : étoiles/amas/poussière en `Points` groupés (1 draw par
  couche) ; galaxies/objets lointains en **impostors instanciés** (`InstancedMesh`
  de billboards ou `Points` texturés).
- **LOD strict** (§ 3.3) : caps durs sur les objets pleine qualité simultanés
  (raymarch trou noir : 1–2 ; galaxies particules : 3–5).
- **Impostors** : pré-générer les textures de sprite une fois (`impostors.js`),
  pas par frame.
- **Culling** via `SpatialIndex` (distance + frustum) : ne pas updater l'invisible.
- `logarithmicDepthBuffer` pour la profondeur 1M (valider XR).
- **Indicateurs live** (fps + compteurs) dans F10 pour régler densité vs perf en
  direct.
- Disposer proprement à chaque Regen (géométries, matériaux, textures) pour
  éviter les fuites mémoire GPU sur reconstructions répétées.

---

## 14. Notes techniques & pièges

- **Bug étoiles** : supprimer le fade `smoothstep(10000,28000)` et la
  distribution `z`-négatif (§ 5.1). C'est le fix le plus visible, à faire tôt.
- **Sliders morts** : `galaxyDensity`/`blackHoleChance`/`anomalyChance` du F2
  actuel ne sont branchés à rien ; ils sont remplacés par de vrais counts en F10.
- **`cameraFar`/`skyRadius`/fog** : monter à ~1M+ et recalibrer le fog ; sans
  `logarithmicDepthBuffer`, z-fighting garanti.
- **WebXR + log depth** : à valider sur Quest 3 streamé (le rendu stéréo via
  `RenderPipeline`/`XRPostFxPipeline` ne doit pas casser).
- **Dispose à la Regen** : `geometry.dispose()`, `material.dispose()`,
  `texture.dispose()` sur tout l'ancien arbre avant de reconstruire.
- **Surface d'API stable** : garder `group`/`update`/`getAttractors`/
  `setRuntimeConfig`/`setVisualGlow` pour ne pas casser `App.js`,
  `XRVisualEffects`, `GravityField`.
- **Compat XR glow** : `setVisualGlow` est utilisé par le pipeline XR
  (`App._applyRuntimeConfig`) — le conserver.

---

## 15. Ordre d'implémentation suggéré

1. **7a — Fondations & fix étoiles** : `universePresets.js` + `Universe.js`
   (remplace `DeepSpaceEnvironment`, API stable) + seed model + `StarField`
   multi-couches (sphère complète, sans fade). `logarithmicDepthBuffer` +
   `cameraFar`/fog. *Gain visible immédiat : un vrai ciel d'étoiles.*
2. **7b — Toile cosmique & densité** : `CosmicWeb` + `SpatialIndex` +
   `GalaxyField` + `Landmarks` + `NebulaField` avec LOD/impostors + nœud spawn
   dense. *L'univers devient plein et structuré.*
3. **7c — Éclairage & vie** : `UniverseLighting` (héros le plus proche) +
   mouvement ambiant.
4. **7d — Panneau F10** : `UniversePanel` à onglets + migration hors F2 + Regen à
   chaud + JSON + presets nommés + compteurs/perf.
5. **7e — Navigation** : `UniverseNavigation` (boussole + markers desktop + VR).
6. **7f — Événements** : `UniverseEvents` (supernova, balayage pulsar, comète,
   éclair ionique).
7. **Hooks différés** (§ 12) : champs `mass`/`dangerProfile`, requête gravité via
   `SpatialIndex`, API nav pour future carte 3D. **Données prêtes, gameplay non
   câblé.**

---

## 16. Checklist de validation manuelle

1. Lancer le serveur statique, ouvrir l'app.
2. **Étoiles** : ciel dense dans **toutes** les directions (se retourner), pas de
   vide derrière, pas d'effacement brutal à moyenne distance.
3. **Plein autour du spawn** : trou noir héros, galaxies, nébuleuse traversable,
   amas visibles dès le départ.
4. **Voyager** longtemps dans une direction : on traverse des nœuds denses, des
   filaments, des vides — jamais de « noir total » (fond d'étoiles présent) ;
   contenu jusqu'à la brume de frontière.
5. **Éclairage** : l'ambiance lumineuse du vaisseau change selon l'objet héros le
   plus proche, transitions douces.
6. **Vie** : galaxies tournent, pulsars pulsent, nébuleuses dérivent ; au bout
   d'un moment, observer au moins un événement rare.
7. **F10** : ouvre le panneau à onglets ; modifier un knob **LIVE** (brillance
   étoiles, couleur galaxie) s'applique **immédiatement**.
8. **Regen** : changer `seed` ou un `*Count`, cliquer **Regen** -> l'univers se
   reconstruit **sans recharger la page**, déterministe (même seed => même
   univers).
9. **Randomize** -> **Regen** : univers différent à chaque seed.
10. **Export JSON**, recharger, **Import JSON** -> univers identique restauré.
11. **Presets** : `dense_cluster` / `deep_void` / `black_hole_graveyard` /
    `stellar_nursery` donnent des univers nettement distincts.
12. **Compteurs/perf** : les compteurs reflètent le contenu ; surveiller le fps en
    montant la densité.
13. **F2** : ne contient plus le groupe Deep Space ; post-FX intacts.
14. **VR (Quest 3 streamé)** : pas de z-fighting, pas de frame noire, stéréo OK,
    fps tenable ; F10 reste un outil desktop (pas requis en VR).
15. **Navigation** : boussole/markers pointent vers les POI proches avec distance.

---

## 17. Récapitulatif des fichiers touchés

**Nouveaux** : `src/space/Universe.js`, `src/space/universe/*`
(`CosmicWeb`, `SpatialIndex`, `StarField`, `GalaxyField`, `Landmarks`,
`NebulaField`, `UniverseLighting`, `UniverseEvents`, `impostors`),
`src/rendering/UniversePanel.js`, `src/ui/UniverseNavigation.js`,
`src/config/universePresets.js`, `assets/config/universe.json` (optionnel).

**Modifiés** : `src/app/App.js` (instancier `Universe` au lieu de
`DeepSpaceEnvironment`, F10, `logarithmicDepthBuffer`, `cameraFar`, séparation
univers/post-FX dans `_applyRuntimeConfig`, debug hooks), `src/config/deepSpacePreset.js`
(cameraFar/skyRadius/fog), `src/rendering/PostProcessingPanel.js` (retirer le
groupe Deep Space), `src/config/postFxPresets.js` (retirer la section `deepSpace`),
`src/rendering/SkyDeepSpace.js` (la light devient dynamique via `UniverseLighting`),
`index.html` (#hud : ajouter la ligne F10).

**Réutilisés tels quels** : `src/space/BlackHole.js`, `src/space/SpatialAnomaly.js`,
`src/space/GravityField.js` (API inchangée ; future requête via `SpatialIndex`).
