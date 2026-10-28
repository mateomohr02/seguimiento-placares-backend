-- Planilla de PVC por mesa (diseño.md §14.12). Aditiva y sin tocar datos: en PVC cada fila pasa a ser una TANDA DE MESAS
-- (tamaño + cantidad de mesas) con uno o más pedidos y las piezas de cada uno. `mesa_chica` / `mesa_grande` se CONSERVAN
-- en planilla_fila sin uso (la API ya no los expone).

CREATE TYPE "mesa_tamano" AS ENUM ('CHICA', 'GRANDE');

ALTER TABLE "planilla_fila" ADD COLUMN "mesa_tamano" "mesa_tamano";
ALTER TABLE "planilla_fila" ADD COLUMN "mesa_cantidad" INTEGER;

-- Pedidos de cada tanda. `pedido_id` sin FK, igual que planilla_fila.pedido_id (solo si el código coincide con un pedido sincronizado).
CREATE TABLE "planilla_fila_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fila_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "pedido_codigo" TEXT NOT NULL,
    "pedido_id" UUID,
    "cantidad_piezas" INTEGER NOT NULL,

    CONSTRAINT "planilla_fila_pedido_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "planilla_fila_pedido_fila_id_idx" ON "planilla_fila_pedido"("fila_id");
CREATE INDEX "planilla_fila_pedido_pedido_codigo_idx" ON "planilla_fila_pedido"("pedido_codigo");
ALTER TABLE "planilla_fila_pedido" ADD CONSTRAINT "planilla_fila_pedido_fila_id_fkey" FOREIGN KEY ("fila_id") REFERENCES "planilla_fila"("id") ON DELETE CASCADE ON UPDATE CASCADE;
