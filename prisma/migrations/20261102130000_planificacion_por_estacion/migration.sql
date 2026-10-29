-- Planificaciones independientes de las estaciones.
--  1. Existe un catálogo de planificaciones (enum PlantillaPlanificacion: TERMOLAMINADO y CALIDAD). Las filas de planificacion_item
--     pertenecen a UNA planificación (columna `plantilla`), no a una estación. La estación tiene `plantilla_planificacion`
--     (nullable) = la planificación que se le ASIGNA: varias estaciones pueden tener la misma; sin asignar no ve ninguna.
--  2. planificacion_item pasa a tener `plantilla` y pedido_id (opcional). El cliente es TEXTO LIBRE (se conserva `cliente`);
--     `n_tw` (texto) es el N° de pedido tal cual y, si coincide exacto con un pedido vigente, la fila queda asociada (pedido_id);
--     `n_orden` (texto) solo se usa en filas SIN pedido (en las asociadas el N° de orden sale de la orden del pedido).
--  3. Pedidos: "Fecha compromiso" reemplaza a "Fábrica" y "Fecha límite".
--  4. Se eliminan los RECLAMOS de todos lados (filas, tipo, distribuidor, ticket, tipo_reclamo, finalizado_en y el enum
--     PlanificacionTipo). Calidad se planifica por día (lunes a sábado): columnas `dia` y `modulos`.
--  5. orden.posicion: lugar de cada orden en la cartera (la reordena técnica a mano).
--
-- MIGRA LA PLANIFICACIÓN VIEJA:
--  * NO se crea ni se toca ninguna estación: las que ya existan quedan como están (sin planificación asignada); el usuario les
--    asigna la planificación desde la configuración de estaciones. Nada en la planificación depende del nombre de una estación.
--  * TODAS las filas PEDIDOS pasan a la planificación TERMOLAMINADO (Calidad no existía) y conservan cliente / n_tw / n_orden. Las vigentes cuyo n_tw es igual a
--    pedido.codigo_pedido (coincidencia exacta; pedido y orden no eliminados; si hay más de uno, el más reciente) quedan
--    asociadas (pedido_id); las demás quedan SIN pedido (se ven con el aviso «pedido no encontrado»). Las ya borradas
--    lógicamente (eliminado_en) se mantienen como están.
--  * Las filas RECLAMOS se BORRAN físicamente (con sus marcas y observaciones, en cascada). Decisión del usuario.
--  * En PEDIDOS, compromiso toma el valor de fecha_limite cuando compromiso estaba vacío. "fabrica" se pierde.
-- Revertir: down.sql (restaura lo que se pueda; lo que se perdió está listado ahí).

-- 1. Catálogo de planificaciones y planificación asignada a cada estación (null = ninguna; no se asigna a ninguna estación acá).
CREATE TYPE "PlantillaPlanificacion" AS ENUM ('TERMOLAMINADO', 'CALIDAD');
ALTER TABLE "estacion_trabajo" ADD COLUMN "plantilla_planificacion" "PlantillaPlanificacion";

-- 2. Reclamos: se borran del todo (las marcas, observaciones y su historial se van en cascada).
DELETE FROM "planificacion_item" WHERE "tipo" = 'RECLAMOS';

-- 3. Columnas nuevas de la fila (`plantilla` queda NOT NULL al final, cuando todas las filas la tienen).
ALTER TABLE "planificacion_item" ADD COLUMN "plantilla" "PlantillaPlanificacion";
ALTER TABLE "planificacion_item" ADD COLUMN "pedido_id" UUID;
ALTER TABLE "planificacion_item" ADD COLUMN "dia" DATE;
ALTER TABLE "planificacion_item" ADD COLUMN "modulos" INTEGER;

-- Pedido de cada fila: coincidencia EXACTA n_tw = codigo_pedido, con pedido y orden no eliminados (solo las vigentes).
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
WHERE i."n_tw" = m."codigo_pedido" AND i."n_tw" <> '' AND i."eliminado_en" IS NULL;

-- Todas las filas (también las ya borradas) eran de Termolaminado: quedan en esa planificación.
UPDATE "planificacion_item" SET "plantilla" = 'TERMOLAMINADO';
ALTER TABLE "planificacion_item" ALTER COLUMN "plantilla" SET NOT NULL;

-- Pedidos: el compromiso toma la fecha límite cuando estaba vacío.
UPDATE "planificacion_item" SET "compromiso" = "fecha_limite" WHERE "compromiso" IS NULL AND "fecha_limite" IS NOT NULL;

-- 4. Claves foráneas e índices; se eliminan las columnas viejas (con ellas se va el índice (area, semana_inicio, tipo)).
ALTER TABLE "planificacion_item" ADD CONSTRAINT "planificacion_item_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "planificacion_item_plantilla_semana_inicio_dia_orden_idx" ON "planificacion_item"("plantilla", "semana_inicio", "dia", "orden");
CREATE INDEX "planificacion_item_pedido_id_idx" ON "planificacion_item"("pedido_id");

DROP INDEX IF EXISTS "planificacion_item_area_semana_inicio_tipo_idx";
ALTER TABLE "planificacion_item"
  DROP COLUMN "area",
  DROP COLUMN "tipo",
  DROP COLUMN "fabrica",
  DROP COLUMN "fecha_limite",
  DROP COLUMN "distribuidor",
  DROP COLUMN "ticket",
  DROP COLUMN "tipo_reclamo",
  DROP COLUMN "finalizado_en";
DROP TYPE "PlanificacionTipo";

-- 5. Posición de las órdenes en la cartera. Se conserva el orden que tenían (más nuevas primero: posicion 0 = la más nueva);
-- las órdenes que se agreguen desde ahora van al final (posicion = máxima + 1).
ALTER TABLE "orden" ADD COLUMN "posicion" INTEGER NOT NULL DEFAULT 0;
UPDATE "orden" o SET "posicion" = r."n"
FROM (SELECT "id", (ROW_NUMBER() OVER (ORDER BY "creado_en" DESC, "id") - 1)::int AS "n" FROM "orden") r
WHERE r."id" = o."id";
CREATE INDEX "orden_posicion_idx" ON "orden"("posicion");
