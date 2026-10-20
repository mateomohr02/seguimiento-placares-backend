-- Revierte 20261021150000_operarios_predeterminados_por_planilla. Después, borrar su fila de _prisma_migrations.
ALTER TABLE "usuario_planilla" DROP COLUMN "operarios_predeterminados";
