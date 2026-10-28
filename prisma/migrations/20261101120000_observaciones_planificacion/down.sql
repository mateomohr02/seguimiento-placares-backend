-- Revierte 20261101120000_observaciones_planificacion. Después, borrar su fila de _prisma_migrations.
-- OJO: se pierden todas las observaciones de los usuarios en la planificación y su historial.

DROP TABLE "planificacion_observacion_historial";
DROP TABLE "planificacion_observacion";
