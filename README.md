# Pokémon Distribuciones Bot

Bot de Telegram público que responde a preguntas como *"¿en qué juegos se ha
distribuido Mew, y era shiny?"* cubriendo **todo** el historial de Mystery
Gift (no solo los Pokémon míticos), te deja **descargarte la wondercard
real** de cualquier distribución, sabe qué distribuciones del juego actual
están **activas ahora mismo** o **anunciadas** sin empezar todavía, te avisa
de **qué se queda atrapado si no lo mueves a Pokémon HOME** antes de que
cierre Pokémon Bank, y cruza esto último con tu propia Living Dex de
Poketracker para decirte exactamente qué te falta.

Sigue el mismo patrón que tus otros bots: **Cloudflare Workers + KV**,
desplegado conectando el Worker a GitHub (nada de CLI ni entorno local), y
todo administrable desde el navegador o el móvil.

## De dónde salen los datos (y por qué te puedes fiar del shiny)

- **Historial completo + shiny**: [`projectpokemon/EventsGallery`](https://github.com/projectpokemon/EventsGallery),
  el archivo comunitario que usa la propia herramienta PKHeX para comprobar
  la legalidad de Pokémon de evento. No son notas de un wiki: son los
  **archivos reales** (wondercards) tal como los distribuyó Nintendo/Game
  Freak. El scraper (`scripts/fetch-eventsgallery.mjs`) descarga ese
  repositorio entero y, para cada distribución, **lee el binario del
  archivo** para saber si es shiny — no se fía del nombre del archivo salvo
  como último recurso. La lógica de lectura (`scripts/wc-parsers.mjs`) está
  sacada directamente del código fuente de PKHeX (offsets exactos de PID,
  TID/SID y el byte que indica "siempre shiny / nunca / depende del
  entrenador"), y se ha validado contra más de 8.000 archivos reales del
  repositorio antes de dar esto por bueno.
  - Cuando el archivo no se puede verificar de forma fiable (un formato
    minoritario, o un archivo corrupto), el bot te lo dice explícitamente
    en vez de inventar una respuesta: verás una etiqueta *"✅ verificado
    leyendo la wondercard real"* o *"ℹ️ estimado por el nombre del
    archivo"* según el caso.
  - El shiny puede ser de tres tipos, y el bot los distingue: **siempre**
    (garantizado), **nunca** (bloqueado) y **depende** (aleatorio según tu
    suerte/ID de entrenador — es lo mismo que capturar uno normal).
- **Activas / anunciadas ahora mismo**: dos páginas de Bulbapedia que se
  mantienen casi al día con las distribuciones del juego actual (Escarlata
  y Púrpura, Legends Z-A), con fechas de inicio y fin concretas.

## Cómo funciona

```
EventsGallery (GitHub, historial completo)      Bulbapedia (activas/anunciadas)
        │  scraping semanal                              │
        ▼                                                 ▼
GitHub Actions ──commit──► data/eventsgallery.json   data/distributions.json
        │  ping opcional
        ▼
Cloudflare Worker ──cron semanal (y al recibir el ping)──► lee ambos JSON y
        │                                                   los guarda en KV
        ▼
Telegram (webhook) ◄── usuarios escribiendo /activas, "mew", /wondercard ...
```

- **`scripts/fetch-eventsgallery.mjs`**: clona EventsGallery, recorre todos
  los archivos de evento (ignorando objetos, ropa, códigos QR y demás cosas
  que no son un Pokémon), determina el shiny leyendo el binario, agrupa las
  variantes de un mismo evento (un mismo Jirachi repartido con 13 códigos
  distintos cuenta como una sola distribución) y genera
  `data/eventsgallery.json` — el catálogo completo.
- **`scripts/wc-parsers.mjs`**: los lectores binarios en sí (WC6, WC7, WC8,
  WC9, PGF, PGT/PCD/WC4, PK3/PK4/PK5). Documentado por dentro con de dónde
  sale cada offset.
- **`scripts/fetch-distributions.mjs`**: solo se encarga de las fechas
  concretas de activas/anunciadas del juego actual (`data/distributions.json`).
- **`src/worker.js`**: el bot (Cloudflare Worker). Atiende el webhook de
  Telegram, cachea ambos datasets en KV, responde comandos y reenvía la
  wondercard real cuando se la piden.

## Despliegue (todo desde el navegador, sin terminal)

### 1. Sube este proyecto a un repo de GitHub

Crea un repositorio nuevo en GitHub y sube todos estos archivos y carpetas
tal cual ("Add file → Upload files" en la web de GitHub).

### 2. Crea el bot en Telegram

Habla con **@BotFather** → `/newbot` → guarda el **token** que te da.

### 3. Crea el Worker en Cloudflare, conectado a tu repo

Cloudflare dashboard → **Workers & Pages → Create → Connect to Git** →
elige tu repo. Detecta `wrangler.toml` y hace `npm install` + `wrangler
deploy` solo en cada push.

### 4. Crea el namespace de KV y enlázalo

Cloudflare dashboard → **Workers & Pages → KV → Create namespace**. Copia
su ID a `wrangler.toml` (`id = "..."`) y haz commit del cambio vía la web
de GitHub.

### 5. Configura variables y secretos en Cloudflare

Worker → **Settings → Variables and Secrets**:

| Nombre | Tipo | Valor |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | el token de @BotFather |
| `WEBHOOK_SECRET` | Secret | una cadena aleatoria que te inventes |
| `REFRESH_SECRET` | Secret | otra cadena aleatoria distinta |

Y edita `wrangler.toml` (commit vía web de GitHub) para poner las dos URLs
"raw" reales de tu repo:

- `GITHUB_DATA_URL` → `https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/distributions.json`
- `GITHUB_GALLERY_URL` → `https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/eventsgallery.json`

### 6. Registra el webhook de Telegram

Abre esto en el navegador (sustituye los valores):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<TU-WORKER>.workers.dev/webhook&secret_token=<WEBHOOK_SECRET>
```

Debería responder `{"ok":true,...}`.

### 7. Primera actualización de datos

**El dataset de historial completo (`data/eventsgallery.json`) ya viene
incluido y relleno** con más de 1.800 distribuciones reales — no hace falta
esperar a nada para empezar a usar `/pokemon` y `/wondercard`.

Lo único que falta es lo de activas/anunciadas: ve a **Actions** en tu
repo → workflow **"Actualizar distribuciones"** → **Run workflow**, para
que `data/distributions.json` se rellene con las fechas actuales de
Bulbapedia.

### 8. (Opcional) refresco instantáneo

Si no haces nada, el Worker se sincroniza solo (su propio cron semanal). Si
quieres que se entere al instante de cada actualización del Action:

- Repo → **Settings → Secrets and variables → Actions**:
  - Variable `CLOUDFLARE_REFRESH_URL` = `https://<TU-WORKER>.workers.dev/refresh`
  - Secret `REFRESH_SECRET` = el mismo valor que en el Worker.

### 9. Habla con tu bot

`/ayuda`, luego prueba `mew`, `/activas`, `/proximas`, y coge el id que
aparece bajo cualquier resultado para probar `/wondercard <id>`.

## Comandos

- Escribir el nombre de un Pokémon (o `/pokemon <nombre>`, en español o
  inglés) → todas sus distribuciones conocidas: juego, generación, región,
  shiny (con el nivel de confianza), si puede llegar a día de hoy a Pokémon
  HOME o se queda atrapado, y el id para descargarla.
- `/wondercard <id>` → te manda el archivo real de esa distribución como
  documento de Telegram (para abrir con PKHeX u otras herramientas). El
  archivo se pide al momento a GitHub, no se guarda copia en el bot.
- `/home` → recordatorio general: cuándo cierra Pokémon Bank y qué juegos
  dependen de él.
- `/faltan` → cruza el catálogo con tu Living Dex de Poketracker: qué
  especies tienes pendientes de mover a HOME antes de que cierre Bank, y qué
  shiny garantizados por Mystery Gift te faltan en la Living Dex Shiny.
- `/activas` → distribuciones del juego actual abiertas ahora mismo.
- `/proximas` → distribuciones del juego actual anunciadas sin empezar.
- `/ayuda` → recordatorio de todo esto.

### Sobre `/faltan` y Pokémon HOME

- El estado de HOME/Bank se calcula a partir de la generación de cada
  distribución y de la fecha de cierre de Pokémon Bank, confirmada por
  Nintendo/The Pokémon Company para el **26 de febrero de 2027**: si esa
  fecha cambiara, solo hay que actualizar `BANK_CLOSURE_UTC` en `src/lib.js`.
- `/faltan` lee `data/progreso.json` de
  [`afsenovilla/poketracker`](https://github.com/afsenovilla/poketracker)
  directamente — es un archivo público de solo lectura, así que no hace
  falta ni login ni vincular cuentas. Es una función pensada para quien
  mantiene el bot (tú), no un sistema multiusuario: si algún día quisieras
  que cada persona pudiera cruzar su propio Poketracker, habría que guardar
  qué repo le corresponde a cada `chat_id` en KV — ahora mismo el repo está
  fijado en la variable `POKETRACKER_REPO` de `wrangler.toml`. Ponla en
  blanco (`""`) si prefieres desactivar `/faltan`.

## Pruebas locales

```
npm install
npm test                                  # valida los lectores binarios y las funciones del bot
node scripts/fetch-distributions.mjs      # requiere acceso a internet (Bulbapedia)
node scripts/fetch-eventsgallery.mjs      # requiere acceso a internet (clona ~200 MB de GitHub)
```

Si ya tienes el repo de EventsGallery clonado en algún sitio, puedes
apuntar el scraper ahí en vez de que lo vuelva a clonar:

```
EG_LOCAL_PATH=/ruta/a/tu/copia/de/EventsGallery node scripts/fetch-eventsgallery.mjs
```

## Límites conocidos / posibles mejoras futuras

- La agrupación de variantes (varios códigos/objetos sostenidos de un mismo
  evento contados como una sola distribución) es una heurística por
  carpeta/nombre de archivo; en un puñado de casos puede agrupar de más o
  de menos. El campo `variantCount` te dice cuántos archivos hay detrás de
  cada entrada.
- Un pequeño porcentaje de formatos binarios minoritarios (algunas
  variantes WA8/WA9/WB7full) no se pueden verificar con total garantía —
  esos casos se marcan como "sin verificar" en vez de arriesgarse a mentir.
- Generación 1 y 2 no tienen "shiny" en el sentido moderno (Gen 1 no existía
  el concepto; Gen 2 usa un sistema de IVs distinto) — no se intenta
  verificar ahí.
- No hay modo inline de Telegram (`@tubot mew` dentro de otro chat); se
  podría añadir más adelante.
- Los datos de EventsGallery los mantiene la comunidad de Project Pokémon;
  este bot los usa (igual que hace PKHeX) para consulta y descarga directa
  desde su repositorio público — no se redistribuye ninguna copia propia.
