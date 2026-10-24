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

Aparte del embudo, la entrevistadora puede aplicar en cualquier momento un **Test de
Personalidad** presencial (ver *Herramientas del día a día*). Describe rasgos, no es
"mejor" ni "peor": por eso no suma al Ranking.

## Rutas principales

- Públicas: `/careers`, `/apply/:vacancyId`, `/eval/:applicationId`, `/test/:applicationId`, `/personalidad/:applicationId`, `/estacion` (teléfonos de la empresa)
- Internas (requieren login): `/` (dashboard), `/vacancies`, `/candidates`, `/interviews`, `/forms`, `/phones`, `/settings`

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
| `WA_SEND_HOURS` | *(Opcional)* Horario (hora de RD) en que salen los WhatsApp **automáticos**, p. ej. `8-20` (por defecto: 8:00 a. m. – 7:59 p. m.); `off` lo desactiva. El chat manual no se limita |
| `WA_MAX_QUEUE_HOURS` | *(Opcional)* Horas que un WhatsApp puede esperar en cola; pasado ese tiempo **vence y no se envía** (por defecto 48) |

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
| [`src/lib/interviewScorecard.test.ts`](src/lib/interviewScorecard.test.ts) | El scorecard de entrevista: banco de preguntas compartido vs. respuestas de cada candidato — editar o quitar una pregunta nunca borra lo que alguien ya respondió |
| [`serverInterviewEval.test.ts`](serverInterviewEval.test.ts) | Qué ve la IA de una entrevista (solo respuestas descritas, señales, métricas, contexto) y qué se guarda de su respuesta |
| [`src/lib/candidateScore.test.ts`](src/lib/candidateScore.test.ts) | El puntaje total del Ranking: la entrevista cuenta una sola vez (entrevistador + IA) y un "sin puntuar" no resta |
| [`src/lib/messageVariation.test.ts`](src/lib/messageVariation.test.ts) | Variaciones `{a\|b}` de las plantillas: un envío masivo no manda el mismo texto a todos, pero un reintento produce exactamente el mismo (no duplica) |
| [`src/lib/sendWindow.test.ts`](src/lib/sendWindow.test.ts) / [`src/lib/whatsappPacing.test.ts`](src/lib/whatsappPacing.test.ts) | Horario de envío en hora de RD y la estimación de cuánto tardan en salir los mensajes de un movimiento masivo |
| [`src/lib/whatsapp.automation.test.ts`](src/lib/whatsapp.automation.test.ts) | Lo que de verdad envía un cambio de etapa: redacción distinta por candidato pero idéntica en un reintento, claves de la notificación, canal "solo correo" y que un reintento nunca repita el correo |
| [`src/lib/interviewAttendance.test.ts`](src/lib/interviewAttendance.test.ts) | Quién cuenta como convocado a entrevista (el sello sobrevive al descarte y al avance), que avanzar de etapa no vuelva a contar ni borre la marca, y que los porcentajes nunca den NaN |
| [`src/lib/mergeCandidates.test.ts`](src/lib/mergeCandidates.test.ts) | Unificar dos perfiles: nada se sobreescribe, nada se pierde (el test del duplicado se archiva), un "Descartado" no gana a una etapa activa y dos postulaciones a la misma vacante acaban en una |
| [`src/lib/participantStatus.test.ts`](src/lib/participantStatus.test.ts) | Con varias citas de la misma postulación manda la última: marcar la de hoy no puede borrar el "asistió" real de la de enero |
| [`src/lib/duplicateGroups.test.ts`](src/lib/duplicateGroups.test.ts) | Detectar duplicados en toda la base: agrupa de forma transitiva (A~B por teléfono y B~C por correo son un grupo) y un nombre suelto como "Ana" nunca agrupa a personas distintas |
| [`src/lib/applicantIdentity.test.ts`](src/lib/applicantIdentity.test.ts) | Cuándo una postulación nueva pertenece a un perfil que ya existe: hacen falta teléfono, correo **y** nombre (dos hermanas con el celular y el correo de la casa quedan separadas, y el nombre de pila solo nunca basta) |
| [`src/lib/applicationCv.test.ts`](src/lib/applicationCv.test.ts) | Qué currículum se ve en cada postulación y quién lo ha leído: una nota heredada del perfil no hace pasar por analizado el CV que la persona envió aquí |
| [`serverDb.test.ts`](serverDb.test.ts) | Las consultas con que se busca a una persona por su contacto: si no devuelven su perfil, la comparación de identidad nunca llega a hacerse y se duplica — la precisa pide teléfono **y** correo a la vez, y las de un solo campo prueban el teléfono como lo escribió (no solo canónico) y el correo en minúsculas. También el rastro de una unificación: hasta el perfil vivo, sin colgarse en un ciclo, y qué pasa si la lectura falla |
| [`src/lib/personalityTest.test.ts`](src/lib/personalityTest.test.ts) | El test de personalidad: las frases invertidas cuentan al revés, el resultado se calcula solo con las preguntas que la persona vio, todas se exigen, una plantilla rota no se guarda ni se aplica y los avisos de "respondió todo igual" / "perfil demasiado perfecto" |
| [`serverPersonalityEval.test.ts`](serverPersonalityEval.test.ts) | Qué ve la IA del test de personalidad (resultado ya calculado, frases invertidas, avisos, respuestas abiertas como datos y no como instrucciones) y qué se guarda de su respuesta |

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

- **Entrevista estructurada con respuestas** (perfil → *Evaluar Entrevista*): además de
  señales, red flags y métricas 1–5, el entrevistador **marca las preguntas que hizo** y solo
  entonces aparece la caja para **describir lo que respondió el candidato**. Desde el mismo
  modal se **editan, crean o quitan** preguntas del banco de sugeridas (se guardan al instante
  en `settings/forms`, con transacción, y aplican a todas las entrevistas) o se añaden
  preguntas **solo para esa entrevista**. Cada respuesta guarda el texto de su pregunta, así
  que editar o quitar una pregunta del banco nunca borra lo que alguien ya respondió.
  Al guardar, **la IA analiza la entrevista** (`/api/evaluate-interview`, solo reclutadores):
  lee del documento guardado las respuestas descritas, las señales, las métricas y el
  comentario del entrevistador, con el CV, la etapa 2 y el test como contexto, y deja en la
  postulación `interviewAiEvaluation` (puntaje, recomendación, fortalezas, dudas, análisis
  respuesta por respuesta, consistencia y preguntas para validar). En el **Ranking** la
  entrevista cuenta una vez: promedio de la nota del entrevistador y la de la IA
  ([`candidateScore.ts`](src/lib/candidateScore.ts)).
- **¿Asistió a la entrevista?** (tarjeta del Kanban y perfil, solo en quien fue convocado):
  dos botones — ✅ *Asistió* / ❌ *No se presentó* — que guardan quién marcó y cuándo.
  Pulsar otra vez la opción marcada la quita (un "no vino" por error falsearía justo el
  porcentaje que se intenta bajar). El **Dashboard** muestra convocados, % que asistió,
  % que no se presentó, % sin registrar y el desglose por vacante, con filtro de 30/90
  días o todo el histórico.
  La clave está en el denominador: al mover a alguien a una etapa de entrevista la
  postulación queda con `interviewInvitedAt`, y ese sello **no se borra** aunque la
  persona avance a Finalista o se descarte. Si "los invitados" se contaran por la etapa
  actual, cada descarte haría bajar el porcentaje de ausencias sin que nadie hubiera
  mejorado nada. Avanzar de "Convocado a entrevista" a "Entrevista presencial" no es una
  convocatoria nueva; una reconvocatoria de verdad archiva la marca anterior en
  `interviewAttendanceLog` y deja la nueva cita sin marcar. La página *Entrevistas* sigue
  marcando asistencia en su sesión, pero escribe también en la postulación, así que las
  dos pantallas no pueden decir cosas distintas: el botón lee lo marcado en la agenda y
  marcar desde el Kanban toca **solo la última cita** (escribir en todas borraría el
  "asistió" real de una sesión anterior). Añadir a alguien a una sesión nueva cuando ya
  tenía asistencia marcada es una reconvocatoria: archiva esa marca y la cita nueva nace
  sin marcar. Lógica y métricas en
  [`src/lib/interviewAttendance.ts`](src/lib/interviewAttendance.ts).
  Además del porcentaje sobre el total de convocados, el panel muestra el porcentaje
  **sobre lo ya registrado**: es el número comparable entre períodos mientras falten
  marcas. Los colores de la barra son `emerald-500` / `rose-700` a propósito — el
  verde/rojo habitual queda a ΔE 5.8 en deuteranopía, indistinguible para quien no ve el
  rojo — y ningún dato se comunica solo con color.
- **Unificar perfiles duplicados** (perfil → *Unificar perfiles*): junta en el perfil
  abierto otro perfil del mismo postulante — sus postulaciones, tests, formularios,
  entrevistas, notas, historial de WhatsApp y citas de entrevista.
  Por qué había duplicados: `/api/apply` crea el candidato con el UID de la sesión
  anónima, así que quien aplicaba otro día o desde otro navegador **nacía como un perfil
  nuevo**; si además escribió el número distinto, el deduplicado por teléfono/correo no lo
  veía. Así es como la misma persona acabó con un test en un perfil y otro en el otro.
  Ahora el intake lo reconoce (ver *Una persona, un perfil* más abajo), y esta pantalla
  resuelve los que ya estaban y los que el reconocimiento no puede afirmar.
  Reglas: manda el perfil principal (del duplicado solo se toma lo que le falta); una
  postulación a una vacante donde el principal no está se **mueve** conservando su id (los
  links `/eval` y `/test` ya enviados siguen funcionando); dos postulaciones a la **misma**
  vacante se combinan en una, que se queda con la etapa más avanzada —un "Descartado"
  nunca gana a una etapa activa— y con la evidencia que faltaba. Cuando los dos tienen la
  misma evidencia (un test cada uno) **no se mezcla nada**: se conserva la del principal
  entera y la otra se archiva, porque juntar la puntuación de una con las respuestas de la
  otra dejaría una postulación que se contradice. La postulación absorbida se guarda
  **completa** en `mergedEvidence` y se muestra en el perfil ("De un perfil unificado");
  si no cabe ahí (más de 200 KB) va a `merged_applications`, y si ni eso se pudo, la
  postulación original se deja sin borrar; la misma tarjeta la trae con un botón de los
  dos sitios — decir "se guardó aparte" o "se dejó sin borrar" sin poder abrirla era
  prometer una consulta que no existía, y menos aún desde el perfil duplicado, que
  redirige al principal,
  pero su documento desaparece: el link de test/formulario enviado *desde ese perfil* deja
  de funcionar (la pantalla lo advierte antes de confirmar).
  El perfil duplicado **no se borra**: queda con `mergedInto`, deja de recibir
  postulaciones y mensajes y sus links viejos redirigen al perfil principal. Las búsquedas
  de candidato del servidor siguen ese rastro hasta el perfil vivo, y `/api/apply` lo
  sigue también para la sesión del propio postulante: su navegador conserva el UID
  anónimo, así que sin eso su siguiente postulación nacería colgada del perfil muerto.
  Si el rastro no acaba en ningún perfil vivo —el que recibió la unificación se **borró**,
  y borrar un candidato no limpia los `mergedInto` que apuntan a él—, la postulación
  **reactiva** el perfil de esa sesión en vez de colgarse de un perfil que las pantallas
  esconden (la reparación se escribe con la postulación, o al decirle "ya existe una
  postulación" — nunca en una petición que no concluye nada): en el peor caso reaparece un duplicado, que se ve y se arregla en dos clics,
  mientras que fallar dejaría a esa persona sin poder aplicar nunca desde su navegador. El
  otro teléfono/correo se guarda como `alternatePhones`/`alternateEmails` —incluidos los
  que el duplicado ya traía de una unificación anterior, para que unificar dos veces
  (A→B→C) no pierda el contacto de A—: entran en el buscador, vuelven a enlazar un
  WhatsApp entrante con la persona y **el deduplicado de `/api/apply` también los mira**,
  que es lo que evita el tercer duplicado cuando vuelve a aplicar con ese número. Y si el
  contacto solo quedó guardado en el perfil muerto, el reconocimiento salta de ahí al
  perfil vivo en vez de descartarlo.
  **Revisar duplicados** (*Candidatos* → botón en la cabecera) hace la pregunta con la
  que se limpia de verdad: cuántos duplicados hay en la base y cuáles. Agrupa **toda** la
  base por teléfono, correo y nombre completo, de forma transitiva (si A y B comparten el
  teléfono y B y C el correo, los tres son un grupo: tratarlos como dos parejas dejaría a
  C fuera), propone dentro de cada grupo el perfil más completo como principal y lanza la
  unificación de siempre con su vista previa. Un nombre suelto ("Ana") nunca agrupa: una
  unificación equivocada no se deshace con un botón.
  La pantalla propone los perfiles parecidos (mismo teléfono, correo o nombre completo),
  deja buscar cualquier otro y muestra **exactamente** qué va a pasar antes de confirmar;
  la vista previa la calcula el mismo módulo que ejecuta el servidor
  ([`src/lib/mergeCandidates.ts`](src/lib/mergeCandidates.ts)), así que no puede prometer
  otra cosa. Va por el servidor (`POST /api/candidates/merge`, solo reclutadores) porque
  el historial de WhatsApp es inmutable para el cliente: solo el Admin SDK puede
  reasignarlo. En el perfil aparece solo un aviso cuando hay otro perfil con el mismo
  teléfono.
- **Una persona, un perfil (al postular)**: el navegador no es la identidad de nadie. Si
  el perfil que ya existe coincide en **teléfono, correo Y nombre**, la postulación nueva
  se cuelga de ESE perfil en vez de nacer un duplicado
  ([`src/lib/applicantIdentity.ts`](src/lib/applicantIdentity.ts)). No es una regla nueva:
  con la misma sesión ya pasaba — el perfil se actualizaba con los datos y el CV nuevos.
  El listón es alto a propósito: compartir un celular es normal en una familia, y hacen
  falta **dos palabras distintas** en los dos nombres (con el nombre de pila solo, "Ana"
  estaría contenido en "Ana Gómez" y bastaría conocer el teléfono, el correo y el nombre
  de pila de alguien para caer dentro de su perfil; y repetirlo tampoco vale — "Ana Ana"
  no es compatible con "Ana Pérez").
  Se busca primero por **teléfono y correo a la vez**, que es la consulta que de verdad
  identifica y a la que no le afecta cuántos perfiles compartan uno de los dos; después
  por cada dato por separado, que es lo que encuentra a quien lo tiene en otro sitio (los
  alternativos de una unificación, un teléfono viejo sin forma canónica). Esas llevan
  tope, porque si no un número de negocio compartido haría leer la base entera en cada
  postulación — y eso lo puede provocar cualquiera desde el formulario público. Si algo no cuadra se crea un perfil aparte y
  queda en *Revisar duplicados*: un duplicado se arregla en dos clics; confundir a dos
  personas, no. Y compartir el contacto **no bloquea**: solo la postulación de un perfil
  que sí es esta persona impide repetir en la misma vacante. Bloquear por el celular
  compartido dejaría a la hermana sin poder aplicar a un trabajo, y eso es un daño real
  que nadie ve — la postulación no llega nunca; dos postulaciones del mismo teléfono, en
  cambio, se ven y se descartan en un clic. Por la misma razón, **una postulación
  reconocida solo por el contacto tampoco bloquea** a otra sesión: si lo hiciera, quien
  conociera el teléfono, el correo y el nombre de alguien podría aplicar primero en su
  nombre y dejar fuera su postulación de verdad. Bloquean la del dueño del perfil (la
  sesión que lo creó) y la de la **misma** sesión que vuelve a enviar — el doble clic de
  siempre ([`blocksNewApplication`](src/lib/applicantIdentity.ts)). Solo se reconoce cuando esa sesión no tiene perfil propio todavía; juntar
  dos perfiles que ya existen es una unificación de verdad, y la decide una persona.
  Escribir en un perfil que ya existía **completa, no destruye** (igual que la
  unificación): se conserva el nombre más completo, la ciudad solo se rellena si falta, y
  el teléfono/correo que deja de ser el principal se guarda como alternativo — de él
  depende que un WhatsApp entrante siga enlazándose con esa persona.
  En un perfil reconocido por sus datos, el **nombre** y el teléfono y el correo
  **principales tampoco se tocan** (`namesCompatible` acepta un nombre que contenga al
  guardado, así que si no, quien conociera el contacto de alguien podría añadirle
  apellidos inventados, y ese nombre es el que ve el equipo y el que va en sus mensajes): para ser reconocido basta coincidir con un contacto *alternativo* (ahí está
  justo el número por el que nació un duplicado), así que escribirlo como principal
  ascendería un dato viejo y la siguiente respuesta de WhatsApp saldría hacia otro número.
  En el perfil de la propia sesión sí se actualiza: ahí el contacto nuevo es una
  corrección suya.
  El **CV y su análisis no se tocan** en un perfil reconocido por sus datos: quien llena
  el formulario no ha demostrado que ese perfil sea suyo, y conocer el teléfono, el correo
  y el nombre completo de alguien —un ex, un rival, un familiar— bastaría para reemplazar
  su currículum y con él su análisis de IA y la nota de sus postulaciones sin puntuar.
  Sería sabotaje silencioso contra un candidato: ni él ni el equipo lo verían. Su
  postulación nueva sí lleva su propio CV, y nace con la nota del análisis vigente de esa
  persona (marcada como heredada) para no quedarse fuera del Ranking; el perfil ofrece
  **Analizar CV de esta postulación** mientras la nota venga de otro currículum, que es el
  único camino para leer ese CV — el worker ya no vuelve a pasar por él
  ([`src/lib/applicationCv.ts`](src/lib/applicationCv.ts)).
  En el perfil de la **propia sesión** sí se renueva, como siempre: ese uid creó el perfil,
  así que es suyo. Y si el perfil reconocido no tenía CV, se le pone.
  Cada postulación conserva **su** CV: el Kanban y el perfil abren el currículum con el
  que se envió esa postulación, y la nota del CV no se reescribe en una postulación
  presentada con otro — ni al reanalizar a mano, ni desde el worker, que además devuelve
  el CV a la cola si cambió mientras la IA leía el anterior. Reconocer a alguien exige que
  su teléfono coincida, y la consulta que lo encuentra es la del teléfono canónico: la
  primera postulación tras actualizar rellena ese campo en los perfiles viejos que no lo
  tenían (una sola vez en la vida de la base, anotado en `settings/dedupe`), porque si no
  aparecen en la búsqueda se duplican igual.
- **Test situacional en el teléfono de la empresa** (perfil → *Resultados Test*, mientras
  está pendiente): *QR para el teléfono* abre `/test/:id` sin escribir nada ni pasar por
  WhatsApp —lo escanea la reclutadora con el teléfono de la empresa y lo entrega ya
  abierto, así el candidato no lo abre en el suyo—; también *Abrir aquí* y *Copiar link*.
  El test empieza con **"Este test es para: Juan C. P."** (nombre de pila e iniciales, que
  da `/api/public/form-data/test/:id`; nunca el apellido completo en una página pública) y
  el botón *Sí, soy Juan C. P. Comenzar test*, para que nadie responda el de otro. Los
  campos de texto van **sin corrector**: sin revisión ortográfica, autocorrección,
  mayúsculas automáticas ni autocompletar (el teclado del teléfono puede ignorarlo: hay
  que apagarlo también en sus ajustes). **Pegar está bloqueado**, también el texto que
  entra de golpe sin evento `paste` (portapapeles del teclado, dictado): más de 20
  caracteres en un solo cambio no se acepta. La página cuenta cada vez que la pantalla del
  test deja de verse (otra app o pestaña, teléfono bloqueado, recarga) con el tiempo fuera,
  los intentos de pegar y la duración; el conteo sobrevive a una recarga y viaja con las
  respuestas. El servidor lo guarda en `testIntegrity` —aparte de `testResults`, que la
  calificación IA reescribe entero— y el perfil lo muestra como **Integridad del test**:
  en verde si no salió ni intentó pegar, en ámbar con el detalle si lo hizo. Lo cuenta el
  navegador del candidato: es una señal para conversar, no una prueba (una salida corta
  puede ser la pantalla que se apagó sola). Lógica en
  [`src/lib/testIntegrity.ts`](src/lib/testIntegrity.ts). *Eliminar Test* lo borra con
  las respuestas y al unificar perfiles viaja con el resto del test.
- **Modo estación: los teléfonos de la empresa** (menú *Teléfonos*; en el perfil,
  *Enviar a un teléfono* en *Resultados Test* y en *Test de personalidad*): el test
  situacional y el de personalidad llegan solos al teléfono que la reclutadora elige, sin
  QR, link ni WhatsApp. La asignación lleva su tipo (`assignment.kind`: `test` o
  `personality`; sin tipo = situacional, para teléfonos con la página anterior) y una
  misma postulación puede tener cada test en un teléfono distinto: todo lo que escribe o
  libera un teléfono comprueba postulación **y** tipo (`holds`). En el de personalidad,
  *Enviar a un teléfono* lo **aplica y lo envía en un solo paso** (si el test de
  Formularios tiene errores, no envía nada); *Reiniciar* lo vuelve a abrir desde cero en el
  teléfono que lo tenga y *Cancelar test* libera ese teléfono. El teléfono abre la página
  de personalidad embebida (con *Sí, soy Juan. Comenzar*), informa la pregunta en
  pantalla y, al enviar, `/api/public/personality/submit` comprueba el teléfono, anota
  `personalityTest.station` (*Respondido … en Teléfono 2*) y lo libera. Mientras un test
  está en un teléfono, la tarjeta oculta el QR y el link, y el botón para sacarlo de ahí
  es *Quitar del teléfono*. Cada teléfono se **vincula una vez**: abre
  `/estacion` (el QR de *Teléfonos* la abre), escribe un código de 6 dígitos que genera el
  panel (`station_codes/{código}`, vence en 10 minutos, un solo uso, se consume en una
  transacción) y un nombre («Teléfono 2»). El servidor crea `stations/{id}` con un id
  **secreto** de 32 caracteres que es la llave del teléfono: lo guarda su navegador y el
  teléfono nunca toca Firestore — habla solo con `/api/public/station/*` (`pair`, `poll`,
  `progress`, `release`); las reglas dejan `stations` y `station_codes` solo al equipo.
  Desde entonces la página espera: cada 3 s pregunta si tiene test (`poll`, que anota
  `lastSeenAt` como mucho cada 30 s; sin noticias en 2 minutos el panel lo muestra *Sin
  conexión*). *Enviar* escribe `assignment` en el teléfono en una transacción que rechaza
  uno ocupado con otra persona; *Pasar a otro teléfono* lo quita del anterior en la misma
  transacción. El teléfono abre el test **embebido** (el mismo `/test`, sin link a la vista),
  con su nombre arriba y la confirmación *Sí, soy …*; informa la pregunta en pantalla y las
  salidas (`progress`, que solo escribe si sigue siendo su test), y el perfil lo muestra en
  vivo: *En Teléfono 2 · Confirmó su nombre a las … · Pregunta 7 de 20 · No ha salido de la
  pantalla*, con *Pasar a otro teléfono* y *Cancelar*. Al enviar, `/api/evaluate-test`
  comprueba que el test estaba asignado a ese teléfono, anota `testIntegrity.station`
  (*Respondido en Teléfono 2* en el perfil) y lo **libera**; el teléfono despide al
  candidato («¡Listo, Juan!») y a los 8 s vuelve a *Esperando candidato…*. Mientras está a
  la vista mantiene la pantalla encendida (Wake Lock), para que un teléfono que se bloquea
  solo no cuente como salida. Se instala como app (`public/estacion.webmanifest`: abre
  `/estacion` sin barra de direcciones) y *Teléfonos* explica cómo dejarlo listo: instalar,
  apagar las ayudas del teclado, fijar la app y no dejar cuenta en la Play Store. Esa
  página muestra cada teléfono en vivo (libre, ocupado con quién y por qué pregunta, sin
  conexión), los tests terminados hoy (`doneToday`, por día de RD), *Liberar* y
  *Desvincular* (el teléfono vuelve a *Vincular* en su próxima consulta). El QR y el link
  siguen como respaldo. Lógica en [`src/lib/stations.ts`](src/lib/stations.ts).
- **Test de Personalidad presencial** (perfil → tarjeta *Test de personalidad*): se aplica
  **cuando la entrevistadora lo decide**, no lo dispara ninguna etapa. *Aplicar test ahora*
  guarda en la postulación una **copia** del test tal como está en Formularios y habilita
  el link `/personalidad/:id`; desde la tarjeta se abre en esa misma pantalla, se muestra un
  **QR** para el teléfono del candidato o se copia el link. Sin esa activación el link solo
  dice "aún no está habilitado" (y se activa solo en cuanto se aplique), y una vez
  respondido se cierra. El candidato ve una pregunta por pantalla con botones grandes, pensado
  para tableta o teléfono; su progreso sobrevive a una recarga y al terminar **no** ve el
  resultado. El perfil lo recibe en vivo.
  El test por defecto mide los **Cinco Grandes rasgos** adaptados a atención al cliente
  (Sociabilidad, Amabilidad, Responsabilidad, Estabilidad emocional y Apertura): 25 frases
  de escala 1–5 —2 invertidas por rasgo, intercaladas— más 2 de opción múltiple y 2
  abiertas, unos 10 minutos. El **servidor** calcula el resultado
  (`/api/public/personality/submit`): por rasgo, el promedio de sus frases llevado a 0–100
  (bajo < 40, alto ≥ 70) con la lectura de "alto"/"bajo" de cada rasgo, y avisos cuando la
  persona respondió casi todo igual o salió perfecta en todo. Las respuestas se validan
  contra la copia guardada, nunca contra preguntas que traiga la petición, y una entrega de
  un intento que la entrevistadora reinició se rechaza. *Interpretar con IA*
  (`/api/personality/interpret`, solo reclutadores) lo traduce a un perfil práctico:
  fortalezas, qué explorar, cómo trabaja, encaje con la vacante y preguntas para validar.
  **Editable en Formularios** → *Test de Personalidad (presencial)*: cambiar el nombre y las
  instrucciones; añadir, renombrar o quitar rasgos (con su texto para "alto" y "bajo");
  añadir, editar, duplicar, reordenar arrastrando o quitar preguntas de escala (con su
  rasgo y si es invertida), de opción múltiple o abiertas; y *Restaurar test recomendado*.
  Un test con errores (sin nombre, pregunta vacía, opción múltiple con menos de 2 opciones)
  no se guarda ni se aplica; los avisos (frase sin rasgo, rasgo con menos de 3 frases) solo
  informan. Lo ya respondido nunca cambia al editar: cada postulación guarda la versión que
  se le aplicó. Lógica en [`src/lib/personalityTest.ts`](src/lib/personalityTest.ts).
  Al unificar perfiles el test viaja entero como el resto de la evidencia.
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

> Las notas necesitan las reglas de Firestore actualizadas (`candidate_notes`), y el test
> de personalidad también (un postulante no puede crear su postulación con un
> `personalityTest` ya puesto). Se publican solas al llegar a `main` (workflow *Deploy
> Firebase Rules*) o con `npm run deploy:rules`.

## Mensajería de WhatsApp: cola durable y propietario único

Ningún mensaje se envía "a ver si sale". En modo admin, **todo** mensaje (automatización
de etapa y también el chat manual) se **persiste primero** en `whatsapp_outbox` y un
drenador único lo entrega: de a uno (el chat manual con espaciado aleatorio de 8–20 s; los
automáticos, mucho más lento — ver *Refuerzos* abajo), presencia "escribiendo…" proporcional al largo del texto,
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

Refuerzos para los envíos masivos (oct 2026, tras nuevos bloqueos):

- **Ritmo propio para los automáticos**: ~1 por minuto con espacios irregulares (35–95 s) y
  un descanso de 3–7 min tras ráfagas de 4 a 7 mensajes, también al azar
  ([`serverWhatsAppQueue.ts`](serverWhatsAppQueue.ts)). El espacio **se respeta entre
  pasadas del drenador** (`autoNextAt` persistido en `send_stats`): antes, una pasada que
  terminaba justo después de enviar y la siguiente, segundos después, mandaban dos plantillas
  seguidas. El chat manual va **primero** y no espera ese ritmo.
- **Horario de envío** (`WA_SEND_HOURS`, por defecto 8:00 a. m. – 7:59 p. m., hora de RD):
  fuera de él los automáticos esperan a la mañana ([`sendWindow.ts`](src/lib/sendWindow.ts)).
- **Ningún mensaje idéntico**: las plantillas aceptan variaciones `{Hola|Saludos|Buenas}` y
  cada candidato recibe una combinación distinta ([`messageVariation.ts`](src/lib/messageVariation.ts)).
  La elección es **determinista por destinatario** (teléfono + etapa + vacante), así que un
  reintento genera el mismo texto; además la cola deduplica por la notificación
  (`dedupeKey`), no solo por el texto. Nuevo `{{primer_nombre}}` ("Hola María", y los
  nombres en MAYÚSCULAS se escriben normal). Las plantillas por defecto
  ([`whatsappTemplates.ts`](src/lib/whatsappTemplates.ts), una sola copia para el envío y el
  editor) ya traen variaciones; el editor muestra cuántas versiones tiene cada una, avisa si
  todas salen iguales, ofrece **vista previa** y **"Usar versión recomendada"**.
- **Confirmación antes de un movimiento masivo** (Kanban y Candidatos) a una etapa que avisa:
  cuántos mensajes son, **cuánto tardarán** en salir a este ritmo (con el límite diario y el
  horario), si la plantilla varía, y la opción de avisar **solo por correo** (sin riesgo para
  el número) o **solo mover**. "Reintentar envíos fallidos" ya no reenvía el correo.
- La fecha límite del formulario de etapa 2 (`{{fecha}}`) ya no sale vacía ("antes del :"):
  si nadie la fijó, se usan 3 días.
- **Los mensajes del pasado no se envían** ([`outboxFate`](serverWhatsAppQueue.ts)): todo lo
  que estaba en cola antes del **12 oct 2026, 5:45 p. m. (RD)** —mucho se acumuló mientras
  el número estuvo bloqueado— se descarta en bloque en la primera pasada del drenador y,
  por si acaso, se vuelve a comprobar antes de cada envío. Desde entonces, un mensaje que no
  logra salir en `WA_MAX_QUEUE_HOURS` (48 h) **vence**: no se envía y queda en *Fallidos*
  para saber a quién no se avisó (*Reintentar* lo vuelve a poner en cola y reinicia su
  reloj). Un mensaje viejo nunca bloquea al nuevo en la deduplicación.

Todo esto es **visible en Ajustes de WhatsApp**: panel de protección (enviados hoy vs
límite, cuarentena, fecha de vinculación, ritmo, horario de envío y próximo automático) y la **cola de mensajes** (en espera y fallidos
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
