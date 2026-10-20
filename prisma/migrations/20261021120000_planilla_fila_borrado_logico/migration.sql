-- Borrado lógico de las filas de las planillas: al quitar un ítem de una planilla se conserva (con sus fotos) en vez de borrarse.
ALTER TABLE "planilla_fila" ADD COLUMN "eliminado_en" TIMESTAMP(3);
