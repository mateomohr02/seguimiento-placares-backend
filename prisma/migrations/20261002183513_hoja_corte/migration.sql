-- CreateTable
CREATE TABLE "hoja_corte" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orden_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "hoja_corte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hoja_corte_orden_id_idx" ON "hoja_corte"("orden_id");

-- AddForeignKey
ALTER TABLE "hoja_corte" ADD CONSTRAINT "hoja_corte_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
