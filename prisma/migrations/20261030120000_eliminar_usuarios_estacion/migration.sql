-- Elimina las filas de `usuario` que eran ESTACIONES de trabajo en el modelo viejo (termolaminado1, Mecanizado1…) y que
-- la migración de estaciones dejó inactivas: activo = false, rol fabrica y nombre igual (sin distinguir mayúsculas) al de
-- una estacion_trabajo. Las FKs hacia `usuario` (usuario_planilla, usuario_operario, usuario_estado_produccion,
-- usuario_estacion_trabajo) son ON DELETE CASCADE (tablas viejas sin uso o de asignaciones); planilla_operario.usuario_id
-- es ON DELETE SET NULL (el nombre queda como historia). Las planillas guardan autores como texto, no FK.
DELETE FROM "usuario" u
USING "rol" r
WHERE r."id" = u."rol_id"
  AND r."nombre" = 'fabrica'
  AND u."activo" = false
  AND EXISTS (SELECT 1 FROM "estacion_trabajo" e WHERE lower(e."nombre") = lower(trim(u."nombre" || ' ' || u."apellido")));
