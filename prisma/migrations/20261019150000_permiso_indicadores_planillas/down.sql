-- Revierte 20261019150000_permiso_indicadores_planillas. Después, borrar su fila de _prisma_migrations.
DELETE FROM "rol_permiso" WHERE "permiso_clave" = 'planillas.indicadores';
DELETE FROM "permiso" WHERE "clave" = 'planillas.indicadores';
