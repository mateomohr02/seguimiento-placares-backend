-- CreateTable
CREATE TABLE "plano_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "modulo_id" UUID,
    "nombre" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "plano_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_pedido_anotacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plano_pedido_id" UUID NOT NULL,
    "pagina" INTEGER,
    "tipo" "AnotacionTipo" NOT NULL,
    "datos" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "plano_pedido_anotacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plano_pedido_pedido_id_idx" ON "plano_pedido"("pedido_id");

-- CreateIndex
CREATE INDEX "plano_pedido_anotacion_plano_pedido_id_idx" ON "plano_pedido_anotacion"("plano_pedido_id");

-- AddForeignKey
ALTER TABLE "plano_pedido" ADD CONSTRAINT "plano_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_pedido" ADD CONSTRAINT "plano_pedido_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_pedido_anotacion" ADD CONSTRAINT "plano_pedido_anotacion_plano_pedido_id_fkey" FOREIGN KEY ("plano_pedido_id") REFERENCES "plano_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
