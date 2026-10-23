import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import {
  fetchModulosDePedido,
  fetchOrdenCabecera,
  fetchOrdenDespiece,
  fetchPedidoInfo,
} from "../../sync/teowin-orden.queries";
import { agruparDespiece } from "../../sync/agrupar-despiece";
import { lineaDeModulo } from "../../sync/linea-producto";
import { cargarPartidasDeOrden, partidaDesdeRow } from "../../sync/partida";

// diseño.md §5 / §3.6 — "Agregar orden": trae la cabecera y todas las
// piezas de corte de la orden (placares y cocinas: catálogos 4 y 3) desde TeoWin (solo lectura) y las escribe
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
      `La orden ${codigoOrdenFabricacion} no tiene piezas de corte de placares ni cocinas.`,
      422,
    );
  }

  const codigosPedido = [...new Set(despieceRows.map((r) => r.pedido))];

  const pedidosInfo = await Promise.all(codigosPedido.map((codigo) => fetchPedidoInfo(codigo)));
  const modulosPorPedido = await Promise.all(
    codigosPedido.map((codigo) => fetchModulosDePedido(codigo)),
  );

  // Partida de cada módulo (una consulta por orden; si falla, los módulos quedan sin partida y el sync sigue).
  const partidas = await cargarPartidasDeOrden(codigoOrdenFabricacion);

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

        // Una fila de TeoWin no siempre es una pieza física (ver agruparDespiece).
        const rowsDeModulo = rowsDePedido.filter((r) => r.modulo_id === moduloId);
        const gruposDeModulo = agruparDespiece(rowsDeModulo);

        // Línea del módulo: catálogo de la fila raíz; si no, el dominante de sus piezas (linea-producto.ts).
        const linea = lineaDeModulo(
          moduloInfo?.idCatalogo,
          rowsDeModulo.map((r) => r.idCatalogo),
        );

        const modulo = await tx.modulo.create({
          data: {
            pedido_id: pedido.id,
            idEscena: moduloId,
            descripcion: descripcionModulo || `Módulo ${moduloId}`,
            linea,
            estado: "PENDIENTE",
          },
        });

        const partida = partidas.get(`${codigoPedido}|${moduloId}`);
        if (partida) {
          await tx.moduloPartida.create({ data: { modulo_id: modulo.id, ...partidaDesdeRow(partida) } });
        }

        for (const grupo of gruposDeModulo) {
          const despieceTipo = await tx.despieceTipo.create({
            data: {
              modulo_id: modulo.id,
              familia: grupo.familia,
              articulo: grupo.articulo,
              color: grupo.color,
              descripcion: grupo.pieza_descripcion,
              medida1: grupo.medida1,
              medida2: grupo.medida2,
              medida3: null,
              idCatalogo: grupo.idCatalogo,
              unidades: grupo.idUnicos.length,
              estado: "PENDIENTE",
            },
          });

          await tx.piezaFisica.createMany({
            data: grupo.idUnicos.map((idUnico) => ({
              despiece_tipo_id: despieceTipo.id,
              idUnico,
              estado: "PENDIENTE" as const,
            })),
          });
        }
      }
    }

    return tx.orden.findUniqueOrThrow({
      where: { id: orden.id },
      include: { pedidos: { include: { modulos: { select: { linea: true } } } } },
    });
  });
}
