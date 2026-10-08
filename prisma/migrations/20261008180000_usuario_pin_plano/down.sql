-- Reversión manual (Prisma no tiene "down"). OJO: los valores ya cargados son PIN en
-- texto plano, no hashes; para volver al esquema anterior habría que regenerarlos.
-- Después: DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%usuario_pin_plano';
ALTER INDEX "usuario_pin_key" RENAME TO "usuario_pin_hash_key";
ALTER TABLE "usuario" RENAME COLUMN "pin" TO "pin_hash";
