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
desplegado conectando el Worker a GitHub (nada de CLI ni entorno local), y
todo administrable desde el navegador o el móvil.

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
  si el resultado parece sospechosamente bajo, pero conviene revisar a ojo
  unos cuantos eventos después de la primera ejecución real.

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

### 3. Crea el Worker en Cloudflare, conectado a tu repo

Cloudflare dashboard → **Workers & Pages → Create → Import a repository** →
elige tu repo. Detecta `wrangler.toml` y hace `npm install` + `wrangler
deploy` solo en cada push.

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

Si no haces nada, el Worker se sincroniza solo (su propio cron semanal). Si
quieres que se entere al instante de cada actualización del Action:

- Repo → **Settings → Secrets and variables → Actions**:
  - Variable `CLOUDFLARE_REFRESH_URL` = `https://<TU-WORKER>.workers.dev/refresh`
  - Secret `REFRESH_SECRET` = el mismo valor que en el Worker.

### 9. Habla con tu bot

`/ayuda`, luego prueba `mew`, `/activas`, `/eventosactivos`, `/alertas on`,
y coge el id que aparece en el histórico para probar `/wondercard <id>`.

## Comandos

- Escribir el nombre de un Pokémon (o `/pokemon <nombre>`, en español o
  inglés) → si tiene una distribución o evento activo ahora mismo, te lo
  muestra; si no, te ofrece un botón **"Ver distribuciones anteriores"**
  que despliega el histórico completo agrupado por consola (de la más
  reciente a la más antigua), con el estado de HOME resumido una vez por
  grupo en vez de repetido en cada línea.
- `/wondercard <id>` → te manda el archivo real de esa distribución como
  documento de Telegram (para abrir con PKHeX u otras herramientas). El
  archivo se pide al momento a GitHub, no se guarda copia en el bot.
- `/home` → recordatorio general: cuándo cierra Pokémon Bank y qué juegos
  dependen de él.
- `/activas` / `/proximas` → distribuciones Mystery Gift del juego actual,
  abiertas ahora mismo o anunciadas sin empezar.
- `/eventosactivos` / `/eventosproximos` → lo mismo pero para eventos
  in-game (raids, etc.).
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

- **`fetch-events.mjs` es heurístico**, a diferencia del resto del proyecto
  (que lee binarios exactos o tablas HTML estructuradas). Analiza texto
  libre de Serebii buscando patrones de fecha y negrita; puede perderse
  algún evento suelto o interpretar mal una fecha rara. Revísalo a ojo tras
  la primera ejecución real, y si algo falla claramente, dilo — es la parte
  menos probada del proyecto.
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
