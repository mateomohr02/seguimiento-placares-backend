-- Permiso para ver los indicadores de producción de Termolaminado (solo admin, tecnica y gerencia).
INSERT INTO "permiso" ("clave", "descripcion") VALUES
  ('planillas.indicadores', 'Ver los indicadores de producción de las planillas de Termolaminado');

INSERT INTO "rol_permiso" ("rol_id", "permiso_clave")
SELECT r."id", 'planillas.indicadores' FROM "rol" r WHERE r."nombre" IN ('admin', 'tecnica', 'gerencia');
