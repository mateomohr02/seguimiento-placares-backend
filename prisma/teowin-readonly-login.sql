-- diseño.md §5.1 — login de SQL Server para el backend, acotado a SELECT.
-- Correr como administrador contra la instancia que aloja TeoWin, no como
-- parte de la app (esta app nunca escribe en TeoWin, ni siquiera esto).
-- Reemplazar 'CAMBIAR_PASSWORD' por una contraseña real antes de correr.

USE master;
CREATE LOGIN seguimiento_placares_ro WITH PASSWORD = 'CAMBIAR_PASSWORD';

USE TeoWin;
CREATE USER seguimiento_placares_ro FOR LOGIN seguimiento_placares_ro;

-- Solo lectura sobre el schema por default (dbo). Sin INSERT/UPDATE/DELETE,
-- sin pertenencia a db_datawriter/db_owner.
ALTER ROLE db_datareader ADD MEMBER seguimiento_placares_ro;

-- Verificación rápida (debería devolver solo el rol SELECT/db_datareader):
-- SELECT dp.name AS login, r.name AS rol
-- FROM sys.database_role_members drm
-- JOIN sys.database_principals dp ON dp.principal_id = drm.member_principal_id
-- JOIN sys.database_principals r ON r.principal_id = drm.role_principal_id
-- WHERE dp.name = 'seguimiento_placares_ro';
