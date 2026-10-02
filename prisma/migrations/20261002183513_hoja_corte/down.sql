-- Reversión manual (Prisma no tiene "down"). Solo elimina lo que creó esta migración.
-- Uso:  psql -d Neostone -f down.sql   y luego:
--       DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%hoja_corte';
DROP TABLE IF EXISTS "hoja_corte";
