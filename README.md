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
3. **Test presencial** (uno por posición: cada vacante elige el suyo) → `/api/evaluate-test` lo
   califica con los criterios de **ese** test (sobre 100). Ver [Tests presenciales por posición](#tests-presenciales-por-posición).
4. **Ranking** combina todas las puntuaciones para la decisión final (contratar / descartar).

## Rutas principales

- Públicas: `/careers`, `/apply/:vacancyId`, `/eval/:applicationId`, `/test/:applicationId`
- Internas (requieren login): `/` (dashboard), `/vacancies`, `/candidates`, `/interviews`, `/forms`
  (y `/forms/tests/:id`, el editor de cada test presencial), `/settings`

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
| `GEMINI_MODEL` | *(Opcional)* Modelo de IA. El valor por defecto es una versión **preview** y Google las retira sin aviso: si la IA deja de responder, pon aquí el modelo vigente y reinicia — sin tocar código |
| `CV_WORKER_TOKEN` | *(Opcional)* Secreto para que un ping programado externo vacíe la cola de CV (ver más abajo) |

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
| `npm test` | Pruebas automatizadas (Vitest) |
| `npm run test:watch` | Pruebas en modo vigilancia, mientras programas |

## Pruebas y CI

`npm test` corre la suite con [Vitest](https://vitest.dev). Cubre la lógica pura donde un
error es silencioso y caro:

| Archivo | Qué protege |
|---|---|
| [`src/lib/phone.test.ts`](src/lib/phone.test.ts) | La forma canónica del teléfono: de ella dependen que una respuesta de WhatsApp se enlace con su candidato y que `/api/apply` detecte duplicados |
| [`src/lib/kanbanOrder.test.ts`](src/lib/kanbanOrder.test.ts) | Que una tarjeta soltada en un punto del embudo se quede exactamente ahí, también tras recargar |
| [`src/lib/whatsapp.test.ts`](src/lib/whatsapp.test.ts) | Qué etapas envían mensaje automático y cuáles exigen fecha/hora antes de enviar |
| [`src/constants/stages.test.ts`](src/constants/stages.test.ts) | Que las dos definiciones del embudo (columnas y descripciones) no se desincronicen |
| [`src/lib/smartSearch.test.ts`](src/lib/smartSearch.test.ts) | El buscador: acentos, formatos de teléfono, varias palabras, búsqueda en notas y tolerancia a errores de escritura |
| [`src/lib/moveApplication.test.ts`](src/lib/moveApplication.test.ts) | Que mover/copiar perfiles entre vacantes nunca duplique a un candidato en la vacante destino |
| [`src/lib/navigation.test.ts`](src/lib/navigation.test.ts) | A dónde lleva "Atrás" cuando no hay historial (pestaña nueva, recarga) |
| [`serverPhotoBackfill.test.ts`](serverPhotoBackfill.test.ts) | El orden en que se buscan las fotos de los candidatos existentes: ventas primero, más avanzados primero, nunca a quien ya se revisó |
| [`serverCvPhoto.test.ts`](serverCvPhoto.test.ts) | Extraer la foto del CV: imágenes de PDF/Word/imagen, descarte de íconos y máscaras, recorte cuadrado centrado en la cara |
| [`src/lib/testTemplates.test.ts`](src/lib/testTemplates.test.ts) | Tests presenciales por posición: qué test aplica cada vacante, que el candidato nunca reciba las respuestas esperadas, la validación del editor (pesos que suman 100, preguntas repetidas…) y que los resultados viejos se sigan leyendo |
| [`serverTestEval.test.ts`](serverTestEval.test.ts) | Que la IA califique cada test con **sus** criterios, que la respuesta esperada quede fuera del bloque del candidato y que nadie pueda colar instrucciones en sus respuestas |

El workflow [`ci.yml`](.github/workflows/ci.yml) verifica tipos, pruebas y build en cada
push y cada PR a `main`. Los tres pasos corren aunque uno falle, para ver todos los
problemas de una vez.

El servidor y el cliente comparten **una sola** implementación de `normalizePhone`
([`src/lib/phone.ts`](src/lib/phone.ts)) — cuando eran dos copias, se desincronizaron y
las respuestas entrantes dejaron de enlazarse con su candidato.

## Herramientas del día a día del reclutador

- **Atrás / Adelante** (barra superior de todo el panel): recorre las pantallas visitadas
  sin depender del navegador. Si no hay a dónde volver (link abierto en pestaña nueva),
  "Atrás" lleva a la pantalla padre en vez de salir de la app. La búsqueda y los filtros de
  *Candidatos* viven en la URL (`?q=&stage=&city=&exp=`), así que al volver de un perfil la
  lista sigue exactamente como estaba.
- **Buscador inteligente** (barra superior, atajo `/`, y en Candidatos y el Kanban):
  busca en nombre, teléfono, correo, dónde vive, vacante, etapa, CV, **notas** y
  comentarios de entrevista. Ignora acentos y mayúsculas, entiende cualquier formato de
  teléfono (`809-555-1234`, `18095551234`, `5551234`), exige que aparezcan todas las
  palabras (cada una puede estar en un campo distinto), acepta `"frases exactas"` y, si no
  hay coincidencias exactas, muestra resultados *parecidos* (Rodrigues → Rodríguez,
  Yoselin → Joselyn). Cada resultado indica dónde coincidió. Lógica en
  [`src/lib/smartSearch.ts`](src/lib/smartSearch.ts).
- **Notas del candidato** (perfil): notas con tipo (llamada, WhatsApp, entrevista,
  referencia, punto fuerte, alerta, seguimiento), autor y fecha; se pueden fijar arriba,
  editar, eliminar y filtrar. Son del **candidato** (lo siguen entre vacantes) y se guardan
  en la colección `candidate_notes`, que **solo el equipo** puede leer — nunca en el doc del
  candidato, que el propio postulante puede leer. El borrador sin guardar se recuerda.
- **Mover / copiar a otra vacante** (perfil, selección múltiple en Candidatos y en el
  Kanban): *Mover* cambia la vacante de la postulación conservando su id (los links de
  formulario/test ya enviados siguen funcionando) y deja constancia en `vacancyHistory`;
  *Copiar* crea una postulación nueva en la otra vacante con el CV y su puntuación. Nunca
  duplica a alguien que ya está en la vacante destino y no envía WhatsApp.
  `/api/apply` detecta duplicados por el campo `vacancyId`, no por el id del documento.

- **Foto del candidato** (perfil, tarjetas del Kanban y lista de candidatos): al analizar el
  CV, si la IA ve una foto de la persona, el worker la recorta y la guarda como avatar
  ([`serverCvPhoto.ts`](serverCvPhoto.ts)). Saca las imágenes del PDF (JPEG y Flate), del
  Word (`word/media`) o usa el CV mismo si es una imagen; Gemini elige cuál es el retrato
  (descarta logos, íconos y firmas) y dónde está la cara, y `sharp` recorta un cuadrado de
  400×400. Se guarda en Storage (`candidate_photos/`, URL con token) y en el candidato como
  `photoUrl` + `photoStatus` (`found`, `none`, `manual`, `removed`, `error`). En el perfil
  la foto se amplía con un clic y se puede **cambiar**, **buscar en el CV** o **quitar**; lo
  que decide una persona nunca lo pisa la IA. La foto aparece también en **Ranking** y en
  **Entrevistas** (`useCandidatePhotos`).
- **Fotos de los candidatos que ya existían, solas y poco a poco**: tras cada pasada del
  worker de CV (temporizador de 60 s y latido del navegador) el servidor revisa unos
  pocos CV más (`PHOTO_BACKFILL_PER_PASS`, 3 por defecto), **primero las vacantes de
  ventas** y dentro de ellas los más avanzados en el embudo
  ([`serverPhotoBackfill.ts`](serverPhotoBackfill.ts)). No importa si el CV ya se analizó.
  La cola se reconstruye cada 6 h; si una tanda entera falla se pausa 30 min.
  `PHOTO_BACKFILL=off` lo apaga y `GET /api/photos/backfill/status` muestra el avance
  (visible en *Candidatos*). El botón **Buscar fotos en los CV** sigue disponible para
  acelerar a mano (`/api/photos/backfill`).

> Las notas necesitan las reglas de Firestore actualizadas (`candidate_notes`). Se
> publican solas al llegar a `main` (workflow *Deploy Firebase Rules*) o con
> `npm run deploy:rules`.

## Tests presenciales por posición

El test que el candidato hace **en persona** ya no es uno solo: cada vacante elige el suyo,
porque a un técnico, a un cajero y a un asesor de ventas se les evalúan cosas distintas.

- **Biblioteca** (*Formularios → Tests Presenciales*): crear un test nuevo, **duplicar** uno
  existente para adaptarlo a otra posición, editar o eliminar. Cada test muestra qué vacantes lo
  usan; uno en uso no se puede eliminar, y "eliminar" en realidad **archiva** (los candidatos que
  ya lo hicieron conservan sus resultados y se pueden reevaluar con sus criterios).
- **Editor** (`/forms/tests/:id`): nombre, instrucciones que ve el candidato, **perfil buscado** y
  **criterios de calificación con su peso** (suman 100) — es lo que la IA evalúa — y las
  preguntas (arrastrar para ordenar, texto corto/largo, opción múltiple, casillas, escala 1–5).
  Cada pregunta puede llevar una **respuesta esperada** (privada: el candidato nunca la ve; la IA
  la usa para saber si acertó) y una sección.
- **Vacante → test** (*Vacantes → Editar → Test presencial*): se guarda en la vacante como
  `testTemplateId`. Las vacantes que no eligieron usan el **Test Presencial** general (el de
  siempre, id `default`, que no se puede eliminar). La tarjeta de cada vacante muestra su test.
- **Candidato**: el link `/test/<postulación>` (perfil → tarjeta *Test Presencial* → *Abrir test*
  o *Copiar link*) carga el test de su vacante desde `/api/public/form-data/test/…`, que lo
  resuelve en el servidor y **quita las respuestas esperadas**. El avance guardado en el
  navegador es por test.
- **Evaluación**: `/api/evaluate-test` arma el prompt y el esquema de Gemini con los criterios del
  test ([`serverTestEval.ts`](serverTestEval.ts)) y guarda en `testResults` qué test se hizo
  (`testTemplateId`, `testName`) y el puntaje por criterio (`dimensionScores`). *Reevaluar IA*
  usa las respuestas guardadas y el test que el candidato hizo, no el que la vacante tenga hoy.

Los tests viven en la colección `test_templates`, que **solo el equipo** puede leer (reglas de
Firestore). El test general existe solo en código (más las preguntas que se hubieran
personalizado en `settings/forms`) hasta que alguien lo edita y lo guarda: desde ahí es un
documento más. La lógica compartida está en [`src/lib/testTemplates.ts`](src/lib/testTemplates.ts).

## Mensajería de WhatsApp: cola durable y propietario único

Ningún mensaje se envía "a ver si sale". En modo admin, **todo** mensaje (automatización
de etapa y también el chat manual) se **persiste primero** en `whatsapp_outbox` y un
drenador único lo entrega: de a uno, con espaciado aleatorio de 8–20 s y una pausa larga
de 45–90 s cada ~6 mensajes, presencia "escribiendo…" proporcional al largo del texto,
reintentos con backoff (30 s → 1 h, máx. 6 intentos; los errores permanentes tipo
`forbidden`/`item-not-found` fallan al primer intento), reconexión automática previa y
alerta por correo si un mensaje se declara imposible o la cola queda varada esperando a
un humano. Un envío que no puede salir ahora **no se pierde: espera**.

Protección anti-baneo (tras el bloqueo del número en ago 2026): el número recién
vinculado pasa una **cuarentena** de 12 h sin automatizaciones (el chat manual sí sale) y
luego una **rampa de calentamiento** de ~2 semanas (20 → 200 mensajes/día; tope fijo de
25/hora; contadores persistidos en `whatsapp_runtime/send_stats`, edad del número en
`whatsapp_runtime/link_info`). Antes de cada envío se verifica con `onWhatsApp()` que el
número exista (adiós a la tasa de rebote), y si un candidato responde "no me escriban"
queda en `whatsapp_optouts` y no recibe nada más — los reportes de destinatarios son la
señal #1 de baneo. La huella del cliente es estándar (`Browsers.macOS('Chrome')`,
`markOnlineOnConnect:false`), una racha de 403 **suspende** en vez de re-parear en bucle,
y todas las vías de reconexión respetan una única puerta de backoff. Ajustables por env:
`WA_HOURLY_CAP`, `WA_DAILY_CAP`, `WA_QUARANTINE_HOURS`.

Todo esto es **visible en Ajustes de WhatsApp**: panel de protección (enviados hoy vs
límite, cuarentena, fecha de vinculación) y la **cola de mensajes** (en espera y fallidos
con su motivo, con Reintentar/Descartar vía `/api/whatsapp/outbox`). El perfil del
candidato marca a quien pidió no recibir WhatsApp (chat bloqueado) y a los números sin
cuenta de WhatsApp.

Complementos que eliminan las desconexiones que sufría el envío masivo:

- **Lease de propietario único** (`whatsapp_runtime/socket_owner`): solo una instancia
  del servidor mantiene el socket de Baileys. Antes, cada instancia de Cloud Run
  conectaba al arrancar con las mismas credenciales y WhatsApp las echaba entre sí
  (conflictos 440 — el "se desconecta solo" del día a día). Las no propietarias solo
  encolan; el botón **Forzar Reconexión** roba el lease (autoridad humana) y el
  apagado limpio lo libera para el traspaso instantáneo en cada deploy.
- **Bug corregido**: ese botón llamaba `sock.logout()`, que **desvincula el
  dispositivo** (invalida la sesión guardada y obliga a re-escanear el QR). Ahora
  cierra el websocket (`end()`) y reconecta con las mismas credenciales.
- El drenaje corre con CPU garantizada: al encolar, al reconectar, en el latido del
  navegador (cada 3 min vía `/api/cv-worker/run`, que mueve ambas colas) y en un
  temporizador de 60 s como red de seguridad.
- La lógica pura de decisiones (backoff, ritmo, cuándo parar sin quemar reintentos)
  vive en [`serverWhatsAppQueue.ts`](serverWhatsAppQueue.ts), fijada por pruebas.

En desarrollo (sin Admin SDK) el envío es directo, como siempre.

> **Nota operativa:** conviene fijar el servicio de Cloud Run en **máximo 1 instancia**
> y **CPU siempre asignada**. El lease ya evita la pelea entre instancias, pero una
> sola instancia con CPU permanente es lo más sano para un websocket persistente.

## El worker de CV

El análisis de CV corre **en el backend**, no en el navegador del reclutador. Cuando hay
credenciales de Admin SDK, el servidor toma los candidatos con `aiStatus == 'pending'`,
los reclama de forma atómica (una transacción, para que dos pasadas nunca procesen el
mismo CV) y los puntúa con Gemini de a 3 en paralelo. Los que quedan atascados en
`processing` más de 5 minutos —por un reinicio o un corte a mitad de análisis— vuelven a
`pending` solos. En desarrollo, sin credenciales de Admin, el worker del navegador
([`CVWorker.tsx`](src/components/CVWorker.tsx)) hace el trabajo; consulta `/api/health` y
se aparta en cuanto el backend se encarga.

Hay **cuatro** cosas que ponen el worker a trabajar, porque una sola no basta:

| Disparador | Cuándo |
|---|---|
| Aviso interno tras `/api/apply` | Al instante en que llega una postulación |
| `POST /api/cv-worker/run` desde la app | Cuando el reclutador sube CVs en lote o reintenta los que fallaron |
| Latido del navegador (cada 3 min) | Mientras un reclutador tenga la app abierta |
| Temporizador cada 60 s | Mientras el proceso tenga CPU (red de seguridad) |

El temporizador por sí solo no es suficiente en Cloud Run: fuera de una petición la CPU
se limita, así que entre visitas el `setInterval` se detiene y la cola queda quieta. Por
eso los otros tres disparadores son peticiones HTTP — vaciar la cola **dentro** de una
petición es lo que garantiza la CPU para hacerlo. El endpoint corta a los 4 minutos para
no chocar con el tiempo límite de 5 minutos de Cloud Run y responde `incomplete: true`
si quedó trabajo pendiente.

El latido vive en [`CVWorker.tsx`](src/components/CVWorker.tsx): cuando el backend es
quien analiza (hay credenciales de Admin), el navegador **no** analiza —dos reclutadores
duplicarían el trabajo— sino que llama al endpoint cada 3 minutos. En desarrollo, sin
credenciales de Admin, ese mismo componente analiza los CV él mismo.

Al endpoint lo pueden llamar los reclutadores autenticados o un programador externo con
el secreto `CV_WORKER_TOKEN` en la cabecera `X-CV-Worker-Token`. Esto último es
**opcional**: solo hace falta si se quiere garantizar el procesamiento en un periodo en
que nadie se postule *y* ningún reclutador abra la app. Para activarlo, define
`CV_WORKER_TOKEN` en el servicio y apunta un Cloud Scheduler cada 5 minutos a:

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
- [x] **Pruebas automatizadas** (Vitest) y CI que verifica tipos, pruebas y build en cada push.
- [x] Modelo de Gemini **configurable** (`GEMINI_MODEL`) en vez de fijado en 5 sitios del código.
- [x] Gráficas del dashboard en su propio chunk (esa ruta pasó de ~507 KB a ~135 KB).
- [x] Validación de **todos** los cuerpos `/api/*` con Zod (`serverSchemas.ts`), con los
      mensajes fijados por pruebas; `fileUrl` de `parse-cv` restringido al bucket (SSRF).
- [x] Reglas: vacantes en borrador y plantillas de WhatsApp ya no son de lectura pública.
- [x] **Avisos por correo al admin** cuando WhatsApp se desvincula (o lo desplaza otra
      sesión) y cuando la IA falla todos los CV de una tanda — con tope de 1 correo por
      tipo por hora (`ALERT_EMAIL` para cambiar el destinatario).

Pendiente:

- [ ] Ampliar la cobertura de pruebas: hoy cubre la lógica pura y la validación de los
      endpoints, no los handlers completos ni los componentes.
- [ ] Seguir dividiendo `server.ts` (~1.470 líneas tras extraer `serverGemini.ts` y
      `serverCvParse.ts`; el siguiente corte natural es el bloque de WhatsApp/Baileys) y
      `CandidateProfile.tsx` (~1.400 líneas — mejor en una sesión con la app corriendo,
      para verificar visualmente cada extracción).
- [ ] Manejo de errores estructurado (hoy son `console.error` sueltos; los fallos críticos ya avisan por correo).
