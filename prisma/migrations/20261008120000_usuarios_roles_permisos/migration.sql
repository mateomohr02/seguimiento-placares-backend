-- CreateTable
CREATE TABLE "rol" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permiso" (
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "permiso_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "rol_permiso" (
    "rol_id" UUID NOT NULL,
    "permiso_clave" TEXT NOT NULL,

    CONSTRAINT "rol_permiso_pkey" PRIMARY KEY ("rol_id","permiso_clave")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "rol_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rol_nombre_key" ON "rol"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_nombre_key" ON "usuario"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_pin_hash_key" ON "usuario"("pin_hash");

-- CreateIndex
CREATE INDEX "usuario_rol_id_idx" ON "usuario"("rol_id");

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_permiso_clave_fkey" FOREIGN KEY ("permiso_clave") REFERENCES "permiso"("clave") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Datos iniciales: roles, permisos y qué permisos tiene cada rol (diseño.md §12).
-- Los usuarios NO se cargan acá: se dan de alta a mano (ver README del backend).
INSERT INTO "rol" ("nombre", "descripcion") VALUES
  ('admin',    'Todas las funcionalidades'),
  ('tecnica',  'Visualización, edición de documentación, alta y baja de órdenes y usuarios'),
  ('fabrica',  'Estaciones de planta: lectura, marcar piezas y anotar documentación'),
  ('gerencia', 'Solo lectura de producción y documentación');

INSERT INTO "permiso" ("clave", "descripcion") VALUES
  ('produccion.ver',                        'Ver órdenes, pedidos, módulos y piezas'),
  ('piezas.marcar',                         'Escanear y marcar/deshacer piezas cortadas'),
  ('documentacion.ver',                     'Ver hojas de corte, documentos, planos y sus anotaciones'),
  ('documentacion.anotar',                  'Crear anotaciones sobre los documentos'),
  ('documentacion.anotaciones.eliminar',    'Borrar anotaciones'),
  ('documentacion.gestionar',               'Subir y eliminar hojas de corte, documentos y planos'),
  ('ordenes.gestionar',                     'Agregar, archivar y eliminar órdenes'),
  ('usuarios.gestionar',                    'Alta y baja de usuarios');

INSERT INTO "rol_permiso" ("rol_id", "permiso_clave")
SELECT r."id", p."clave" FROM "rol" r JOIN "permiso" p ON
  r."nombre" = 'admin'
  OR (r."nombre" = 'tecnica' AND p."clave" IN (
        'produccion.ver','piezas.marcar','documentacion.ver','documentacion.anotar',
        'documentacion.anotaciones.eliminar','documentacion.gestionar','ordenes.gestionar','usuarios.gestionar'))
  OR (r."nombre" = 'fabrica' AND p."clave" IN (
        'produccion.ver','piezas.marcar','documentacion.ver','documentacion.anotar'))
  OR (r."nombre" = 'gerencia' AND p."clave" IN ('produccion.ver','documentacion.ver'));
