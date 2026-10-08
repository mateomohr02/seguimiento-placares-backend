-- Reversión manual (Prisma no tiene "down"). Solo elimina lo que creó esta migración.
-- Después: DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%documento_pedido';
DROP TABLE IF EXISTS "documento_pedido_anotacion";
DROP TABLE IF EXISTS "documento_pedido";
DROP TYPE IF EXISTS "DocumentoPedidoTipo";
