import { prisma } from "../../../config/prisma";

// diseño.md Vista 1 — listado de órdenes vigentes (no eliminadas).
export async function listOrdenes() {
  return prisma.orden.findMany({
    where: { estado: { not: "ELIMINADO" } },
    orderBy: { creado_en: "desc" },
    include: { pedidos: { select: { id: true } } },
  });
}
