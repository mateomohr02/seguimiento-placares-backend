import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Cartera de órdenes (listado inicial, global): el orden lo define `orden.posicion` y lo ve todo el mundo igual. Técnica lo
// reordena arrastrando. `ids` son las órdenes visibles (todas o las de un filtro; vigentes o archivadas) en el orden nuevo:
// se reubican ENTRE SÍ, quedándose con los lugares (posiciones) que ocupaban, y el resto de la cartera no se mueve.
// Una orden nueva entra al final (ver sync-orden.service). Todo en una transacción, serializada con un lock de aplicación.
export async function reordenarOrdenes(ids: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('orden.posicion'))`;
    const filas = await tx.orden.findMany({ where: { id: { in: ids }, estado: { not: "ELIMINADO" } }, select: { id: true } });
    if (filas.length !== ids.length) {
      const hay = new Set(filas.map((f) => f.id));
      throw new AppError(`ids: ${ids.filter((i) => !hay.has(i)).length} orden(es) no existen o fueron eliminadas: recargá el listado.`, 400);
    }
    // Si por una carrera quedaron lugares repetidos, se renumera toda la cartera (sin cambiar su orden visible).
    await tx.$executeRaw`
      UPDATE "orden" o SET "posicion" = r."n"
      FROM (SELECT "id", (ROW_NUMBER() OVER (ORDER BY "posicion", "creado_en", "id") - 1)::int AS "n" FROM "orden") r
      WHERE r."id" = o."id" AND o."posicion" <> r."n"`;
    const lugares = await tx.$queryRaw<{ posicion: number }[]>`SELECT "posicion" FROM "orden" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "posicion"`;
    const posiciones = lugares.map((l) => l.posicion);
    await tx.$executeRaw`
      UPDATE "orden" SET "posicion" = v."pos"
      FROM unnest(${ids}::uuid[], ${posiciones}::int[]) AS v("id", "pos")
      WHERE "orden"."id" = v."id"`;
  });
}
