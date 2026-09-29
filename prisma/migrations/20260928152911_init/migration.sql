-- CreateEnum
CREATE TYPE "OrdenEstado" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'LISTA', 'ELIMINADO');

-- CreateEnum
CREATE TYPE "PedidoEstado" AS ENUM ('PENDIENTE', 'EN_PRODUCCION', 'FINALIZADO', 'ELIMINADO');

-- CreateEnum
CREATE TYPE "ModuloEstado" AS ENUM ('PENDIENTE', 'EN_PRODUCCION', 'FINALIZADO', 'ELIMINADO');

-- CreateEnum
CREATE TYPE "DespieceTipoEstado" AS ENUM ('PENDIENTE', 'EN_PRODUCCION', 'FINALIZADO', 'ELIMINADO');

-- CreateEnum
CREATE TYPE "PiezaFisicaEstado" AS ENUM ('PENDIENTE', 'CORTADA', 'ELIMINADA');

-- CreateTable
CREATE TABLE "orden" (
    "id" SERIAL NOT NULL,
    "codigoOrdenFabricacion" INTEGER NOT NULL,
    "numeroOrdenCustom" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "OrdenEstado" NOT NULL DEFAULT 'PENDIENTE',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "orden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id" SERIAL NOT NULL,
    "orden_id" INTEGER NOT NULL,
    "codigo_pedido" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "nombreComercial" TEXT NOT NULL,
    "estado" "PedidoEstado" NOT NULL DEFAULT 'PENDIENTE',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulo" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "idEscena" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "ModuloEstado" NOT NULL DEFAULT 'PENDIENTE',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "modulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despiece_tipo" (
    "id" SERIAL NOT NULL,
    "modulo_id" INTEGER NOT NULL,
    "familia" TEXT NOT NULL,
    "articulo" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "medida1" DECIMAL(65,30) NOT NULL,
    "medida2" DECIMAL(65,30) NOT NULL,
    "medida3" DECIMAL(65,30) NOT NULL,
    "idCatalogo" INTEGER NOT NULL,
    "unidades" INTEGER NOT NULL,
    "estado" "DespieceTipoEstado" NOT NULL DEFAULT 'PENDIENTE',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "despiece_tipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieza_fisica" (
    "id" SERIAL NOT NULL,
    "despiece_tipo_id" INTEGER NOT NULL,
    "idUnico" INTEGER,
    "estado" "PiezaFisicaEstado" NOT NULL DEFAULT 'PENDIENTE',
    "escaneado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "pieza_fisica_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo" ADD CONSTRAINT "modulo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despiece_tipo" ADD CONSTRAINT "despiece_tipo_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieza_fisica" ADD CONSTRAINT "pieza_fisica_despiece_tipo_id_fkey" FOREIGN KEY ("despiece_tipo_id") REFERENCES "despiece_tipo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (parcial, no expresable en schema.prisma — ver diseño.md sección 8.3)
CREATE UNIQUE INDEX "ux_orden_codigoordenfabricacion_vigente"
    ON "orden" ("codigoOrdenFabricacion") WHERE "estado" <> 'ELIMINADO';

-- CreateIndex (parcial, no expresable en schema.prisma — ver diseño.md sección 8.3)
CREATE UNIQUE INDEX "ux_piezafisica_idunico_vigente"
    ON "pieza_fisica" ("idUnico") WHERE "idUnico" IS NOT NULL AND "estado" <> 'ELIMINADA';
