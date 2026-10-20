# Backend — Seguimiento de placares

API que sincroniza información de piezas de placares desde **TeoWin** (el ERP de la fábrica, base SQL Server) hacia una base propia (PostgreSQL), y expone los endpoints que usa el [frontend](../frontend/README.md) para mostrar órdenes/pedidos/módulos/piezas y registrar el escaneo de piezas cortadas. Además guarda la **documentación digital** de órdenes y pedidos (hojas de corte, nota de pedido, remisión, listados, planos) con las **anotaciones** que se le hacen encima. El acceso es por **PIN de usuario** y cada **rol** tiene permisos distintos ([regla 9](#9-usuarios-roles-y-permisos)).

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
│       ├── pedidos/            # Consultar pedidos (solo lectura: su estado se deriva de los módulos)
│       ├── modulos/            # Consultar módulos (muebles) (solo lectura: su estado se deriva de las piezas)
│       ├── piezas/             # Escanear, confirmar manualmente, listar piezas
│       ├── hojas-corte/        # PDF de hojas de corte por orden + sus anotaciones (schemas/anotacion.schema.ts es el contrato compartido)
│       ├── documentos-pedido/  # PDF de documentación por pedido (nota de pedido, remisión, escandallo, herrajes, accesorios) + anotaciones
│       ├── planos-pedido/      # Planos por pedido (imagen JPG/PNG/WEBP o PDF), módulo opcional + anotaciones
│       ├── escenas-pedido/     # Escenas 3D por pedido (.3d de TeoWin): solo lectura, sin anotaciones. parser/ interpreta el .3d a una geometría liviana (regla 10)
│       ├── texturas-3d/        # Texturas de los materiales de las escenas 3D, por catálogo (copiadas de la carpeta de TeoWin a la base)
│       ├── planillas/          # Planillas de producción de Termolaminado (Lijado, Encolado, PVC): borrador/guardada, versiones, fotos, operarios, tabla, indicadores y trazabilidad (regla 11)
│       ├── planificacion/      # Planificación semanal (pedidos y reclamos) de Termolaminado cargada por sistema por técnica, con el marcado de estados de producción por fila (regla 11)
│       ├── auth/                # Login por PIN, sesión (token firmado), middlewares autenticar / requierePermiso y claves de permiso
│       └── sync/                # Las queries de solo-lectura contra TeoWin + agrupar-despiece.ts (cuántas piezas físicas es cada fila)
├── scripts/
│   └── usuario-sql.ts          # Genera el INSERT para dar de alta un usuario (npm run usuario:sql)
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

Los módulos de documentación digital (`hojas-corte`, `documentos-pedido`, `planos-pedido`) siguen la misma idea pero más simples: `controllers/`, `services/` y a veces `schemas/`; arman el DTO dentro del service (`toDTO`) en vez de tener `mappers/` y `dtos/` separados, y **nunca** seleccionan el campo `contenido` salvo al servir el archivo.

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
| `TEOWIN_3D_DIR` | *(opcional)* Carpeta de datos 3D de TeoWin (solo lectura) de donde se copian las texturas de las escenas 3D y se leen los objetos de la biblioteca (`<catálogo>\Catalogo\<familia>\<nombre>.3d`). Por defecto `T:/datos/3d/E_50`. Si el disco no está, las escenas se ven con colores lisos o con las texturas que ya se copiaron | `T:/datos/3d/E_50` |
| `TEOWIN_DB_ENCRYPT` | Si la conexión requiere cifrado (mirar la config de conexión en SSMS) | `true` |
| `TEOWIN_DB_TRUST_SERVER_CERTIFICATE` | Aceptar el certificado del servidor sin validarlo contra una CA pública | `true` |
| `SESSION_SECRET` | **Obligatoria.** Clave que firma las sesiones. Mínimo 16 caracteres, aleatoria. Si se cambia, solo se cierran las sesiones abiertas | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SESSION_HORAS` | Duración de la sesión en horas (por defecto `12`) | `12` |

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

> **Antes de usar la app tenés que cargar al menos un usuario**: la migración de usuarios crea los roles y permisos pero **ningún usuario**, y sin sesión todo responde `401`. Ver [Alta de usuarios](#alta-de-usuarios).

> Las migraciones de la documentación digital (`hoja_corte`, `documento_pedido`, `plano_pedido` y sus anotaciones) y las de las escenas 3D (`escena_pedido`, `textura_3d`) solo **agregan** tablas. Para revertir una, ejecutá su `down.sql` (en `prisma/migrations/<nombre>/`) y borrá su fila de `_prisma_migrations`.

Otros comandos útiles:

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila TypeScript a JavaScript (para producción) |
| `npm start` | Corre la versión ya compilada (`npm run build` primero) |
| `npx prisma studio` | Abre una interfaz web para mirar/editar los datos de la base propia a mano |
| `npx prisma migrate dev --name algo` | Crea y aplica una migración nueva después de cambiar `schema.prisma` |
| `npm run escenas3d:reinterpretar` | Rehace las escenas 3D guardadas con la versión actual del intérprete, desde el `.3d` original de la base (`-- --todas`, `-- --nombre=26-02568`) |
| `npm run escenas3d:probar -- <carpeta>` | Corre el intérprete sobre una carpeta de `.3d` (copias, nunca la de TeoWin) e informa tiempo, piezas, tamaño del JSON y problemas; no usa la base |
| `npm run texturas3d:sincronizar` | Copia a la base todas las texturas de las carpetas de colores de TeoWin (catálogos 4, 3, 658 y decoración 641; ~60 MB; idempotente). Ver `diseño.md` §13.5 |
| `npm run termolaminado:sembrar` | Siembra la base de **prueba** con partes de producción, planificación y estados de ejemplo de Termolaminado (diseño.md §14.7). Se niega a correr si `DATABASE_URL` no apunta a `Neostone_test` |
| `npm run usuario:sql -- "<nombre>" <rol> <pin>` | Imprime el `INSERT` para dar de alta un usuario (ver [Alta de usuarios](#alta-de-usuarios)) |

---

## Modelo de datos

La jerarquía de producción son cinco tablas (más las seis de [documentación digital](#documentación-digital-tablas-aparte), que cuelgan de orden / pedido / módulo, y las cuatro de [usuarios, roles y permisos](#usuarios-roles-y-permisos-tablas-aparte)). Todas en la base propia. Reflejan la jerarquía real: una **orden de fabricación** agrupa varios **pedidos**, cada pedido tiene varios **módulos** (muebles), cada módulo tiene varios **tipos de pieza**, y cada tipo de pieza puede representar varias **piezas físicas** (cuando hay que cortar más de una unidad igual).

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
| `orden` | `codigoOrdenFabricacion`, `numeroOrdenCustom`, `descripcion`, `archivada_en` (nullable) | Se aprieta "Agregar orden" |
| `pedido` | `orden_id`, `codigo_pedido`, `referencia`, `nombreComercial` | Junto con la orden |
| `modulo` | `pedido_id`, `idEscena`, `descripcion` | Junto con la orden |
| `despiece_tipo` | `modulo_id`, `familia`, `articulo`, `color`, `descripcion`, `medida1`, `medida2`, `medida3`, `idCatalogo`, `unidades` | Junto con la orden |
| `pieza_fisica` | `despiece_tipo_id`, `idUnico` (nulo si la pieza no tiene etiqueta), `escaneado_en` | Junto con la orden |

Todos los campos que vienen directo de TeoWin (`idEscena`, `idCatalogo`, `familia`, `articulo`, `color`, `medida1/2/3`, `codigoOrdenFabricacion`, `idUnico`, etc.) mantienen el mismo nombre que tienen allá, para que sea fácil rastrear de dónde sale cada dato. Los campos que son solo nuestros usan `snake_case` (`creado_en`, `codigo_pedido`, etc.).

### Documentación digital (tablas aparte)

Ocho tablas más, agregadas por migraciones **solo aditivas** (no modifican ninguna de las anteriores; cada migración trae un `down.sql` para revertirla a mano). Guardan los archivos **dentro de Postgres** (`bytea`), así el `pg_dump` es el único backup.

| Tabla | De qué cuelga | Qué guarda |
|---|---|---|
| `hoja_corte` | `orden` | PDF de hoja de corte. Una orden puede tener varias (ej. MDP y MDF), cada una con su `nombre` |
| `documento_pedido` | `pedido` | PDF con `tipo` (enum `DocumentoPedidoTipo`): `NOTA_PEDIDO` y `DETALLE_REMISION` (obligatorios en todo pedido) y los adicionales `ESCANDALLO_PLACARES`, `HERRAJES_PLACARES`, `ACCESORIOS_PLACARES`, `HERRAJES_COCINAS`, `ACCESORIOS_COCINAS` (herrajes y accesorios salen de reportes distintos según la línea). Puede haber varios del mismo tipo |
| `plano_pedido` | `pedido` (+ `modulo`, opcional) | Plano en imagen (`image/jpeg`, `image/png`, `image/webp`) o PDF; guarda su `mime` |
| `escena_pedido` | `pedido` | Escena 3D (`.3d` de TeoWin): el original en `contenido` (`bytea`), la geometría interpretada en `escena` (`jsonb`) y `parser_version`. Sin anotaciones (regla 10) |
| `textura_3d` | — (global) | Textura de un material de las escenas 3D: `clave` = `catálogo/código` en minúsculas (ej. `4/fsn`), `mime`, `contenido` (`bytea`) y `origen` (`teowin` o `manual`). Regla 10 |
| `hoja_corte_anotacion`, `documento_pedido_anotacion`, `plano_pedido_anotacion` | cada archivo | Anotaciones: `tipo` (`TEXTO` o `DIBUJO`, enum `AnotacionTipo`), `pagina` (nulo = nota de todo el documento) y `datos` (JSON, ver regla 8) |

Campos comunes: `id` (UUID), `nombre`, `nombre_archivo`, `tamano`, `contenido` (`bytea`), `creado_en`, `eliminado_en` (borrado lógico: nada se borra físicamente).

### Usuarios, roles y permisos (tablas aparte)

Cuatro tablas más, también por migración **solo aditiva** (`20261008120000_usuarios_roles_permisos`, con `down.sql`). Se administran **directo en la base**; no hay pantalla.

| Tabla | Campos | Para qué |
|---|---|---|
| `rol` | `id`, `nombre` (único), `descripcion` | Los roles: `admin`, `tecnica`, `fabrica`, `gerencia` |
| `permiso` | `clave` (PK), `descripcion` | Las funcionalidades (ej. `piezas.marcar`) |
| `rol_permiso` | `rol_id`, `permiso_clave` (PK compuesta) | **Qué funcionalidades tiene cada rol** |
| `usuario` | `id`, `nombre` (único), `pin` (único, texto plano), `rol_id`, `activo`, `creado_en`, `ultimo_acceso` | Un usuario = una persona o una estación de trabajo |

Un usuario no se borra: se le pone `activo = false`. Detalle de qué permite cada rol en la [regla 9](#9-usuarios-roles-y-permisos).

### Estados (el campo `estado` de cada tabla)

| Tabla | Valores posibles |
|---|---|
| `orden` | `PENDIENTE` → `EN_PROCESO` → `LISTA`, o `ELIMINADO` |
| `pedido` / `modulo` / `despiece_tipo` | `PENDIENTE` → `EN_PRODUCCION` → `FINALIZADO`, o `ELIMINADO` |
| `pieza_fisica` | `PENDIENTE` → `CORTADA`, o `ELIMINADA` |

`ELIMINADO`/`ELIMINADA` no es un borrado físico — es un estado más, que se usa cuando una orden se elimina (para no perder el historial de lo que ya se había cortado). Los módulos, pedidos y tipos de pieza usan `EN_PRODUCCION` (se muestra "En producción") como estado intermedio; solo la orden lo llama `EN_PROCESO`. Solo el estado de las piezas se decide a mano o por escaneo: el de los demás niveles se **deriva** de las piezas (regla 2).

**Archivar no es un estado**: `orden.archivada_en` (timestamp nullable) solo oculta la orden del listado inicial. La orden sigue vigente — conserva su `estado`, sigue ocupando su número en el índice único y sus piezas se pueden seguir escaneando.

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
1. Se busca esa orden en TeoWin (cabecera + todos sus pedidos con piezas de placar — se detecta por `idCatalogo = 4` en `tdespieceLineaPresupuesto`, que es el catálogo "Placares" del Maestro de Productos. Además, solo cuentan las familias del listado de corte de TeoWin — `tFamiliasListadosFabricacion`, listado `A02`, catálogo 4: hoy `PZPP`, `PZD`, `PZC`, `PZA` — para excluir tarugos, herrajes, guías y tiradores que el catálogo 4 también marca como escandallo. No se usa una lista fija: familias como `PZA` existen también en otros catálogos, ej. Cocinas, con artículos totalmente distintos, y en placares los paneles son `PZPP`, no `PZP`. Las piezas sin código de barras (ej. paneles `PZPP/PAN`, con `unidades` fraccionarias 0,5 / 0,25) se agrupan por tipo y se cuentan sumando unidades; quedan con `idUnico` nulo y se finalizan con el botón manual).
2. Si no existe en TeoWin → error 404.
3. Si no tiene ninguna pieza de placar → error 422.
4. Si ya hay una orden **activa** con ese mismo número en la base propia → error 409 (hay que eliminarla primero con el botón "Eliminar" del listado, ver regla 6).
5. Si nada de eso pasa, se crea todo (orden → pedidos → módulos → tipos de pieza → piezas físicas) en una sola operación de base de datos (si algo falla a mitad de camino, no queda nada a medias).

**Qué filas del despiece son piezas de corte**: además de `idCatalogo = 4` y `siEscandallo = 1`, la familia tiene que estar en el listado de corte de TeoWin — `tFamiliasListadosFabricacion`, `codigoListado = 'A02'`, `idCatalogo = 4` (hoy `PZPP`, `PZD`, `PZC`, `PZA`), leído con una subconsulta `EXISTS` en `fetchOrdenDespiece`, no fijado en el código. Sin eso el catálogo 4 trae también tarugos (`TAR3D`), herrajes (`HER3D`), guías (`GC3D`) y tiradores (`TIR`). Ojo: la familia de paneles es `PZPP` (en Cocinas, catálogo 3, es `PZP`).

**Cuántas piezas físicas es cada fila** (`src/modules/sync/agrupar-despiece.ts`): las filas con código único (`tdespieceLineaPresupuestoUnico`) generan una `PiezaFisica` por `idUnico`. Las filas **sin** código único (ej. los paneles `PZPP/PAN` de `unidades` 0,5 / 0,25; los `PAN` enteros sí tienen etiqueta) tienen `unidades` fraccionarias (0,5 / 0,25: varias filas componen una pieza), así que se agrupan por módulo + familia/artículo/color/medidas, se suman las unidades y se crea `ceil(suma)` piezas con `idUnico = null`. Esas piezas no se escanean: se dan por cortadas con el botón manual.

**Descripciones**: `tArticuloDescripciones` carga el español como `'ESP'` (completo) y como `'ES'` (parcial). El join usa `OUTER APPLY (SELECT TOP 1 ...)` prefiriendo `'ESP'` y filtrando por `idCatalogo`, para no duplicar filas ni dejar piezas sin descripción.

Después de sincronizada, la orden vive **solo** en la base propia — no se vuelve a consultar TeoWin para verla ni actualizarla automáticamente.

### 2. Lo único que se marca a mano son las piezas; el resto se deriva

Una `PiezaFisica` pasa a `CORTADA` por escaneo (`POST /piezas/escanear`) o por el botón manual "Finalizado" (`PATCH /piezas/:id/confirmar`), y vuelve a `PENDIENTE` con `PATCH /piezas/:id/pendiente`. **Todos los niveles de arriba son derivados** de sus hijos vigentes (no eliminados), tanto hacia "en producción" como hacia "finalizado" y de vuelta a "pendiente". No existen acciones manuales para módulo, pedido ni orden (se eliminaron los endpoints `finalizar` / `pendiente` que había):

| Nivel | `PENDIENTE` si... | `FINALIZADO` (`LISTA` en la orden) si... | Si no |
|---|---|---|---|
| Pieza | — (se marca a mano o por escaneo) | `CORTADA` | — |
| Módulo | ninguna pieza `CORTADA` | todas `CORTADA` | `EN_PRODUCCION` |
| Pedido | todos sus módulos `PENDIENTE` | todos `FINALIZADO` | `EN_PRODUCCION` |
| Orden | todos sus pedidos `PENDIENTE` | todos `FINALIZADO` → `LISTA` | `EN_PROCESO` |
| `DespieceTipo` (interno, no se muestra) | ninguna pieza `CORTADA` | todas `CORTADA` | `EN_PRODUCCION` |

Se recalcula hacia arriba (Módulo → Pedido → Orden) dentro de la misma transacción **después de cada cambio de una pieza**:

- El primer avance (una pieza cortada) pasa a los ancestros a "en producción".
- Un nivel es `FINALIZADO` solo cuando **todos** sus hijos lo están: un módulo con todas sus piezas cortadas, un pedido con todos sus módulos finalizados y una orden `LISTA` con todos sus pedidos finalizados. Sin pasos salteados: nada se finaliza sin que las piezas lo respalden.
- Al deshacer una pieza, un `FINALIZADO`/`LISTA` deja de serlo apenas un hijo deja de cumplir, y cuando no queda **nada** avanzado debajo el nivel vuelve solo a `PENDIENTE` (ej. al deshacer la última pieza cortada de un módulo, el módulo pasa a `PENDIENTE`, y el pedido y la orden también si no tienen nada más avanzado).
- Un nivel sin hijos vigentes no se toca.

Toda la lógica vive en `src/modules/estados/estados.service.ts` (`recalcularDespieceTipo`, `propagarDesdeModulo`, `recalcularPedido`, `recalcularOrden`) y la usan los servicios de pieza (escanear/confirmar y deshacer). Eliminar una orden (regla 6) no pasa por acá: marca todo como eliminado.

Aclaración sobre piezas sin escaneo: las piezas que nunca pasan por Rover (fondos, paneles fraccionarios sin etiqueta) se dan por cortadas con el botón manual; así un módulo puede llegar a `FINALIZADO` aunque no todas sus piezas se hayan escaneado.

### 3. (eliminada) Finalizar / volver a pendiente a nivel módulo, pedido u orden

Antes había botones y endpoints manuales para finalizar módulos y pedidos y para volverlos a pendiente, con precondiciones sobre los hijos. Se eliminaron: como los estados se derivan de las piezas, esas acciones eran redundantes (los estados intermedios quedaban desalineados, ej. un módulo "en producción" sin ninguna pieza cortada) o siempre fallaban.

### 4. Deshacer una pieza

`PATCH /piezas/:id/pendiente` (`CORTADA` → `PENDIENTE`, limpia `escaneado_en`) es la única forma de "volver atrás"; los niveles de arriba se recalculan solos según la regla 2. `410` si la pieza pertenece a una orden eliminada.

### 5. Re-escaneo

`POST /piezas/escanear` de una pieza que ya estaba `CORTADA` no falla ni cambia nada: responde igual, con `yaEscaneada: true`, para que la pantalla avise (popup amarillo en vez de verde).

### 6. Eliminar una orden (soft delete)

`DELETE /ordenes/:id` (diseño.md §5.2, "Descartar" en el diseño): en una transacción, marca la orden, sus pedidos, módulos y tipos de pieza como `ELIMINADO` y sus piezas físicas como `ELIMINADA`, con `eliminado_en`. **Nada se borra físicamente** y **TeoWin no se toca**. Se puede eliminar una orden en cualquier estado (incluso con piezas cortadas: el historial se conserva). Consecuencias: desaparece del listado, escanear una de sus etiquetas responde `410`, y como sale del índice único parcial, el mismo número de orden se puede volver a agregar desde TeoWin.

### 7. Archivar una orden

`PATCH /ordenes/:id/archivar` y `/desarchivar` solo setean/limpian `archivada_en`. No cambia el estado ni bloquea el escaneo. `GET /ordenes` devuelve solo las no archivadas; con `?archivadas=true`, solo las archivadas.

### 8. Documentación digital y anotaciones

- **El archivo original nunca se modifica.** Las correcciones (dibujos, textos, aclaraciones) son filas de anotación que el visor dibuja encima.
- **Coordenadas normalizadas**: en `datos`, `x` e `y` van de `0` a `1` sobre el ancho y el alto de la página, y `grosor` / `tamano` son fracción del ancho. Así se ven igual con cualquier zoom o dispositivo. Un `DIBUJO` lleva `{ puntos: [[x,y],...] (máx. 3000), grosor, color (#rrggbb), resaltador }`; un `TEXTO` de página, `{ x, y, texto (máx. 500), tamano, color }`; una **nota del documento** (`pagina: null`), solo `{ texto }`. La validación está en `hojas-corte/schemas/anotacion.schema.ts` y la comparten los tres tipos de documento.
- **Validación de archivos**: máximo 40 MB. Los PDF se aceptan si contienen la firma `%PDF-`; los planos se validan por la **firma real** del archivo (JPEG, PNG, WEBP o PDF), no por lo que declara el cliente. Un módulo asociado a un plano tiene que ser del mismo pedido.
- **Borrado lógico**: eliminar un documento o una anotación pone `eliminado_en`; la fila y el archivo siguen en la tabla (se puede purgar a mano con SQL pasado un tiempo).
- **Orden o pedido eliminado**: sus documentos no se tocan en cascada, pero **dejan de ser accesibles** (todas las rutas responden `404`), porque cada consulta verifica que el pedido y la orden sigan vigentes.
- **Los listados nunca traen `contenido`** (son MB por fila); el archivo se pide aparte por `/archivo`.
- **Permisos**: subir y eliminar documentos exige `documentacion.gestionar`; crear anotaciones, `documentacion.anotar`; borrarlas, `documentacion.anotaciones.eliminar` (regla 9). **No se registra quién** subió, anotó o borró.

### 10. Escenas 3D (solo lectura)

- **Qué son**: el archivo `.3d` que TeoWin guarda por pedido. Se sube a mano al pedido (`POST /pedidos/:pedidoId/escenas`, body crudo con `Content-Type: application/x-teowin-3d`, `?nombre=…&archivo=…`) y el backend lo **interpreta al subirlo** (`parser/escena-3d.parser.ts`): paneles (`taulerv/h/f`), extrusiones rectangulares (tapas, tiradores), caras de pared interiores y contorno del suelo, en mm (X ancho, Y alto, Z profundidad). Las medidas son expresiones que se evalúan con un evaluador propio (`parser/expresion.ts`, sin `eval`), que también resuelve las condiciones `invisibilidad(...)`; las piezas con `nuncavis3d`, con `transp(0)` o invisibles según las medidas del mueble no se incluyen. Los espesores (`mymat`, `GRxx = "matxx"`) se toman del `matTablero` de cada pieza. Detalle del formato y límites: `diseño.md` §13.
- **Validación**: máximo 40 MB; el contenido tiene que empezar con `//version` (no se confía en la extensión ni en el tipo declarado) y la escena debe tener al menos un mueble o una pared (`400` / `422` si no).
- **Se guardan los dos**: el `.3d` original (`contenido`) para poder re-interpretarlo cuando mejore el parser, y el JSON interpretado (`escena`) que consume el visor. Los listados nunca traen ninguno de los dos.
- **Enlace con módulos**: cada mueble de la escena lleva el `idEscena` de `modulo.idEscena`.
- **Solo lectura**: no hay anotaciones. Permisos: `documentacion.ver` para listar y ver; `documentacion.gestionar` para subir y eliminar (borrado lógico). No se agregó ningún permiso.
- **Orden o pedido eliminado**: la escena deja de ser accesible (`404`), igual que el resto de la documentación.
- **Animaciones**: el intérprete detecta los cajones (`seabre`), las hojas corredizas (`corredera`, `opened`) y las puertas con bisagra (`anguloAper`) de los muebles de fábrica y emite `animaciones[]` (tipo, eje, recorrido en mm o grados) y, en cada caja o malla, el índice `a` de su grupo; los catálogos de decoración y equipamiento no se animan (`diseño.md` §13.4 y §13.6).
- **Texturas** (`texturas-3d`): al subir una escena, el backend copia a la tabla `textura_3d` la textura de cada material (`escena.materiales`, como `catálogo/código`) desde `TEOWIN_3D_DIR`; si el disco no responde, la carga de la escena **no falla**. Los colores de un mueble se buscan en el catálogo del mueble (4 Placares, 3 Cocinas); paredes y piso, en el 641 (decoración). El visor pide cada textura por `GET /api/texturas-3d/:catalogo/:material` (se copia sola la primera vez). Detalle y límites: `diseño.md` §13.5.
- Subir `PARSER_VERSION` cuando cambie el formato de salida del intérprete y rehacer las escenas guardadas con `npm run escenas3d:reinterpretar`. La salida incluye `cajas`, `mallas` (cortinas, tubos, bachas…), `paredes` (con huecos) y `animaciones`. Los objetos `esBiblioteca` se leen de `TEOWIN_3D_DIR` (solo lectura). `npm run escenas3d:probar -- <carpeta>` prueba el intérprete contra copias de `.3d` sin tocar la base.

### 11. Seguimiento de Termolaminado (planillas)

Detalle completo en `diseño.md` §14. Lo que hay que tener presente al tocar el módulo `planillas`:

- **Una planilla por estación y día** (`LIJADO`, `ENCOLADO`, `PVC`; única por `area + estacion + fecha`). El formulario manda siempre el estado completo con `PUT /planillas/dia/:estacion/:fecha` (upsert): sirve para el guardado automático del borrador (`estado: BORRADOR`) y para cerrarla o corregirla (`estado: GUARDADA`). Las filas llevan su `id` una vez creadas; las que no se mandan se borran (con sus fotos).
- **Corregir una `GUARDADA`** guarda antes la versión previa en `planilla_version` (con quién la guardó/reemplazó y cuándo). Una `GUARDADA` no vuelve a `BORRADOR` (`409`). Un `BORRADOR` acepta filas incompletas; al guardar, cada fila necesita pedido, hora de inicio y cantidad (en PVC, mesa chica y/o grande).
- **PVC**: `cantidad_piezas` = `mesa_chica + mesa_grande`, calculada por el backend; `colores` en mayúsculas y sin puntos; solo las filas de PVC aceptan fotos (hasta 12 por fila, JPG/PNG/WEBP por firma, máx. 8 MB, `bytea`, borrado lógico).
- **N° de pedido**: texto libre en mayúsculas; si coincide exactamente con un pedido sincronizado se guarda también `pedido_id`.
- **Configuración por usuario** (la hace técnica, `planillas.configurar`): `usuario_planilla` (planillas que completa; `PUT /planillas/dia/...` y las fotos devuelven `403` si la estación no está asignada), `usuario_estado_produccion` (el estado que marca en la planificación; un estado puede repetirse entre usuarios) y `usuario_operario` (sus operarios). La sesión (`GET /auth/me`) devuelve `planillas`.
- **Operarios**: los de **su estación** (`usuario_operario`); en cada planilla se eligen a mano (`operarios` en el `PUT`, deben ser los del usuario o estar ya en la planilla) y se guardan como nombre, así que cambiar la lista no altera las planillas existentes.
- **Planificación semanal por sistema** (`planificacion_item`, `planificacion_marca`, `estado_produccion`): técnica (`documentacion.gestionar`) carga a mano las filas de pedidos y reclamos de cada semana (lunes); quien tiene un estado de producción asignado marca/desmarca ese estado en cada fila (`PUT /planificacion/items/:id/marca`). Ver con `documentacion.ver`. Ya no hay carga de PDF/imagen.
- **Visibilidad de registros**: el rol `fabrica` solo ve los registros de las planillas que tiene asignadas (`GET /planillas/registros`, `/dia/...`, `/:id`, `/versiones/:id`, `/fotos/:id`, `/trazabilidad`, sugerencias y colores); técnica, gerencia y admin ven todas. Una estación no visible responde `403`; sin planillas asignadas, el listado queda vacío y la trazabilidad responde `403` (`estacionesVisibles` en `planillas.router.ts`).
- Esta feature **no lee ni escribe en TeoWin**. Permisos: `planillas.completar`, `planillas.ver`, `planillas.indicadores`, `planillas.configurar` (tabla de la regla 9).

### 9. Usuarios, roles y permisos

Todo `/api/*` exige sesión salvo `GET /api/health` y `POST /api/auth/login`. Cada ruta, además, declara el permiso que necesita (`requierePermiso(PERMISOS.…)` en su router).

- **Login**: `POST /api/auth/login` con `{ "pin": "123456" }`. El PIN identifica al usuario. Devuelve `{ token, expiraEnSegundos, usuario: { nombre, rol } }`; el frontend guarda el token en una cookie httpOnly y lo reenvía como `Authorization: Bearer <token>`.
- **PIN**: numérico de 4 a 10 dígitos (se recomiendan 6) y único. **Se guarda en texto plano** en `usuario.pin` (decisión del usuario; cualquiera con lectura a la base ve los PIN, incluidos los backups).
- **Sesión**: token firmado con `SESSION_SECRET`, dura `SESSION_HORAS`. Lleva solo el id de usuario y el vencimiento: **el rol y los permisos se leen de la base en cada pedido**, así que una baja (`activo = false`) o un cambio en `rol_permiso` rige de inmediato.
- **Límite de intentos**: 8 PIN incorrectos en 10 minutos bloquean el login con `429`, por IP y en memoria (se reinicia con el servidor). Como el backend ve la IP del frontend, en la práctica es global.
- **Errores**: `401` sin sesión válida (falta el token, venció, está alterado o el usuario está inactivo); `403` si el usuario no tiene el permiso.
- `GET /api/auth/me` devuelve `{ nombre, rol, permisos[] }` (lo usa el frontend para decidir qué mostrar; el backend igual valida cada acción).

**Permisos por rol** (la fuente es la tabla `rol_permiso`; esta tabla es la carga inicial de la migración):

| Permiso | Qué habilita | admin | tecnica | fabrica | gerencia |
|---|---|:-:|:-:|:-:|:-:|
| `produccion.ver` | Ver órdenes, pedidos, módulos y piezas | ✔ | ✔ | ✔ | ✔ |
| `piezas.marcar` | Escanear y marcar / deshacer piezas | ✔ | ✔ | ✔ | — |
| `documentacion.ver` | Ver hojas de corte, documentos, planos y anotaciones | ✔ | ✔ | ✔ | ✔ |
| `documentacion.anotar` | Crear anotaciones | ✔ | ✔ | ✔ | — |
| `documentacion.anotaciones.eliminar` | Borrar anotaciones | ✔ | ✔ | — | — |
| `documentacion.gestionar` | Subir y eliminar hojas de corte, documentos y planos | ✔ | ✔ | — | — |
| `ordenes.gestionar` | Agregar, archivar y eliminar órdenes | ✔ | ✔ | — | — |
| `usuarios.gestionar` | Alta y baja de usuarios (previsto; hoy se hace por base) | ✔ | ✔ | — | — |
| `planillas.completar` | Completar, guardar y corregir las planillas de producción de Termolaminado y sus fotos | ✔ | ✔ | ✔ | — |
| `planillas.ver` | Ver registros, indicadores y trazabilidad de las planillas | ✔ | ✔ | ✔ | ✔ |
| `planillas.indicadores` | Ver los indicadores de producción de Termolaminado | ✔ | ✔ | — | ✔ |
| `planillas.configurar` | Configurar estados de producción, planillas y operarios de cada usuario | ✔ | ✔ | — | — |

La planificación semanal de Termolaminado no tiene permiso propio: usa `documentacion.ver` (ver) y `documentacion.gestionar` (subir y eliminar). Ojo: hoy **todo usuario `fabrica`** recibe `planillas.completar` (no hay un rol solo de Termolaminado).

Los usuarios `fabrica` son las estaciones de trabajo (`cortadora1`, `rover1`, `armado1`, …); `gerencia` queda previsto para un panel de información futuro. Ver `diseño.md` §12 para los motivos.

#### Alta de usuarios

No hay pantalla: se da de alta desde la base. El script genera el `INSERT`:

```powershell
cd app\backend
npm run usuario:sql -- "rover1" fabrica 123456
```

Imprime algo como `INSERT INTO usuario (nombre, pin, rol_id) VALUES ('rover1', '123456', (SELECT id FROM rol WHERE nombre = 'fabrica'));`, que se ejecuta en psql / pgAdmin / Prisma Studio. Roles válidos: `admin`, `tecnica`, `fabrica`, `gerencia`. Otras operaciones, directo en SQL:

```sql
UPDATE usuario SET activo = false WHERE nombre = 'rover1';              -- dar de baja (cierra su sesión de inmediato)
UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE nombre = 'tecnica') WHERE nombre = 'rover1';  -- cambiar de rol
```

Para cambiar el PIN de alguien: `UPDATE usuario SET pin = '654321' WHERE nombre = 'rover1';` (tiene que ser numérico y único). Para **agregar un permiso nuevo**: insertarlo en `permiso` y asignarlo en `rol_permiso` (también a `admin`: no tiene acceso implícito a todo); el código lo referencia con `requierePermiso`.

> No guardes PIN en archivos del proyecto ni en el historial de git. Evitá pasar PIN reales en la línea de comandos de una máquina compartida (queda en el historial de la terminal).

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

**Autenticación**: todas las rutas salvo `GET /health` y `POST /auth/login` requieren `Authorization: Bearer <token>`. Sin sesión válida responden `401`; sin el permiso de la ruta, `403` (`"No tenés permiso para realizar esta acción."`). El permiso que exige cada ruta es el de la regla 9: lectura de producción (`produccion.ver`) en los `GET` de órdenes, pedidos y módulos; `ordenes.gestionar` en `POST`/`DELETE`/`archivar`/`desarchivar` de órdenes; `piezas.marcar` en las tres rutas de piezas; `documentacion.ver` en los `GET` de documentación y anotaciones; `documentacion.gestionar` en subir y eliminar archivos; `documentacion.anotar` en `POST` de anotaciones y `documentacion.anotaciones.eliminar` en su `DELETE`.

### Autenticación

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `POST /auth/login` | Inicia sesión con el PIN (ruta pública) | body: `{ "pin": "123456" }` → `data`: `{ token, expiraEnSegundos, usuario: { nombre, rol } }`. Errores: `400` (PIN no numérico), `401` (PIN incorrecto o usuario inactivo), `429` (demasiados intentos) |
| `GET /auth/me` | Quién es el usuario de la sesión y qué puede hacer | `data`: `{ nombre, rol, permisos: string[] }` |

### Salud del servidor

`GET /health` → `{ "ok": true }`. Para chequear que el backend está vivo.

### Órdenes

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /ordenes` | Lista las órdenes vigentes **no archivadas**, más recientes primero. `?archivadas=true` devuelve solo las archivadas | `data`: array de `{ id, codigoOrdenFabricacion, numeroOrdenCustom, descripcion, estado, creado_en, archivada_en, pedidosCount, codigosPedido }` (`codigosPedido`: códigos de pedido de la orden, para que el listado busque por pedido) |
| `POST /ordenes` | Sincroniza una orden nueva desde TeoWin | body: `{ "codigoOrdenFabricacion": 263500002 }` → `data`: la orden creada. Errores: `404` (no existe en TeoWin), `422` (sin piezas de placar), `409` (ya activa) |
| `GET /ordenes/:id` | Detalle de una orden | `data`: mismo shape que en la lista |
| `GET /ordenes/:id/pedidos` | Pedidos de esa orden | `data`: array de `{ id, codigo_pedido, referencia, nombreComercial, estado, modulosCount }` |
| `PATCH /ordenes/:id/archivar` | Archiva la orden (regla 7) | `data`: la orden |
| `PATCH /ordenes/:id/desarchivar` | Desarchiva la orden | `data`: la orden |
| `DELETE /ordenes/:id` | Elimina la orden con soft delete en cascada (regla 6). `404` si no existe o ya está eliminada | `data`: la orden (con `estado: "ELIMINADO"`) |

### Pedidos

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /pedidos/:id` | Detalle de un pedido | `data`: los campos del pedido + `orden: { id, numeroOrdenCustom, descripcion }` |
| `GET /pedidos/:id/modulos` | Módulos de ese pedido | `data`: array de `{ id, idEscena, descripcion, estado, despieceTiposCount }` |

### Módulos

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /modulos/:id` | Detalle de un módulo | `data`: los campos del módulo + `pedido: { id, codigo_pedido, nombreComercial }` + `orden: { id, numeroOrdenCustom }` |
| `GET /modulos/:id/piezas` | Piezas físicas de ese módulo | `data`: array de `{ id, idUnico, familia, articulo, color, descripcion, medida1, medida2, estado, escaneado_en }` |

### Hojas de corte (por orden)

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /ordenes/:ordenId/hojas-corte` | Lista las hojas de la orden (sin el archivo) | `data`: array de `{ id, orden_id, nombre, nombre_archivo, tamano, creado_en }` |
| `POST /ordenes/:ordenId/hojas-corte?nombre=...&archivo=...` | Sube una hoja. **Body: el PDF crudo** con `Content-Type: application/pdf` (no JSON) | `data`: la hoja creada. `400` (no es PDF / falta nombre), `404` (orden), `413` (más de 40 MB), `415` (no es `application/pdf`) |
| `GET /hojas-corte/:id/archivo` | Devuelve el PDF (`inline`) | binario `application/pdf` |
| `DELETE /hojas-corte/:id` | Borrado lógico | `data: null` |
| `GET /hojas-corte/:id/anotaciones` | Anotaciones vigentes de la hoja | `data`: array de `{ id, hoja_corte_id, pagina, tipo, datos, creado_en }` |
| `POST /hojas-corte/:id/anotaciones` | Crea una anotación (regla 8) | body JSON: `{ tipo, pagina, datos }` → `data`: la anotación. `400` si no valida |
| `DELETE /hojas-corte/:id/anotaciones/:anotacionId` | Borrado lógico de una anotación | `data: null` |

### Documentos de un pedido

Mismo esquema que las hojas de corte, colgando del pedido.

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /pedidos/:pedidoId/documentos` | Lista los documentos del pedido (sin el archivo) | `data`: array de `{ id, pedido_id, tipo, nombre, nombre_archivo, tamano, creado_en }` |
| `POST /pedidos/:pedidoId/documentos?tipo=...&archivo=...&nombre=...` | Sube un PDF. `tipo` es obligatorio (uno de `DocumentoPedidoTipo`); `nombre` es opcional (por defecto, la etiqueta del tipo). Body: PDF crudo, `Content-Type: application/pdf` | `data`: el documento creado |
| `GET /documentos-pedido/:id/archivo` · `DELETE /documentos-pedido/:id` | Descargar / borrado lógico | igual que en hojas de corte |
| `GET`/`POST /documentos-pedido/:id/anotaciones` · `DELETE /documentos-pedido/:id/anotaciones/:anotacionId` | Anotaciones del documento | mismo contrato (campo `documento_pedido_id`) |

### Planos de un pedido

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /pedidos/:pedidoId/planos` | Lista los planos (sin el archivo) | `data`: array de `{ id, pedido_id, nombre, nombre_archivo, mime, tamano, creado_en, modulo: { id, idEscena, descripcion } \| null }` |
| `POST /pedidos/:pedidoId/planos?nombre=...&archivo=...&moduloId=...` | Sube un plano. `nombre` obligatorio; `moduloId` opcional (UUID de un módulo **de ese pedido**). Body: el archivo crudo con su `Content-Type` (`image/jpeg`, `image/png`, `image/webp` o `application/pdf`) | `data`: el plano. `400` (la firma no coincide / módulo de otro pedido), `415` (formato no soportado) |
| `GET /planos-pedido/:id/archivo` · `DELETE /planos-pedido/:id` | Descargar (con su `Content-Type`) / borrado lógico | |
| `GET`/`POST /planos-pedido/:id/anotaciones` · `DELETE /planos-pedido/:id/anotaciones/:anotacionId` | Anotaciones del plano (una imagen es un documento de una sola página) | mismo contrato (campo `plano_pedido_id`) |

### Escenas 3D de un pedido

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /pedidos/:pedidoId/escenas` | Lista las escenas del pedido (sin el archivo ni la geometría) | `data`: array de `{ id, pedido_id, nombre, nombre_archivo, tamano, creado_en }` |
| `POST /pedidos/:pedidoId/escenas?nombre=...&archivo=...` | Sube e interpreta un `.3d` (regla 10). **Body: el archivo crudo** con `Content-Type: application/x-teowin-3d` | `data`: la escena creada. `400` (no es un `.3d`), `404` (pedido), `413` (más de 40 MB), `415` (falta el body), `422` (sin muebles ni paredes) |
| `GET /escenas-pedido/:id/escena` | Geometría interpretada para el visor | `data`: `{ nombre, escena: { version, cabecera, modulos[], cajas[], paredes[], suelo[], sinResolver[] } }` |
| `DELETE /escenas-pedido/:id` | Borrado lógico | `data: null` |

### Texturas de escenas 3D

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `GET /texturas-3d/:catalogo/:material` | Imagen de la textura del material en ese catálogo (`documentacion.ver`). La copia desde la carpeta de TeoWin la primera vez | binario `image/jpeg` o `image/png`. `404` si no existe |
| `POST /texturas-3d/:catalogo/:material` | Alta o reemplazo manual (`documentacion.gestionar`). **Body: la imagen cruda** (`image/jpeg` o `image/png`, máx. 8 MB, se verifica la firma) | `data`: `{ clave, tamano }` |

### Planillas de Termolaminado

Todas bajo `/api/planillas`. `estacion` es `lijado`, `encolado` o `pvc`; `fecha`, `AAAA-MM-DD`.

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /planillas/dia/:estacion/:fecha` | `planillas.ver` | La planilla de ese día con sus filas, fotos (metadatos) y versiones; `data: null` si no existe |
| `PUT /planillas/dia/:estacion/:fecha` | `planillas.completar` | Crea o actualiza con `{ estado: "BORRADOR" \| "GUARDADA", filas: [{ id?, hora_inicio, hora_fin, pedido_codigo, cantidad_piezas, observaciones, colocacion_pvc, perfilado, colores, mesa_chica, mesa_grande }] }`. `400` (datos inválidos, mensaje legible), `409` (una guardada no vuelve a borrador) |
| `GET /planillas/:id` · `GET /planillas/versiones/:id` | `planillas.ver` | Detalle de una planilla / una versión previa (`datos`) |
| `GET /planillas/registros?desde&hasta&estacion&estado&pedido` | `planillas.ver` (+ planilla asignada si es `fabrica`) | Tabla cruda: una fila por registro con `fotos` (cantidad) y `versiones`. Por defecto, los últimos 30 días |
| `GET /planillas/indicadores?desde&hasta` | `planillas.indicadores` | Por estación, por día y estado de los pedidos del período |
| `GET /planillas/trazabilidad?pedido=` | `planillas.ver` | Recorrido de un pedido por las tres estaciones |
| `GET /planillas/pedidos-sugeridos?q=` · `GET /planillas/colores` | `planillas.ver` | Autocompletado de N° de pedido y de códigos de color |
| `GET /planillas/accesos` · `PUT /planillas/accesos/:usuarioId` | `planillas.configurar` | Configuración por usuario: `{ estaciones: ["LIJADO","ENCOLADO","PVC"], estado_id, operarios: ["Fabián"] }` |
| `GET`/`PUT /planillas/estados` | `planillas.configurar` | Catálogo de estados de producción: `{ estados: [{ id?, nombre, color? (#rrggbb) }] }` (`409` si se quita uno asignado o con marcas) |
| `GET /planillas/operarios` | `planillas.ver` | Los operarios de la estación del usuario: `{ operarios: ["Fabián", "Carlos"] }` |
| `POST /planillas/filas/:filaId/fotos` | `planillas.completar` | **Body: la imagen cruda** (`image/jpeg`, `png` o `webp`). Solo filas de PVC. `201`: `{ id, mime, tamano, creado_en }` |
| `GET`/`DELETE /planillas/fotos/:fotoId` | `planillas.ver` / `planillas.completar` | Imagen / borrado lógico |

### Planificación semanal de Termolaminado

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /planificacion?semana=AAAA-MM-DD` | `documentacion.ver` | La semana (por defecto la actual; se normaliza a su lunes): `{ semana_inicio, semanas[], estados[], mi_estado, items[] }`, cada fila con sus `marcas` (estado, quién, cuándo) |
| `POST /planificacion/items` · `PUT /planificacion/items/:id` · `DELETE /planificacion/items/:id` | `documentacion.gestionar` | Alta, edición y baja lógica de una fila. Body: `{ tipo: "PEDIDOS" \| "RECLAMOS", semana, cliente, n_tw, n_orden, modelo, color, fabrica, fecha_limite, distribuidor, ticket, tipo_reclamo, compromiso, finalizado_en, observaciones }` (hace falta cliente o N° TW) |
| `PUT /planificacion/items/:id/marca` | `documentacion.ver` + estado asignado | `{ marcado: true \| false }`: marca o quita el estado de producción del usuario en la fila (`403` si no tiene estado asignado) |

### Piezas

| Método y ruta | Qué hace | Body / respuesta |
|---|---|---|
| `POST /piezas/escanear` | El operario escaneó un código de barras — marca la pieza `CORTADA` y dispara la cascada | body: `{ "idUnico": "2195136" }` (string de **exactamente 7 dígitos**) → `data`: resumen (ver abajo). Errores: `400` (formato inválido), `404` (código no existe), `410` (la pieza pertenece a una orden descartada) |
| `PATCH /piezas/:id/confirmar` | Confirmación manual (Vista 4) — mismo efecto que escanear, pero por `id` propio en vez de código de barras | `data`: mismo resumen que el escaneo |
| `PATCH /piezas/:id/pendiente` | Deshace el corte: `CORTADA` → `PENDIENTE` y limpia `escaneado_en`; recalcula módulo, pedido y orden (regla 2). `410` si la pieza pertenece a una orden eliminada | `data`: `{ id, estado, modulo_id }` |

El **resumen** que devuelven `escanear` y `confirmar` (para mostrar en pantalla qué se acaba de marcar). `yaEscaneada` es `true` si la pieza ya estaba `CORTADA` antes de este llamado (regla 5):

```json
{
  "yaEscaneada": false,
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
| `409 Conflict` ("ya existe un registro activo") al sincronizar una orden que **sí** aparece en el listado de la app | Ya existe una fila activa con ese `codigoOrdenFabricacion` en la base propia | Es el comportamiento esperado — para recargarla hay que eliminarla primero (botón "Eliminar" del listado) |
| `409 Conflict` al sincronizar una orden que **no** aparece en ningún lado de la app (nunca se sincronizó) | `tArticuloDescripciones` puede tener más de una fila para el mismo familia/articulo/idioma con distinto `idCatalogo` — sin filtrar por `idCatalogo` en el join de descripción (`src/modules/sync/teowin-orden.queries.ts`), se duplican filas y dos piezas con el mismo `idUnico` terminan en el mismo `INSERT`, lo que dispara el índice único de la sección 8.3 con un mensaje engañoso ("ya existe") aunque la orden nunca se llegó a crear | Ya corregido (el join ahora exige `ad.idCatalogo = d.idCatalogo`/`= padre.idCatalogo`) — si vuelve a aparecer con otra orden, correr la query de `fetchOrdenDespiece` a mano y comparar el conteo de filas con/sin ese join |
| Un módulo muestra menos piezas que el escandallo de TeoWin | Familia de corte que no estaba en el filtro (caso real: los paneles `PZPP/PAN` del módulo 38 del pedido `26-02149`, 40 en vez de 42) o órdenes sincronizadas antes de la corrección | El filtro ahora sale de `tFamiliasListadosFabricacion` (listado `A02`, catálogo 4). Para órdenes ya cargadas hay que completarlas (solo agregando filas) o eliminarlas y volver a agregarlas — ver la regla 1 |
| Una escena 3D se ve con colores lisos en vez de texturas | El backend no llega a la carpeta de TeoWin (`TEOWIN_3D_DIR`, por defecto `T:/datos/3d/E_50`) y esa textura todavía no está en la base | Verificar que el disco esté disponible para el usuario que corre el backend (un servicio de Windows no ve las unidades mapeadas: usar ruta UNC) o subir la textura a mano (`POST /texturas-3d/...`). Se copia sola la primera vez que se la encuentra |
| Una escena 3D se ve incompleta (faltan tiradores, ventanas o alguna pieza) | v1 del intérprete: no cubre `tube` ni `malla` (los perfiles de relieve se dibujan como su caja envolvente), y usa 18 mm donde el espesor depende del catálogo | Ver los límites en `diseño.md` §13.3; la escena se puede re-interpretar desde el original guardado cuando mejore el parser |
| `prisma generate` falla con `EPERM: operation not permitted, rename ...query_engine-windows.dll.node` | El backend (`npm run dev`, `tsx watch`) está corriendo y tiene la DLL de Prisma abierta | Detené el backend, corré `npx prisma generate` y volvelo a levantar |
| Subir un PDF o plano falla con `413` | Supera los 40 MB | Reducir el archivo; el límite está en `MAX_PDF_BYTES` / `MAX_PLANO_BYTES` |
| El backend no arranca: `SESSION_SECRET debe tener al menos 16 caracteres` | Falta completar esa variable en `.env` (es obligatoria desde la feature de usuarios) | Generá un valor aleatorio largo (ver [Variables de entorno](#variables-de-entorno)) |
| Toda la app responde `401` / pide PIN y no hay forma de entrar | No hay ningún usuario cargado (la migración no crea usuarios) o el PIN no coincide con el de ningún usuario activo | Cargar un usuario con `npm run usuario:sql` (ver [Alta de usuarios](#alta-de-usuarios)). |
| `429` al ingresar el PIN | 8 PIN incorrectos en 10 minutos desde el mismo origen | Esperar el tiempo que indica el mensaje o reiniciar el backend (el contador está en memoria) |
| `403` en una acción que antes andaba | El rol del usuario no tiene ese permiso | Revisar `rol_permiso` (ver la tabla de la regla 9) |
| `npm run build`/`tsc` falla con `Invalid value for '--ignoreDeprecations'` | `tsconfig.json` tiene `"ignoreDeprecations": "6.0"` pero el TypeScript instalado es 5.9 (`npm run dev` no se ve afectado: `tsx` no chequea tipos) | Pendiente de decidir: subir TypeScript a 6 o cambiar el valor a `"5.0"` |
