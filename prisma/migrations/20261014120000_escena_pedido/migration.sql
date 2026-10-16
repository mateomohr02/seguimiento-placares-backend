-- CreateTable
CREATE TABLE "escena_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "escena" JSONB NOT NULL,
    "parser_version" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "escena_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escena_pedido_pedido_id_idx" ON "escena_pedido"("pedido_id");

-- AddForeignKey
ALTER TABLE "escena_pedido" ADD CONSTRAINT "escena_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
