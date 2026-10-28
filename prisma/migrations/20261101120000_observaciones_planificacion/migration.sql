-- Observaciones de los usuarios en la planificación (diseño.md §14.13). Aditiva y sin tocar datos: cada fila de la
-- planificación puede tener varias observaciones, cada una con su autor, y un historial de altas, ediciones y bajas.
-- La observación de técnica (planificacion_item.observaciones) no cambia.

CREATE TABLE "planificacion_observacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "usuario_id" UUID,
    "autor" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editado_en" TIMESTAMP(3),
    "eliminado_en" TIMESTAMP(3),
    "eliminado_por" TEXT,

    CONSTRAINT "planificacion_observacion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "planificacion_observacion_item_id_idx" ON "planificacion_observacion"("item_id");
ALTER TABLE "planificacion_observacion" ADD CONSTRAINT "planificacion_observacion_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "planificacion_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planificacion_observacion" ADD CONSTRAINT "planificacion_observacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Historial: una fila por alta (CREADA), edición (EDITADA, con el texto nuevo) y baja (ELIMINADA, con el texto vigente).
CREATE TABLE "planificacion_observacion_historial" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observacion_id" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "por" TEXT NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planificacion_observacion_historial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "planificacion_observacion_historial_observacion_id_idx" ON "planificacion_observacion_historial"("observacion_id");
ALTER TABLE "planificacion_observacion_historial" ADD CONSTRAINT "planificacion_observacion_historial_observacion_id_fkey" FOREIGN KEY ("observacion_id") REFERENCES "planificacion_observacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
