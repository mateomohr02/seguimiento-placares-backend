import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { interpretarEscena3D, PARSER_VERSION, type Escena3D } from "../parser/escena-3d.parser";

// Escenas 3D de un pedido (.3d de TeoWin), solo lectura (diseño.md §13).
export const MAX_ESCENA_BYTES = 40 * 1024 * 1024;

// Nunca se selecciona `contenido` ni `escena` al listar.
const metaSelect = {
  id: true,
  pedido_id: true,
  nombre: true,
  nombre_archivo: true,
  tamano: true,
  creado_en: true,
} as const;

function toDTO<T extends { creado_en: Date }>(e: T) {
  return { ...e, creado_en: e.creado_en.toISOString() };
}

async function assertPedidoVigente(pedidoId: string) {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: { estado: true, orden: { select: { estado: true } } },
  });
  if (!pedido || pedido.estado === "ELIMINADO" || pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Pedido no encontrado.", 404);
  }
}

export async function listEscenasDePedido(pedidoId: string) {
  await assertPedidoVigente(pedidoId);
  const escenas = await prisma.escenaPedido.findMany({
    where: { pedido_id: pedidoId, eliminado_en: null },
    select: metaSelect,
    orderBy: { creado_en: "asc" },
  });
  return escenas.map(toDTO);
}

export async function crearEscena(
  pedidoId: string,
  input: { nombre: string; nombreArchivo: string; contenido: Buffer },
) {
  await assertPedidoVigente(pedidoId);
  if (input.contenido.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (input.contenido.length > MAX_ESCENA_BYTES) throw new AppError("El archivo supera el tamaño máximo (40 MB).", 413);
  // Un .3d de TeoWin es texto y empieza con "//version"; se verifica el contenido, no la extensión.
  if (!input.contenido.subarray(0, 64).toString("latin1").startsWith("//version")) {
    throw new AppError("El archivo no parece una escena .3d de TeoWin.", 400);
  }

  let escena: Escena3D;
  try {
    escena = interpretarEscena3D(input.contenido.toString("latin1"));
  } catch {
    throw new AppError("No se pudo interpretar la escena .3d.", 422);
  }
  if (escena.modulos.length === 0 && escena.paredes.length === 0) {
    throw new AppError("La escena no tiene muebles ni paredes que mostrar.", 422);
  }

  const creada = await prisma.escenaPedido.create({
    data: {
      pedido_id: pedidoId,
      nombre: input.nombre,
      nombre_archivo: input.nombreArchivo,
      tamano: input.contenido.length,
      contenido: input.contenido,
      escena: escena as unknown as Prisma.InputJsonValue,
      parser_version: PARSER_VERSION,
    },
    select: metaSelect,
  });
  return toDTO(creada);
}

export async function getEscena(id: string) {
  const e = await prisma.escenaPedido.findUnique({
    where: { id },
    select: {
      escena: true,
      nombre: true,
      eliminado_en: true,
      pedido: { select: { estado: true, orden: { select: { estado: true } } } },
    },
  });
  if (!e || e.eliminado_en || e.pedido.estado === "ELIMINADO" || e.pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Escena no encontrada.", 404);
  }
  return { nombre: e.nombre, escena: e.escena as unknown as Escena3D };
}

export async function eliminarEscena(id: string) {
  const e = await prisma.escenaPedido.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!e || e.eliminado_en) throw new AppError("Escena no encontrada.", 404);
  await prisma.escenaPedido.update({ where: { id }, data: { eliminado_en: new Date() } });
}
