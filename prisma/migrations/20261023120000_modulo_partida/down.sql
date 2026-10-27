-- Revierte 20261023120000_modulo_partida. Después, borrar su fila de _prisma_migrations.
DELETE FROM "rol_permiso" WHERE "permiso_clave" = 'modulos.precios';
DELETE FROM "permiso" WHERE "clave" = 'modulos.precios';
DROP TABLE "modulo_partida";
