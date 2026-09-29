import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import {
  fetchModulosDePedido,
  fetchOrdenCabecera,
  fetchOrdenDespiece,
  fetchPedidoInfo,
} from "../../sync/teowin-orden.queries";
import type { TeowinDespieceRow } from "../../sync/teowin-orden.types";

// diseño.md §5 / §3.6 — "Agregar orden": trae la cabecera y todas las
// piezas de placar de la orden desde TeoWin (solo lectura) y las escribe
// en la base propia dentro de una única transacción. Si ya existe una
// orden activa con el mismo codigoOrdenFabricacion, el índice único parcial
// (§8.3) hace fallar el INSERT — la violación se traduce a un 409 en
// errorController, no se maneja acá silenciosamente.
export async function syncOrdenFromTeowin(codigoOrdenFabricacion: number) {
  const cabecera = await fetchOrdenCabecera(codigoOrdenFabricacion);
  if (!cabecera) {
    throw new AppError(`No se encontró la orden ${codigoOrdenFabricacion} en TeoWin.`, 404);
  }

  const despieceRows = await fetchOrdenDespiece(codigoOrdenFabricacion);
  if (despieceRows.length === 0) {
    throw new AppError(
      `La orden ${codigoOrdenFabricacion} no tiene pedidos con piezas de placar (catálogo 4).`,
      422,
    );
  }

  const codigosPedido = [...new Set(despieceRows.map((r) => r.pedido))];

  const pedidosInfo = await Promise.all(codigosPedido.map((codigo) => fetchPedidoInfo(codigo)));
  const modulosPorPedido = await Promise.all(
    codigosPedido.map((codigo) => fetchModulosDePedido(codigo)),
  );

  return prisma.$transaction(async (tx) => {
    const orden = await tx.orden.create({
      data: {
        codigoOrdenFabricacion: cabecera.numeroOrden,
        numeroOrdenCustom: cabecera.numeroOrdenCustom,
        descripcion: cabecera.descripcion,
        estado: "PENDIENTE",
      },
    });

    for (let i = 0; i < codigosPedido.length; i++) {
      const codigoPedido = codigosPedido[i];
      const pedidoInfo = pedidosInfo[i];
      const modulosInfo = modulosPorPedido[i];
      const rowsDePedido = despieceRows.filter((r) => r.pedido === codigoPedido);

      const pedido = await tx.pedido.create({
        data: {
          orden_id: orden.id,
          codigo_pedido: codigoPedido,
          referencia: pedidoInfo?.referencia ?? "",
          nombreComercial: pedidoInfo?.nombreComercial ?? "",
          estado: "PENDIENTE",
        },
      });

      const moduloIdsEnPedido = [...new Set(rowsDePedido.map((r) => r.modulo_id))];

      for (const moduloId of moduloIdsEnPedido) {
        const moduloInfo = modulosInfo.find((m) => m.modulo_id === moduloId);
        const descripcionModulo =
          moduloInfo?.descripcion_mueble ??
          `${moduloInfo?.familia_mueble ?? ""} ${moduloInfo?.articulo_mueble ?? ""}`.trim();

        const modulo = await tx.modulo.create({
          data: {
            pedido_id: pedido.id,
            idEscena: moduloId,
            descripcion: descripcionModulo || `Módulo ${moduloId}`,
            estado: "PENDIENTE",
          },
        });

        const rowsDeModulo = rowsDePedido.filter((r) => r.modulo_id === moduloId);
        const piezaTipoIds = [...new Set(rowsDeModulo.map((r) => r.pieza_tipo_id))];

        for (const piezaTipoId of piezaTipoIds) {
          const rowsDePieza: TeowinDespieceRow[] = rowsDeModulo.filter(
            (r) => r.pieza_tipo_id === piezaTipoId,
          );
          const sample = rowsDePieza[0];

          const despieceTipo = await tx.despieceTipo.create({
            data: {
              modulo_id: modulo.id,
              familia: sample.familia,
              articulo: sample.articulo,
              color: sample.color,
              descripcion: sample.pieza_descripcion,
              medida1: sample.medida1,
              medida2: sample.medida2,
              medida3: null,
              idCatalogo: sample.idCatalogo,
              unidades: sample.unidades,
              estado: "PENDIENTE",
            },
          });

          await tx.piezaFisica.createMany({
            data: rowsDePieza.map((r) => ({
              despiece_tipo_id: despieceTipo.id,
              idUnico: r.idunico,
              estado: "PENDIENTE",
            })),
          });
        }
      }
    }

    return tx.orden.findUniqueOrThrow({
      where: { id: orden.id },
      include: { pedidos: true },
    });
  });
}
