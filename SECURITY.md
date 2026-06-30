# Guía de seguridad y despliegue (Track B)

Esta guía explica cómo activar el **modo seguro** del backend y desplegar las reglas
de Firestore endurecidas **sin interrumpir la app**. Sigue el orden tal cual.

## Qué cambió y por qué

Antes:
- El backend hablaba con Firestore como un cliente **sin autenticar**, así que las
  credenciales de la sesión de WhatsApp estaban en colecciones con `read/write: if true`
  (cualquiera en internet podía leerlas y **secuestrar el WhatsApp de la empresa**).
- Los endpoints `/api/*` no tenían autenticación: cualquiera podía gastar tu
  presupuesto de IA, enviar WhatsApp desde la empresa o desconectar la sesión.

Ahora:
- El backend usa el **Firebase Admin SDK** cuando hay credenciales. El Admin SDK
  ignora las reglas de seguridad, así que ya no hace falta dejar nada abierto.
- Los endpoints sensibles exigen un **token de reclutador** (se activa solo en modo admin).
- Las reglas (`firestore.rules`) cierran `whatsapp_auth_*` por completo (`if false`).

> **Importante:** el código está diseñado para no romper nada. Si NO hay credenciales
> admin, el backend cae a modo cliente y la app sigue funcionando como antes (sin
> exigir tokens). El modo seguro se activa cuando completas los pasos de abajo.

---

## Paso 1 — Dar credenciales de administrador al backend

El servidor entra en **modo admin** si encuentra credenciales, en este orden:

1. **En Cloud Run / Google Cloud (recomendado, sin archivos):**
   normalmente ya existe *Application Default Credentials* (ADC) con la cuenta de
   servicio del runtime. Solo asegúrate de que esa cuenta tenga el rol
   **Cloud Datastore User** (o **Firebase Admin**) en el proyecto
   `gen-lang-client-0929279196`. No hace falta configurar nada más.

2. **Con un archivo de cuenta de servicio (cualquier entorno):**
   - En la consola de Firebase → ⚙️ *Configuración del proyecto* → pestaña
     *Cuentas de servicio* → **Generar nueva clave privada**. Se descarga un `.json`.
   - Entrega ese JSON al backend de UNA de estas formas (NO lo subas a git):
     - Variable `GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/archivo.json`, o
     - Variable `FIREBASE_SERVICE_ACCOUNT_JSON='{...contenido del json...}'`
       (útil en plataformas donde solo puedes poner variables de entorno / secrets).

## Paso 2 — Confirmar que el backend está en MODO ADMIN

Reinicia el backend y revisa los logs de arranque. Debe aparecer:

```
[serverDb] Firestore: ADMIN mode (security rules bypassed, auth enforcement ENABLED).
```

Si en su lugar ves `CLIENT fallback mode`, **todavía no hay credenciales válidas**:
revisa el Paso 1. **No continúes al Paso 3 hasta ver `ADMIN mode`.**

> ¿Por qué esperar? Las reglas nuevas cierran `whatsapp_auth_*`. Si las despliegas
> mientras el backend sigue en modo cliente, el backend no podría guardar la sesión
> de WhatsApp y se desconectaría. En modo admin esto no pasa (ignora las reglas).

## Paso 3 — Desplegar las reglas de Firestore endurecidas

Con el backend ya en modo admin, despliega `firestore.rules`:

**Opción A — CLI de Firebase (recomendada):**
```bash
npm i -g firebase-tools     # si no la tienes
firebase login
firebase deploy --only firestore:rules --project gen-lang-client-0929279196
```

**Opción B — Consola web:**
Firebase Console → *Firestore Database* → pestaña *Reglas* → pega el contenido de
`firestore.rules` → *Publicar*.

## Paso 4 — Verificar

- WhatsApp: en *Configuración* la sesión sigue conectada (o reconecta con normalidad).
- Un reclutador puede analizar un CV, enviar WhatsApp y mover candidatos.
- Llamar a un endpoint protegido sin token (p.ej. `curl .../api/whatsapp/status`)
  ahora debe devolver **401**.

## Reversión

Si algo falla, vuelve a publicar la versión anterior de las reglas (Firebase guarda
el historial en *Firestore → Reglas → historial*), o despliega el commit previo. El
backend seguirá funcionando porque el modo admin es compatible con reglas abiertas
y cerradas.

---

## Pendiente conocido (siguiente fase)

- La colección `applications` mantiene **lectura pública** porque las páginas de
  evaluación y test del candidato (`/eval/:id`, `/test/:id`) leen el documento por
  su id (secreto y aleatorio) sin login. Para cerrarla del todo hay que servir esos
  datos desde un endpoint del backend (Admin SDK). Queda para la fase de escalabilidad.
- El endpoint `/api/email/send` es público (lo usa el correo de confirmación del
  candidato); está protegido con rate limiting pero no con autenticación.
