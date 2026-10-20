-- Revierte 20261019120000_seguimiento_termolaminado (borra solo lo que agregó). Después,
-- borrar su fila de _prisma_migrations.
DELETE FROM "rol_permiso" WHERE "permiso_clave" IN ('planillas.completar','planillas.ver','planillas.configurar');
DELETE FROM "permiso" WHERE "clave" IN ('planillas.completar','planillas.ver','planillas.configurar');
DROP TABLE "planificacion_semanal";
DROP TABLE "area_operario";
DROP TABLE "planilla_version";
DROP TABLE "planilla_foto";
DROP TABLE "planilla_fila";
DROP TABLE "planilla_produccion";
DROP TYPE "PlanificacionTipo";
DROP TYPE "PlanillaEstado";
DROP TYPE "PlanillaEstacion";
