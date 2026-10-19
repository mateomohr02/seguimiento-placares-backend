-- CreateTable
CREATE TABLE "usuario_operario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_operario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estado_produccion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estado_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_estado_produccion" (
    "usuario_id" UUID NOT NULL,
    "estado_id" UUID NOT NULL,

    CONSTRAINT "usuario_estado_produccion_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "planificacion_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "area" TEXT NOT NULL DEFAULT 'TERMOLAMINADO',
    "tipo" "PlanificacionTipo" NOT NULL,
    "semana_inicio" DATE NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cliente" TEXT NOT NULL DEFAULT '',
    "n_tw" TEXT NOT NULL DEFAULT '',
    "n_orden" TEXT,
    "modelo" TEXT,
    "color" TEXT,
    "fabrica" DATE,
    "fecha_limite" DATE,
    "distribuidor" TEXT,
    "ticket" TEXT,
    "tipo_reclamo" TEXT,
    "compromiso" DATE,
    "finalizado_en" DATE,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "planificacion_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planificacion_marca" (
    "item_id" UUID NOT NULL,
    "estado_id" UUID NOT NULL,
    "marcado_por" TEXT NOT NULL,
    "marcado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planificacion_marca_pkey" PRIMARY KEY ("item_id","estado_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_operario_usuario_id_nombre_key" ON "usuario_operario"("usuario_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "estado_produccion_nombre_key" ON "estado_produccion"("nombre");

-- CreateIndex
CREATE INDEX "usuario_estado_produccion_estado_id_idx" ON "usuario_estado_produccion"("estado_id");

-- CreateIndex
CREATE INDEX "planificacion_item_area_semana_inicio_tipo_idx" ON "planificacion_item"("area", "semana_inicio", "tipo");

-- AddForeignKey
ALTER TABLE "usuario_operario" ADD CONSTRAINT "usuario_operario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_estado_produccion" ADD CONSTRAINT "usuario_estado_produccion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_estado_produccion" ADD CONSTRAINT "usuario_estado_produccion_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estado_produccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planificacion_marca" ADD CONSTRAINT "planificacion_marca_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "planificacion_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planificacion_marca" ADD CONSTRAINT "planificacion_marca_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estado_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Los operarios del área pasan a ser por usuario: se copian a termolaminado1 (si existe; los usuarios se cargan a mano).
INSERT INTO "usuario_operario" ("usuario_id", "nombre", "orden")
SELECT u."id", o."nombre", o."orden" FROM "usuario" u CROSS JOIN "area_operario" o WHERE u."nombre" = 'termolaminado1';

-- La planificación por archivo (PDF/imagen) se reemplaza por la planificación cargada por sistema. Ambas tablas
-- son de esta misma feature (todavía no llegaron a producción).
-- DropTable
DROP TABLE "area_operario";

-- DropTable
DROP TABLE "planificacion_semanal";
