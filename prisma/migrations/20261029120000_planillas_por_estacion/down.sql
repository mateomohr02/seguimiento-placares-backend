-- Revierte 20261029120000_planillas_por_estacion. Después, borrar su fila de _prisma_migrations.
-- OJO: se pierde lo cargado en planilla_operario (la copia `operarios` de cada planilla se conserva). Las asignaciones
-- viejas de usuario_estado_produccion que la migración borró NO se pueden restaurar desde acá (ver el respaldo previo).
-- Para restaurar la unicidad (area, estacion, fecha) no puede haber dos planillas del mismo tipo y día en estaciones
-- de trabajo distintas (si las hay, unificarlas o borrar una antes).

DROP TABLE "planilla_operario";
CREATE UNIQUE INDEX "planilla_produccion_area_estacion_fecha_key" ON "planilla_produccion"("area", "estacion", "fecha");
DROP INDEX "planilla_produccion_estacion_trabajo_id_estacion_fecha_key";
DROP INDEX "planilla_produccion_estacion_trabajo_id_idx";
ALTER TABLE "planilla_produccion" DROP CONSTRAINT "planilla_produccion_estacion_trabajo_id_fkey";
ALTER TABLE "planilla_produccion" DROP COLUMN "estacion_trabajo_id";
