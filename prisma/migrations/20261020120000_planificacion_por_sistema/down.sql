-- Revierte 20261019-20261020_planificacion_por_sistema: borra lo nuevo y recrea las dos tablas que reemplazó (vacías).
-- Después, borrar su fila de _prisma_migrations.
DROP TABLE "planificacion_marca";
DROP TABLE "planificacion_item";
DROP TABLE "usuario_estado_produccion";
DROP TABLE "estado_produccion";
DROP TABLE "usuario_operario";

CREATE TABLE "area_operario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "area" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "area_operario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "area_operario_area_nombre_key" ON "area_operario"("area", "nombre");

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
CREATE INDEX "planificacion_semanal_area_semana_inicio_idx" ON "planificacion_semanal"("area", "semana_inicio");
