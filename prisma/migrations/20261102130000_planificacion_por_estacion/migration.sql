-- Planificación por estación de trabajo.
--  1. Cada estación elige una "plantilla de planificación" (hoy solo TERMOLAMINADO); sin plantilla no tiene planificación.
--  2. La planificación se arma sobre pedidos ya cargados: planificacion_item pasa a tener estacion_id y pedido_id.
--     N° TW, cliente y N° de orden ya no se guardan en la fila: salen del pedido (codigo_pedido, referencia) y de su orden.
--  3. Pedidos: "Fecha compromiso" reemplaza a "Fábrica" y "Fecha límite".
--  4. orden.posicion: lugar de cada orden en la cartera (la reordena técnica a mano).
--
-- MIGRA LA PLANIFICACIÓN VIEJA y elimina las columnas viejas (area, cliente, n_tw, n_orden, fabrica, fecha_limite):
--  * Se crea la estación "Termolaminado" con la plantilla TERMOLAMINADO (si ya hay una estación con ese nombre, sin distinguir
--    mayúsculas, se le asigna la plantilla). No se asignan usuarios: los de fábrica la ven recién cuando técnica los agrega.
--  * Las filas vigentes que tienen pedido (n_tw igual a pedido.codigo_pedido, pedido y orden no eliminados) pasan a esa
--    estación con su pedido_id. Si hay más de un pedido con ese código, se toma el más reciente.
--  * Las filas vigentes SIN pedido se borran (borrado lógico, eliminado_en): decisión del usuario, "solo migro las que
--    tienen pedido". Quedan en la tabla, pero ya sin los datos viejos (cliente, n_tw...) que se eliminan.
--  * En PEDIDOS, compromiso toma el valor de fecha_limite cuando compromiso estaba vacío. "fabrica" se pierde.
-- Revertir: down.sql (restaura lo que se pueda; lo que se perdió está listado ahí).

-- 1. Plantilla de planificación de la estación.
CREATE TYPE "PlantillaPlanificacion" AS ENUM ('TERMOLAMINADO');
ALTER TABLE "estacion_trabajo" ADD COLUMN "plantilla_planificacion" "PlantillaPlanificacion";

-- Estación "Termolaminado" (la crea si no existe una con ese nombre, sin distinguir mayúsculas).
INSERT INTO "estacion_trabajo" ("nombre", "activa")
SELECT 'Termolaminado', true
WHERE NOT EXISTS (SELECT 1 FROM "estacion_trabajo" WHERE lower("nombre") = 'termolaminado');

UPDATE "estacion_trabajo" SET "plantilla_planificacion" = 'TERMOLAMINADO' WHERE lower("nombre") = 'termolaminado';

-- 2. Columnas nuevas de la fila (estacion_id queda NOT NULL al final, cuando todas las filas la tienen).
ALTER TABLE "planificacion_item" ADD COLUMN "estacion_id" UUID;
ALTER TABLE "planificacion_item" ADD COLUMN "pedido_id" UUID;

-- 3. Pedido de cada fila: coincidencia EXACTA n_tw = codigo_pedido, con pedido y orden no eliminados.
UPDATE "planificacion_item" i
SET "pedido_id" = m."pedido_id"
FROM (
  SELECT DISTINCT ON (p."codigo_pedido") p."codigo_pedido", p."id" AS "pedido_id"
  FROM "pedido" p
  JOIN "orden" o ON o."id" = p."orden_id"
  WHERE p."estado" <> 'ELIMINADO' AND p."eliminado_en" IS NULL
    AND o."estado" <> 'ELIMINADO' AND o."eliminado_en" IS NULL
  ORDER BY p."codigo_pedido", p."creado_en" DESC, p."id"
) m
WHERE i."n_tw" = m."codigo_pedido" AND i."n_tw" <> '';

-- Todas las filas (también las ya borradas) quedan en la estación Termolaminado.
UPDATE "planificacion_item"
SET "estacion_id" = (SELECT "id" FROM "estacion_trabajo" WHERE lower("nombre") = 'termolaminado' LIMIT 1);
ALTER TABLE "planificacion_item" ALTER COLUMN "estacion_id" SET NOT NULL;

-- Pedidos: el compromiso toma la fecha límite cuando estaba vacío.
UPDATE "planificacion_item" SET "compromiso" = "fecha_limite" WHERE "tipo" = 'PEDIDOS' AND "compromiso" IS NULL AND "fecha_limite" IS NOT NULL;

-- Las vigentes sin pedido se borran (borrado lógico).
UPDATE "planificacion_item" SET "eliminado_en" = CURRENT_TIMESTAMP WHERE "pedido_id" IS NULL AND "eliminado_en" IS NULL;

-- 4. Claves foráneas e índices; se eliminan las columnas viejas (con ellas se va el índice (area, semana_inicio, tipo)).
ALTER TABLE "planificacion_item" ADD CONSTRAINT "planificacion_item_estacion_id_fkey" FOREIGN KEY ("estacion_id") REFERENCES "estacion_trabajo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planificacion_item" ADD CONSTRAINT "planificacion_item_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "planificacion_item_estacion_id_semana_inicio_tipo_orden_idx" ON "planificacion_item"("estacion_id", "semana_inicio", "tipo", "orden");
CREATE INDEX "planificacion_item_pedido_id_idx" ON "planificacion_item"("pedido_id");

DROP INDEX IF EXISTS "planificacion_item_area_semana_inicio_tipo_idx";
ALTER TABLE "planificacion_item"
  DROP COLUMN "area",
  DROP COLUMN "cliente",
  DROP COLUMN "n_tw",
  DROP COLUMN "n_orden",
  DROP COLUMN "fabrica",
  DROP COLUMN "fecha_limite";

-- 5. Posición de las órdenes en la cartera. Se conserva el orden que tenían (más nuevas primero: posicion 0 = la más nueva);
-- las órdenes que se agreguen desde ahora van al final (posicion = máxima + 1).
ALTER TABLE "orden" ADD COLUMN "posicion" INTEGER NOT NULL DEFAULT 0;
UPDATE "orden" o SET "posicion" = r."n"
FROM (SELECT "id", (ROW_NUMBER() OVER (ORDER BY "creado_en" DESC, "id") - 1)::int AS "n" FROM "orden") r
WHERE r."id" = o."id";
CREATE INDEX "orden_posicion_idx" ON "orden"("posicion");
