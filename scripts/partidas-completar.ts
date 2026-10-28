// Completa la «Partida» de TeoWin (detalle del presupuesto) de los módulos ya cargados que no la tienen.
//   npm run partidas:completar            (solo los módulos sin partida; no pisa lo ya cargado)
//   npm run partidas:completar -- --forzar (vuelve a leer y sobrescribe también las ya cargadas)
//   npm run partidas:completar -- --orden=264200008 (solo esa orden)
// Usa DATABASE_URL del .env (órdenes no eliminadas). TeoWin: solo SELECT, una consulta por orden.
import { prisma } from "../src/config/prisma";
import { fetchPartidasDeOrden } from "../src/modules/sync/teowin-orden.queries";
import { partidaDesdeRow } from "../src/modules/sync/partida";

async function main() {
  const forzar = process.argv.includes("--forzar");
  const soloOrden = process.argv.find((x) => x.startsWith("--orden="))?.slice(8);
  const ordenes = await prisma.orden.findMany({
    where: { estado: { not: "ELIMINADO" }, ...(soloOrden ? { codigoOrdenFabricacion: Number(soloOrden) } : {}) },
    orderBy: { codigoOrdenFabricacion: "asc" },
    select: {
      id: true,
      codigoOrdenFabricacion: true,
      pedidos: {
        where: { estado: { not: "ELIMINADO" } },
        select: {
          codigo_pedido: true,
          modulos: {
            where: { estado: { not: "ELIMINADO" }, ...(forzar ? {} : { partida: { is: null } }) },
            select: { id: true, idEscena: true },
          },
        },
      },
    },
  });
  console.log(`${ordenes.length} orden(es) vigente(s)${forzar ? " (--forzar)" : ""}`);

  let completadas = 0;
  let sinPartida = 0;
  let errores = 0;
  for (const o of ordenes) {
    const pendientes = o.pedidos.reduce((n, p) => n + p.modulos.length, 0);
    if (pendientes === 0) continue;
    try {
      const filas = new Map((await fetchPartidasDeOrden(o.codigoOrdenFabricacion)).map((r) => [`${r.pedido}|${r.modulo_id}`, r]));
      let ok = 0;
      let sin = 0;
      for (const p of o.pedidos) {
        for (const m of p.modulos) {
          const fila = filas.get(`${p.codigo_pedido}|${m.idEscena}`);
          if (!fila) {
            sin++;
            continue;
          }
          const datos = partidaDesdeRow(fila);
          await prisma.moduloPartida.upsert({
            where: { modulo_id: m.id },
            create: { modulo_id: m.id, ...datos },
            update: datos,
          });
          ok++;
        }
      }
      completadas += ok;
      sinPartida += sin;
      console.log(`orden ${o.codigoOrdenFabricacion}: ${ok} completada(s)${sin ? `, ${sin} sin partida en TeoWin` : ""}`);
    } catch (err) {
      errores++;
      console.error(`ERROR orden ${o.codigoOrdenFabricacion}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Resumen: ${completadas} partida(s) completada(s), ${sinPartida} módulo(s) sin partida en TeoWin, ${errores} error(es).`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
