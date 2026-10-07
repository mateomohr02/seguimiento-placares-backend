-- Reversión manual (Prisma no tiene "down"). Solo elimina lo que creó esta migración.
-- Después: DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%plano_pedido';
DROP TABLE IF EXISTS "plano_pedido_anotacion";
DROP TABLE IF EXISTS "plano_pedido";
