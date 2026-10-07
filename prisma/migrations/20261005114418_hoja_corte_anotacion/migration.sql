-- CreateEnum
CREATE TYPE "AnotacionTipo" AS ENUM ('TEXTO', 'DIBUJO');

-- CreateTable
CREATE TABLE "hoja_corte_anotacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hoja_corte_id" UUID NOT NULL,
    "pagina" INTEGER,
    "tipo" "AnotacionTipo" NOT NULL,
    "datos" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "hoja_corte_anotacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hoja_corte_anotacion_hoja_corte_id_idx" ON "hoja_corte_anotacion"("hoja_corte_id");

-- AddForeignKey
ALTER TABLE "hoja_corte_anotacion" ADD CONSTRAINT "hoja_corte_anotacion_hoja_corte_id_fkey" FOREIGN KEY ("hoja_corte_id") REFERENCES "hoja_corte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
