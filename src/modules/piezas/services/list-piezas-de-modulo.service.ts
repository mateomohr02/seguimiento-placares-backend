import { prisma } from "../../../config/prisma";

// diseño.md Vista 4 — piezas físicas de un módulo, con estado individual.
// Se lista a nivel PiezaFisica (no DespieceTipo) porque es la que tiene un
// estado real de corte por unidad (§8.2: unidades > 1 son piezas físicas
// independientes, cada una con su propio idUnico y estado).
export async function listPiezasDeModulo(moduloId: string) {
  return prisma.piezaFisica.findMany({
    where: { despieceTipo: { modulo_id: moduloId }, estado: { not: "ELIMINADA" } },
    orderBy: { id: "asc" },
    include: { despieceTipo: true },
  });
}
