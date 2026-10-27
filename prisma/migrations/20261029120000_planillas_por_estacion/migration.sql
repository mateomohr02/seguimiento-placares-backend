-- Planillas por estación de trabajo (diseño.md §17, fase 2). Aditiva: la planilla pasa a ser única por (estación de
-- trabajo, tipo, fecha) y registra los operarios (personas) que figuran en ella. Las tablas viejas (usuario_planilla,
-- usuario_operario, usuario_estado_produccion) se CONSERVAN; solo se vacía usuario_estado_produccion (ver 5).

-- 1) Estación de trabajo de cada planilla. Backfill: las planillas existentes pasan a la estación que tiene asignado
--    ese tipo de planilla. Si hay más de una, se elige la más antigua (creación y nombre) y se avisa; si ninguna estación
--    tiene el tipo, la migración se cancela entera (no se pierde nada).
ALTER TABLE "planilla_produccion" ADD COLUMN "estacion_trabajo_id" UUID;

DO $$
DECLARE
  r RECORD;
  elegida UUID;
  cuantas INT;
BEGIN
  FOR r IN SELECT DISTINCT "estacion" FROM "planilla_produccion" LOOP
    SELECT count(*) INTO cuantas FROM "estacion_trabajo_planilla" WHERE "planilla" = r."estacion";
    IF cuantas = 0 THEN
      RAISE EXCEPTION 'Hay planillas % pero ninguna estación de trabajo tiene ese tipo de planilla: asignalo antes de migrar.', r."estacion";
    END IF;
    IF cuantas > 1 THEN
      RAISE NOTICE 'Ambiguo: % estaciones de trabajo tienen planilla %; se usa la más antigua.', cuantas, r."estacion";
    END IF;
    SELECT et."id" INTO elegida
    FROM "estacion_trabajo" et JOIN "estacion_trabajo_planilla" p ON p."estacion_trabajo_id" = et."id"
    WHERE p."planilla" = r."estacion"
    ORDER BY et."creado_en", et."nombre" LIMIT 1;
    UPDATE "planilla_produccion" SET "estacion_trabajo_id" = elegida WHERE "estacion" = r."estacion";
  END LOOP;
END $$;

ALTER TABLE "planilla_produccion" ALTER COLUMN "estacion_trabajo_id" SET NOT NULL;
ALTER TABLE "planilla_produccion" ADD CONSTRAINT "planilla_produccion_estacion_trabajo_id_fkey" FOREIGN KEY ("estacion_trabajo_id") REFERENCES "estacion_trabajo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Unicidad: una planilla por estación de trabajo + tipo + día (antes: área + tipo + día). `area` se conserva.
CREATE UNIQUE INDEX "planilla_produccion_estacion_trabajo_id_estacion_fecha_key" ON "planilla_produccion"("estacion_trabajo_id", "estacion", "fecha");
DROP INDEX "planilla_produccion_area_estacion_fecha_key";
CREATE INDEX "planilla_produccion_estacion_trabajo_id_idx" ON "planilla_produccion"("estacion_trabajo_id");

-- 3) Operarios de cada planilla. `usuario_id` es null en los nombres históricos (texto libre de antes); `bloqueado`
--    indica los que no se pueden quitar al completarla (solo técnica/admin pueden corregirlo).
CREATE TABLE "planilla_operario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planilla_id" UUID NOT NULL,
    "usuario_id" UUID,
    "nombre" TEXT NOT NULL,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planilla_operario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "planilla_operario_planilla_id_usuario_id_key" ON "planilla_operario"("planilla_id", "usuario_id");
CREATE INDEX "planilla_operario_usuario_id_idx" ON "planilla_operario"("usuario_id");
ALTER TABLE "planilla_operario" ADD CONSTRAINT "planilla_operario_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planilla_operario" ADD CONSTRAINT "planilla_operario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Backfill: los nombres viejos de `operarios` quedan como historia (sin usuario, bloqueados).
INSERT INTO "planilla_operario" ("planilla_id", "usuario_id", "nombre", "bloqueado", "orden")
SELECT p."id", NULL, o."nombre", true, (o."n" - 1)::int
FROM "planilla_produccion" p, LATERAL unnest(p."operarios") WITH ORDINALITY AS o("nombre", "n");

-- 5) «Planificado»: el estado productivo ahora lo tiene la estación; las asignaciones viejas por usuario se limpian.
DELETE FROM "usuario_estado_produccion";
