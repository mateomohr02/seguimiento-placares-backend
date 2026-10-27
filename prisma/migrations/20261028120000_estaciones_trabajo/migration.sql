-- Operarios por estación de trabajo (diseño.md §17). Aditiva: agrega `usuario.apellido`, cambia la unicidad del
-- nombre del usuario por (nombre, apellido) sin distinguir mayúsculas y crea las estaciones de trabajo. Las tablas
-- viejas (usuario_planilla, usuario_estado_produccion, usuario_operario) se CONSERVAN tal cual, sin uso.

-- 1) Apellido de la persona (los usuarios existentes quedan con '').
ALTER TABLE "usuario" ADD COLUMN "apellido" TEXT NOT NULL DEFAULT '';

-- 2) Unicidad: (nombre, apellido) sin distinguir mayúsculas. Primero se crea el índice nuevo (si hubiera nombres que
--    solo difieren en mayúsculas, falla acá y la migración entera se revierte sin perder nada) y recién después se
--    quita la unicidad vieja de `nombre`. Es un índice de expresión: no se puede declarar en schema.prisma.
CREATE UNIQUE INDEX "usuario_nombre_apellido_ci_key" ON "usuario" (lower("nombre"), lower("apellido"));
DROP INDEX "usuario_nombre_key";

-- 3) Estaciones de trabajo (no tienen login). Nombre único sin distinguir mayúsculas.
CREATE TABLE "estacion_trabajo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_id" UUID,

    CONSTRAINT "estacion_trabajo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "estacion_trabajo_nombre_ci_key" ON "estacion_trabajo" (lower("nombre"));
CREATE INDEX "estacion_trabajo_estado_id_idx" ON "estacion_trabajo"("estado_id");
ALTER TABLE "estacion_trabajo" ADD CONSTRAINT "estacion_trabajo_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estado_produccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Planillas de Termolaminado que se completan en la estación.
CREATE TABLE "estacion_trabajo_planilla" (
    "estacion_trabajo_id" UUID NOT NULL,
    "planilla" "PlanillaEstacion" NOT NULL,

    CONSTRAINT "estacion_trabajo_planilla_pkey" PRIMARY KEY ("estacion_trabajo_id","planilla")
);
ALTER TABLE "estacion_trabajo_planilla" ADD CONSTRAINT "estacion_trabajo_planilla_estacion_trabajo_id_fkey" FOREIGN KEY ("estacion_trabajo_id") REFERENCES "estacion_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Usuario (persona) <-> estación: muchos a muchos.
CREATE TABLE "usuario_estacion_trabajo" (
    "usuario_id" UUID NOT NULL,
    "estacion_trabajo_id" UUID NOT NULL,

    CONSTRAINT "usuario_estacion_trabajo_pkey" PRIMARY KEY ("usuario_id","estacion_trabajo_id")
);
CREATE INDEX "usuario_estacion_trabajo_estacion_trabajo_id_idx" ON "usuario_estacion_trabajo"("estacion_trabajo_id");
ALTER TABLE "usuario_estacion_trabajo" ADD CONSTRAINT "usuario_estacion_trabajo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usuario_estacion_trabajo" ADD CONSTRAINT "usuario_estacion_trabajo_estacion_trabajo_id_fkey" FOREIGN KEY ("estacion_trabajo_id") REFERENCES "estacion_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Datos: cada usuario de rol `fabrica` que hoy representa una estación (tiene planillas, estado de producción u
--    operarios configurados) pasa a ser una estación con el mismo nombre, sus planillas y su estado. Su usuario queda
--    inactivo (no se borra; deja de tener login). Las filas de usuario_operario NO se migran (no son personas con PIN).
CREATE TEMP TABLE "_usuarios_estacion" AS
SELECT u."id" AS "usuario_id", u."nombre", gen_random_uuid() AS "estacion_id"
FROM "usuario" u
JOIN "rol" r ON r."id" = u."rol_id"
WHERE r."nombre" = 'fabrica'
  AND (EXISTS (SELECT 1 FROM "usuario_planilla" p WHERE p."usuario_id" = u."id")
    OR EXISTS (SELECT 1 FROM "usuario_estado_produccion" e WHERE e."usuario_id" = u."id")
    OR EXISTS (SELECT 1 FROM "usuario_operario" o WHERE o."usuario_id" = u."id"));

INSERT INTO "estacion_trabajo" ("id", "nombre", "activa", "estado_id")
SELECT m."estacion_id", m."nombre", true, e."estado_id"
FROM "_usuarios_estacion" m
LEFT JOIN "usuario_estado_produccion" e ON e."usuario_id" = m."usuario_id";

INSERT INTO "estacion_trabajo_planilla" ("estacion_trabajo_id", "planilla")
SELECT m."estacion_id", p."estacion"
FROM "_usuarios_estacion" m
JOIN "usuario_planilla" p ON p."usuario_id" = m."usuario_id";

UPDATE "usuario" SET "activo" = false WHERE "id" IN (SELECT "usuario_id" FROM "_usuarios_estacion");

DROP TABLE "_usuarios_estacion";
