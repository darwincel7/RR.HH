# Instrucciones para Claude en este repositorio

## Idioma

Escríbele al usuario **siempre en español**: en el chat, en las descripciones de los PR y
en los comentarios en GitHub.

## Autorización permanente: fusionar y desplegar

El dueño del repositorio autorizó (28 oct 2026), sin necesidad de volver a preguntar:

- **Fusionar en `main`** los PR terminados: CI en verde, sin conflictos y sin
  comentarios de revisión pendientes. Fusionar con *squash*, como los PR anteriores.
- **Desplegar a producción** todo lo que llegue a `main`.

Después de fusionar, comprobar que terminaron en verde los workflows de `main` (*CI*,
*Deploy Firebase Rules* si cambiaron las reglas, y *Deploy Cloud Run*) y avisar del
resultado. Si alguno falla, arreglarlo.

## Despliegue

Fusionar en `main` **es** desplegar; no hay pasos a mano:

| Qué | Workflow | Cuándo |
|---|---|---|
| Reglas de Firestore y Storage | [`deploy-firebase-rules.yml`](.github/workflows/deploy-firebase-rules.yml) | Cambios en `firestore.rules`, `storage.rules`, `firebase.json` |
| Servidor y app (Cloud Run, `Dockerfile`) | [`deploy-cloud-run.yml`](.github/workflows/deploy-cloud-run.yml) | Cualquier otro cambio de código; también *Run workflow* a mano |

`Deploy Cloud Run` crea una revisión nueva del servicio con **la misma configuración**
(variables de entorno, secretos, instancias) y al final comprueba que `/api/health`
responde. Si se puede, lanzarlo a mano con la herramienta de GitHub Actions
(`workflow_dispatch`) en vez de pedirle al usuario que lo haga.

### Configuración única de Google Cloud (ya explicada al usuario)

Proyecto: `gen-lang-client-0929279196`.

1. APIs habilitadas: Cloud Run Admin, Cloud Build y Artifact Registry.
2. Cuenta de servicio `github-deploy` con los roles **Desarrollador de origen de Cloud Run**
   (`roles/run.sourceDeveloper`), **Consumidor de Service Usage**
   (`roles/serviceusage.serviceUsageConsumer`) y **Usuario de cuenta de servicio**
   (`roles/iam.serviceAccountUser`). La consola del usuario está en español.
3. La cuenta que compila (Compute Engine default service account,
   `<número-del-proyecto>-compute@developer.gserviceaccount.com`) con el rol
   **Cloud Run Builder** (`roles/run.builder`).
4. La clave JSON de `github-deploy`, guardada como secreto del repositorio **`GCP_DEPLOY_SA`**.
5. Servicio de producción: **`darwin-cell-vacantes-de-empleo`** (región `us-west1`), fijado
   en el workflow. El otro servicio del proyecto, `my-google-ai-studio-applet`, **no se
   toca**. Las variables del repositorio `CLOUD_RUN_SERVICE` / `CLOUD_RUN_REGION` lo cambian.

Mientras falte `GCP_DEPLOY_SA`, el workflow se salta con un aviso (no pone `main` en
rojo). Si el despliegue falla por permisos, leer el error del job y decirle al usuario
exactamente qué rol añadir y a qué cuenta.

## Comprobaciones antes de subir cambios

`npm run lint`, `npm test` y `npm run build` (lo mismo que corre el CI).
