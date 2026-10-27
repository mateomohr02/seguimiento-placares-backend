-- Revierte 20261022120000_linea_producto_modulo. Después, borrar su fila de _prisma_migrations.
ALTER TABLE "modulo" DROP COLUMN "linea";
DROP TYPE "LineaProducto";
