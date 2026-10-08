-- El PIN pasa a guardarse en texto plano (decisión del usuario, diseño.md §12): se renombra
-- la columna y su índice único. No se pierden datos.
ALTER TABLE "usuario" RENAME COLUMN "pin_hash" TO "pin";
ALTER INDEX "usuario_pin_hash_key" RENAME TO "usuario_pin_key";
