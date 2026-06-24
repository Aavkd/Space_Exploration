# Ship Design - Phase 02

## Intention

Le vaisseau est l'espace central du jeu, pas un simple vehicule vu de dehors. Il doit rester compact, habitable et lisible dans le vide Deep Space : coque sombre metallique, accents froids cyan/bleu, quelques touches magenta/orange, silhouette claire a distance, interieur utilitaire et stable pour le joueur.

Le blockout procedural de `src/ship/ShipModel.js` sert toujours de contrat de design. Il n'est plus le modele affiche par defaut : le vaisseau actif est desormais un GLB importe (`ship.glb`, coque Star Citizen convertie depuis `.ctm` via Blender), charge par `src/ship/ShipModelGLB.js`. Le blockout reste disponible via `new Ship({ variant: 'procedural' })`. Le GLB est normalise sur la longueur de 34 m et reutilise le meme repere d'anchors/zones ; ce document reste la reference d'echelle et d'anchors a respecter. Voir `docs/phase-02-ship-design.md` pour le detail de l'import (materiaux, IBL, vitres, animations, FX).

## Silhouette exterieure

- Longueur : 34 m.
- Largeur : 13.6 m avec nacelles laterales.
- Hauteur : 7.4 m.
- Avant : cockpit/baie vitree cyan, lisible sans devenir cockpit d'avion.
- Centre : coque sombre allongee, dorsal spine et lignes lumineuses froides.
- Cotes : pods utilitaires qui donnent une forme reconnaissable en camera debug.
- Arriere : bloc moteur massif, quatre thrusters visibles, glow orange discret.
- Sas : porte laterale portside avec liseres orange, proche du spawn exterieur.

La direction reste Deep Space : formes fonctionnelles, matiere sombre, emission froide, pas de palette claire ou terrestre.

## Interieur explorable

Unite : 1 unite Three.js = 1 metre.

Zones :

- Cockpit : siege pilote, console de controles, grande fenetre avant.
- Circulation : couloir central court, 3.2 m de largeur libre pour eviter l'effet tunnel VR.
- Observation bay : fenetres laterales et reperes fixes pour lire le mouvement spatial.
- Airlock : sas lateral portside, volume de transition interieur/exterieur.
- Reactor bay : zone technique arriere avec coeur reacteur et panneaux de service.

Hauteurs et confort :

- Plancher a `y = 0`.
- Oeil debug/joueur a `y = 1.65`.
- Plafond interieur autour de `2.7 m`.
- Largeur minimale utile du sas : `2.2 m`.
- Les ribs plafond, handrails et centreline cyan sont des reperes visuels stables.

## Anchors requis

Tous les anchors existent dans `src/ship/ShipInterior.js`, sont ajoutes au scene graph et sont exposes via `ship.getAnchorNames()`, `ship.getAnchorSummary()` et `window.__deepSpaceDebug`.

| Anchor | Position locale | Role |
| --- | --- | --- |
| `cockpitSeat` | `[0, 0.45, -11.75]` | interaction assise/pilotage |
| `pilotControls` | `[0, 1.1, -13.15]` | prise de controle future |
| `exitAirlock` | `[-5.7, 1.05, 4.2]` | sortie par sas |
| `interiorSpawn` | `[0, 0, -1.4]` | spawn joueur dans le referentiel vaisseau |
| `exteriorSpawn` | `[-9.2, 0.4, 4.2]` | spawn exterieur proche du sas |
| `cameraDebugMount` | `[0, 1.65, -3.8]` | entree en vue interieure debug |

## Contraintes VR

- Eviter les couloirs et postes de pilotage trop etroits.
- Garder au moins 1 m autour des interactions principales.
- Ne pas utiliser de lumieres clignotantes rapides ; les glows actuels sont fixes.
- Garder des reperes visuels horizontaux/verticaux : handrails, ribs, deck line.
- Le warp/FOV boost restera a traiter comme effet desktop ou VR-safe plus tard.
- Le vaisseau doit continuer a exister physiquement pendant que le joueur marche dedans.

## Remplacement par modele final

Partiellement realise : `ship.glb` est charge en parallele du blockout via la
variante `glb`. Le contrat reste valable pour tout futur modele :

- les anchors gardent exactement les memes ids ;
- le root conserve `ShipRoot -> ShipExterior / ShipInterior`;
- les volumes de circulation restent au moins aussi confortables ;
- les thrusters et le sas restent lisibles depuis l'exterieur ;
- les fenetres permettent de lire l'echelle Deep Space depuis l'interieur.

Reste a faire pour le GLB actuel : aligner les anchors et les volumes
marchables sur l'interieur importe (les anchors sont encore ceux du blockout
abstrait), et prevoir une variante LOD/decimee pour la VR.
