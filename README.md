# Pokémon Distribuciones Bot

Bot de Telegram público sobre **distribuciones (Mystery Gift) y eventos
in-game** de todos los juegos principales de Pokémon (no Pokémon GO).
Escribe el nombre de un Pokémon y te dice si tiene algo **activo ahora
mismo**; si no, te deja ver el **histórico completo agrupado por consola**
con un botón. Te deja **descargarte la wondercard real** de cualquier
distribución, sabe qué hay **activo** o **anunciado**, te avisa de **qué se
queda atrapado si no lo mueves a Pokémon HOME** antes de que cierre Pokémon
Bank, cruza esto con tu Living Dex de Poketracker, y **te escribe solo**
en cuanto detecta una distribución o evento nuevo — con botones para
posponer el aviso, marcarlo como hecho o silenciarlo, todo por usuario.

Sigue el mismo patrón que tus otros bots: **Cloudflare Workers + KV**,
desplegado con **GitHub Actions** (`.github/workflows/deploy.yml` hace
`wrangler deploy` solo en cuanto haces commit de `src/**`, `wrangler.toml` o
`package.json` en `main`), y todo administrable desde el navegador o el
móvil — nada de CLI ni entorno local. Se dejó de usar la integración nativa
"Connect to Git" de Cloudflare porque se desconectaba sola repetidamente.

## De dónde salen los datos

- **Historial completo de Mystery Gift + shiny verificado**:
  [`projectpokemon/EventsGallery`](https://github.com/projectpokemon/EventsGallery),
  el archivo comunitario que usa la propia herramienta PKHeX para comprobar
  la legalidad de Pokémon de evento. Son los **archivos reales**
  (wondercards) tal como los distribuyó Nintendo/Game Freak. El scraper
  (`scripts/fetch-eventsgallery.mjs`) **lee el binario de cada archivo**
  para saber si es shiny — no se fía del nombre del archivo salvo como
  último recurso. La lógica de lectura (`scripts/wc-parsers.mjs`) está
  sacada del código fuente de PKHeX y se ha validado contra más de 8.000
  archivos reales.
  - El shiny puede ser de tres tipos, y el bot los distingue: **siempre**
    (garantizado), **nunca** (bloqueado) y **depende** (aleatorio, como
    capturar uno normal).
- **Mystery Gift activa/anunciada ahora mismo**: dos páginas de Bulbapedia
  que se mantienen casi al día con las distribuciones del juego actual
  (Escarlata/Púrpura, Legends Z-A), con fechas concretas.
- **Eventos in-game** (Max Raid Battles de Espada/Escudo, Tera Raid Battles
  de Escarlata/Púrpura — no son código, son bichos especiales que aparecen
  durante unos días): Serebii.net, que mantiene el histórico completo con
  fechas por juego. A diferencia del lector binario de wondercards (que es
  determinista, byte a byte), este scraper analiza texto libre y es
  **heurístico** — puede perderse algún evento si Serebii cambia de
  maquetación. Tiene una red de seguridad que evita sobrescribir los datos
  si el resultado parece sospechosamente bajo. Validado contra el HTML real
  de las dos páginas de origen (no solo con HTML de muestra), incluyendo
  casos raros como fechas sin año de fin (se tratan como evento de un solo
  día, nunca como "activo para siempre") y una errata real de Serebii
  ("Janaury" en vez de "January").
  - Los títulos oficiales conocidos se traducen al español al generar los
    datos (`titleEs`): los Tera Raid "Mighty X" → **"X el Imbatible"**, y
    "Shiny X" → **"X variocolor"** (términos oficiales de los juegos
    localizados). El resto de títulos (descripciones propias de Serebii sin
    nombre oficial en español, tipo "Finale" o "Raid Worthy Pokémon") se
    quedan en inglés antes que inventarse una traducción.

## Cómo funciona

```
EventsGallery       Bulbapedia            Serebii.net
(historial MG)       (MG activa/anun.)     (eventos in-game)
      │                    │                     │
      ▼                    ▼                     ▼
        GitHub Actions (semanal) ──commit──► data/*.json
                       │  ping opcional
                       ▼
  Cloudflare Worker ── cron semanal (y al recibir el ping) ──►
        lee los 3 JSON, los guarda en KV, compara con la última
        foto vista y avisa a quien tenga /alertas on de lo nuevo
                       │
                       ▼
  Telegram (webhook) ◄── usuarios escribiendo "mew", /activas,
                          /eventosactivos, /wondercard, botones...
```

- **`scripts/fetch-eventsgallery.mjs`** + **`scripts/wc-parsers.mjs`**:
  historial completo de Mystery Gift, shiny verificado desde el binario →
  `data/eventsgallery.json`.
- **`scripts/fetch-distributions.mjs`**: fechas concretas de Mystery Gift
  activa/anunciada del juego actual → `data/distributions.json`.
- **`scripts/fetch-events.mjs`**: eventos in-game (raids, etc.) de todos
  los juegos con este tipo de evento, excepto Pokémon GO → `data/events.json`.
- **`src/lib.js`**: todo el formateo y la lógica pura (agrupar por consola,
  calcular estado activa/anunciada/finalizada, estado de HOME/Bank...).
- **`src/state.js`**: preferencias y estado por usuario (avisos on/off,
  qué ha silenciado/canjeado/pospuesto cada persona).
- **`src/worker.js`**: el bot (Cloudflare Worker). Webhook de Telegram,
  botones inline, cachea los 3 datasets en KV, y el motor de avisos
  proactivos.

## Despliegue (todo desde el navegador, sin terminal)

### 1. Sube este proyecto a un repo de GitHub

Crea un repositorio nuevo en GitHub y sube todos estos archivos y carpetas
tal cual ("Add file → Upload files" en la web de GitHub).

### 2. Crea el bot en Telegram

Habla con **@BotFather** → `/newbot` → guarda el **token** que te da.

### 3. Crea el Worker en Cloudflare y despliega por GitHub Actions

Crea el Worker vacío desde el dashboard de Cloudflare (**Workers & Pages →
Create → Deploy manually / Start from Hello World**, con el nombre
`pokemon-distro-bot` para que coincida con `wrangler.toml`), y luego deja
que sea `.github/workflows/deploy.yml` quien lo suba en cada commit — no
uses "Connect to Git" de Cloudflare, se ha desconectado solo varias veces.

En **Repo → Settings → Secrets and variables → Actions** añade:

| Nombre | Tipo | Valor |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | token creado en Cloudflare con la plantilla "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | tu Account ID (lo ves en el dashboard de Cloudflare, barra lateral) |

Con eso, cada vez que toques `src/`, `wrangler.toml` o `package.json` y
hagas commit a `main`, el Action despliega solo. También puedes lanzarlo a
mano desde **Actions → "Desplegar el Worker" → Run workflow**.

### 4. Crea el namespace de KV y enlázalo

Cloudflare dashboard → **Workers & Pages → KV → Create namespace**. Copia
su ID a `wrangler.toml` (`id = "..."`) y haz commit del cambio vía la web
de GitHub, o enlázalo directamente desde la pestaña **Bindings** del
Worker (tipo KV Namespace, nombre de variable `DISTRO_KV`).

### 5. Configura variables y secretos en Cloudflare

Worker → **Settings → Variables and Secrets**:

| Nombre | Tipo | Valor |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | el token de @BotFather |
| `WEBHOOK_SECRET` | Secret | una cadena aleatoria que te inventes |
| `REFRESH_SECRET` | Secret | otra cadena aleatoria distinta |

Y edita `wrangler.toml` (commit vía web de GitHub) para poner las URLs
"raw" reales de tu repo y tu propio `chat_id` de Telegram (te lo da
**@userinfobot** si le escribes):

- `GITHUB_DATA_URL` → `https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/distributions.json`
- `GITHUB_GALLERY_URL` → `https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/eventsgallery.json`
- `GITHUB_EVENTS_URL` → `https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/events.json`
- `OWNER_CHAT_ID` → tu chat_id (solo tú puedes usar `/faltan`; el resto del
  bot es público para cualquiera)

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

`data/distributions.json` y `data/events.json` empiezan vacíos: ve a
**Actions** en tu repo → workflow **"Actualizar distribuciones"** → **Run
workflow**, para que se rellenen con datos reales de Bulbapedia y Serebii.

Esta primera ejecución real, al llegarle al Worker, también siembra la
"foto" de qué distribuciones/eventos existen ahora mismo — no manda ningún
aviso proactivo por ese primer lote (si no, todo el mundo con `/alertas on`
recibiría de golpe un aviso por cada distribución activa que ya existiera).
Los avisos empiezan a partir de la siguiente actualización real que traiga
algo genuinamente nuevo.

### 8. (Opcional) refresco instantáneo

Si no haces nada, el Worker se sincroniza solo (su propio cron semanal).
Dos formas de que se entere al instante en vez de esperar:

- **Lo más simple, desde el móvil**: mándale `/refresh` al bot por
  Telegram (solo funciona si eres `OWNER_CHAT_ID`) justo después de que
  termine el workflow "Actualizar distribuciones".
- **Automático**, para que el propio Action lo dispare sin que tengas que
  acordarte: Repo → **Settings → Secrets and variables → Actions**:
  - Variable `CLOUDFLARE_REFRESH_URL` = `https://<TU-WORKER>.workers.dev/refresh`
  - Secret `REFRESH_SECRET` = el mismo valor que en el Worker.

### 9. Habla con tu bot

`/ayuda`, luego prueba `mew`, `/activas`, `/eventosactivos`, `/alertas on`,
y coge el id que aparece en el histórico para probar `/wondercard <id>`.

## Comandos

- Escribir el nombre de un Pokémon (o `/pokemon <nombre>`, en español o
  inglés) → si tiene una distribución o evento activo ahora mismo, te lo
  muestra; si no, te ofrece un botón **"📜 Ver distribuciones anteriores"**
  (con un **"✖️ Cancelar"** justo debajo, por si no quieres desplegarlo) que
  abre el histórico completo agrupado por consola (de la más reciente a la
  más antigua), con el estado de HOME resumido una vez por grupo en vez de
  repetido en cada línea.
- `/wondercard <id>` → te manda el archivo real de esa distribución como
  documento de Telegram (para abrir con PKHeX u otras herramientas). El
  archivo se pide al momento a GitHub, no se guarda copia en el bot.
- `/home` → recordatorio general: cuándo cierra Pokémon Bank y qué juegos
  dependen de él.
- `/activas` / `/proximas` → distribuciones Mystery Gift del juego actual,
  abiertas ahora mismo o anunciadas sin empezar.
- `/eventosactivos` / `/eventosproximos` → lo mismo pero para eventos
  in-game (raids, etc.), **agrupados por juego** (🎮 Escarlata/Púrpura,
  🎮 Espada/Escudo...) de la generación más reciente a la más antigua, en
  vez de una lista única mezclada.
- `/refresh` (solo para `OWNER_CHAT_ID`) → recarga los 3 datasets desde
  GitHub al instante, sin esperar al cron semanal. Útil justo después de
  relanzar el workflow "Actualizar distribuciones" para no tener que
  esperar a que el bot se sincronice solo.
- `/alertas on` / `/alertas off` → activa o desactiva, **para ti**, que el
  bot te escriba solo en cuanto detecte una distribución o evento nuevo.
  Cada aviso trae tres botones:
  - **✅ Ya la tengo / canjeada** (o **Completado** en eventos) — la marca
    como hecha, no vuelves a verla.
  - **⏰ Posponer** — abre un selector de 1 a 7 días; pasado ese plazo,
    vuelves a poder recibir el aviso.
  - **🔕 No me interesa** — la silencia para siempre, para ti.
  Es un estado por persona (`chat_id`), no global: lo que tú silencies o
  pospongas no afecta a nadie más.
- `/faltan` (solo para `OWNER_CHAT_ID`) → cruza el catálogo con tu Living
  Dex de Poketracker: qué especies tienes pendientes de mover a HOME antes
  de que cierre Bank, y qué shiny garantizados te faltan en la Living Dex
  Shiny.
- `/ayuda` → recordatorio de todo esto (adaptado a si eres o no el dueño
  del bot).

### Sobre `/faltan` y Pokémon HOME

- El estado de HOME/Bank se calcula a partir de la generación de cada
  distribución y de la fecha de cierre de Pokémon Bank, confirmada por
  Nintendo/The Pokémon Company para el **26 de febrero de 2027**: si esa
  fecha cambiara, solo hay que actualizar `BANK_CLOSURE_UTC` en `src/lib.js`.
- `/faltan` lee `data/progreso.json` de
  [`afsenovilla/poketracker`](https://github.com/afsenovilla/poketracker)
  directamente — es un archivo público de solo lectura. Está restringido a
  `OWNER_CHAT_ID` porque es tu Poketracker personal, no uno por usuario; el
  resto del bot (búsqueda, activas, eventos, avisos) sí es multiusuario de
  verdad. Deja `POKETRACKER_REPO` en blanco (`""`) en `wrangler.toml` si
  prefieres desactivar `/faltan` del todo.

## Pruebas locales

```
npm install
npm test                              # valida toda la lógica: parsers, formateo, estado por usuario
node scripts/fetch-distributions.mjs  # requiere acceso a internet (Bulbapedia)
node scripts/fetch-eventsgallery.mjs  # requiere acceso a internet (clona ~200 MB de GitHub)
node scripts/fetch-events.mjs         # requiere acceso a internet (Serebii.net)
```

Si ya tienes el repo de EventsGallery clonado en algún sitio, puedes
apuntar el scraper ahí en vez de que lo vuelva a clonar:

```
EG_LOCAL_PATH=/ruta/a/tu/copia/de/EventsGallery node scripts/fetch-eventsgallery.mjs
```

## Límites conocidos / posibles mejoras futuras

- **`fetch-distributions.mjs` (Bulbapedia) falla con `HTTP 403` al
  ejecutarse desde GitHub Actions**, ya con reintentos y una User-Agent
  conforme a la política de Wikimedia — todo apunta a un bloqueo por rango
  de IP de los runners de GitHub, no a la User-Agent en sí. `data/events.json`
  (Serebii) no se ve afectado, así que la parte de "activo ahora mismo"
  (`/activas`, `/proximas`) puede quedarse desactualizada hasta que se
  resuelva esto; el histórico completo (`eventsgallery.json`) no depende de
  Bulbapedia. Pendiente de probar `Special:Export` como alternativa a
  `api.php`.
- **`fetch-events.mjs` es heurístico**, a diferencia del resto del proyecto
  (que lee binarios exactos o tablas HTML estructuradas). Analiza texto
  libre de Serebii buscando patrones de fecha y negrita; puede perderse
  algún evento suelto o interpretar mal una fecha rara. Validado contra el
  HTML real de las dos páginas de origen, pero si Serebii cambia de
  maquetación puede volver a romperse — si algo falla claramente, dilo.
- Los avisos proactivos solo cubren distribuciones/eventos **activos o
  anunciados** en el momento del refresco; algo que aparezca y desaparezca
  entre dos refrescos semanales (poco probable) no generaría aviso.
- Los botones de "posponer/canjeada/silenciar" son para las distribuciones
  y eventos que están activos/anunciados ahora mismo (los que salen en
  `/activas`, `/eventosactivos` o en un aviso proactivo); el histórico
  completo (`eventsgallery.json`) es solo consulta, no tiene estos botones
  — no tendría mucho sentido "posponer" algo de hace 15 años.
- La agrupación de variantes de un mismo evento en el historial (varios
  códigos/objetos sostenidos contados como una sola distribución) es una
  heurística por carpeta/nombre de archivo; el campo `variantCount` te dice
  cuántos archivos hay detrás de cada entrada.
- Un pequeño porcentaje de formatos binarios minoritarios de wondercard no
  se pueden verificar con total garantía — esos casos se marcan como "sin
  verificar" en vez de arriesgarse a mentir.
- Generación 1 y 2 no tienen "shiny" en el sentido moderno — no se intenta
  verificar ahí.
- No hay modo inline de Telegram (`@tubot mew` dentro de otro chat).
- Los datos de EventsGallery los mantiene la comunidad de Project Pokémon;
  este bot los usa (igual que hace PKHeX) para consulta y descarga directa
  desde su repositorio público — no se redistribuye ninguna copia propia.
