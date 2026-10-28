-- Revierte 20261031120000_planilla_pvc_por_mesa. Después, borrar su fila de _prisma_migrations.
-- OJO: se pierde lo cargado en planilla_fila_pedido, mesa_tamano y mesa_cantidad (las tandas de PVC quedarían sin pedidos).

DROP TABLE "planilla_fila_pedido";
ALTER TABLE "planilla_fila" DROP COLUMN "mesa_cantidad";
ALTER TABLE "planilla_fila" DROP COLUMN "mesa_tamano";
DROP TYPE "mesa_tamano";
