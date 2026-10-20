-- Línea de producto por módulo (extensión a cocinas). Aditiva: los módulos existentes son todos de
-- placares (hasta ahora solo se sincronizaba el catálogo 4), así que se rellenan con PLACARES.
CREATE TYPE "LineaProducto" AS ENUM ('PLACARES', 'COCINAS');

ALTER TABLE "modulo" ADD COLUMN "linea" "LineaProducto" NOT NULL DEFAULT 'PLACARES';

-- Sin default: el sync asigna la línea explícitamente al crear cada módulo.
ALTER TABLE "modulo" ALTER COLUMN "linea" DROP DEFAULT;
