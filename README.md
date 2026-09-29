# Backend — Seguimiento de placares

API que sincroniza información de piezas de placares desde **TeoWin** (el ERP de la fábrica, base SQL Server) hacia una base propia (PostgreSQL), y expone los endpoints que usa el [frontend](../frontend/README.md) para mostrar órdenes/pedidos/módulos/piezas y registrar el escaneo de piezas cortadas.

> Si nunca tocaste este proyecto, empezá por **"Cómo levantarlo"** más abajo. El resto del documento es referencia.

---

## Índice

1. [Qué hace esta app, en una imagen](#qué-hace-esta-app-en-una-imagen)
2. [Stack tecnológico](#stack-tecnológico)
3. [Estructura de carpetas](#estructura-de-carpetas)
4. [Variables de entorno](#variables-de-entorno)
5. [Cómo levantarlo](#cómo-levantarlo)
6. [Modelo de datos](#modelo-de-datos)
7. [Reglas de negocio importantes](#reglas-de-negocio-importantes)
8. [Documentación de la API](#documentación-de-la-api)
9. [TeoWin: restricción de solo lectura](#teowin-restricción-de-solo-lectura)
10. [Problemas comunes](#problemas-comunes)

---

## Qué hace esta app, en una imagen

```
┌─────────────┐   solo lectura    ┌──────────────┐   escribe    ┌────────────┐
│   TeoWin     │ ───────────────► │  Este backend │ ───────────► │  PostgreSQL │
│ (SQL Server, │   (nunca se le   │  (Node/Express│   (única     │  ("Neostone"│
│  ERP fábrica)│   escribe nada)  │   /TypeScript)│   base propia│   en dev)   │
└─────────────┘                  └──────┬───────┘   que este    └────────────┘
                                         │           backend puede
                                         │ HTTP/JSON  modificar)
                                         ▼
                                  ┌──────────────┐
                                  │   Frontend    │
                                  │  (Next.js)    │
                                  └──────────────┘
```

- **TeoWin** ya tiene, para cada pedido, el listado de piezas de placar que hay que cortar (el "despiece"). Este backend **lee** esa información cuando alguien aprieta "Agregar orden" en el frontend, y la copia a la base propia.
- A partir de ahí, la app ya no vuelve a consultar TeoWin para esa orden — todo el seguimiento (qué se cortó, qué falta) vive en la base propia.
- El operario de la máquina Rover escanea un código de barras por pieza (Vista 5 del frontend); este backend recibe ese código, busca la pieza en la base propia y la marca como cortada.

Ver [`diseño.md`](../../diseño.md) en la raíz del proyecto para el diseño completo y el razonamiento detrás de cada decisión — este README es el resumen operativo.

---

## Stack tecnológico

| Pieza | Qué es | Por qué se eligió |
|---|---|---|
| **Node.js + Express** | Servidor HTTP / framework web | Simple, liviano, todo el equipo lo conoce |
| **TypeScript** | JavaScript con tipos | Evita errores tontos (nombres de campo mal escritos, etc.) |
| **Prisma** | ORM + herramienta de migraciones | Un solo lugar (`schema.prisma`) define la base, genera migraciones SQL versionadas y un cliente con autocompletado |
| **PostgreSQL** | Base de datos propia | Donde vive todo el estado que esta app controla |
| **mssql / tedious** | Driver para conectarse a SQL Server | Es como este backend lee TeoWin (solo lectura) |
| **Zod** | Validación de datos | Valida el `body` de cada request antes de procesarlo |

---

## Estructura de carpetas

```
app/backend/
├── prisma/
│   ├── schema.prisma          # Definición de la base propia (única fuente de verdad del modelo de datos)
│   ├── migrations/            # Historial de cambios a la base, versionado
│   └── teowin-readonly-login.sql  # Script para crear el login de solo-lectura en TeoWin (ver más abajo)
├── src/
│   ├── server.ts               # Punto de entrada: arranca el servidor HTTP
│   ├── app.ts                  # Arma la app de Express: middlewares + rutas
│   ├── config/
│   │   ├── env.ts              # Lee y valida las variables de entorno (.env)
│   │   ├── prisma.ts           # Cliente de Prisma (conexión a la base propia)
│   │   └── teowin.ts           # Conexión a TeoWin + el guard de "solo SELECT"
│   ├── middlewares/
│   │   ├── validateBody.ts     # Valida el body de un request contra un schema de Zod
│   │   └── errorController.ts  # Traduce cualquier error a una respuesta HTTP consistente
│   ├── utils/                  # AppError, catchAsync, sendResponse, parseIdParam
│   └── modules/                # Un módulo por concepto de negocio
│       ├── ordenes/            # Listar, sincronizar y consultar órdenes de fabricación
│       ├── pedidos/            # Consultar pedidos, marcar "finalizado"
│       ├── modulos/            # Consultar módulos (muebles), marcar "finalizado"
│       ├── piezas/             # Escanear, confirmar manualmente, listar piezas
│       └── sync/                # Las queries de solo-lectura contra TeoWin
└── .env / .env.example
```

Cada módulo de negocio (`ordenes`, `pedidos`, `modulos`, `piezas`) sigue siempre la misma forma interna:

```
<modulo>/
├── <modulo>.router.ts     # Define las URLs (rutas) de ese módulo
├── controllers/           # Reciben el request HTTP, llaman al service, arman la respuesta
├── services/               # La lógica de negocio real (acceso a la base, reglas)
├── schemas/                 # Validación de datos de entrada (Zod)
├── dtos/                     # La forma exacta de los datos que salen hacia el cliente
└── mappers/                  # Convierten un registro de la base a un DTO
```

Esto significa: un controller **nunca** habla directo con la base de datos, y el modelo de la base **nunca** sale tal cual hacia el cliente — siempre pasa por un DTO. Sirve para poder cambiar la base sin romper el contrato con el frontend.

---

## Variables de entorno

Copiá `.env.example` a `.env` y completá los valores. Nunca se sube `.env` al repositorio (contiene contraseñas).

| Variable | Para qué sirve | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Conexión a la base propia (PostgreSQL) | `postgresql://postgres:2002@localhost:5432/Neostone?schema=public` |
| `PORT` | Puerto donde escucha este backend | `4000` |
| `TEOWIN_DB_SERVER` | Servidor de SQL Server donde vive TeoWin | `SRVTEOWIN` |
| `TEOWIN_DB_INSTANCE` | *(opcional)* Nombre de instancia, si es una instancia con nombre (ej. `SRVTEOWIN\TEOWIN`) | `TEOWIN` |
| `TEOWIN_DB_PORT` | Puerto TCP, solo se usa si **no** hay `TEOWIN_DB_INSTANCE` | `1433` |
| `TEOWIN_DB_NAME` | Nombre de la base dentro de esa instancia | `TeoWin` |
| `TEOWIN_DB_USER` | Usuario de SQL Server | — |
| `TEOWIN_DB_PASSWORD` | Contraseña de ese usuario | — |
| `TEOWIN_DB_ENCRYPT` | Si la conexión requiere cifrado (mirar la config de conexión en SSMS) | `true` |
| `TEOWIN_DB_TRUST_SERVER_CERTIFICATE` | Aceptar el certificado del servidor sin validarlo contra una CA pública | `true` |

**Importante sobre el usuario de TeoWin**: tiene que tener permisos acotados a `SELECT` únicamente (nunca `db_datawriter`, nunca `sa`). Ver [TeoWin: restricción de solo lectura](#teowin-restricción-de-solo-lectura) más abajo — hay un script listo para crear ese usuario.

Si `TEOWIN_DB_SERVER`/`USER`/`PASSWORD`/`NAME` faltan, el servidor **igual arranca** (para poder trabajar en las vistas de la app sin depender de TeoWin), pero cualquier intento de sincronizar una orden devuelve un error explícito en vez de romper el servidor entero.

---

## Cómo levantarlo

Necesitás: Node.js instalado, PostgreSQL corriendo (en desarrollo, el que ya tenés en esta PC), y acceso de red a TeoWin.

```powershell
cd app\backend
npm install                 # solo la primera vez, o cuando cambien las dependencias
npx prisma migrate deploy   # aplica el esquema de base a tu Postgres (solo la primera vez, o si hay migraciones nuevas)
npm run dev                 # levanta el servidor en modo desarrollo (reinicia solo al guardar un archivo)
```

Vas a ver `Backend escuchando en puerto 4000`. Dejá esa terminal abierta mientras uses la app.

Otros comandos útiles:

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila TypeScript a JavaScript (para producción) |
| `npm start` | Corre la versión ya compilada (`npm run build` primero) |
| `npx prisma studio` | Abre una interfaz web para mirar/editar los datos de la base propia a mano |
| `npx prisma migrate dev --name algo` | Crea y aplica una migración nueva después de cambiar `schema.prisma` |

---

## Modelo de datos

Cinco tablas, todas en la base propia. Reflejan la jerarquía real: una **orden de fabricación** agrupa varios **pedidos**, cada pedido tiene varios **módulos** (muebles), cada módulo tiene varios **tipos de pieza**, y cada tipo de pieza puede representar varias **piezas físicas** (cuando hay que cortar más de una unidad igual).

```
Orden ──┬── Pedido ──┬── Modulo ──┬── DespieceTipo ──┬── PiezaFisica
        │            │            │                  │
   (orden de     (pedido/     (mueble/      (un tipo de      (una unidad física
    fabricación   presupuesto  escena del     pieza a cortar,   de esa pieza —
    de TeoWin)     de TeoWin)   pedido)        ej. "3 estantes   la que se escanea
                                               iguales")          y tiene idUnico)
```

### Por qué existe `DespieceTipo` separado de `PiezaFisica`

Si el despiece dice "3 estantes iguales", eso es **un** `DespieceTipo` (familia/artículo/medidas en común) pero **tres** `PiezaFisica` (tres unidades físicas independientes, cada una con su propio código de barras y su propio estado de corte). Cortar una no corta las otras dos.

### Las tablas

| Tabla | Campos propios (además de `id`, `estado`, `creado_en`, `eliminado_en`) | Se llena cuando... |
|---|---|---|
| `orden` | `codigoOrdenFabricacion`, `numeroOrdenCustom`, `descripcion` | Se aprieta "Agregar orden" |
| `pedido` | `orden_id`, `codigo_pedido`, `referencia`, `nombreComercial` | Junto con la orden |
| `modulo` | `pedido_id`, `idEscena`, `descripcion` | Junto con la orden |
| `despiece_tipo` | `modulo_id`, `familia`, `articulo`, `color`, `descripcion`, `medida1`, `medida2`, `medida3`, `idCatalogo`, `unidades` | Junto con la orden |
| `pieza_fisica` | `despiece_tipo_id`, `idUnico`, `escaneado_en` | Junto con la orden |

Todos los campos que vienen directo de TeoWin (`idEscena`, `idCatalogo`, `familia`, `articulo`, `color`, `medida1/2/3`, `codigoOrdenFabricacion`, `idUnico`, etc.) mantienen el mismo nombre que tienen allá, para que sea fácil rastrear de dónde sale cada dato. Los campos que son solo nuestros usan `snake_case` (`creado_en`, `codigo_pedido`, etc.).

### Estados (el campo `estado` de cada tabla)

| Tabla | Valores posibles |
|---|---|
| `orden` | `PENDIENTE` → `EN_PROCESO` → `LISTA`, o `ELIMINADO` |
| `pedido` / `modulo` / `despiece_tipo` | `PENDIENTE` → `EN_PRODUCCION` → `FINALIZADO`, o `ELIMINADO` |
| `pieza_fisica` | `PENDIENTE` → `CORTADA`, o `ELIMINADA` |

`ELIMINADO`/`ELIMINADA` no es un borrado físico — es un estado más, que se usa cuando una orden se descarta (para no perder el historial de lo que ya se había cortado).

### Por qué cada fila tiene su propio `id` en vez de usar el código de TeoWin

Los números de TeoWin (`codigoOrdenFabricacion`, `idEscena`, `idUnico`) son **datos de negocio, no identidad**: TeoWin los puede reciclar (una orden vieja descartada y un número nuevo que coincide). Por eso cada tabla tiene su propio `id`, y las relaciones entre tablas siempre usan ese `id`, nunca el código de TeoWin directamente.

**El `id` es un UUID** (ej. `d6f1a8ff-b734-42b3-a86f-5c4879af4508`), generado por Postgres (`gen_random_uuid()`), no un número autoincremental. Esto significa que las URLs de la app (`/ordenes/:id`, `/pedidos/:id`, etc.) y los parámetros de la API son UUID, no enteros — `parseIdParam` (`src/utils/parseIdParam.ts`) valida ese formato y devuelve `400` si no lo es.

### Los dos índices "no puede haber dos activos con el mismo número"

```sql
-- Nunca dos órdenes ACTIVAS con el mismo codigoOrdenFabricacion
CREATE UNIQUE INDEX ux_orden_codigoordenfabricacion_vigente
    ON orden (codigoOrdenFabricacion) WHERE estado <> 'ELIMINADO';

-- Nunca dos piezas ACTIVAS con el mismo idUnico (código de barras)
CREATE UNIQUE INDEX ux_piezafisica_idunico_vigente
    ON pieza_fisica (idUnico) WHERE idUnico IS NOT NULL AND estado <> 'ELIMINADA';
```

Esto es lo que hace que **"Agregar orden" con un número ya cargado y activo falle con un error claro**, en vez de crear un duplicado silencioso. No están escritos en `schema.prisma` (Prisma no soporta este tipo de índice "parcial") — están agregados a mano en la migración SQL, ver `prisma/migrations/20260928152911_init/migration.sql`.

---

## Reglas de negocio importantes

### 1. Sincronizar una orden es una copia completa, una sola vez

Al apretar "Agregar orden" con un número de orden de fabricación:
1. Se busca esa orden en TeoWin (cabecera + todos sus pedidos con piezas de placar — se detecta por `idCatalogo = 4` en `tdespieceLineaPresupuesto`, que es el catálogo "Placares" del Maestro de Productos. **No** se filtra por familia de artículo: familias como `PZA` existen también en otros catálogos, ej. Cocinas, con artículos totalmente distintos).
2. Si no existe en TeoWin → error 404.
3. Si no tiene ninguna pieza de placar → error 422.
4. Si ya hay una orden **activa** con ese mismo número en la base propia → error 409 (hay que descartarla primero — esa función de "Descartar" todavía no está implementada en el frontend).
5. Si nada de eso pasa, se crea todo (orden → pedidos → módulos → tipos de pieza → piezas físicas) en una sola operación de base de datos (si algo falla a mitad de camino, no queda nada a medias).

Después de sincronizada, la orden vive **solo** en la base propia — no se vuelve a consultar TeoWin para verla ni actualizarla automáticamente.

### 2. Cascada de estados al escanear o confirmar una pieza

Cuando una pieza física pasa a `CORTADA` (sea por escaneo o por confirmación manual), automáticamente:

```
PiezaFisica → CORTADA
     ↓ (si estaban en PENDIENTE, suben a EN_PRODUCCION)
DespieceTipo → EN_PRODUCCION
     ↓
Modulo → EN_PRODUCCION
     ↓
Pedido → EN_PRODUCCION
     ↓
Orden → EN_PROCESO
```

Esta cascada **nunca** pone nada en `FINALIZADO` ni `LISTA` — eso es exclusivamente manual (ver el punto siguiente). Alcanza con escanear **una sola pieza** de un módulo para que todo lo de arriba pase de "pendiente" a "en producción/proceso".

### 3. "Marcar finalizado" es siempre una acción manual

No hay forma automática de saber "ya se cortó todo lo de este módulo/pedido", porque algunas piezas (fondos, tapajuntas) nunca pasan por el escaneo de Rover. Por eso:

- **Pedido** y **Módulo** tienen su propio botón de "finalizar" (`PATCH /pedidos/:id/finalizar`, `PATCH /modulos/:id/finalizar`), que un usuario de logística confirma a mano.
- **Pieza** no tiene un estado "finalizado" propio (su `estado` solo tiene `PENDIENTE`/`CORTADA`/`ELIMINADA`) — el botón "Marcar finalizado" de una pieza usa el mismo camino que el escaneo: la marca `CORTADA` directamente. Sirve para las piezas que nunca se escanean.
- **Orden** no tiene botón propio: pasa a `LISTA` automáticamente, pero recién cuando el **100%** de sus pedidos (no eliminados) están `FINALIZADO`. Eso sí es inequívoco, por eso es la única regla automática de cierre.

---

## Documentación de la API

Todas las respuestas tienen esta forma:

```json
{ "status": "success" | "fail" | "error", "message": "opcional", "data": /* lo que sea, o null */ }
```

- `success`: todo bien.
- `fail`: error del que pidió (datos inválidos, no encontrado, duplicado). Código HTTP 4xx.
- `error`: error nuestro/del servidor. Código HTTP 5xx.

Base URL en desarrollo: `http://localhost:4000/api`

### Salud del servidor

`GET /health` → `{ "ok": true }`. Para chequear que el backend está vivo.

### Órdenes

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /ordenes` | Lista las órdenes activas (no `ELIMINADO`), más recientes primero | `data`: array de `{ id, codigoOrdenFabricacion, numeroOrdenCustom, descripcion, estado, creado_en, pedidosCount }` |
| `POST /ordenes` | Sincroniza una orden nueva desde TeoWin | body: `{ "codigoOrdenFabricacion": 263500002 }` → `data`: la orden creada. Errores: `404` (no existe en TeoWin), `422` (sin piezas de placar), `409` (ya activa) |
| `GET /ordenes/:id` | Detalle de una orden | `data`: mismo shape que en la lista |
| `GET /ordenes/:id/pedidos` | Pedidos de esa orden | `data`: array de `{ id, codigo_pedido, referencia, nombreComercial, estado, modulosCount }` |

### Pedidos

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /pedidos/:id` | Detalle de un pedido | `data`: los campos del pedido + `orden: { id, numeroOrdenCustom, descripcion }` |
| `GET /pedidos/:id/modulos` | Módulos de ese pedido | `data`: array de `{ id, idEscena, descripcion, estado, despieceTiposCount }` |
| `PATCH /pedidos/:id/finalizar` | Marca el pedido como `FINALIZADO` (y revisa si hay que pasar la orden a `LISTA`) | `data`: el pedido actualizado |

### Módulos

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /modulos/:id` | Detalle de un módulo | `data`: los campos del módulo + `pedido: { id, codigo_pedido, nombreComercial }` + `orden: { id, numeroOrdenCustom }` |
| `GET /modulos/:id/piezas` | Piezas físicas de ese módulo | `data`: array de `{ id, idUnico, familia, articulo, color, descripcion, medida1, medida2, estado, escaneado_en }` |
| `PATCH /modulos/:id/finalizar` | Marca el módulo como `FINALIZADO` | `data`: el módulo actualizado |

### Piezas

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `POST /piezas/escanear` | El operario escaneó un código de barras — marca la pieza `CORTADA` y dispara la cascada | body: `{ "idUnico": "2195136" }` (string de **exactamente 7 dígitos**) → `data`: resumen (ver abajo). Errores: `400` (formato inválido), `404` (código no existe), `410` (la pieza pertenece a una orden descartada) |
| `PATCH /piezas/:id/confirmar` | Confirmación manual (Vista 4) — mismo efecto que escanear, pero por `id` propio en vez de código de barras | `data`: mismo resumen que el escaneo |

El **resumen** que devuelven `escanear` y `confirmar` (para mostrar en pantalla qué se acaba de marcar):

```json
{
  "pieza":  { "id": "05eeafec-874b-411e-9291-efc1bfab393b", "idUnico": 2200984, "familia": "PZA", "articulo": "F", "color": "FGG", "descripcion": "...", "medida1": "2310", "medida2": "1083" },
  "modulo": { "id": "15473367-afba-4c76-a547-9f107b58036e", "idEscena": 12, "descripcion": "VESTIDOR NEO 2200 PROF. 345 - 2 MÓDULOS" },
  "pedido": { "id": "596f87b8-cb0b-4022-8562-4a593419460b", "codigo_pedido": "26-02473", "referencia": "Ed.Torre Zeus-7A Vestidor" },
  "orden":  { "id": "d6f1a8ff-b734-42b3-a86f-5c4879af4508", "numeroOrdenCustom": "263502" }
}
```

Nota: `id` es siempre UUID (identidad interna de esta base); `idUnico` sigue siendo el número que trae la etiqueta de TeoWin (dato de negocio, no cambia con esta migración).

---

## TeoWin: restricción de solo lectura

Esta app **nunca** debe poder escribir en TeoWin — es la base del ERP real de la fábrica. Hay dos capas de protección:

1. **A nivel de código** (`src/config/teowin.ts`): antes de mandar cualquier query a TeoWin, se revisa que sea un único `SELECT` — si contiene `INSERT`, `UPDATE`, `DELETE`, `DROP`, etc., se rechaza antes de tocar el driver. Esto es una red de seguridad, no la protección real.
2. **A nivel de infraestructura** (la que realmente importa): el usuario de SQL Server con el que se conecta este backend (`TEOWIN_DB_USER`/`TEOWIN_DB_PASSWORD`) tiene que tener permisos acotados a `SELECT` únicamente, otorgados por un administrador de esa instancia — nunca el usuario `sa` ni un usuario con `db_datawriter`. Así, aunque hubiera un bug en el código, es **físicamente imposible** escribir en TeoWin.

El script [`prisma/teowin-readonly-login.sql`](prisma/teowin-readonly-login.sql) crea ese usuario de solo lectura — hay que correrlo una vez, como administrador, contra el servidor que aloja TeoWin.

---

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `EADDRINUSE: address already in use :::4000` al arrancar | Ya hay otro backend corriendo en el puerto 4000 | Fijate qué proceso lo está usando (`netstat -ano \| findstr :4000` en PowerShell) y cerralo, o cambiá `PORT` en `.env` |
| `Faltan credenciales de TeoWin en el .env` al sincronizar una orden | No completaste `TEOWIN_DB_*` en `.env` | Completá esas variables (ver [Variables de entorno](#variables-de-entorno)) |
| `Failed to connect to <servidor>:1433` | El servidor es una **instancia con nombre** (ej. `SRVTEOWIN\TEOWIN`) y falta `TEOWIN_DB_INSTANCE` | Completá `TEOWIN_DB_INSTANCE` con el nombre de instancia (lo ves en la config de conexión de SSMS) |
| El servidor arranca pero se cae solo (crash) al sincronizar una orden | Dependencias de `node_modules` corruptas (pasa si se instala/desinstala un paquete a mano) | `rm -rf node_modules` (o borrarla en el explorador) y `npm ci` para reinstalar todo limpio desde `package-lock.json` |
| `409 Conflict` ("ya existe un registro activo") al sincronizar una orden que **sí** aparece en el listado de la app | Ya existe una fila activa con ese `codigoOrdenFabricacion` en la base propia | Es el comportamiento esperado — para recargarla hay que descartarla primero (función pendiente en el frontend) |
| `409 Conflict` al sincronizar una orden que **no** aparece en ningún lado de la app (nunca se sincronizó) | `tArticuloDescripciones` puede tener más de una fila para el mismo familia/articulo/idioma con distinto `idCatalogo` — sin filtrar por `idCatalogo` en el join de descripción (`src/modules/sync/teowin-orden.queries.ts`), se duplican filas y dos piezas con el mismo `idUnico` terminan en el mismo `INSERT`, lo que dispara el índice único de la sección 8.3 con un mensaje engañoso ("ya existe") aunque la orden nunca se llegó a crear | Ya corregido (el join ahora exige `ad.idCatalogo = d.idCatalogo`/`= padre.idCatalogo`) — si vuelve a aparecer con otra orden, correr la query de `fetchOrdenDespiece` a mano y comparar el conteo de filas con/sin ese join |
