// Copia a la base todas las texturas de las carpetas de colores de TeoWin (diseño.md §13.5):
//   npm run texturas3d:sincronizar
// Usa TEOWIN_3D_DIR (por defecto T:/datos/3d/E_50) y DATABASE_URL del .env. Es idempotente.
import { sincronizarCatalogos } from "../src/modules/texturas-3d/texturas-3d.service";
import { prisma } from "../src/config/prisma";

sincronizarCatalogos((m) => console.log(m))
  .then((t) => console.log("Listo:", t))
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
