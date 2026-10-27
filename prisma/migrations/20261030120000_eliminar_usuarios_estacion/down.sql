-- Revierte 20261030120000_eliminar_usuarios_estacion. NO restaura nada: las filas de `usuario` eliminadas (ni sus PIN,
-- ni sus filas en usuario_planilla / usuario_operario / usuario_estado_produccion / usuario_estacion_trabajo, borradas en
-- cascada) no se pueden recuperar desde acá; solo desde un respaldo previo. Después, borrar su fila de _prisma_migrations.
SELECT 1;
