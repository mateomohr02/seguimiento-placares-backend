// Re-interpreta las escenas 3D guardadas con la versión actual del intérprete, desde el .3d original que
// está en la base (diseño.md §13): no hace falta volver a subirlas.
//   npm run escenas3d:reinterpretar            (solo las de una versión anterior)
//   npm run escenas3d:reinterpretar -- --todas (todas)
//   npm run escenas3d:reinterpretar -- --nombre=26-02568 (solo las que se llamen así)
// Usa DATABASE_URL del .env. Después copia a la base las texturas que falten.
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { interpretarEscena3D, PARSER_VERSION } from "../src/modules/escenas-pedido/parser/escena-3d.parser";
import { asegurarTexturas } from "../src/modules/texturas-3d/texturas-3d.service";

async function main() {
  const nombre = process.argv.find((x) => x.startsWith("--nombre="))?.slice(9);
  const todas = process.argv.includes("--todas") || nombre !== undefined;
  const escenas = await prisma.escenaPedido.findMany({
    where: {
      eliminado_en: null,
      ...(todas ? {} : { parser_version: { lt: PARSER_VERSION } }),
      ...(nombre ? { nombre } : {}),
    },
    select: { id: true, nombre: true },
  });
  console.log(`${escenas.length} escena(s) para re-interpretar (versión ${PARSER_VERSION})`);
  for (const { id, nombre } of escenas) {
    // De a una: el original pesa varios MB.
    const e = await prisma.escenaPedido.findUnique({ where: { id }, select: { contenido: true } });
    if (!e) continue;
    try {
      const escena = interpretarEscena3D(Buffer.from(e.contenido).toString("latin1"));
      await prisma.escenaPedido.update({
        where: { id },
        data: { escena: escena as unknown as Prisma.InputJsonValue, parser_version: PARSER_VERSION },
      });
      await asegurarTexturas(escena.materiales);
      console.log(`ok  ${nombre} (${id}): ${escena.cajas.length} cajas, ${escena.mallas.length} mallas`);
    } catch (err) {
      console.error(`ERROR ${nombre} (${id}):`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
