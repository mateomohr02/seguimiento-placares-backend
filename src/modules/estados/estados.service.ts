import type { Prisma } from "@prisma/client";

// Reglas de correspondencia de estados entre niveles (una sola fuente de
// verdad; los servicios de pieza las usan siempre dentro de su transacción).
// Jerarquía: Pieza < DespieceTipo < Módulo < Pedido < Orden.
//
// LO ÚNICO QUE SE MARCA A MANO SON LAS PIEZAS (CORTADA / PENDIENTE, o por
// escaneo). Todos los niveles de arriba son DERIVADOS de sus hijos vigentes
// (no eliminados), tanto hacia "en producción" como hacia "finalizado" y de
// vuelta a "pendiente":
//
//   Nivel    | PENDIENTE si...           | FINALIZADO si...          | si no
//   ---------|---------------------------|---------------------------|--------------
//   Módulo   | ninguna pieza CORTADA     | todas CORTADA             | EN_PRODUCCION
//   Pedido   | todos sus módulos PEND.   | todos FINALIZADO          | EN_PRODUCCION
//   Orden    | todos sus pedidos PEND.   | (LISTA) todos FINALIZADO  | EN_PROCESO
//
// Se recalcula hacia arriba (Módulo -> Pedido -> Orden) después de CADA cambio
// de una pieza. Así ningún nivel se puede marcar sin que las piezas lo
// respalden, no hay pasos salteados, y un estado avanzado deja de serlo apenas
// un hijo deja de cumplir. Un nivel sin hijos vigentes no se toca.
// DespieceTipo (interno, no se muestra) sigue la misma regla sobre sus piezas.
type Tx = Prisma.TransactionClient;

type Estado3 = "PENDIENTE" | "EN_PRODUCCION" | "FINALIZADO";

function derivar(hijos: { pendientes: number; finalizados: number; total: number }): Estado3 {
  if (hijos.pendientes === hijos.total) return "PENDIENTE";
  if (hijos.finalizados === hijos.total) return "FINALIZADO";
  return "EN_PRODUCCION";
}

export async function recalcularDespieceTipo(tx: Tx, id: string) {
  const tipo = await tx.despieceTipo.findUnique({ where: { id }, select: { estado: true } });
  if (!tipo || tipo.estado === "ELIMINADO") return;

  const where = { despiece_tipo_id: id, estado: { not: "ELIMINADA" as const } };
  const [total, cortadas] = await Promise.all([
    tx.piezaFisica.count({ where }),
    tx.piezaFisica.count({ where: { ...where, estado: "CORTADA" } }),
  ]);
  if (total === 0) return;
  const estado = derivar({ total, pendientes: total - cortadas, finalizados: cortadas });
  if (estado !== tipo.estado) {
    await tx.despieceTipo.update({ where: { id }, data: { estado } });
  }
}

async function recalcularModulo(tx: Tx, id: string) {
  const modulo = await tx.modulo.findUniqueOrThrow({ where: { id }, select: { estado: true } });
  if (modulo.estado === "ELIMINADO") return;

  const where = { despieceTipo: { modulo_id: id }, estado: { not: "ELIMINADA" as const } };
  const [total, cortadas] = await Promise.all([
    tx.piezaFisica.count({ where }),
    tx.piezaFisica.count({ where: { ...where, estado: "CORTADA" } }),
  ]);
  if (total === 0) return;
  const estado = derivar({ total, pendientes: total - cortadas, finalizados: cortadas });
  if (estado !== modulo.estado) {
    await tx.modulo.update({ where: { id }, data: { estado } });
  }
}

export async function recalcularPedido(tx: Tx, id: string) {
  const pedido = await tx.pedido.findUniqueOrThrow({ where: { id }, select: { estado: true } });
  if (pedido.estado === "ELIMINADO") return;

  const modulos = await tx.modulo.findMany({
    where: { pedido_id: id, estado: { not: "ELIMINADO" } },
    select: { estado: true },
  });
  if (modulos.length === 0) return;
  const estado = derivar({
    total: modulos.length,
    pendientes: modulos.filter((m) => m.estado === "PENDIENTE").length,
    finalizados: modulos.filter((m) => m.estado === "FINALIZADO").length,
  });
  if (estado !== pedido.estado) {
    await tx.pedido.update({ where: { id }, data: { estado } });
  }
}

// Orden: PENDIENTE / EN_PROCESO, y LISTA cuando todos sus pedidos vigentes
// están FINALIZADO.
export async function recalcularOrden(tx: Tx, id: string) {
  const orden = await tx.orden.findUniqueOrThrow({ where: { id }, select: { estado: true } });
  if (orden.estado === "ELIMINADO") return;

  const pedidos = await tx.pedido.findMany({
    where: { orden_id: id, estado: { not: "ELIMINADO" } },
    select: { estado: true },
  });
  if (pedidos.length === 0) return;
  const derivado = derivar({
    total: pedidos.length,
    pendientes: pedidos.filter((p) => p.estado === "PENDIENTE").length,
    finalizados: pedidos.filter((p) => p.estado === "FINALIZADO").length,
  });
  const estado = derivado === "PENDIENTE" ? "PENDIENTE" : derivado === "FINALIZADO" ? "LISTA" : "EN_PROCESO";
  if (estado !== orden.estado) {
    await tx.orden.update({ where: { id }, data: { estado } });
  }
}

// Recalcula Módulo -> Pedido -> Orden a partir de un cambio en las piezas.
export async function propagarDesdeModulo(tx: Tx, moduloId: string) {
  await recalcularModulo(tx, moduloId);
  const { pedido_id, pedido } = await tx.modulo.findUniqueOrThrow({
    where: { id: moduloId },
    select: { pedido_id: true, pedido: { select: { orden_id: true } } },
  });
  await recalcularPedido(tx, pedido_id);
  await recalcularOrden(tx, pedido.orden_id);
}
