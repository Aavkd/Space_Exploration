# Phase 09 - Assistant IA vocal

## Objectif

Creer une feature d'assistant IA avec laquelle l'utilisateur interagit uniquement par la voix dans l'experience finale. Avant l'integration complete dans Deep Space VR, la partie IA vocale sera developpee et validee dans un projet/service separe, lance a cote de l'application principale.

Ce service vocal doit permettre de configurer en profondeur le comportement de l'assistant : providers LLM, transcription vocale, synthese vocale, prompts, personnalite, memoire, modes d'interaction et capacites exposees a l'application.

Nom du service/projet separe : `deep-space-voice`.

Emplacement cible dans le repository : `services/voice-ai`.

## Perimetre Fonctionnel

L'assistant doit pouvoir couvrir plusieurs roles, tous parametrables par configuration :

- Guider l'utilisateur dans l'experience.
- Repondre a des questions libres.
- Controler l'application.
- Jouer un role ou un personnage dans l'univers.

Le comportement ne doit pas etre code en dur pour un seul persona. Il doit pouvoir etre adapte par configuration, prompts et modules.

## Principe d'architecture

La feature IA vocale sera isolee dans une instance/service separe de l'application principale.

Le service separe sera developpe en Python avec FastAPI.

## Perimetre V1

La V1 doit valider le coeur vocal et la configurabilite du service sans encore implementer le controle applicatif avance.

Inclus en V1 :

- Service `deep-space-voice` dans `services/voice-ai`.
- Lancement Docker.
- Backend Python/FastAPI.
- Dashboard web multi-pages.
- Configuration providers LLM, STT, TTS, embeddings et personas.
- Conversation Test utilisable sans lancer Deep Space VR.
- Test texte debug.
- Capture micro navigateur.
- Pipeline micro -> STT -> LLM -> TTS -> audio.
- Mode dry run pour inspecter les etapes.
- STT `faster-whisper` par defaut.
- TTS switchable Piper et Coqui/XTTS.
- Providers LLM configurables : Ollama local, Ollama serveur prive, OpenRouter, OpenAI, Anthropic, Gemini.
- Fallback provider configurable.
- Personas multiples configurables, avec import/export JSON.
- Premier persona narrateur : "Eternity & Infinity, The One above All".
- Memoire persistante locale SQLite.
- Recherche semantique/vectorielle locale.
- Embeddings configurables par provider.
- Wake word configurable.
- Logs sans audio brut par defaut.
- Mode debug explicite pour sauvegarde temporaire audio brut.
- Tests unitaires backend, tests API et tests pipeline audio.

## Perimetre V2

La V2 pourra ajouter le controle applicatif et l'integration plus profonde avec l'experience.

Prevus pour V2 ou plus tard :

- Controle de Deep Space VR via tools/commandes.
- Format exact des commandes applicatives.
- Permissions/confirmations pour actions sensibles.
- Integration temps reel complete avec l'application principale.
- Personas/NPCs supplementaires.
- Regles avancees de memoire par profil, persona ou session.
- Voix clonables/custom plus poussees.
- Authentification admin si le service est expose au reseau.

## Architecture recommandee V1

Structure conceptuelle recommandee :

- `api` : routes FastAPI, WebSocket, schemas d'entree/sortie.
- `config` : chargement, validation et sauvegarde des presets JSON.
- `providers` : abstractions LLM, embeddings, STT et TTS.
- `conversation` : orchestration STT -> contexte -> LLM -> TTS.
- `personas` : gestion des prompts, voix, styles et presets.
- `memory` : SQLite, historique, preferences, resumes et recherche semantique.
- `audio` : capture/chunks, normalisation, VAD, wake word et streaming futur.
- `logs` : evenements, erreurs, timings et traces debug.
- `dashboard` : interface admin moderne et maintenable.
- `tests` : tests backend, API et pipeline audio.

L'implementation doit garder des frontieres claires entre orchestration conversationnelle, providers et configuration, afin de pouvoir switcher les moteurs sans modifier le coeur du service.

L'application Deep Space VR communiquera avec ce service externe pour :

- Envoyer de l'audio utilisateur ou des evenements de conversation.
- Recevoir les reponses vocales ou les instructions de controle.
- Transmettre le contexte de l'experience.
- Recuperer les decisions/action commands de l'assistant.

Le service separe devra exposer une interface web d'administration/configuration sous forme de dashboard complet avec pages separees. Cette interface permettra de parametrer en profondeur l'assistant sans modifier directement l'application VR.

La stack frontend exacte du dashboard n'est pas imposee. Le choix doit privilegier une solution moderne, maintenable et adaptee a un dashboard riche.

Les pages ciblees du dashboard V1 sont :

- Overview.
- Conversation Test.
- Providers.
- Personas.
- Voice/STT/TTS.
- Memory.
- Logs.
- Settings.

Le style du dashboard doit etre lisible et efficace comme un outil de developpement, tout en restant coherent avec l'identite Deep Space. Il doit se situer entre dashboard sobre et interface sci-fi immersive.

La page Conversation Test doit permettre de tester l'assistant sans lancer l'application principale, avec :

- Micro directement depuis le navigateur.
- Entree texte pour debug/developpement.

Elle doit aussi proposer un mode developpement/dry run permettant d'inspecter les etapes separement :

- Audio/micro recu.
- Transcription.
- Prompt final construit.
- Provider/modele selectionne.
- Reponse texte du LLM.
- Etape TTS.
- Lecture audio finale.

Les prompts/personas doivent etre editables via un editeur JSON.

Les personas doivent pouvoir etre exportes/importes sous forme de presets, afin de sauvegarder et partager une configuration complete de persona, voix incluse quand possible.

La communication entre Deep Space VR et le service vocal doit utiliser WebSocket pour les flux interactifs, l'integration VR et les evenements temps reel.

Le prototype doit pouvoir etre teste sans lancer l'application principale. Une fois le coeur valide, l'integration avec l'application VR sera faite dans un second temps.

Le service doit etre packagable et lancable via Docker.

La configuration et l'etat doivent etre separes :

- Fichiers JSON pour les presets et configurations versionnables.
- SQLite pour l'etat local, la memoire, l'historique et les donnees modifiables a l'execution.

## Modes d'interaction vocale

Les modes suivants doivent etre supportes ou prevus :

- Bouton dedie pour parler a l'assistant.
- Bouton et comportement parametrables.
- Detection automatique de voix parametrable.
- Conversation continue, proche d'un appel vocal ouvert.
- Interruption de l'assistant par reprise de parole utilisateur.

Le mode final pourra varier selon l'experience, le contexte utilisateur ou la configuration.

## Interface utilisateur finale

Dans l'experience finale, l'utilisateur interagit avec l'assistant uniquement par la voix.

Le texte est accepte pour le developpement, les logs, le debug et les outils de configuration du service separe.

## Personnalite et prompts

La personnalite de l'assistant doit etre personnalisable par configuration via un systeme de personas multiples.

Le premier persona cible est le narrateur, mais l'architecture doit permettre d'ajouter et de switcher entre plusieurs personas pendant le developpement, par exemple des NPCs, une IA de bord ou d'autres entites de l'univers.

Le premier persona narrateur s'appelle : "Eternity & Infinity, The One above All".

Son ton de depart est cosmique.

Son ton, comme celui des autres personas, doit rester entierement configurable.

Le systeme doit permettre de definir et modifier :

- Nom du persona.
- Prompts systeme.
- Prompts de role/personnage.
- Prompts de contexte.
- Regles de ton.
- Limites comportementales.
- Capacites actives ou inactives.
- Voix associee au persona.
- Style expressif, emotions ou intentions vocales si le moteur TTS le permet.
- Langue preferee.
- Niveau de liberte/improvisation.
- Regles autorisees/interdites.
- Memoire separee par persona si necessaire.
- Tools autorises dans une evolution future.

## Memoire

L'assistant doit disposer d'une memoire persistante locale.

Cette memoire doit etre accessible, consultable et configurable depuis l'instance/service IA vocal.

La memoire doit au minimum couvrir :

- Preferences utilisateur.
- Historique conversationnel.
- Recherche semantique/vectorielle pour retrouver des souvenirs pertinents.

La strategie de conservation de l'historique doit etre configurable parmi :

- Transcript brut complet.
- Resumes uniquement.
- Transcript brut et resumes.

Depuis l'interface d'administration, il doit etre possible de :

- Consulter la memoire.
- Supprimer des entrees.
- Modifier des entrees.
- Ajouter manuellement un souvenir.

Points a definir :

- Type exact de memoire.
- Format de stockage.
- Regles de retention.
- Niveau de controle utilisateur/developpeur.
- Separation entre memoire brute, resume de conversation et faits persistants.
- Choix technique exact du vector store local, avec preference pour une option robuste et simple.

## Providers LLM

L'architecture doit supporter plusieurs providers interchangeables :

- Ollama local.
- Ollama sur serveur prive.
- OpenRouter.
- OpenAI.
- Anthropic.
- Gemini.

Les priorites de selection sont :

1. Latence faible.
2. Cout faible.
3. Preference pour le local quand c'est possible.

Le systeme doit etre concu pour permettre un choix par configuration et potentiellement un fallback entre providers.

Le comportement de fallback provider doit etre configurable.

Les modeles par defaut, y compris pour Ollama local, restent vides/configurables. Aucun modele ne doit etre impose en dur au depart.

Les embeddings utilises pour la memoire semantique doivent suivre la meme logique que les LLM : provider configurable, avec possibilite de local ou cloud selon configuration.

## Transcription vocale

La transcription voix vers texte doit privilegier une solution locale/offline de type Whisper.

Le service doit detecter automatiquement la langue, limitee au francais et a l'anglais.

Le moteur de transcription par defaut sera `faster-whisper`, avec une architecture permettant d'ajouter d'autres moteurs depuis les parametres.

Points a definir :

- Mode streaming ou chunking.
- Detection de fin de parole.
- Latence acceptable.

## Synthese vocale

Le texte vers voix doit viser :

- Voix locale/offline.
- Voix custom ou voix de personnage.
- Streaming temps reel.
- Voix differente selon le persona.
- Voix expressive avec emotions/intonations si possible.
- Possibilite de voix clonable/custom dans une evolution future.

Le service doit permettre de switcher entre plusieurs moteurs TTS depuis les parametres. Les options cibles initiales sont :

- Piper pour une voix locale rapide et legere.
- Coqui/XTTS pour des voix plus custom, expressives ou clonables, avec un cout technique plus eleve.

La sortie audio doit supporter les deux modes selon provider/configuration :

- Streaming audio des que possible.
- Generation complete puis lecture.

Pour l'audio navigateur, l'implementation doit commencer simplement puis evoluer vers le streaming :

1. Mode initial base sur capture micro, envoi d'audio/chunks et lecture de reponse.
2. Evolution vers WebSocket/streaming audio quand les briques STT, LLM et TTS sont validees.

Points a definir :

- Moteur TTS cible.
- Support de voix multiples.
- Format audio de sortie.
- Possibilite d'interrompre la voix.
- Synchronisation avec l'application VR.

## Wake word et detection vocale

Le wake word doit etre prevu des la V1.

Le wake word doit etre configurable. Aucun mot d'activation unique n'est impose au depart.

La detection vocale doit couvrir :

- Detection de parole/silence.
- Wake word configurable.
- Mode bouton dedie.
- Mode conversation continue.
- Interruption de l'assistant quand l'utilisateur reprend la parole.

## Observabilite et logs

Le dashboard d'administration doit permettre de consulter les logs de developpement et d'exploitation.

Les donnees a journaliser :

- Transcripts.
- Reponses LLM.
- Provider et modele utilises.
- Timings et latences par etape.
- Erreurs.
- Evenements de configuration.

L'audio brut ne doit pas etre journalise par defaut.

Un mode debug explicite peut autoriser la sauvegarde locale temporaire de l'audio brut pour diagnostiquer STT, VAD ou wake word. Ce mode doit etre desactive par defaut.

L'estimation de cout par requete/session n'est pas requise en V1.

## Securite locale

Pour le prototype local, une authentification admin n'est pas necessaire en V1.

Ce point pourra etre reconsidere si le service devient accessible sur le reseau, expose des donnees sensibles ou controle directement l'application.

## Tests et validation

La V1 doit inclure au minimum :

- Tests unitaires backend.
- Tests API.
- Tests du pipeline audio.

Chaque etape majeure doit rester testable depuis le dashboard ou via des tests automatises avant de passer a l'etape suivante.

## Ordre d'implementation recommande

L'implementation doit avancer par etapes testables, afin que chaque brique puisse etre validee depuis le dashboard ou via des endpoints de debug avant de passer a la suivante.

Chemin recommande :

1. Backend FastAPI, structure Docker, systeme de configuration et health checks.
2. Abstraction providers LLM avec configuration, sans modele impose par defaut.
3. Dashboard initial avec Overview, Settings, Providers et Conversation Test en mode texte.
4. Pipeline LLM texte -> reponse, avec logs, timings et choix de provider.
5. Mode dry run affichant prompt final, provider, reponse texte et timings.
6. STT micro navigateur -> transcription via `faster-whisper`.
7. TTS avec moteurs switchables Piper et Coqui/XTTS, en generation complete puis streaming selon faisabilite.
8. Pipeline complet micro -> STT -> LLM -> TTS -> audio.
9. Personas configurables, avec le narrateur initial "Eternity & Infinity, The One above All".
10. Import/export de presets personas.
11. Memoire SQLite, historique configurable, preferences utilisateur et embeddings configurables.
12. Edition complete de la memoire depuis le dashboard.
13. Recherche semantique/vectorielle locale.
14. Wake word configurable et conversation continue.
15. Preparation des hooks d'integration applicative, sans activer le controle V2.

Les endpoints exacts de l'API ne sont pas figes dans cette spec. Ils devront etre definis au moment de l'implementation, en gardant une structure claire pour health, configuration, providers, personas, conversation, memory et logs.

## Lots de travail pour agents codeurs

L'implementation doit etre decoupee en blocs distincts, afin que chaque agent codeur puisse livrer une partie coherente, testable et verifiable avant de passer au bloc suivant.

### Lot 01 - Socle service FastAPI et Docker

Objectif : creer le squelette executif de `deep-space-voice`.

Livrables :

- Dossier `services/voice-ai`.
- Application FastAPI minimale.
- Configuration de lancement Docker.
- Health check.
- Structure de dossiers initiale.
- Base de configuration applicative.
- Setup de tests backend.

Criteres d'acceptation :

- Le service demarre via Docker.
- Un endpoint de health check repond.
- Les tests backend de base passent.
- La structure prepare les modules `api`, `config`, `providers`, `conversation`, `personas`, `memory`, `audio`, `logs`, `dashboard`.

Dependances : aucune.

### Lot 02 - Systeme de configuration et presets JSON

Objectif : permettre de charger, valider, modifier et sauvegarder les configurations.

Livrables :

- Schemas de configuration.
- Lecture/ecriture de presets JSON.
- Config providers LLM/STT/TTS/embeddings.
- Config personas.
- Config wake word et modes vocaux.
- Config fallback provider.
- Tests de validation config.

Criteres d'acceptation :

- Les presets JSON sont charges au demarrage.
- Une configuration invalide retourne une erreur claire.
- Les configs peuvent etre modifiees sans toucher au code.
- Les tests couvrent les cas valides et invalides.

Implementation realisee le 24 juin 2026 :

- Loader a presets via manifeste `services/voice-ai/config/defaults/app.json` et fichiers separes `providers.json`, `personas.json`, `voice.json`.
- Validation stricte Pydantic avec erreurs explicites par fichier/preset dans `services/voice-ai/app/config/loader.py`.
- Modeles de configuration versionnables pour providers, personas, wake word, modes vocaux et fallback provider dans `services/voice-ai/app/config/models.py`.
- Ecriture JSON formatee des presets via `ConfigStore.save_*`, pour permettre la modification/sauvegarde sans toucher au code.
- Schemas JSON exportes dans `services/voice-ai/config/schemas/` via `services/voice-ai/app/config/schema_export.py`.
- Couverture de tests valides/invalides et round-trip lecture/ecriture dans `services/voice-ai/tests/test_config.py`.

Dependances : Lot 01.

### Lot 03 - Dashboard admin initial

Objectif : creer l'interface web multi-pages de configuration et de test.

Livrables :

- Dashboard moderne et maintenable.
- Pages : Overview, Settings, Providers, Personas, Conversation Test, Voice/STT/TTS, Memory, Logs.
- Navigation claire.
- Edition JSON pour prompts/personas/configs.
- Sauvegarde des modifications via API.

Criteres d'acceptation :

- Le dashboard est accessible depuis le service.
- Les pages principales existent.
- Les configs peuvent etre lues et modifiees depuis l'UI.
- L'interface reste lisible et coherente avec Deep Space sans nuire a l'ergonomie.

Dependances : Lots 01 et 02.

Implementation realisee le 24 juin 2026 :

- Dashboard servi directement par FastAPI via `GET /dashboard`.
- Routes de pages supportees :
  - `GET /dashboard`
  - `GET /dashboard/settings`
  - `GET /dashboard/providers`
  - `GET /dashboard/personas`
  - `GET /dashboard/conversation-test`
  - `GET /dashboard/voice-stt-tts`
  - `GET /dashboard/memory`
  - `GET /dashboard/logs`
- Navigation laterale multi-pages avec style Deep Space lisible et sans build frontend.
- Edition JSON et sauvegarde via API pour :
  - `GET|PUT /api/v1/config/manifest`
  - `GET|PUT /api/v1/config/providers`
  - `GET|PUT /api/v1/config/personas`
  - `GET|PUT /api/v1/config/voice`
- Rechargement de la configuration active en memoire apres sauvegarde validee.
- Import/export JSON ajoute sur la page Personas.
- Page Overview branchee sur `GET /api/v1/dashboard/overview` pour exposer etat, defaults et chemins des presets.
- Pages `Conversation Test`, `Memory` et `Logs` posees comme socle UX maintenable pour les lots 05, 10 et 14.


Limites connues du Lot 03 :

- La page `Conversation Test` prepare le flux et le dry run UX, mais n'appelle pas encore le backend LLM live directement depuis l'interface.
- Les pages `Memory` et `Logs` sont presentes et coherentes visuellement, mais la memoire SQLite editable et les logs live arrivent dans des lots ulterieurs.
- Le pipeline micro -> STT -> LLM -> TTS n'est pas encore branche dans ce lot.

### Lot 04 - Abstraction providers LLM

Objectif : mettre en place une couche interchangeable pour les providers LLM.

Livrables :

- Interface provider LLM commune.
- Connecteurs configurables pour Ollama local/serveur prive.
- Emplacements prevus pour OpenRouter, OpenAI, Anthropic et Gemini.
- Selection provider/modele depuis config.
- Fallback configurable.
- Logs provider, modele, erreurs et timings.

Criteres d'acceptation :

- Une requete texte peut etre envoyee au provider configure.
- Le provider actif est visible dans les logs.
- Une erreur provider est remontee clairement.
- Le fallback se comporte selon la configuration.
- Aucun modele n'est impose en dur.

Dependances : Lots 01 et 02.

Implementation realisee le 24 juin 2026 :

- Interface commune `LlmProvider` et service `LlmGateway` ajoutes dans `services/voice-ai/app/providers/llm.py`.
- Connecteur Ollama reel pour `ollama_local` et `private_ollama`, base sur `POST {endpoint}/api/generate` avec `stream=false`.
- Emplacements fonctionnels reserves pour `openrouter`, `openai`, `anthropic` et `gemini`, avec erreur explicite tant que les connecteurs ne sont pas encore implementes.
- Selection du provider actif et du modele uniquement depuis `services/voice-ai/config/defaults/providers.json` ou ses variantes, sans imposer de modele par defaut.
- Fallback configurable via `llm.fallback_provider`, tente seulement si le provider primaire echoue et si un fallback distinct est configure.
- Logs backend de debut/succes/echec avec provider, kind, modele, raison d'erreur et timings.
- Endpoint de test texte `POST /api/v1/conversation/text` branche sur l'orchestrateur `ConversationOrchestrator`.
- Rechargement automatique de l'orchestrateur apres modification de `providers`, pour appliquer immediatement un nouveau provider ou fallback.
- Couverture de tests pour succes, erreur claire si modele absent, et fallback primaire -> secondaire dans `services/voice-ai/tests/test_llm.py` et `services/voice-ai/tests/test_conversation_api.py`.

### Lot 05 - Conversation Test texte et dry run

Objectif : valider le coeur LLM sans audio.

Livrables :

- Zone de test texte dans le dashboard.
- Construction du prompt final.
- Selection du persona actif.
- Appel LLM depuis l'UI du dashboard.
- Affichage reponse texte.
- Mode dry run affichant prompt final, provider/modele, reponse et timings.

Criteres d'acceptation :

- On peut tester une conversation texte depuis le dashboard.
- Le prompt final est inspectable.
- Les timings sont visibles.
- Le persona actif influence la reponse.

Dependances : Lots 02, 03 et 04.

### Lot 06 - Personas et presets import/export

Objectif : rendre les personas pleinement configurables.

Livrables :

- Modele de persona complet.
- Persona initial : "Eternity & Infinity, The One above All".
- Ton initial cosmique.
- Edition JSON.
- Import/export de presets JSON.
- Association persona -> voix/style/langue/memoire/tools futurs.

Criteres d'acceptation :

- Plusieurs personas peuvent exister.
- On peut switcher de persona pendant le developpement.
- Un persona exporte peut etre reimporte.
- Le narrateur initial est disponible par defaut.

Dependances : Lots 02, 03 et 05.

### Lot 07 - STT micro navigateur avec faster-whisper

Objectif : ajouter la transcription locale/offline.

Livrables :

- Capture micro depuis le navigateur.
- Envoi audio simple au backend.
- Transcription via `faster-whisper`.
- Detection automatique francais/anglais.
- Affichage transcript dans Conversation Test.
- Tests pipeline STT.

Criteres d'acceptation :

- Un utilisateur peut parler au micro depuis le dashboard.
- Le texte transcrit apparait dans l'interface.
- La langue est detectee entre francais et anglais.
- L'audio brut n'est pas journalise par defaut.

Dependances : Lots 01, 03 et 05.

### Lot 08 - TTS Piper et Coqui/XTTS

Objectif : transformer les reponses texte en audio local.

Livrables :

- Interface provider TTS commune.
- Integration Piper.
- Integration ou emplacement fonctionnel Coqui/XTTS.
- Selection moteur/voix depuis configuration.
- Generation complete puis lecture audio.
- Preparation du streaming audio.
- Tests pipeline TTS.

Criteres d'acceptation :

- Une reponse texte peut etre jouee en audio.
- Le moteur TTS actif est configurable.
- La voix peut etre liee a un persona.
- Le pipeline fonctionne au moins en generation complete.

Dependances : Lots 02, 03, 05 et 06.

Implementation realisee le 25 juin 2026 :

- Gateway TTS avec interface commune `TtsGateway` dans `services/voice-ai/app/providers/tts.py`.
- `PiperTtsProvider` complet : charge un modele `.onnx` via `piper-tts`, speaking_rate mappe sur `length_scale` (inverse), cache de modele par chemin, erreurs explicites si modele absent.
- `CoquiXttsTtsProvider` fonctionnel : tente d'importer `TTS` de coqui-ai, remonte `TtsProviderNotImplementedError` claire si absent, implementation complete si le paquet est installe.
- `ReservedTtsProvider` pour backends futurs inconnus.
- `voice_id` d'une persona sert de chemin de modele Piper (override de `options.model_path`).
- `TtsGateway` integre dans `AppContext` via `services/voice-ai/app/config/loader.py`, reconstruit au rechargement de config providers.
- `_refresh_context` dans `services/voice-ai/app/api/routes/config.py` reconstruit aussi le TtsGateway.
- Endpoint `POST /api/v1/conversation/tts` dans `services/voice-ai/app/api/routes/conversation.py` :
  - Accepte texte, engine_id, persona_id, voice_id, language, speaking_rate, pitch, dry_run.
  - Applique les reglages vocaux du persona comme defaults (engine, voice_id, language, speaking_rate, pitch).
  - Les champs explicites de la requete surchargent toujours le persona.
  - Retourne audio en base64 dans `audio.audio_base64` (absent si dry_run=true).
  - Erreur 400 si persona inconnu, 422 si validation echoue, 502 si provider TTS echoue.
- `options.model_path` ajoute dans `services/voice-ai/config/defaults/providers.json` (champ vide, a configurer avec un `.onnx` Piper).
- `piper-tts>=1.2,<2.0` ajoute dans `services/voice-ai/requirements.txt`.
- Banc de test TTS ajoute dans la page `Voice / STT / TTS` du dashboard (`dashboard.js`) :
  - Selecteur persona, selecteur engine, mode dry run.
  - Bouton Synthesize appelle `POST /api/v1/conversation/tts`.
  - Element `<audio>` cree dynamiquement pour la lecture directe depuis le base64 retourne.
  - Metadata engine/voice/language/timings affichee en cle-valeur.
- 28 tests dans `services/voice-ai/tests/test_tts.py` : providers, gateway, endpoint API. 52/52 tests total passent.

Limites connues du Lot 08 :

- Piper necessite un modele `.onnx` telecharge manuellement et configure dans `options.model_path` (providers.json) ou `voice.voice_id` (persona). Pas de modele par defaut.
- `piper-tts` Python package n'a pas de wheel Windows officiel : fonctionne nativement en Docker/Linux. En developpement Windows hors Docker, installer le binaire Piper depuis https://github.com/rhasspy/piper/releases.
- Coqui/XTTS necessite `pip install TTS` (PyTorch, plusieurs Go) : placeholder fonctionnel uniquement tant que le paquet n'est pas installe.
- Pitch non supporte nativement par Piper ONNX inference (accepte en config, sans effet).
- Le streaming audio (generation par chunks) est prevu en evolution, le mode batch est seul disponible en V1.

### Lot 09 - Pipeline vocal complet

Objectif : assembler le flux micro -> STT -> LLM -> TTS -> audio.

Livrables :

- Orchestrateur conversationnel.
- Mode conversation audio dans le dashboard.
- Affichage des etapes du dry run.
- Logs timings par etape.
- Interruption preparatoire cote orchestration.
- Tests pipeline audio complet.

Criteres d'acceptation :

- On peut parler au micro et entendre une reponse audio.
- Chaque etape est visible en debug.
- Les timings STT, LLM, TTS et total sont consultables.
- Le pipeline reste testable sans l'application principale.

Dependances : Lots 04, 05, 07 et 08.

Implementation realisee le 25 juin 2026 :

- `VoicePipelineOrchestrator` ajoute dans `services/voice-ai/app/conversation/__init__.py` : orchestre les trois etapes STT -> LLM -> TTS en sequence, verifie l'annulation entre chaque etape via `_cancelled_sessions`, retourne un `VoicePipelineResult` complet avec timings par etape.
- Mecanisme d'interruption module-level (`cancel_pipeline_session`, `clear_pipeline_session`) : thread-safe en CPython via le GIL, verifie entre STT/LLM et LLM/TTS, leve `PipelineInterruptedError` si la session est marquee annulee.
- `ConversationOrchestrator._resolve_persona` renomme en `resolve_persona` (public) pour etre appele par le pipeline sans acceder a un attribut prive.
- `VoicePipelineOrchestrator` integre dans `AppContext` (`services/voice-ai/app/config/loader.py`) et reconstruit au rechargement de config dans `_refresh_context` (`services/voice-ai/app/api/routes/config.py`).
- Endpoint `POST /api/v1/conversation/voice` dans `services/voice-ai/app/api/routes/conversation.py` :
  - Audio brut en body (meme pattern que `/transcribe`), options en query params (`persona_id`, `provider_id`, `stt_engine_id`, `tts_engine_id`, `session_id`, `dry_run`).
  - Retourne toutes les etapes dans `stages.stt`, `stages.llm`, `stages.tts` avec timings par etape et total.
  - `audio.audio_base64` absent si `dry_run=true`, present sinon.
  - `stages.llm.prompt_final` inclus uniquement si `dry_run=true`.
  - En cas d'interruption, retourne HTTP 200 avec `interrupted: true` au lieu d'une erreur.
  - Erreurs provider/STT/LLM/TTS remontees en 502 avec detail explicite.
- Endpoint `POST /api/v1/conversation/interrupt` :
  - Accepte `{"session_id": "..."}`, marque la session comme annulee.
  - Le pipeline actif s'arrete avant la prochaine etape.
- Mode dry run pipeline : STT et LLM executent normalement, TTS est saute (moteur retourne "dry-run"), `audio_bytes` vide, `prompt_final` inclus dans la reponse.
- Dashboard `services/voice-ai/app/dashboard/static/dashboard.js` - nouveau banc pipeline dans la page `Conversation Test` :
  - Selecteurs persona, moteur TTS, provider LLM et mode dry run.
  - Bouton "Record and run pipeline" : capture micro, envoie l'audio a `/api/v1/conversation/voice` avec les options en query params.
  - Bouton "Interrupt" actif pendant l'execution, appelle `/api/v1/conversation/interrupt`.
  - Indicateurs de progression par etape : STT / LLM / TTS / Audio, chaque badge passe de pending a active/done/error.
  - Affichage du transcript STT, de la reponse LLM, du player audio et des timings par etape.
  - Volet "Dry run inspector" affiche le prompt final si `dry_run=true`.
- 13 tests dans `services/voice-ai/tests/test_pipeline.py` : pipeline complet, dry run, voice settings persona, persona inconnu, interruption avant STT, interruption apres STT, endpoint voice (succes, dry run, body vide, persona inconnu), endpoint interrupt (succes, session_id vide, session pre-annulee). 65/65 tests total passent.

### Lot 10 - Memoire SQLite et historique configurable

Objectif : ajouter la memoire persistante locale.

Livrables :

- Schema SQLite.
- Stockage preferences utilisateur.
- Stockage historique conversationnel.
- Modes de retention : brut, resumes, brut + resumes.
- APIs de consultation/modification/suppression/ajout manuel.
- Page Memory fonctionnelle dans le dashboard.
- Tests memoire.

Criteres d'acceptation :

- Les conversations peuvent etre persistees selon la config.
- Les preferences utilisateur sont stockables.
- La memoire est consultable et editable depuis le dashboard.
- Les suppressions/modifications sont prises en compte.

Dependances : Lots 01, 02, 03 et 09.

### Lot 11 - Memoire semantique et embeddings

Objectif : retrouver les souvenirs pertinents via recherche semantique.

Livrables :

- Choix d'un vector store local robuste/simple.
- Abstraction provider embeddings.
- Embeddings configurables comme les LLM.
- Indexation des souvenirs.
- Recherche semantique depuis la conversation.
- Affichage/debug des souvenirs injectes.
- Tests recherche semantique.

Criteres d'acceptation :

- Un souvenir pertinent peut etre retrouve a partir d'une nouvelle requete.
- Le provider embeddings est configurable.
- Les souvenirs injectes dans le prompt sont inspectables en dry run.

Dependances : Lots 04, 05 et 10.

Implementation realisee le 25 juin 2026 :

- Choix du vector store local V1 : SQLite, via une table `memory_embeddings` liee aux souvenirs persistants. Les vecteurs sont stockes en JSON et compares par cosine similarity cote service. Ce choix reste robuste, simple, portable et inspectable sans service externe.
- Provider embeddings commun ajoute dans `services/voice-ai/app/providers/embeddings.py` :
  - `EmbeddingsGateway`.
  - Provider local `hashing` sans dependance runtime, deterministe, utile par defaut pour indexation locale, tests et dry run.
  - Provider `sentence-transformers` optionnel, active par configuration si le paquet et le modele sont installes.
  - Provider `openai` optionnel pour embeddings cloud via `OPENAI_API_KEY`.
- Preset embeddings mis a jour dans `services/voice-ai/config/defaults/providers.json` :
  - `local-embeddings` utilise `kind: "hashing"` et `model: "hashing-384"` par defaut.
  - `sentence-transformers-local` et `openai-embeddings` restent disponibles mais desactives.
- `MemoryManager` indexe les souvenirs lors de la creation/mise a jour depuis l'API, supprime l'embedding lors de la suppression, et indexe paresseusement les anciennes entrees non vectorisees lors d'une recherche.
- Recherche semantique exposee par API :
  - `GET /api/v1/memory/search?query=...&persona_id=...&limit=...`
  - `POST /api/v1/memory/index`
  - `POST /api/v1/memory/entries/{entry_id}/index`
- Injection conversationnelle :
  - `ConversationOrchestrator` recherche les souvenirs pertinents avant l'appel LLM si `persona.memory.inject_relevant_memories` est actif.
  - Le prompt final contient une section `[RELEVANT MEMORIES]` avec score, scope, source, tags et contenu.
  - Les souvenirs globaux et ceux du persona actif sont eligibles a l'injection.
- Dry run/debug :
  - `POST /api/v1/conversation/text` retourne `dry_run.injected_memories` et inclut les souvenirs dans `prompt_final`.
  - `POST /api/v1/conversation/voice?dry_run=true` expose aussi `stages.llm.injected_memories`.
  - Le dashboard Conversation Test affiche les souvenirs injectes dans l'inspecteur dry run.
  - La page Memory ajoute un panneau de recherche semantique et un compteur `Indexed entries`.
- Tests ajoutes dans `services/voice-ai/tests/test_semantic_memory.py` :
  - Embeddings locaux deterministes et normalises.
  - Indexation et recherche pertinente via `MemoryManager`.
  - Recherche semantique API.
  - Souvenirs injectes inspectables en dry run conversation.
- Stabilisation tests existants :
  - Routes 204 memoire ajustees pour retourner une reponse vide explicite compatible FastAPI.
  - Tests LLM alignes avec les presets actuels sans appel reseau involontaire.
  - Tests Piper alignes avec l'appel runtime `synthesize_wav`.
- Verification : `python -m pytest` depuis `services/voice-ai` : 118 tests passent.

Limites connues du Lot 11 :

- Le provider `hashing` est volontairement simple et local : il est excellent pour une V1 portable et testable, mais moins semantique qu'un vrai modele d'embeddings.
- Pour une qualite de rappel superieure, configurer `sentence-transformers-local` avec un modele local installe, ou `openai-embeddings` avec une cle API.
- Le vector store SQLite actuel calcule les similarites en Python. C'est suffisant pour une memoire locale V1 ; si le volume grossit fortement, une extension type sqlite-vss/sqlite-vec ou un store dedie pourra remplacer cette couche derriere la meme abstraction.

### Lot 12 - Wake word, VAD et conversation continue

Objectif : ajouter les modes vocaux avances de la V1.

Livrables :

- Detection parole/silence.
- Wake word configurable.
- Mode conversation continue.
- Interruption de l'assistant quand l'utilisateur reprend la parole.
- Configuration des modes vocaux.
- Tests manuels et pipeline audio.

Criteres d'acceptation :

- Le wake word peut etre configure.
- Le service peut attendre une activation vocale.
- Le mode conversation continue fonctionne en prototype.
- L'utilisateur peut interrompre l'assistant en parlant.

Dependances : Lots 07, 08 et 09.

Implementation realisee le 25 juin 2026 :

- Configuration des modes vocaux etendue dans `services/voice-ai/app/config/models.py` et `services/voice-ai/config/defaults/voice.json` :
  - `wake_word.phrase`, `wake_word.sensitivity` et `wake_word.provider_engine` restent configurables.
  - `modes.vad` ajoute les seuils VAD (`threshold`, `min_speech_ms`, `min_silence_ms`, `fallback_min_bytes`).
  - `modes.continuous_requires_wake_word`, `modes.continuous_idle_timeout_seconds` et `modes.auto_listen_after_response` pilotent le prototype continu.
  - Schemas JSON regeneres dans `services/voice-ai/config/schemas/`.
- Module audio ajoute dans `services/voice-ai/app/audio/__init__.py` :
  - `AudioActivityDetector` detecte parole/silence sur WAV PCM avec RMS/peak/duree.
  - Fallback simple pour formats navigateur compresses (WebM/Ogg/etc.) base sur taille minimale, afin de garder le prototype utilisable sans decoder ffmpeg cote endpoint VAD.
  - `WakeWordDetector` compare le transcript STT au wake word configure.
  - `ContinuousConversationState` garde l'etat de session : activation, assistant en train de parler, timeout d'inactivite.
- Endpoints API ajoutes dans `services/voice-ai/app/api/routes/conversation.py` :
  - `POST /api/v1/conversation/audio/analyze` retourne l'analyse VAD.
  - `POST /api/v1/conversation/voice-mode` gere `push_to_talk`, `voice_activity` et `continuous_conversation`.
  - En mode continu, le service attend le wake word configure avant activation si `continuous_requires_wake_word=true`.
  - `run_pipeline=true` lance le pipeline complet apres activation.
  - `assistant_speaking=true` + parole detectee declenche le barge-in, marque la session interrompue et appelle le mecanisme d'interruption existant.
- Dashboard mis a jour dans `services/voice-ai/app/dashboard/static/dashboard.js` :
  - Page `Voice / STT / TTS` affiche les nouveaux parametres VAD et conversation continue.
  - Page `Conversation Test` garde le banc pipeline manuel et ajoute un prototype `Continuous voice mode`.
  - Le prototype envoie des chunks micro courts vers `/api/v1/conversation/voice-mode`, affiche `silence`, `waiting_for_wake_word`, `activated` et `barge_in`, joue l'audio retourne, puis continue l'ecoute.
  - Pendant la lecture de l'assistant, la reprise de parole utilisateur envoie `assistant_speaking=true` et peut interrompre le playback cote dashboard.
- Tests ajoutes dans `services/voice-ai/tests/test_voice_modes.py` :
  - Detection parole/silence VAD sur WAV.
  - Wake word configurable.
  - Endpoint `/audio/analyze`.
  - Attente du wake word en mode continu.
  - Lancement du pipeline apres wake word.
  - Interruption/barge-in quand l'utilisateur parle pendant la reponse.
- Verification : `python -m pytest` depuis `services/voice-ai` : 124 tests passent.

Limites connues du Lot 12 :

- Le VAD serveur mesure proprement le WAV PCM. Pour les formats navigateur compresses, le fallback par taille de payload evite les faux silences mais ne remplace pas une vraie detection acoustique decodee.
- Le prototype continu HTTP fonctionne par chunks MediaRecorder. Une integration temps reel plus fine passera par le WebSocket du Lot 13.
- Le wake word V1 utilise STT + matching texte. Une detection embarquee dediee type Porcupine/OpenWakeWord pourra remplacer cette couche derriere la meme configuration.
- Le barge-in stoppe le pipeline aux checkpoints serveur existants et interrompt le playback dashboard ; le streaming TTS permettra une interruption plus immediate dans une evolution ulterieure.

### Lot 13 - WebSocket et integration VR preparatoire

Objectif : preparer la communication temps reel avec Deep Space VR sans encore implementer les commandes V2.

Livrables :

- Canal WebSocket.
- Messages pour etat conversationnel, transcripts, reponses, audio/events.
- Hooks pour contexte VR.
- Documentation courte du protocole.
- Exemple client minimal ou simulateur.

Criteres d'acceptation :

- Un client externe peut se connecter au service via WebSocket.
- Le service peut diffuser les evenements de conversation.
- Le protocole reste compatible avec une integration VR future.
- Aucune commande applicative V2 n'est encore activee.

Dependances : Lots 01, 09 et 12.

### Lot 14 - Observabilite, logs et debug audio explicite

Objectif : rendre le service debuggable sans exposer inutilement les donnees sensibles.

Livrables :

- Logs transcripts.
- Logs reponses LLM.
- Logs provider/modele.
- Logs timings/latences.
- Logs erreurs.
- Logs evenements config.
- Mode debug explicite pour sauvegarde temporaire audio brut.
- Page Logs exploitable.

Criteres d'acceptation :

- Les logs utiles sont consultables depuis le dashboard.
- L'audio brut n'est jamais sauvegarde sauf activation explicite.
- Les erreurs provider/STT/TTS sont comprehensibles.
- Les timings permettent d'identifier le bottleneck.

Dependances : Lots 03, 04, 07, 08 et 09.

### Lot 15 - Stabilisation V1 et verification globale

Objectif : rendre la V1 coherente, testee et prete pour validation utilisateur.

Livrables :

- Revue de configuration.
- Nettoyage UX dashboard.
- Tests unitaires backend complets.
- Tests API.
- Tests pipeline audio.
- Documentation de lancement Docker.
- Documentation de validation manuelle.
- Liste des limites connues et travaux V2.

Criteres d'acceptation :

- Le service se lance proprement.
- Le dashboard permet de configurer et tester la V1.
- Le pipeline vocal complet fonctionne sans l'application principale.
- Les tests requis passent.
- Les limites V2 sont documentees.

Dependances : tous les lots V1 precedents.

## Questions ouvertes

### Prototype/service separe

- Faut-il fournir un simulateur de contexte VR dans le dashboard ?

### Controle de l'application

- Quelles commandes l'assistant aura-t-il le droit d'executer ?
- Comment distinguer une reponse conversationnelle d'une commande applicative ?
- Faut-il une validation utilisateur avant certaines actions ?
- Comment representer les commandes : JSON schema, tool calling, messages typed, autre ?

Note : le controle applicatif par tools/commandes est prevu pour une V2. La V1 doit d'abord valider le coeur vocal : entree audio, transcription, LLM, memoire minimale, TTS et configuration.

Le format exact des commandes V2 n'est pas encore decide.

### Memoire

- La memoire doit-elle etre par profil utilisateur ?
- Faut-il pouvoir editer/supprimer des souvenirs depuis l'interface de configuration ?
- Faut-il remplacer le vector store SQLite V1 par sqlite-vss/sqlite-vec ou un store dedie si le volume de souvenirs augmente fortement ?
- Comment gerer la separation entre memoire utilisateur, memoire persona et memoire de session ?

### Personnalite

- Peut-il changer de persona en cours d'experience ?
- Doit-il avoir des limites de style strictes ?

### Performance

- Le systeme doit-il pouvoir repondre avant d'avoir termine la generation complete ?

Objectif : reduire au maximum la latence logicielle afin que le bottleneck principal soit le provider LLM/TTS selectionne. La cible souhaitee est un debut de reponse entre 1 et 2 secondes apres la fin de parole utilisateur.

### Securite et confidentialite

- Quelles donnees ne doivent jamais sortir en cloud ?

Le choix local/cloud doit rester librement configurable. Le local est privilegie quand c'est possible, mais l'architecture doit permettre des fallbacks et comparaisons de providers.

## Decisions prises

- L'assistant vocal est une feature configurable, pas un personnage unique code en dur.
- L'interaction finale utilisateur est vocale uniquement.
- Les logs, textes et outils de debug sont autorises pour le developpement et la configuration.
- La partie IA vocale sera developpee comme une instance/service separe de l'application principale.
- Le service separe sera developpe en Python avec FastAPI.
- Le service devra inclure un dashboard web d'administration/configuration complet avec pages separees.
- La stack frontend du dashboard est libre, avec preference pour une solution moderne et maintenable.
- Le service/projet separe s'appelle `deep-space-voice`.
- Son emplacement cible est `services/voice-ai`.
- Les pages dashboard V1 ciblees sont Overview, Conversation Test, Providers, Personas, Voice/STT/TTS, Memory, Logs et Settings.
- La page Conversation Test doit permettre les tests au micro navigateur et en texte debug.
- Le dashboard doit etre lisible et efficace, avec une identite coherente Deep Space sans sacrifier l'ergonomie.
- La langue du dashboard n'est pas une contrainte forte en V1.
- Les prompts/personas doivent etre editables via editeur JSON.
- Les personas doivent pouvoir etre importes/exportes comme presets.
- Un mode dry run doit permettre d'inspecter transcription, prompt final, provider/modele, reponse texte, TTS et lecture audio.
- Le service sera lance via Docker.
- Les presets/configurations seront stockes en fichiers JSON ; l'etat, la memoire et l'historique seront stockes en SQLite.
- L'audio navigateur doit commencer par une implementation simple, puis evoluer vers du streaming.
- L'integration future avec l'application VR doit passer par WebSocket.
- Le prototype devra etre testable sans lancer l'application principale.
- Le pipeline complet cible est micro -> transcription -> LLM -> TTS -> sortie audio, valide et implemente par etapes pendant le developpement.
- Le service devra permettre une configuration profonde du comportement, des prompts et des providers.
- Les modes d'interaction doivent inclure bouton dedie, detection vocale automatique et conversation continue.
- L'assistant doit pouvoir etre interrompu par reprise de parole utilisateur.
- La memoire doit etre persistante, locale, consultable et configurable.
- La memoire V1 doit au minimum couvrir les preferences utilisateur et l'historique conversationnel.
- La memoire doit inclure une recherche semantique/vectorielle des la V1.
- La retention de conversation doit etre configurable : brut, resumes, ou brut + resumes.
- La personnalite passe par un systeme de personas multiples configurables.
- Le premier persona cible est le narrateur, avec possibilite de switcher vers d'autres personas pendant le developpement.
- Le premier persona narrateur s'appelle "Eternity & Infinity, The One above All".
- Le ton initial du narrateur est cosmique.
- Le ton du narrateur et des autres personas est entierement configurable.
- Un persona doit inclure nom, prompt systeme, style de voix, langue preferee, niveau de liberte/improvisation, regles autorisees/interdites, memoire separee si necessaire et tools autorises plus tard.
- L'architecture LLM doit supporter Ollama local, Ollama serveur prive, OpenRouter, OpenAI, Anthropic et Gemini.
- Le fallback provider doit etre configurable.
- Les modeles par defaut restent vides/configurables, y compris pour Ollama local.
- Les embeddings de memoire sont configurables par provider comme les LLM.
- Le vector store local V1 est SQLite (`memory_embeddings`), avec vecteurs JSON et cosine similarity cote service.
- Les priorites techniques sont la faible latence et le faible cout, avec une preference pour le local.
- La transcription doit privilegier Whisper ou equivalent local/offline.
- Le moteur STT par defaut sera `faster-whisper`, avec possibilite d'ajouter d'autres moteurs par configuration.
- La langue doit etre detectee automatiquement, limitee au francais et a l'anglais.
- Le TTS doit viser une voix locale/offline, custom/personnage, avec streaming temps reel.
- Les moteurs TTS cibles initiaux sont Piper et Coqui/XTTS, switchables depuis les parametres.
- Les voix doivent pouvoir etre differentes selon le persona, configurables, expressives si possible, et clonables/custom plus tard.
- La sortie audio doit supporter streaming ou generation complete selon provider/configuration.
- Le wake word est prevu des la V1 et doit etre configurable.
- Les logs doivent inclure transcripts, reponses LLM, provider/modele, timings/latences, erreurs et evenements de configuration, mais pas l'audio brut par defaut.
- Un mode debug explicite peut sauvegarder temporairement l'audio brut localement, mais il doit etre desactive par defaut.
- L'estimation de cout n'est pas requise en V1.
- Une authentification admin n'est pas necessaire pour le prototype local V1.
- La V1 doit inclure tests unitaires backend, tests API et tests du pipeline audio.
- La cible de latence est un debut de reponse entre 1 et 2 secondes apres la fin de parole, avec une latence logicielle minimale.
- Le controle applicatif par tools/commandes est prevu pour une V2 ; la V1 doit valider le coeur vocal.
- L'implementation doit suivre un chemin progressif ou chaque etape est testable avant la suivante.
- Les endpoints exacts ne sont pas figes dans cette spec.
- Le format exact des commandes applicatives V2 reste a definir plus tard.
