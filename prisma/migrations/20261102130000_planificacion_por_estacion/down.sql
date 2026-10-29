-- Revierte 20261102130000_planificacion_por_estacion. Después, borrar su fila de _prisma_migrations
-- (DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261102130000_planificacion_por_estacion';).
--
-- Recrea la estructura vieja de planificacion_item (area, tipo, fabrica, fecha_limite, distribuidor, ticket, tipo_reclamo,
-- finalizado_en y el enum PlanificacionTipo) y restaura lo que se pueda:
--  * Todas las filas que quedan (las de Termolaminado) vuelven como tipo PEDIDOS y area = 'TERMOLAMINADO'.
--  * cliente y n_tw se conservan tal cual; si cliente está vacío se completa con pedido.referencia. En las filas asociadas
--    a un pedido, n_tw = pedido.codigo_pedido y n_orden = numeroOrdenCustom de su orden.
--  * fecha_limite = compromiso y compromiso queda vacío (así los usaba el modelo viejo en PEDIDOS).
-- NO se puede restaurar:
--  * Las filas de la planificación CALIDAD (plantilla = 'CALIDAD' o con `dia`) se BORRAN físicamente, con sus marcas y
--    observaciones: el modelo viejo no tiene por día ni módulos. También se pierden `dia`, `modulos` y el vínculo
--    pedido_id (las filas conservan el N° TW como texto).
--  * Se pierde la planificación asignada a cada estación (se borra estacion_trabajo.plantilla_planificacion).
--  * Los RECLAMOS que la migración borró físicamente no vuelven. "fabrica" (la fecha de fábrica) se perdió: queda vacía.
--  * El orden de la cartera (orden.posicion) se pierde: el listado vuelve a ordenarse por fecha de creación, más nuevas primero.
--  * Las estaciones no se tocan, salvo por la columna plantilla_planificacion (que desaparece).

-- Calidad no existe en el modelo viejo: se borran sus filas (marcas y observaciones se van en cascada).
DELETE FROM "planificacion_item" WHERE "plantilla" = 'CALIDAD' OR "dia" IS NOT NULL;

CREATE TYPE "PlanificacionTipo" AS ENUM ('PEDIDOS', 'RECLAMOS');

ALTER TABLE "planificacion_item"
  ADD COLUMN "area" TEXT NOT NULL DEFAULT 'TERMOLAMINADO',
  ADD COLUMN "tipo" "PlanificacionTipo" NOT NULL DEFAULT 'PEDIDOS',
  ADD COLUMN "fabrica" DATE,
  ADD COLUMN "fecha_limite" DATE,
  ADD COLUMN "distribuidor" TEXT,
  ADD COLUMN "ticket" TEXT,
  ADD COLUMN "tipo_reclamo" TEXT,
  ADD COLUMN "finalizado_en" DATE;
ALTER TABLE "planificacion_item" ALTER COLUMN "tipo" DROP DEFAULT;

UPDATE "planificacion_item" i
SET "cliente" = CASE WHEN i."cliente" = '' THEN p."referencia" ELSE i."cliente" END,
    "n_tw" = p."codigo_pedido",
    "n_orden" = o."numeroOrdenCustom"
FROM "pedido" p
JOIN "orden" o ON o."id" = p."orden_id"
WHERE p."id" = i."pedido_id";

UPDATE "planificacion_item" SET "fecha_limite" = "compromiso", "compromiso" = NULL;

CREATE INDEX "planificacion_item_area_semana_inicio_tipo_idx" ON "planificacion_item"("area", "semana_inicio", "tipo");

DROP INDEX "planificacion_item_plantilla_semana_inicio_dia_orden_idx";
DROP INDEX "planificacion_item_pedido_id_idx";
ALTER TABLE "planificacion_item" DROP CONSTRAINT "planificacion_item_pedido_id_fkey";
ALTER TABLE "planificacion_item" DROP COLUMN "plantilla", DROP COLUMN "pedido_id", DROP COLUMN "dia", DROP COLUMN "modulos";

DROP INDEX "orden_posicion_idx";
ALTER TABLE "orden" DROP COLUMN "posicion";

ALTER TABLE "estacion_trabajo" DROP COLUMN "plantilla_planificacion";
DROP TYPE "PlantillaPlanificacion";
