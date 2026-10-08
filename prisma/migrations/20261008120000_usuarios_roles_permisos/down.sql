-- Reversión manual (Prisma no tiene "down"). Solo elimina lo que creó esta migración
-- (incluidos los usuarios cargados a mano: hacer backup antes si los hay).
-- Después: DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%usuarios_roles_permisos';
DROP TABLE IF EXISTS "usuario";
DROP TABLE IF EXISTS "rol_permiso";
DROP TABLE IF EXISTS "permiso";
DROP TABLE IF EXISTS "rol";
