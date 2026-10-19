-- Revierte 20261020150000_estado_produccion_color. Después, borrar su fila de _prisma_migrations.
ALTER TABLE "estado_produccion" DROP COLUMN "color";
