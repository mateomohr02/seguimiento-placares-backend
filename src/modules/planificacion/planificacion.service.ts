import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { AREA_TERMOLAMINADO, fechaISO, parseFecha } from "../planillas/schemas/planilla.schema";

// Planificación semanal de Termolaminado cargada por sistema (diseño.md §14.4): pedidos y reclamos que baja la
// oficina técnica. El estado de producción lo tiene la estación de trabajo: cualquier usuario de la estación (activa)
// puede marcarlo en cada fila; si está en varias estaciones con estados distintos, puede marcar cualquiera (§17).

const DIA_MS = 86_400_000;

/** Lunes de la semana de una fecha (la semana de producción va de lunes a viernes). */
export function lunesDe(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(d.getTime() - dow * DIA_MS);
}

const itemSelect = {
  id: true,
  tipo: true,
  semana_inicio: true,
  orden: true,
  cliente: true,
  n_tw: true,
  n_orden: true,
  modelo: true,
  color: true,
  fabrica: true,
  fecha_limite: true,
  distribuidor: true,
  ticket: true,
  tipo_reclamo: true,
  compromiso: true,
  finalizado_en: true,
  observaciones: true,
  marcas: { select: { estado_id: true, marcado_por: true, marcado_en: true, estado: { select: { nombre: true, color: true } } }, orderBy: { marcado_en: "asc" } },
} satisfies Prisma.PlanificacionItemSelect;

type ItemDB = Prisma.PlanificacionItemGetPayload<{ select: typeof itemSelect }>;

const dia = (d: Date | null) => (d ? fechaISO(d) : null);

function itemDTO(i: ItemDB) {
  return {
    id: i.id,
    tipo: i.tipo,
    semana_inicio: fechaISO(i.semana_inicio),
    cliente: i.cliente,
    n_tw: i.n_tw,
    n_orden: i.n_orden,
    modelo: i.modelo,
    color: i.color,
    fabrica: dia(i.fabrica),
    fecha_limite: dia(i.fecha_limite),
    distribuidor: i.distribuidor,
    ticket: i.ticket,
    tipo_reclamo: i.tipo_reclamo,
    compromiso: dia(i.compromiso),
    finalizado_en: dia(i.finalizado_en),
    observaciones: i.observaciones,
    marcas: i.marcas.map((m) => ({ estado_id: m.estado_id, estado: m.estado.nombre, color: m.estado.color, marcado_por: m.marcado_por, marcado_en: m.marcado_en.toISOString() })),
  };
}

/**
 * Estados de producción que el usuario puede marcar: los de sus estaciones de trabajo activas (diseño.md §17), sin
 * repetir, en el orden del catálogo. Vacío si ninguna de sus estaciones tiene estado (o si no tiene estaciones).
 */
export async function estadosDeUsuario(usuarioId: string) {
  return prisma.estadoProduccion.findMany({
    where: { estaciones: { some: { activa: true, usuarios: { some: { usuario_id: usuarioId } } } } },
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, color: true },
  });
}

export async function getSemana(semanaRaw: string | undefined, usuarioId: string) {
  const hoy = parseFecha(fechaISO(new Date()));
  const semana = lunesDe(semanaRaw ? parseFecha(semanaRaw, "La semana") : hoy);
  const [items, semanas, estados, misEstados] = await Promise.all([
    prisma.planificacionItem.findMany({
      where: { area: AREA_TERMOLAMINADO, semana_inicio: semana, eliminado_en: null },
      select: itemSelect,
      orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    }),
    prisma.planificacionItem.findMany({
      where: { area: AREA_TERMOLAMINADO, eliminado_en: null },
      select: { semana_inicio: true },
      distinct: ["semana_inicio"],
      orderBy: { semana_inicio: "desc" },
      take: 30,
    }),
    prisma.estadoProduccion.findMany({ orderBy: [{ orden: "asc" }, { creado_en: "asc" }], select: { id: true, nombre: true, color: true } }),
    estadosDeUsuario(usuarioId),
  ]);
  return {
    semana_inicio: fechaISO(semana),
    semanas: semanas.map((s) => fechaISO(s.semana_inicio)),
    estados,
    // Compatibilidad: el primero de `mis_estados` (o null). Con varios, el frontend tiene que usar `mis_estados`.
    mi_estado: misEstados[0] ?? null,
    mis_estados: misEstados,
    items: items.map(itemDTO),
  };
}

export interface ItemInput {
  tipo: "PEDIDOS" | "RECLAMOS";
  semana: string;
  cliente: string;
  n_tw: string;
  n_orden: string | null;
  modelo: string | null;
  color: string | null;
  fabrica: string | null;
  fecha_limite: string | null;
  distribuidor: string | null;
  ticket: string | null;
  tipo_reclamo: string | null;
  compromiso: string | null;
  finalizado_en: string | null;
  observaciones: string | null;
}

const fecha = (v: string | null, etiqueta: string) => (v ? parseFecha(v, etiqueta) : null);

function datosDe(i: ItemInput) {
  return {
    tipo: i.tipo,
    semana_inicio: lunesDe(parseFecha(i.semana, "La semana")),
    cliente: i.cliente,
    n_tw: i.n_tw,
    n_orden: i.n_orden,
    modelo: i.modelo,
    color: i.color,
    fabrica: fecha(i.fabrica, "La fecha de fábrica"),
    fecha_limite: fecha(i.fecha_limite, "La fecha límite"),
    distribuidor: i.distribuidor,
    ticket: i.ticket,
    tipo_reclamo: i.tipo_reclamo,
    compromiso: fecha(i.compromiso, "La fecha de compromiso"),
    finalizado_en: fecha(i.finalizado_en, "La fecha de finalizado"),
    observaciones: i.observaciones,
  };
}

async function itemVigente(id: string) {
  const i = await prisma.planificacionItem.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!i || i.eliminado_en) throw new AppError("Fila no encontrada.", 404);
}

export async function crearItem(input: ItemInput) {
  const datos = datosDe(input);
  const ultimo = await prisma.planificacionItem.aggregate({
    where: { area: AREA_TERMOLAMINADO, semana_inicio: datos.semana_inicio, tipo: datos.tipo, eliminado_en: null },
    _max: { orden: true },
  });
  const creada = await prisma.planificacionItem.create({ data: { ...datos, orden: (ultimo._max.orden ?? -1) + 1 }, select: itemSelect });
  return itemDTO(creada);
}

export async function actualizarItem(id: string, input: ItemInput) {
  await itemVigente(id);
  const datos = datosDe(input);
  const actual = await prisma.planificacionItem.findUnique({ where: { id }, select: { tipo: true, semana_inicio: true } });
  // Cambiar de semana o de tipo manda la fila al final de la nueva lista.
  const cambio = actual!.tipo !== datos.tipo || actual!.semana_inicio.getTime() !== datos.semana_inicio.getTime();
  const orden = cambio
    ? ((await prisma.planificacionItem.aggregate({ where: { area: AREA_TERMOLAMINADO, semana_inicio: datos.semana_inicio, tipo: datos.tipo, eliminado_en: null }, _max: { orden: true } }))._max.orden ?? -1) + 1
    : undefined;
  const u = await prisma.planificacionItem.update({ where: { id }, data: { ...datos, ...(orden === undefined ? {} : { orden }) }, select: itemSelect });
  return itemDTO(u);
}

export async function eliminarItem(id: string) {
  await itemVigente(id);
  await prisma.planificacionItem.update({ where: { id }, data: { eliminado_en: new Date() } });
}

/**
 * Marca o desmarca, en una fila, uno de los estados de producción de las estaciones del usuario. `estadoId` es
 * opcional si el usuario tiene un solo estado posible; con varios es obligatorio.
 */
export async function marcarEstado(itemId: string, usuarioId: string, usuarioNombre: string, marcado: boolean, estadoId?: string) {
  await itemVigente(itemId);
  const mios = await estadosDeUsuario(usuarioId);
  if (mios.length === 0) throw new AppError("Tus estaciones de trabajo no tienen un estado de producción asignado.", 403);
  let estado = mios[0];
  if (estadoId) {
    const elegido = mios.find((e) => e.id === estadoId);
    if (!elegido) throw new AppError("Ese estado no es de ninguna de tus estaciones de trabajo.", 403);
    estado = elegido;
  } else if (mios.length > 1) {
    throw new AppError("Tenés varios estados posibles: elegí cuál marcar (estado_id).", 400);
  }
  const clave = { item_id_estado_id: { item_id: itemId, estado_id: estado.id } };
  if (marcado) {
    await prisma.planificacionMarca.upsert({
      where: clave,
      create: { item_id: itemId, estado_id: estado.id, marcado_por: usuarioNombre },
      update: {},
    });
  } else {
    await prisma.planificacionMarca.deleteMany({ where: { item_id: itemId, estado_id: estado.id } });
  }
  const i = await prisma.planificacionItem.findUnique({ where: { id: itemId }, select: itemSelect });
  return itemDTO(i!);
}
