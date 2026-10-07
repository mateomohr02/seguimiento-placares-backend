-- CreateEnum
CREATE TYPE "DocumentoPedidoTipo" AS ENUM ('NOTA_PEDIDO', 'DETALLE_REMISION', 'ESCANDALLO_PLACARES', 'HERRAJES_PLACARES', 'ACCESORIOS_PLACARES', 'HERRAJES_COCINAS', 'ACCESORIOS_COCINAS');

-- CreateTable
CREATE TABLE "documento_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "tipo" "DocumentoPedidoTipo" NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "documento_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_pedido_anotacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documento_pedido_id" UUID NOT NULL,
    "pagina" INTEGER,
    "tipo" "AnotacionTipo" NOT NULL,
    "datos" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "documento_pedido_anotacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documento_pedido_pedido_id_idx" ON "documento_pedido"("pedido_id");

-- CreateIndex
CREATE INDEX "documento_pedido_anotacion_documento_pedido_id_idx" ON "documento_pedido_anotacion"("documento_pedido_id");

-- AddForeignKey
ALTER TABLE "documento_pedido" ADD CONSTRAINT "documento_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_pedido_anotacion" ADD CONSTRAINT "documento_pedido_anotacion_documento_pedido_id_fkey" FOREIGN KEY ("documento_pedido_id") REFERENCES "documento_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
