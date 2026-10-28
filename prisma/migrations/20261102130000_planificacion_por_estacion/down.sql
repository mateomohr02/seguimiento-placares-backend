-- Revierte 20261102130000_planificacion_por_estacion. Después, borrar su fila de _prisma_migrations
-- (DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261102130000_planificacion_por_estacion';).
--
-- Recrea la estructura vieja de planificacion_item (area, cliente, n_tw, n_orden, fabrica, fecha_limite) y restaura lo que se pueda:
--  * cliente = pedido.referencia, n_tw = pedido.codigo_pedido, n_orden = numeroOrdenCustom de la orden del pedido.
--  * En PEDIDOS, fecha_limite = compromiso y compromiso queda vacío (así los usaba el modelo viejo).
--  * area = 'TERMOLAMINADO' en todas las filas (aunque haya filas de varias estaciones: se juntan en una sola lista).
-- NO se puede restaurar:
--  * "fabrica" (la fecha de fábrica de los pedidos) se perdió: queda vacía.
--  * Las filas sin pedido que la migración borró lógicamente siguen borradas (no se distinguen de las borradas por un usuario) y,
--    como ya habían perdido cliente/n_tw/n_orden al migrar, vuelven con esos campos vacíos.
--  * El pedido_id de las filas ya borradas sin pedido (nulo) no existía antes; el orden de la cartera (orden.posicion) se pierde:
--    el listado vuelve a ordenarse por fecha de creación, más nuevas primero.
--  * La estación "Termolaminado" que creó la migración NO se borra (puede tener usuarios o planillas); solo se le quita la
--    plantilla de planificación. Si no se usa, se puede desactivar o borrar a mano.

ALTER TABLE "planificacion_item"
  ADD COLUMN "area" TEXT NOT NULL DEFAULT 'TERMOLAMINADO',
  ADD COLUMN "cliente" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "n_tw" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "n_orden" TEXT,
  ADD COLUMN "fabrica" DATE,
  ADD COLUMN "fecha_limite" DATE;

UPDATE "planificacion_item" i
SET "cliente" = p."referencia", "n_tw" = p."codigo_pedido", "n_orden" = o."numeroOrdenCustom"
FROM "pedido" p
JOIN "orden" o ON o."id" = p."orden_id"
WHERE p."id" = i."pedido_id";

UPDATE "planificacion_item" SET "fecha_limite" = "compromiso", "compromiso" = NULL WHERE "tipo" = 'PEDIDOS';

CREATE INDEX "planificacion_item_area_semana_inicio_tipo_idx" ON "planificacion_item"("area", "semana_inicio", "tipo");

DROP INDEX "planificacion_item_estacion_id_semana_inicio_tipo_orden_idx";
DROP INDEX "planificacion_item_pedido_id_idx";
ALTER TABLE "planificacion_item" DROP CONSTRAINT "planificacion_item_estacion_id_fkey";
ALTER TABLE "planificacion_item" DROP CONSTRAINT "planificacion_item_pedido_id_fkey";
ALTER TABLE "planificacion_item" DROP COLUMN "estacion_id", DROP COLUMN "pedido_id";

DROP INDEX "orden_posicion_idx";
ALTER TABLE "orden" DROP COLUMN "posicion";

ALTER TABLE "estacion_trabajo" DROP COLUMN "plantilla_planificacion";
DROP TYPE "PlantillaPlanificacion";
