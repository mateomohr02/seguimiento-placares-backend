-- Partida de TeoWin de cada módulo (1:1). Aditiva: tabla nueva y permiso nuevo; no toca nada existente.
CREATE TABLE "modulo_partida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "modulo_id" UUID NOT NULL,
    "unidades" DOUBLE PRECISION NOT NULL,
    "referencia" TEXT NOT NULL,
    "titulo" TEXT,
    "descripcion" TEXT NOT NULL,
    "largo" DOUBLE PRECISION,
    "alto" DOUBLE PRECISION,
    "profundidad" DOUBLE PRECISION,
    "capitulo" TEXT,
    "variantes" DOUBLE PRECISION,
    "precio_unitario" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modulo_partida_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modulo_partida_modulo_id_key" ON "modulo_partida"("modulo_id");

ALTER TABLE "modulo_partida" ADD CONSTRAINT "modulo_partida_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permiso para ver los importes de la partida (precio, total, variantes): solo gestión.
INSERT INTO "permiso" ("clave", "descripcion") VALUES
  ('modulos.precios', 'Ver los importes de la partida de un módulo (variantes, precio y total)');

INSERT INTO "rol_permiso" ("rol_id", "permiso_clave")
SELECT r."id", 'modulos.precios' FROM "rol" r WHERE r."nombre" IN ('admin', 'tecnica', 'gerencia');
