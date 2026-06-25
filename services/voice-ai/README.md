# deep-space-voice

Socle du service vocal `deep-space-voice` pour Deep Space VR.

## Acces rapide

Une fois le service demarre sur le port `8000`, ouvrir :

- Dashboard principal : [http://localhost:8000/dashboard](http://localhost:8000/dashboard)
- Overview : [http://localhost:8000/dashboard](http://localhost:8000/dashboard)
- Settings : [http://localhost:8000/dashboard/settings](http://localhost:8000/dashboard/settings)
- Providers : [http://localhost:8000/dashboard/providers](http://localhost:8000/dashboard/providers)
- Personas : [http://localhost:8000/dashboard/personas](http://localhost:8000/dashboard/personas)
- Conversation Test : [http://localhost:8000/dashboard/conversation-test](http://localhost:8000/dashboard/conversation-test)
- Voice / STT / TTS : [http://localhost:8000/dashboard/voice-stt-tts](http://localhost:8000/dashboard/voice-stt-tts)
- Memory : [http://localhost:8000/dashboard/memory](http://localhost:8000/dashboard/memory)
- Logs : [http://localhost:8000/dashboard/logs](http://localhost:8000/dashboard/logs)
- Health check : [http://localhost:8000/health](http://localhost:8000/health)
- API health : [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

## Demarrage local

Depuis `services/voice-ai` :

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Puis ouvrir [http://localhost:8000/dashboard](http://localhost:8000/dashboard).

Le service expose par defaut :

- `GET /health`
- `GET /api/v1/health`
- `GET /`
- `GET /dashboard`
- `GET /dashboard/{page}`
- `GET|PUT /api/v1/config/{manifest|providers|personas|voice}`
- `POST /api/v1/conversation/text`

## Tests

Depuis `services/voice-ai` :

```powershell
pytest
```

## Docker

Depuis `services/voice-ai` :

```powershell
docker compose up --build
```

Puis ouvrir [http://localhost:8000/dashboard](http://localhost:8000/dashboard).

Pour lancer en arriere-plan :

```powershell
docker compose up --build -d
```

Pour verifier que le conteneur repond :

```powershell
docker compose ps
docker compose logs -f deep-space-voice
```

Pour arreter le service :

```powershell
docker compose down
```

## Etat actuel apres Lot 04

Le socle actuellement livre couvre :

- Navigation multi-pages accessible depuis `/dashboard`.
- Lecture et edition JSON de `manifest`, `providers`, `personas` et `voice`.
- Sauvegarde via API `PUT /api/v1/config/...` avec validation avant ecriture.
- Import/export JSON pour la page Personas.
- Pages `Conversation Test`, `Memory` et `Logs` presentes comme base UX coherente pour les lots suivants.
- Appel texte live au provider LLM actif via `POST /api/v1/conversation/text`.
- Selection du provider/modele depuis `providers.json`, avec fallback configurable.
- Logs backend de provider, modele, erreurs et timings sur les appels LLM.

Ce lot ne livre pas encore :

- L'interface dashboard complete pour lancer les appels texte directement depuis la page `Conversation Test`.
- Pipeline micro -> STT -> LLM -> TTS -> audio.
- Memoire SQLite editable depuis l'UI.
- Flux de logs live.
