-- Reversión manual (Prisma no tiene "down"). Solo elimina lo que creó esta migración.
-- Después: DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%hoja_corte_anotacion';
DROP TABLE IF EXISTS "hoja_corte_anotacion";
DROP TYPE IF EXISTS "AnotacionTipo";
