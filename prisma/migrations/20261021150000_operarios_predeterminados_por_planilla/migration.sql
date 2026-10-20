-- Operarios que se preseleccionan al abrir una planilla nueva (por usuario y estación). NULL = todos los operarios del usuario.
ALTER TABLE "usuario_planilla" ADD COLUMN "operarios_predeterminados" JSONB;
