import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { fechaISO, parseFecha } from "../planillas/schemas/planilla.schema";
import type { ItemInput, ReordenarInput } from "./schemas/planificacion.schema";

// Planificación semanal POR ESTACIÓN DE TRABAJO (diseño.md §14.4). Cada estación elige una plantilla de planificación
// (hoy solo TERMOLAMINADO: tabla de pedidos y tabla de reclamos); una estación sin plantilla no tiene planificación.
// Las filas se arman sobre pedidos ya cargados en la app (`pedido_id`): N° TW = pedido.codigo_pedido, cliente =
// pedido.referencia, N° de orden = numeroOrdenCustom de la orden del pedido. El estado de producción lo tiene la estación
// de trabajo: cualquier usuario de una estación (activa) puede marcarlo en cada fila; si está en varias estaciones con
// estados distintos, puede marcar cualquiera (§17), sea cual sea la estación cuya planificación esté mirando.

const DIA_MS = 86_400_000;

/** Roles que ven la planificación de TODAS las estaciones con plantilla; el resto (fábrica) solo la de las suyas. */
const ROLES_VEN_TODAS = ["admin", "tecnica", "gerencia"];

/** Lunes de la semana de una fecha (la semana de producción va de lunes a viernes). */
export function lunesDe(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(d.getTime() - dow * DIA_MS);
}

const itemSelect = {
  id: true,
  estacion_id: true,
  tipo: true,
  semana_inicio: true,
  orden: true,
  pedido_id: true,
  pedido: { select: { id: true, codigo_pedido: true, referencia: true, orden: { select: { id: true, numeroOrdenCustom: true } } } },
  modelo: true,
  color: true,
  distribuidor: true,
  ticket: true,
  tipo_reclamo: true,
  compromiso: true,
  finalizado_en: true,
  observaciones: true,
  marcas: { select: { estado_id: true, marcado_por: true, marcado_en: true, estado: { select: { nombre: true, color: true } } }, orderBy: { marcado_en: "asc" } },
  comentarios: {
    select: {
      id: true,
      usuario_id: true,
      autor: true,
      texto: true,
      creado_en: true,
      editado_en: true,
      eliminado_en: true,
      eliminado_por: true,
      historial: { select: { id: true, accion: true, texto: true, por: true, en: true }, orderBy: { en: "asc" } },
    },
    orderBy: { creado_en: "asc" },
  },
} satisfies Prisma.PlanificacionItemSelect;

type ItemDB = Prisma.PlanificacionItemGetPayload<{ select: typeof itemSelect }>;

const dia = (d: Date | null) => (d ? fechaISO(d) : null);

/** Quién mira la planificación: define qué estaciones ve y qué observaciones puede editar (las suyas) y borrar (las suyas, o cualquiera si gestiona). */
export interface Lector {
  id: string;
  nombre: string;
  rol: string;
  puedeGestionar: boolean;
}

export interface EstacionPlanificacion {
  id: string;
  nombre: string;
  plantilla: "TERMOLAMINADO";
}

function itemDTO(i: ItemDB, lector: Lector) {
  return {
    id: i.id,
    estacion_id: i.estacion_id,
    tipo: i.tipo,
    semana_inicio: fechaISO(i.semana_inicio),
    pedido_id: i.pedido_id,
    orden_id: i.pedido?.orden.id ?? null,
    codigo_pedido: i.pedido?.codigo_pedido ?? null, // N° TW
    n_orden: i.pedido?.orden.numeroOrdenCustom ?? null,
    cliente: i.pedido?.referencia ?? null,
    modelo: i.modelo,
    color: i.color,
    compromiso: dia(i.compromiso),
    finalizado_en: dia(i.finalizado_en),
    distribuidor: i.distribuidor,
    ticket: i.ticket,
    tipo_reclamo: i.tipo_reclamo,
    observaciones: i.observaciones,
    orden: i.orden,
    marcas: i.marcas.map((m) => ({ estado_id: m.estado_id, estado: m.estado.nombre, color: m.estado.color, marcado_por: m.marcado_por, marcado_en: m.marcado_en.toISOString() })),
    // Observaciones de los usuarios (incluye las borradas, con `eliminado_en`, para que figuren en el historial).
    comentarios: i.comentarios.map((c) => {
      const propia = c.usuario_id === lector.id;
      const vigente = c.eliminado_en === null;
      return {
        id: c.id,
        usuario_id: c.usuario_id,
        autor: c.autor,
        texto: c.texto,
        creado_en: c.creado_en.toISOString(),
        editado_en: c.editado_en?.toISOString() ?? null,
        eliminado_en: c.eliminado_en?.toISOString() ?? null,
        eliminado_por: c.eliminado_por,
        puede_editar: vigente && propia,
        puede_borrar: vigente && (propia || lector.puedeGestionar),
        historial: c.historial.map((h) => ({ id: h.id, accion: h.accion, texto: h.texto, por: h.por, en: h.en.toISOString() })),
      };
    }),
  };
}

// --- Estaciones ---

/**
 * Estaciones con planificación que el usuario puede ver: las ACTIVAS con plantilla. Admin, técnica y gerencia ven todas;
 * el resto (fábrica) solo aquellas de las que es miembro.
 */
export async function estacionesVisibles(lector: Lector): Promise<EstacionPlanificacion[]> {
  const verTodas = ROLES_VEN_TODAS.includes(lector.rol);
  const estaciones = await prisma.estacionTrabajo.findMany({
    where: {
      activa: true,
      plantilla_planificacion: { not: null },
      ...(verTodas ? {} : { usuarios: { some: { usuario_id: lector.id } } }),
    },
    select: { id: true, nombre: true, plantilla_planificacion: true },
  });
  return estaciones
    .map((e) => ({ id: e.id, nombre: e.nombre, plantilla: e.plantilla_planificacion! }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
}

/** La estación de trabajo existe, está activa y tiene plantilla de planificación (para cargar, editar y reordenar filas). */
async function exigirEstacionConPlantilla(id: string) {
  const e = await prisma.estacionTrabajo.findUnique({ where: { id }, select: { id: true, activa: true, plantilla_planificacion: true } });
  if (!e || !e.activa || !e.plantilla_planificacion) {
    throw new AppError("estacion_id: la estación no existe, está inactiva o no tiene plantilla de planificación.", 400);
  }
}

// --- Lectura de una semana ---

/**
 * Estados de producción que el usuario puede marcar: los de sus estaciones de trabajo activas (diseño.md §17), sin
 * repetir, en el orden del catálogo. Vacío si ninguna de sus estaciones tiene estado (o si no tiene estaciones).
 * No depende de qué estación de planificación esté mirando.
 */
export async function estadosDeUsuario(usuarioId: string) {
  return prisma.estadoProduccion.findMany({
    where: { estaciones: { some: { activa: true, usuarios: { some: { usuario_id: usuarioId } } } } },
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, color: true },
  });
}

/** La estación pedida (si el usuario la ve) o, sin `estacionId`, la primera que ve. */
async function resolverEstacion(estacionId: string | undefined, lector: Lector): Promise<EstacionPlanificacion> {
  const visibles = await estacionesVisibles(lector);
  if (!estacionId) {
    if (visibles.length === 0) throw new AppError("No hay planificación disponible para tus estaciones de trabajo.", 404);
    return visibles[0];
  }
  const e = visibles.find((v) => v.id === estacionId);
  if (e) return e;
  const existe = await prisma.estacionTrabajo.findFirst({ where: { id: estacionId, plantilla_planificacion: { not: null } }, select: { id: true } });
  if (!existe) throw new AppError("Estación de trabajo no encontrada o sin planificación.", 404);
  throw new AppError("No tenés acceso a la planificación de esa estación.", 403);
}

export async function getSemana(estacionId: string | undefined, semanaRaw: string | undefined, lector: Lector) {
  const estacion = await resolverEstacion(estacionId, lector);
  const hoy = parseFecha(fechaISO(new Date()));
  const semana = lunesDe(semanaRaw ? parseFecha(semanaRaw, "La semana") : hoy);
  const [items, semanas, estados, misEstados] = await Promise.all([
    prisma.planificacionItem.findMany({
      where: { estacion_id: estacion.id, semana_inicio: semana, eliminado_en: null },
      select: itemSelect,
      orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    }),
    prisma.planificacionItem.findMany({
      where: { estacion_id: estacion.id, eliminado_en: null },
      select: { semana_inicio: true },
      distinct: ["semana_inicio"],
      orderBy: { semana_inicio: "desc" },
      take: 30,
    }),
    prisma.estadoProduccion.findMany({ orderBy: [{ orden: "asc" }, { creado_en: "asc" }], select: { id: true, nombre: true, color: true } }),
    estadosDeUsuario(lector.id),
  ]);
  return {
    estacion,
    semana_inicio: fechaISO(semana),
    semanas: semanas.map((s) => fechaISO(s.semana_inicio)),
    estados,
    // Compatibilidad: el primero de `mis_estados` (o null). Con varios, el frontend tiene que usar `mis_estados`.
    mi_estado: misEstados[0] ?? null,
    mis_estados: misEstados,
    items: items.map((i) => itemDTO(i, lector)),
  };
}

// --- Búsquedas ---

/** Pedidos cargados en la app para armar una fila: búsqueda por N° de pedido (contiene, sin distinguir mayúsculas). */
export async function buscarPedidos(q: string, limit: number) {
  const pedidos = await prisma.pedido.findMany({
    where: {
      estado: { not: "ELIMINADO" },
      orden: { estado: { not: "ELIMINADO" } },
      ...(q ? { codigo_pedido: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: q ? [{ codigo_pedido: "asc" }] : [{ creado_en: "desc" }, { codigo_pedido: "asc" }],
    take: limit,
    select: { id: true, codigo_pedido: true, referencia: true, orden: { select: { id: true, numeroOrdenCustom: true } } },
  });
  return pedidos.map((p) => ({ pedido_id: p.id, codigo_pedido: p.codigo_pedido, referencia: p.referencia, orden_id: p.orden.id, n_orden: p.orden.numeroOrdenCustom }));
}

/** Dónde está un pedido dentro de la planificación de una estación: las filas vigentes cuyo pedido contiene `q`. */
export async function buscarEnEstacion(estacionId: string, q: string, lector: Lector) {
  const estacion = await resolverEstacion(estacionId, lector);
  if (q === "") return [];
  const items = await prisma.planificacionItem.findMany({
    where: { estacion_id: estacion.id, eliminado_en: null, pedido: { codigo_pedido: { contains: q, mode: "insensitive" } } },
    orderBy: [{ semana_inicio: "desc" }, { tipo: "asc" }, { orden: "asc" }],
    take: 50,
    select: { id: true, semana_inicio: true, tipo: true, pedido: { select: { codigo_pedido: true, referencia: true } } },
  });
  return items.map((i) => ({ item_id: i.id, semana_inicio: fechaISO(i.semana_inicio), tipo: i.tipo, codigo_pedido: i.pedido!.codigo_pedido, cliente: i.pedido!.referencia }));
}

// --- Alta, edición, baja y orden de las filas ---

const fecha = (v: string | null, etiqueta: string) => (v ? parseFecha(v, etiqueta) : null);

/** El pedido tiene que existir y, al cargarlo o cambiarlo, no estar eliminado (ni su orden). `actual` = el que ya tenía la fila. */
async function exigirPedido(pedidoId: string, actual?: string | null) {
  const p = await prisma.pedido.findUnique({ where: { id: pedidoId }, select: { estado: true, orden: { select: { estado: true } } } });
  if (!p) throw new AppError("pedido_id: el pedido no existe.", 400);
  if (pedidoId !== actual && (p.estado === "ELIMINADO" || p.orden.estado === "ELIMINADO")) {
    throw new AppError("pedido_id: el pedido fue eliminado.", 400);
  }
}

function datosDe(i: ItemInput) {
  return {
    estacion_id: i.estacion_id,
    pedido_id: i.pedido_id,
    tipo: i.tipo,
    semana_inicio: lunesDe(parseFecha(i.semana, "La semana")),
    modelo: i.modelo,
    color: i.color,
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

/** Lugar al final de la lista (estación, semana, tipo). */
async function proximoOrden(estacionId: string, semana: Date, tipo: "PEDIDOS" | "RECLAMOS") {
  const ultimo = await prisma.planificacionItem.aggregate({ where: { estacion_id: estacionId, semana_inicio: semana, tipo, eliminado_en: null }, _max: { orden: true } });
  return (ultimo._max.orden ?? -1) + 1;
}

export async function crearItem(input: ItemInput, lector: Lector) {
  await exigirEstacionConPlantilla(input.estacion_id);
  await exigirPedido(input.pedido_id);
  const datos = datosDe(input);
  const orden = await proximoOrden(datos.estacion_id, datos.semana_inicio, datos.tipo);
  const creada = await prisma.planificacionItem.create({ data: { ...datos, orden }, select: itemSelect });
  return itemDTO(creada, lector);
}

export async function actualizarItem(id: string, input: ItemInput, lector: Lector) {
  const actual = await prisma.planificacionItem.findUnique({ where: { id }, select: { eliminado_en: true, estacion_id: true, tipo: true, semana_inicio: true, pedido_id: true } });
  if (!actual || actual.eliminado_en) throw new AppError("Fila no encontrada.", 404);
  await exigirEstacionConPlantilla(input.estacion_id);
  await exigirPedido(input.pedido_id, actual.pedido_id);
  const datos = datosDe(input);
  // Cambiar de estación, de semana o de tipo manda la fila al final de la nueva lista.
  const cambio = actual.estacion_id !== datos.estacion_id || actual.tipo !== datos.tipo || actual.semana_inicio.getTime() !== datos.semana_inicio.getTime();
  const orden = cambio ? await proximoOrden(datos.estacion_id, datos.semana_inicio, datos.tipo) : undefined;
  const u = await prisma.planificacionItem.update({ where: { id }, data: { ...datos, ...(orden === undefined ? {} : { orden }) }, select: itemSelect });
  return itemDTO(u, lector);
}

export async function eliminarItem(id: string) {
  await itemVigente(id);
  await prisma.planificacionItem.update({ where: { id }, data: { eliminado_en: new Date() } });
}

/**
 * Reordena las filas de una estación + semana + tipo: `ids` tiene que ser EXACTAMENTE el conjunto de filas vigentes de esa
 * lista (en el orden nuevo). Reasigna `orden` 0..n-1 en una transacción, con las filas bloqueadas.
 */
export async function reordenarItems(input: ReordenarInput) {
  await exigirEstacionConPlantilla(input.estacion_id);
  const semana = lunesDe(parseFecha(input.semana, "La semana"));
  await prisma.$transaction(async (tx) => {
    const vigentes = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id" FROM "planificacion_item"
      WHERE "estacion_id" = ${input.estacion_id}::uuid AND "semana_inicio" = ${fechaISO(semana)}::date AND "tipo" = ${input.tipo}::"PlanificacionTipo" AND "eliminado_en" IS NULL
      FOR UPDATE`;
    const set = new Set(vigentes.map((v) => v.id.toLowerCase()));
    const mismas = input.ids.length === set.size && input.ids.every((id) => set.has(id.toLowerCase()));
    if (!mismas) {
      throw new AppError("ids: la lista no coincide con las filas vigentes de esa estación, semana y tipo (puede que alguien haya agregado o quitado filas): recargá la planificación.", 400);
    }
    if (input.ids.length === 0) return;
    await tx.$executeRaw`
      UPDATE "planificacion_item" SET "orden" = v."pos"
      FROM unnest(${input.ids}::uuid[], ${input.ids.map((_, i) => i)}::int[]) AS v("id", "pos")
      WHERE "planificacion_item"."id" = v."id"`;
  });
}

/**
 * Marca o desmarca, en una fila, uno de los estados de producción de las estaciones del usuario. `estadoId` es
 * opcional si el usuario tiene un solo estado posible; con varios es obligatorio.
 */
export async function marcarEstado(itemId: string, lector: Lector, marcado: boolean, estadoId?: string) {
  await itemVigente(itemId);
  const mios = await estadosDeUsuario(lector.id);
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
      create: { item_id: itemId, estado_id: estado.id, marcado_por: lector.nombre },
      update: {},
    });
  } else {
    await prisma.planificacionMarca.deleteMany({ where: { item_id: itemId, estado_id: estado.id } });
  }
  const i = await prisma.planificacionItem.findUnique({ where: { id: itemId }, select: itemSelect });
  return itemDTO(i!, lector);
}

// --- Observaciones de los usuarios (diseño.md §14.13) ---

async function itemConObservaciones(itemId: string, lector: Lector) {
  const i = await prisma.planificacionItem.findUnique({ where: { id: itemId }, select: itemSelect });
  return itemDTO(i!, lector);
}

async function observacionVigente(id: string) {
  const o = await prisma.planificacionObservacion.findUnique({ where: { id }, select: { id: true, item_id: true, usuario_id: true, texto: true, eliminado_en: true, item: { select: { eliminado_en: true } } } });
  if (!o || o.eliminado_en || o.item.eliminado_en) throw new AppError("Observación no encontrada.", 404);
  return o;
}

/** Agrega una observación a una fila. Cualquier usuario que ve la planificación puede hacerlo; queda firmada con su nombre. */
export async function agregarObservacion(itemId: string, texto: string, lector: Lector) {
  await itemVigente(itemId);
  await prisma.planificacionObservacion.create({
    data: { item_id: itemId, usuario_id: lector.id, autor: lector.nombre, texto, historial: { create: { accion: "CREADA", texto, por: lector.nombre } } },
  });
  return itemConObservaciones(itemId, lector);
}

/** Edita el texto de una observación propia; cada versión queda en el historial. */
export async function editarObservacion(id: string, texto: string, lector: Lector) {
  const o = await observacionVigente(id);
  if (o.usuario_id !== lector.id) throw new AppError("Solo podés editar tus propias observaciones.", 403);
  if (o.texto !== texto) {
    await prisma.planificacionObservacion.update({
      where: { id },
      data: { texto, editado_en: new Date(), historial: { create: { accion: "EDITADA", texto, por: lector.nombre } } },
    });
  }
  return itemConObservaciones(o.item_id, lector);
}

/** Borrado lógico: el autor borra la suya y quien gestiona (técnica) puede borrar cualquiera; queda en el historial. */
export async function eliminarObservacion(id: string, lector: Lector) {
  const o = await observacionVigente(id);
  if (o.usuario_id !== lector.id && !lector.puedeGestionar) throw new AppError("No podés borrar observaciones de otros usuarios.", 403);
  await prisma.planificacionObservacion.update({
    where: { id },
    data: { eliminado_en: new Date(), eliminado_por: lector.nombre, historial: { create: { accion: "ELIMINADA", texto: o.texto, por: lector.nombre } } },
  });
  return itemConObservaciones(o.item_id, lector);
}
