-- Cambia las claves sustitutas (id) de Int autoincremental a UUID real,
-- preservando filas y relaciones existentes (no es un DROP/CREATE — Prisma
-- Migrate no puede generar esto solo porque no hay cast Int->UUID posible).
--
-- Estrategia por tabla, en orden padre -> hijo:
--   1. Agregar columna "id_new" UUID con gen_random_uuid() para cada fila existente.
--   2. En las tablas hijas, agregar la FK nueva ("<fk>_new") resuelta por join
--      contra el id_new del padre (no por posición, por igualdad de id viejo).
--   3. Soltar constraints viejas (FK, luego PK).
--   4. Soltar columnas viejas, renombrar las nuevas a su nombre final.
--   5. Recrear PK y FKs con los nombres de constraint originales.
--   6. Dejar gen_random_uuid() como DEFAULT de "id" para las filas futuras.
--
-- gen_random_uuid() es nativo desde PostgreSQL 13, no requiere pgcrypto.

-- 1) Nuevas columnas UUID en cada tabla
ALTER TABLE "orden" ADD COLUMN "id_new" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "pedido" ADD COLUMN "id_new" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "modulo" ADD COLUMN "id_new" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "despiece_tipo" ADD COLUMN "id_new" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "pieza_fisica" ADD COLUMN "id_new" UUID NOT NULL DEFAULT gen_random_uuid();

-- 2) Nuevas FKs resueltas contra el id_new del padre
ALTER TABLE "pedido" ADD COLUMN "orden_id_new" UUID;
UPDATE "pedido" p SET "orden_id_new" = o."id_new" FROM "orden" o WHERE o."id" = p."orden_id";
ALTER TABLE "pedido" ALTER COLUMN "orden_id_new" SET NOT NULL;

ALTER TABLE "modulo" ADD COLUMN "pedido_id_new" UUID;
UPDATE "modulo" m SET "pedido_id_new" = p."id_new" FROM "pedido" p WHERE p."id" = m."pedido_id";
ALTER TABLE "modulo" ALTER COLUMN "pedido_id_new" SET NOT NULL;

ALTER TABLE "despiece_tipo" ADD COLUMN "modulo_id_new" UUID;
UPDATE "despiece_tipo" d SET "modulo_id_new" = m."id_new" FROM "modulo" m WHERE m."id" = d."modulo_id";
ALTER TABLE "despiece_tipo" ALTER COLUMN "modulo_id_new" SET NOT NULL;

ALTER TABLE "pieza_fisica" ADD COLUMN "despiece_tipo_id_new" UUID;
UPDATE "pieza_fisica" pf SET "despiece_tipo_id_new" = dt."id_new" FROM "despiece_tipo" dt WHERE dt."id" = pf."despiece_tipo_id";
ALTER TABLE "pieza_fisica" ALTER COLUMN "despiece_tipo_id_new" SET NOT NULL;

-- 3) Soltar FKs viejas (hijo -> padre) y luego PKs viejas
ALTER TABLE "pieza_fisica" DROP CONSTRAINT "pieza_fisica_despiece_tipo_id_fkey";
ALTER TABLE "despiece_tipo" DROP CONSTRAINT "despiece_tipo_modulo_id_fkey";
ALTER TABLE "modulo" DROP CONSTRAINT "modulo_pedido_id_fkey";
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_orden_id_fkey";

ALTER TABLE "pieza_fisica" DROP CONSTRAINT "pieza_fisica_pkey";
ALTER TABLE "despiece_tipo" DROP CONSTRAINT "despiece_tipo_pkey";
ALTER TABLE "modulo" DROP CONSTRAINT "modulo_pkey";
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_pkey";
ALTER TABLE "orden" DROP CONSTRAINT "orden_pkey";

-- 4) Soltar columnas Int viejas, renombrar las UUID nuevas a su nombre final
ALTER TABLE "orden" DROP COLUMN "id";
ALTER TABLE "orden" RENAME COLUMN "id_new" TO "id";

ALTER TABLE "pedido" DROP COLUMN "id";
ALTER TABLE "pedido" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "pedido" DROP COLUMN "orden_id";
ALTER TABLE "pedido" RENAME COLUMN "orden_id_new" TO "orden_id";

ALTER TABLE "modulo" DROP COLUMN "id";
ALTER TABLE "modulo" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "modulo" DROP COLUMN "pedido_id";
ALTER TABLE "modulo" RENAME COLUMN "pedido_id_new" TO "pedido_id";

ALTER TABLE "despiece_tipo" DROP COLUMN "id";
ALTER TABLE "despiece_tipo" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "despiece_tipo" DROP COLUMN "modulo_id";
ALTER TABLE "despiece_tipo" RENAME COLUMN "modulo_id_new" TO "modulo_id";

ALTER TABLE "pieza_fisica" DROP COLUMN "id";
ALTER TABLE "pieza_fisica" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "pieza_fisica" DROP COLUMN "despiece_tipo_id";
ALTER TABLE "pieza_fisica" RENAME COLUMN "despiece_tipo_id_new" TO "despiece_tipo_id";

-- 5) Recrear PKs y FKs con los nombres originales
ALTER TABLE "orden" ADD CONSTRAINT "orden_pkey" PRIMARY KEY ("id");
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_pkey" PRIMARY KEY ("id");
ALTER TABLE "modulo" ADD CONSTRAINT "modulo_pkey" PRIMARY KEY ("id");
ALTER TABLE "despiece_tipo" ADD CONSTRAINT "despiece_tipo_pkey" PRIMARY KEY ("id");
ALTER TABLE "pieza_fisica" ADD CONSTRAINT "pieza_fisica_pkey" PRIMARY KEY ("id");

ALTER TABLE "pedido" ADD CONSTRAINT "pedido_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modulo" ADD CONSTRAINT "modulo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "despiece_tipo" ADD CONSTRAINT "despiece_tipo_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pieza_fisica" ADD CONSTRAINT "pieza_fisica_despiece_tipo_id_fkey" FOREIGN KEY ("despiece_tipo_id") REFERENCES "despiece_tipo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) Default para filas futuras (Prisma también manda el valor explícito en el
-- INSERT, pero conviene que la base lo pueda generar sola igual)
ALTER TABLE "orden" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "pedido" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "modulo" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "despiece_tipo" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "pieza_fisica" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
