# Darwin Cell — ATS de Reclutamiento

Aplicación de Recursos Humanos para **depuración y análisis de talento**: portal público de
vacantes + ATS interno que pasa a cada postulante por un embudo de contratación, le hace
preguntas, analiza sus respuestas con IA y filtra a los mejores candidatos en cada etapa.

## Arquitectura

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + React Router + Tailwind CSS 4 |
| Backend | Express (`server.ts`), servido por el mismo proceso de Vite en dev |
| Base de datos | Firebase Firestore |
| Autenticación | Firebase Auth (Google) |
| Almacenamiento | Firebase Storage (CVs, logo de empresa) |
| IA | Google Gemini (`@google/genai`) — análisis de CV y evaluación de tests |
| Mensajería | WhatsApp vía Baileys (`@whiskeysockets/baileys`) + Email (Nodemailer) |

## El embudo de contratación

Las etapas del pipeline están definidas en [`src/constants/stages.ts`](src/constants/stages.ts):

`Nuevo → Aplicó → CV recibido → Precalificado → Revisión humana → Contacto WhatsApp 1 →
Formulario etapa 2 enviado → Formulario etapa 2 completado → Evaluación IA etapa 2 →
Convocado a entrevista → Entrevista presencial → Tests presenciales → Finalista → Oferta →
Contratado` (más `Descartado` y `Banco de talento`).

Cada etapa filtra candidatos mediante puntuaciones de IA:

1. **CV** → `/api/parse-cv` extrae y puntúa el currículum (0.1–5.0 ⭐).
2. **Formulario Etapa 2** → `/api/score-stage2` evalúa estabilidad, integridad, ética y redacción (sobre 100).
3. **Test situacional presencial** → `/api/evaluate-test` evalúa 6 dimensiones conductuales (sobre 100).
4. **Ranking** combina todas las puntuaciones para la decisión final (contratar / descartar).

## Rutas principales

- Públicas: `/careers`, `/apply/:vacancyId`, `/eval/:applicationId`, `/test/:applicationId`
- Internas (requieren login): `/` (dashboard), `/vacancies`, `/candidates`, `/interviews`, `/forms`, `/settings`

## Ejecutar localmente

**Requisitos:** Node.js 20+

```bash
npm install
cp .env.example .env.local   # completa las variables
npm run dev                  # levanta Express + Vite en http://localhost:3000
```

### Variables de entorno (`.env.local`)

| Variable | Descripción |
|----------|-------------|
| `GEMINI_API_KEY` | Clave de Google Gemini (**solo backend**, nunca se expone al cliente) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | Credenciales de correo (Nodemailer) |
| `APP_URL` | URL pública donde se hospeda la app |

> La configuración de Firebase vive en `firebase-applet-config.json`. La `apiKey` de Firebase
> **no es un secreto** (es identificadora, no de autorización); la seguridad real la imponen
> las reglas de Firestore/Storage (`firestore.rules`, `storage.rules`).

## Scripts

| Script | Acción |
|--------|--------|
| `npm run dev` | Servidor de desarrollo (Express + Vite middleware) |
| `npm run build` | Compila el frontend y empaqueta el servidor (`dist/server.cjs`) |
| `npm run start` | Ejecuta el build de producción |
| `npm run lint` | Type-check con TypeScript (`tsc --noEmit`) |

## El worker de CV

El análisis de CV corre **en el backend**, no en el navegador del reclutador. Cuando hay
credenciales de Admin SDK, el servidor toma los candidatos con `aiStatus == 'pending'`,
los reclama de forma atómica (una transacción, para que dos pasadas nunca procesen el
mismo CV) y los puntúa con Gemini de a 3 en paralelo. Los que quedan atascados en
`processing` más de 5 minutos —por un reinicio o un corte a mitad de análisis— vuelven a
`pending` solos. En desarrollo, sin credenciales de Admin, el worker del navegador
([`CVWorker.tsx`](src/components/CVWorker.tsx)) hace el trabajo; consulta `/api/health` y
se aparta en cuanto el backend se encarga.

Hay **tres** cosas que ponen el worker a trabajar, porque una sola no basta:

| Disparador | Cuándo |
|---|---|
| Temporizador cada 60 s | Mientras el proceso tenga CPU |
| Aviso interno tras `/api/apply` | Al instante en que llega una postulación |
| `POST /api/cv-worker/run` | Bajo demanda: acciones del reclutador o un ping programado |

El temporizador por sí solo no es suficiente en Cloud Run: fuera de una petición la CPU
se limita, así que entre visitas el `setInterval` se detiene y la cola queda quieta. El
endpoint vacía la cola **dentro** de una petición, donde la CPU está garantizada, y corta
a los 4 minutos para no chocar con el tiempo límite de 5 minutos de Cloud Run (responde
`incomplete: true` si quedó trabajo pendiente).

Lo pueden llamar los reclutadores autenticados o un programador con el secreto
`CV_WORKER_TOKEN` en la cabecera `X-CV-Worker-Token`. Para garantizar el procesamiento
con cero tráfico, apunta un Cloud Scheduler cada 5 minutos a:

```
POST https://<tu-app>/api/cv-worker/run
X-CV-Worker-Token: <CV_WORKER_TOKEN>
```

## Estado y hoja de ruta de producción

Ya resuelto:

- [x] `server.ts` sobre el **Firebase Admin SDK** (`serverDb.ts`), con fail-closed en producción.
- [x] Endpoints `/api/*` **autenticados** (verificación de token de Firebase + rol de reclutador).
- [x] Reglas de Firestore endurecidas (los postulantes anónimos no crean ni editan candidatos).
- [x] **Paginación** en la lista de candidatos; agregación `count()` en el dashboard.
- [x] Análisis de CV en un **worker de backend** con cola, reclamo atómico y disparo bajo demanda.
- [x] **Rate limiting** por IP y global; despliegue automático de reglas por CI.

Pendiente:

- [ ] Validación de entrada con **Zod** (la dependencia está instalada pero sin usar; hoy la
      validación es manual endpoint por endpoint).
- [ ] **Pruebas automatizadas** y CI de `lint`/`build` (el único workflow despliega reglas).
- [ ] Dividir `server.ts` (~1.600 líneas) y `CandidateProfile.tsx` (~1.400 líneas) en módulos.
- [ ] Manejo de errores estructurado y observabilidad.
