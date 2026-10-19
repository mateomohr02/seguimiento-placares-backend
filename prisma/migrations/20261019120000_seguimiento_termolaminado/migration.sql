-- CreateEnum
CREATE TYPE "PlanillaEstacion" AS ENUM ('LIJADO', 'ENCOLADO', 'PVC');

-- CreateEnum
CREATE TYPE "PlanillaEstado" AS ENUM ('BORRADOR', 'GUARDADA');

-- CreateEnum
CREATE TYPE "PlanificacionTipo" AS ENUM ('PEDIDOS', 'RECLAMOS');

-- CreateTable
CREATE TABLE "planilla_produccion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "area" TEXT NOT NULL DEFAULT 'TERMOLAMINADO',
    "estacion" "PlanillaEstacion" NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "PlanillaEstado" NOT NULL DEFAULT 'BORRADOR',
    "operarios" TEXT[],
    "creado_por" TEXT NOT NULL,
    "modificado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardada_en" TIMESTAMP(3),

    CONSTRAINT "planilla_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planilla_fila" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planilla_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "hora_inicio" TEXT,
    "hora_fin" TEXT,
    "pedido_codigo" TEXT NOT NULL DEFAULT '',
    "pedido_id" UUID,
    "cantidad_piezas" INTEGER,
    "observaciones" TEXT,
    "colocacion_pvc" TEXT,
    "perfilado" TEXT,
    "colores" TEXT,
    "mesa_chica" INTEGER,
    "mesa_grande" INTEGER,

    CONSTRAINT "planilla_fila_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planilla_foto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fila_id" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "planilla_foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planilla_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planilla_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "datos" JSONB NOT NULL,
    "guardada_por" TEXT NOT NULL,
    "guardada_en" TIMESTAMP(3) NOT NULL,
    "reemplazada_por" TEXT NOT NULL,
    "reemplazada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planilla_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_operario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "area" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "area_operario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planificacion_semanal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "area" TEXT NOT NULL DEFAULT 'TERMOLAMINADO',
    "tipo" "PlanificacionTipo" NOT NULL,
    "semana_inicio" DATE NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "planificacion_semanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planilla_produccion_fecha_idx" ON "planilla_produccion"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "planilla_produccion_area_estacion_fecha_key" ON "planilla_produccion"("area", "estacion", "fecha");

-- CreateIndex
CREATE INDEX "planilla_fila_planilla_id_idx" ON "planilla_fila"("planilla_id");

-- CreateIndex
CREATE INDEX "planilla_fila_pedido_codigo_idx" ON "planilla_fila"("pedido_codigo");

-- CreateIndex
CREATE INDEX "planilla_foto_fila_id_idx" ON "planilla_foto"("fila_id");

-- CreateIndex
CREATE UNIQUE INDEX "planilla_version_planilla_id_version_key" ON "planilla_version"("planilla_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "area_operario_area_nombre_key" ON "area_operario"("area", "nombre");

-- CreateIndex
CREATE INDEX "planificacion_semanal_area_semana_inicio_idx" ON "planificacion_semanal"("area", "semana_inicio");

-- AddForeignKey
ALTER TABLE "planilla_fila" ADD CONSTRAINT "planilla_fila_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_foto" ADD CONSTRAINT "planilla_foto_fila_id_fkey" FOREIGN KEY ("fila_id") REFERENCES "planilla_fila"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_version" ADD CONSTRAINT "planilla_version_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos nuevos (diseño.md §14). Los usuarios NO se cargan acá: se dan de alta a mano.
-- Documentación de planificación: se reutilizan documentacion.ver / documentacion.gestionar.
INSERT INTO "permiso" ("clave", "descripcion") VALUES
  ('planillas.completar', 'Completar, guardar y corregir las planillas de producción de Termolaminado'),
  ('planillas.ver',       'Ver los registros, indicadores y trazabilidad de las planillas de producción'),
  ('planillas.configurar','Configurar los operarios de cada área de trabajo');

INSERT INTO "rol_permiso" ("rol_id", "permiso_clave")
SELECT r."id", p."clave" FROM "rol" r JOIN "permiso" p ON
  p."clave" IN ('planillas.completar','planillas.ver','planillas.configurar')
  AND (
    r."nombre" = 'admin'
    OR (r."nombre" = 'tecnica' AND p."clave" IN ('planillas.completar','planillas.ver','planillas.configurar'))
    OR (r."nombre" = 'fabrica' AND p."clave" IN ('planillas.completar','planillas.ver'))
    OR (r."nombre" = 'gerencia' AND p."clave" = 'planillas.ver')
  );
