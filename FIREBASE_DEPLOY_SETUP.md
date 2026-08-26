# Despliegue automático de las reglas de Firebase

Las **reglas de seguridad** (`firestore.rules` y `storage.rules`) NO viajan con el
despliegue normal de la web. Este proyecto ya está montado para **desplegarlas solas**
cada vez que cambian: cuando se hace push de un cambio de reglas a `main`, una GitHub
Action las publica en la base de datos `produccion` automáticamente.

Para que eso funcione, hay que hacer **UN solo paso, UNA sola vez**. Después nunca más.

---

## ✅ Paso único (te toma ~3 minutos)

### 1. Descarga la llave de servicio de Firebase
1. Entra a la consola de Firebase: <https://console.firebase.google.com/>
2. Elige el proyecto **gen-lang-client-0929279196**.
3. Arriba a la izquierda, clic en el engranaje ⚙️ → **Configuración del proyecto**.
4. Pestaña **Cuentas de servicio**.
5. Botón **Generar nueva clave privada** → **Generar clave**.
6. Se descarga un archivo `.json`. **Ese archivo es una llave — no lo compartas.**

### 2. Guarda esa llave como secreto en GitHub
1. Entra al repositorio en GitHub: `darwincel7/rr.hh`.
2. **Settings** (del repo) → menú izquierdo **Secrets and variables** → **Actions**.
3. Botón **New repository secret**.
4. En **Name** escribe exactamente:
   ```
   FIREBASE_SERVICE_ACCOUNT
   ```
5. En **Secret**, abre el archivo `.json` que descargaste, copia **todo** su contenido y
   pégalo tal cual.
6. **Add secret**.

### 2.5. Dale permisos a esa cuenta de servicio (necesario una sola vez)

La llave recién creada autentica, pero por defecto **no tiene permiso para publicar
reglas**. Hay que darle dos roles:

1. Abre IAM del proyecto:
   <https://console.cloud.google.com/iam-admin/iam?project=gen-lang-client-0929279196>
2. Busca la fila de la cuenta que termina en
   `@gen-lang-client-0929279196.iam.gserviceaccount.com`
   (normalmente empieza con `firebase-adminsdk-`).
3. Clic en el **lápiz** ✏️ de esa fila.
4. **+ AGREGAR OTRO ROL** y añade estos dos:
   - **Firebase Rules Admin** (publicar las reglas)
   - **Service Usage Consumer** (dejar que verifique que la API está activa)
5. **Guardar**.

> Si prefieres lo más rápido en vez de lo más preciso, un solo rol **Editor** también
> funciona (da más permisos de los necesarios).

### 3. ¡Listo!
De ahora en adelante, cada vez que yo (o cualquiera) cambie las reglas y lo suba a
`main`, se despliegan solas. Puedes verlo en la pestaña **Actions** del repo.

---

## ▶️ Desplegar las reglas AHORA (para activar las de seguridad ya subidas)

Después del paso único de arriba, dispara el despliegue una vez sin esperar a un cambio:

1. Repo en GitHub → pestaña **Actions**.
2. En la izquierda, workflow **Deploy Firebase Rules**.
3. Botón **Run workflow** → **Run workflow** (rama `main`).
4. En ~1 minuto se ponen en vigor las reglas nuevas (incluye el arreglo de seguridad de
   candidatos).

---

## 💻 Alternativa: desplegarlas desde tu computadora

Si algún día prefieres hacerlo a mano desde tu máquina (no hace falta si usas lo de
arriba):

```bash
npm install -g firebase-tools     # una vez
firebase login                    # una vez, abre el navegador
npm run deploy:rules              # despliega firestore + storage
```

---

## ℹ️ Notas
- La base de datos es **`produccion`** (no la `(default)`). Ya está configurada así en
  `firebase.json`, así que las reglas se aplican a la base correcta.
- La cuenta de servicio generada desde *Configuración del proyecto → Cuentas de servicio*
  ya trae permisos suficientes para publicar reglas; no hay que configurar roles de IAM.
- El secreto vive cifrado en GitHub y nunca aparece en los registros.
