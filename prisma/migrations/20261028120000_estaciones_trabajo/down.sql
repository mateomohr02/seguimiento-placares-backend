-- Revierte 20261028120000_estaciones_trabajo. Después, borrar su fila de _prisma_migrations.
-- Las tablas viejas (usuario_planilla, usuario_estado_produccion, usuario_operario) nunca se tocaron: al volver al
-- código anterior siguen con la configuración de antes de la migración.
-- OJO: lo cargado desde la app después de migrar se pierde (estaciones, asignaciones y apellidos), y para restaurar
-- la unicidad de `nombre` no puede haber dos usuarios con el mismo nombre (si los hay, renombrarlos antes).

-- 1) Se reactivan los usuarios que la migración convirtió en estación: mismo criterio que el backfill (rol fabrica
--    con configuración en las tablas viejas) y que tienen una estación con su mismo nombre. Si alguno ya estaba
--    inactivo antes de migrar, queda activo: revisarlo a mano.
UPDATE "usuario" u SET "activo" = true
FROM "rol" r
WHERE r."id" = u."rol_id" AND r."nombre" = 'fabrica'
  AND EXISTS (SELECT 1 FROM "estacion_trabajo" et WHERE et."nombre" = u."nombre")
  AND (EXISTS (SELECT 1 FROM "usuario_planilla" p WHERE p."usuario_id" = u."id")
    OR EXISTS (SELECT 1 FROM "usuario_estado_produccion" e WHERE e."usuario_id" = u."id")
    OR EXISTS (SELECT 1 FROM "usuario_operario" o WHERE o."usuario_id" = u."id"));

-- 2) Tablas nuevas.
DROP TABLE "usuario_estacion_trabajo";
DROP TABLE "estacion_trabajo_planilla";
DROP TABLE "estacion_trabajo";

-- 3) Unicidad vieja de `nombre` y sin apellido.
CREATE UNIQUE INDEX "usuario_nombre_key" ON "usuario"("nombre");
DROP INDEX "usuario_nombre_apellido_ci_key";
ALTER TABLE "usuario" DROP COLUMN "apellido";
