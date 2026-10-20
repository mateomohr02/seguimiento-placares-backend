-- Revierte 20261021120000_planilla_fila_borrado_logico. Después, borrar su fila de _prisma_migrations.
-- Ojo: las filas ya eliminadas lógicamente volverían a verse; borrarlas antes si no se quieren (DELETE FROM "planilla_fila" WHERE "eliminado_en" IS NOT NULL).
ALTER TABLE "planilla_fila" DROP COLUMN "eliminado_en";
