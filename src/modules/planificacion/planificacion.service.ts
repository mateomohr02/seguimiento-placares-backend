import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { fechaISO, parseFecha } from "../planillas/schemas/planilla.schema";
import { PLANIFICACIONES, esPlantilla, type Plantilla, type PlanificacionCatalogo } from "./planificacion.catalogo";
import type { ItemInput, ReordenarInput } from "./schemas/planificacion.schema";

export type { Plantilla } from "./planificacion.catalogo";

// Planificaciones semanales INDEPENDIENTES de las estaciones de trabajo (diseño.md §14.4 y §19.5). Hay un catálogo fijo
// (planificacion.catalogo.ts): TERMOLAMINADO (una lista por semana, lunes a viernes) y CALIDAD (una lista por día, de lunes a
// sábado). Las filas pertenecen a la planificación (`plantilla`), no a una estación. A cada estación se le ASIGNA una planificación
// (`estacion_trabajo.plantilla_planificacion`); varias estaciones pueden tener la misma y ven las mismas filas. El nombre de la
// estación no interviene. El cliente es texto libre. El N° TW (`n_tw`) identifica el pedido: si coincide exacto con
// un `pedido.codigo_pedido` vigente la fila queda asociada (`pedido_id`: de ahí salen el N° de orden y los links); si no, se
// guarda SIN pedido (`sin_pedido`) y puede asociarse después editándola. El estado de producción lo tiene la estación de
// trabajo: cualquier usuario de una estación (activa) puede marcarlo en cada fila; si está en varias estaciones con estados
// distintos, puede marcar cualquiera (§17), sea cual sea la estación cuya planificación esté mirando.

export const DIA_MS = 86_400_000;

/** Roles que ven y eligen TODAS las planificaciones del catálogo (aunque ninguna estación la tenga asignada); el resto (fábrica) solo las asignadas a sus estaciones activas. */
const ROLES_VEN_TODAS = ["admin", "tecnica", "gerencia"];

/** Lunes de la semana de una fecha (la semana de producción va de lunes a viernes; la de Calidad, de lunes a sábado). */
export function lunesDe(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(d.getTime() - dow * DIA_MS);
}

const itemSelect = {
  id: true,
  plantilla: true,
  semana_inicio: true,
  dia: true,
  orden: true,
  pedido_id: true,
  pedido: { select: { id: true, orden: { select: { id: true, numeroOrdenCustom: true } } } },
  n_tw: true,
  n_orden: true,
  cliente: true,
  modelo: true,
  color: true,
  modulos: true,
  compromiso: true,
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

/** Quién mira la planificación: define qué planificaciones ve y qué observaciones puede editar (las suyas) y borrar (las suyas, o cualquiera si gestiona). */
export interface Lector {
  id: string;
  nombre: string;
  rol: string;
  puedeGestionar: boolean;
}

function itemDTO(i: ItemDB, lector: Lector) {
  return {
    id: i.id,
    plantilla: i.plantilla,
    semana_inicio: fechaISO(i.semana_inicio),
    dia: dia(i.dia),
    pedido_id: i.pedido_id,
    orden_id: i.pedido?.orden.id ?? null,
    sin_pedido: i.pedido_id === null,
    n_tw: i.n_tw,
    // Con pedido, el N° de orden es el de su orden; sin pedido, el texto guardado en la fila (puede ser null).
    n_orden: i.pedido ? i.pedido.orden.numeroOrdenCustom : i.n_orden,
    cliente: i.cliente,
    modelo: i.modelo,
    color: i.color,
    compromiso: dia(i.compromiso),
    modulos: i.modulos,
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

// --- Planificaciones visibles ---

/**
 * Planificaciones del catálogo que el usuario puede ver, en el orden del catálogo. Admin, técnica y gerencia ven todas; el
 * resto (fábrica) las asignadas a las estaciones ACTIVAS de las que es miembro (sin repetir). Una estación sin planificación
 * asignada, o inactiva, no aporta ninguna.
 */
export async function planificacionesVisibles(lector: Lector): Promise<PlanificacionCatalogo[]> {
  if (ROLES_VEN_TODAS.includes(lector.rol)) return [...PLANIFICACIONES];
  const estaciones = await prisma.estacionTrabajo.findMany({
    where: { activa: true, plantilla_planificacion: { not: null }, usuarios: { some: { usuario_id: lector.id } } },
    select: { plantilla_planificacion: true },
  });
  const asignadas = new Set(estaciones.map((e) => e.plantilla_planificacion));
  return PLANIFICACIONES.filter((p) => asignadas.has(p.clave));
}

/**
 * La planificación pedida (si el usuario la ve) o, sin `plantillaRaw`, la primera que ve. 400 si la clave no es del catálogo,
 * 403 si existe pero no la ve, 404 si no pidió ninguna y no ve ninguna.
 */
async function resolverPlanificacion(plantillaRaw: string | undefined, lector: Lector): Promise<PlanificacionCatalogo> {
  if (plantillaRaw !== undefined && !esPlantilla(plantillaRaw)) {
    throw new AppError(`plantilla: tiene que ser una de ${PLANIFICACIONES.map((p) => p.clave).join(", ")}.`, 400);
  }
  const visibles = await planificacionesVisibles(lector);
  if (plantillaRaw === undefined) {
    if (visibles.length === 0) throw new AppError("No hay planificación disponible para tus estaciones de trabajo.", 404);
    return visibles[0];
  }
  const p = visibles.find((v) => v.clave === plantillaRaw);
  if (!p) throw new AppError("No tenés acceso a esa planificación.", 403);
  return p;
}

// --- Lectura de una semana ---

/**
 * Estados de producción que el usuario puede marcar: los de sus estaciones de trabajo activas (diseño.md §17), sin
 * repetir, en el orden del catálogo. Vacío si ninguna de sus estaciones tiene estado (o si no tiene estaciones).
 * No depende de qué planificación esté mirando.
 */
export async function estadosDeUsuario(usuarioId: string) {
  return prisma.estadoProduccion.findMany({
    where: { estaciones: { some: { activa: true, usuarios: { some: { usuario_id: usuarioId } } } } },
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, color: true },
  });
}

export async function getSemana(plantillaRaw: string | undefined, semanaRaw: string | undefined, lector: Lector) {
  const planificacion = await resolverPlanificacion(plantillaRaw, lector);
  const hoy = parseFecha(fechaISO(new Date()));
  const semana = lunesDe(semanaRaw ? parseFecha(semanaRaw, "La semana") : hoy);
  const [items, semanas, estados, misEstados] = await Promise.all([
    prisma.planificacionItem.findMany({
      where: { plantilla: planificacion.clave, semana_inicio: semana, eliminado_en: null },
      select: itemSelect,
      // Termolaminado: por `orden` (todas con dia = null). Calidad: por día y luego `orden`.
      orderBy: [{ dia: "asc" }, { orden: "asc" }, { creado_en: "asc" }],
    }),
    prisma.planificacionItem.findMany({
      where: { plantilla: planificacion.clave, eliminado_en: null },
      select: { semana_inicio: true },
      distinct: ["semana_inicio"],
      orderBy: { semana_inicio: "desc" },
      take: 30,
    }),
    prisma.estadoProduccion.findMany({ orderBy: [{ orden: "asc" }, { creado_en: "asc" }], select: { id: true, nombre: true, color: true } }),
    estadosDeUsuario(lector.id),
  ]);
  return {
    planificacion,
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

/** Pedido vigente (ni él ni su orden eliminados) cuyo N° de pedido es EXACTAMENTE `nTw` (si hay varios, el más reciente), o null. */
async function pedidoPorNTw(nTw: string) {
  if (nTw === "") return null;
  return prisma.pedido.findFirst({
    where: { codigo_pedido: nTw, estado: { not: "ELIMINADO" }, eliminado_en: null, orden: { estado: { not: "ELIMINADO" }, eliminado_en: null } },
    orderBy: [{ creado_en: "desc" }, { id: "asc" }],
    select: { id: true, codigo_pedido: true, referencia: true, orden: { select: { id: true, numeroOrdenCustom: true } } },
  });
}

/** Igual que `pedidoPorNTw` para varios N° TW de una vez (importador): mapa N° TW exacto -> pedido (el más reciente si hay varios). */
export async function pedidosPorNTw(nTws: string[]) {
  const unicos = [...new Set(nTws.filter((t) => t !== ""))];
  const mapa = new Map<string, { id: string; orden: { id: string; numeroOrdenCustom: string | null } }>();
  for (let i = 0; i < unicos.length; i += 500) {
    const pedidos = await prisma.pedido.findMany({
      where: { codigo_pedido: { in: unicos.slice(i, i + 500) }, estado: { not: "ELIMINADO" }, eliminado_en: null, orden: { estado: { not: "ELIMINADO" }, eliminado_en: null } },
      orderBy: [{ creado_en: "desc" }, { id: "asc" }],
      select: { id: true, codigo_pedido: true, orden: { select: { id: true, numeroOrdenCustom: true } } },
    });
    // Ordenados del más reciente al más antiguo: el primero de cada N° TW es el que usa `pedidoPorNTw`.
    for (const p of pedidos) if (!mapa.has(p.codigo_pedido)) mapa.set(p.codigo_pedido, { id: p.id, orden: p.orden });
  }
  return mapa;
}

/** Para validar un N° TW tipeado: el pedido con ese N° exacto (o null si no existe). */
export async function buscarPedidoPorNTw(nTw: string) {
  const p = await pedidoPorNTw(nTw);
  return p ? { pedido_id: p.id, codigo_pedido: p.codigo_pedido, referencia: p.referencia, orden_id: p.orden.id, n_orden: p.orden.numeroOrdenCustom } : null;
}

/** Dónde está un N° TW dentro de una planificación: las filas vigentes cuyo `n_tw` contiene `q` (estén o no asociadas a un pedido). */
export async function buscarEnPlanificacion(plantillaRaw: string, q: string, lector: Lector) {
  const planificacion = await resolverPlanificacion(plantillaRaw, lector);
  if (q === "") return [];
  const items = await prisma.planificacionItem.findMany({
    where: { plantilla: planificacion.clave, eliminado_en: null, n_tw: { contains: q, mode: "insensitive" } },
    orderBy: [{ semana_inicio: "desc" }, { dia: "asc" }, { orden: "asc" }],
    take: 50,
    select: { id: true, semana_inicio: true, dia: true, n_tw: true, cliente: true, pedido_id: true },
  });
  return items.map((i) => ({ item_id: i.id, semana_inicio: fechaISO(i.semana_inicio), dia: dia(i.dia), n_tw: i.n_tw, cliente: i.cliente, sin_pedido: i.pedido_id === null }));
}

// --- Alta, edición, baja y orden de las filas ---

const fecha = (v: string | null, etiqueta: string) => (v ? parseFecha(v, etiqueta) : null);

/** El pedido tiene que existir y, al cargarlo o cambiarlo, no estar eliminado (ni su orden). `actual` = el que ya tenía la fila. */
async function exigirPedido(pedidoId: string, actual?: string | null) {
  const p = await prisma.pedido.findUnique({ where: { id: pedidoId }, select: { codigo_pedido: true, estado: true, orden: { select: { estado: true } } } });
  if (!p) throw new AppError("pedido_id: el pedido no existe.", 400);
  if (pedidoId !== actual && (p.estado === "ELIMINADO" || p.orden.estado === "ELIMINADO")) {
    throw new AppError("pedido_id: el pedido fue eliminado.", 400);
  }
  return p;
}

/**
 * Qué pedido le toca a la fila y qué N° TW queda. Con `pedido_id` se valida y `n_tw` pasa a ser el del pedido; sin él se busca el
 * pedido con ese N° TW exacto (si no hay, la fila queda sin pedido). Al editar, si el N° TW no cambió y la fila ya tenía pedido,
 * lo conserva (aunque después haya sido eliminado).
 */
async function resolverPedido(input: ItemInput, actual?: { pedido_id: string | null; n_tw: string }) {
  if (input.pedido_id) {
    const p = await exigirPedido(input.pedido_id, actual?.pedido_id);
    return { pedido_id: input.pedido_id, n_tw: p.codigo_pedido };
  }
  if (actual?.pedido_id && actual.n_tw === input.n_tw) return { pedido_id: actual.pedido_id, n_tw: input.n_tw };
  const p = await pedidoPorNTw(input.n_tw);
  return { pedido_id: p?.id ?? null, n_tw: input.n_tw };
}

/** El día (AAAA-MM-DD) de Calidad: de lunes a sábado de la semana que empieza el `lunes`. */
export function exigirDiaDeCalidad(raw: string | null, lunes: Date): Date {
  if (!raw) throw new AppError("dia: es obligatorio en la planificación de Calidad (de lunes a sábado).", 400);
  const d = parseFecha(raw, "El día");
  const desplazamiento = Math.round((d.getTime() - lunes.getTime()) / DIA_MS);
  if (desplazamiento < 0 || desplazamiento > 5) throw new AppError(`dia: tiene que ser un día de lunes a sábado de la semana del ${fechaISO(lunes)}.`, 400);
  return d;
}

export function datosDe(i: ItemInput, pedido: { pedido_id: string | null; n_tw: string }) {
  const semana_inicio = lunesDe(parseFecha(i.semana, "La semana"));
  const plantilla = i.plantilla;
  const calidad = plantilla === "CALIDAD";
  return {
    plantilla,
    pedido_id: pedido.pedido_id,
    n_tw: pedido.n_tw,
    cliente: i.cliente,
    semana_inicio,
    // Termolaminado ignora día y módulos; Calidad ignora color y compromiso.
    dia: calidad ? exigirDiaDeCalidad(i.dia, semana_inicio) : null,
    modelo: i.modelo,
    color: calidad ? null : i.color,
    compromiso: calidad ? null : fecha(i.compromiso, "La fecha de compromiso"),
    modulos: calidad ? i.modulos : null,
    observaciones: i.observaciones,
  };
}

async function itemVigente(id: string) {
  const i = await prisma.planificacionItem.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!i || i.eliminado_en) throw new AppError("Fila no encontrada.", 404);
}

/** Lugar al final de la lista: (planificación, semana) en Termolaminado; (planificación, semana, día) en Calidad (`diaDe` = null en Termolaminado). */
async function proximoOrden(plantilla: Plantilla, semana: Date, diaDe: Date | null) {
  const ultimo = await prisma.planificacionItem.aggregate({
    where: { plantilla, semana_inicio: semana, ...(diaDe ? { dia: diaDe } : {}), eliminado_en: null },
    _max: { orden: true },
  });
  return (ultimo._max.orden ?? -1) + 1;
}

export async function crearItem(input: ItemInput, lector: Lector) {
  const datos = datosDe(input, await resolverPedido(input));
  const orden = await proximoOrden(datos.plantilla, datos.semana_inicio, datos.dia);
  const creada = await prisma.planificacionItem.create({ data: { ...datos, orden }, select: itemSelect });
  return itemDTO(creada, lector);
}

export async function actualizarItem(id: string, input: ItemInput, lector: Lector) {
  const actual = await prisma.planificacionItem.findUnique({
    where: { id },
    select: { eliminado_en: true, plantilla: true, semana_inicio: true, dia: true, pedido_id: true, n_tw: true, n_orden: true },
  });
  if (!actual || actual.eliminado_en) throw new AppError("Fila no encontrada.", 404);
  const datos = datosDe(input, await resolverPedido(input, actual));
  // Cambiar de planificación, de semana o de día manda la fila al final de la nueva lista.
  const mismoDia = (actual.dia?.getTime() ?? null) === (datos.dia?.getTime() ?? null);
  const cambio = actual.plantilla !== datos.plantilla || actual.semana_inicio.getTime() !== datos.semana_inicio.getTime() || !mismoDia;
  const orden = cambio ? await proximoOrden(datos.plantilla, datos.semana_inicio, datos.dia) : undefined;
  // El N° de orden de texto solo vale sin pedido: al asociarse a uno, la orden sale del pedido.
  const nOrden = datos.pedido_id ? null : actual.n_orden;
  const u = await prisma.planificacionItem.update({ where: { id }, data: { ...datos, n_orden: nOrden, ...(orden === undefined ? {} : { orden }) }, select: itemSelect });
  return itemDTO(u, lector);
}

export async function eliminarItem(id: string) {
  await itemVigente(id);
  await prisma.planificacionItem.update({ where: { id }, data: { eliminado_en: new Date() } });
}

/**
 * Reordena las filas de una lista: (planificación + semana) en Termolaminado; (planificación + semana + día) en Calidad, donde `dia` es
 * obligatorio (de lunes a sábado). `ids` tiene que ser EXACTAMENTE el conjunto de filas vigentes de esa lista (en el orden
 * nuevo). Reasigna `orden` 0..n-1 en una transacción, con las filas bloqueadas.
 */
export async function reordenarItems(input: ReordenarInput) {
  const semana = lunesDe(parseFecha(input.semana, "La semana"));
  const diaDe = input.plantilla === "CALIDAD" ? exigirDiaDeCalidad(input.dia, semana) : null;
  const filtroDia = diaDe ? Prisma.sql`AND "dia" = ${fechaISO(diaDe)}::date` : Prisma.empty;
  await prisma.$transaction(async (tx) => {
    const vigentes = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id" FROM "planificacion_item"
      WHERE "plantilla" = ${input.plantilla}::"PlantillaPlanificacion" AND "semana_inicio" = ${fechaISO(semana)}::date ${filtroDia} AND "eliminado_en" IS NULL
      FOR UPDATE`;
    const set = new Set(vigentes.map((v) => v.id.toLowerCase()));
    const mismas = input.ids.length === set.size && input.ids.every((id) => set.has(id.toLowerCase()));
    if (!mismas) {
      throw new AppError(`ids: la lista no coincide con las filas vigentes de esa planificación, semana${diaDe ? " y día" : ""} (puede que alguien haya agregado o quitado filas): recargá la planificación.`, 400);
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
