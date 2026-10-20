import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import {
  AREA_TERMOLAMINADO,
  ESTACIONES,
  fechaISO,
  parseFecha,
  type Estacion,
  type FilaInput,
  type PlanillaBody,
} from "../schemas/planilla.schema";

// Planillas de producción de Termolaminado (diseño.md §14): una por estación y día.

const filaSelect = {
  id: true,
  orden: true,
  hora_inicio: true,
  hora_fin: true,
  pedido_codigo: true,
  pedido_id: true,
  cantidad_piezas: true,
  observaciones: true,
  colocacion_pvc: true,
  perfilado: true,
  colores: true,
  mesa_chica: true,
  mesa_grande: true,
  fotos: {
    where: { eliminado_en: null },
    select: { id: true, mime: true, tamano: true, creado_en: true },
    orderBy: { creado_en: "asc" },
  },
} satisfies Prisma.PlanillaFilaSelect;

type FilaDB = Prisma.PlanillaFilaGetPayload<{ select: typeof filaSelect }>;

function filaDTO(f: FilaDB) {
  return { ...f, fotos: f.fotos.map((x) => ({ ...x, creado_en: x.creado_en.toISOString() })) };
}

type PlanillaDB = Prisma.PlanillaProduccionGetPayload<{
  include: { versiones: { select: { id: true; version: true; guardada_por: true; guardada_en: true; reemplazada_por: true; reemplazada_en: true } } };
}> & { filas: FilaDB[] };

function planillaDTO(p: PlanillaDB) {
  return {
    id: p.id,
    estacion: p.estacion,
    fecha: fechaISO(p.fecha),
    estado: p.estado,
    operarios: p.operarios,
    creado_por: p.creado_por,
    modificado_por: p.modificado_por,
    creado_en: p.creado_en.toISOString(),
    actualizado_en: p.actualizado_en.toISOString(),
    guardada_en: p.guardada_en?.toISOString() ?? null,
    filas: p.filas.map(filaDTO),
    versiones: p.versiones.map((v) => ({
      id: v.id,
      version: v.version,
      guardada_por: v.guardada_por,
      guardada_en: v.guardada_en.toISOString(),
      reemplazada_por: v.reemplazada_por,
      reemplazada_en: v.reemplazada_en.toISOString(),
    })),
  };
}

const detalleInclude = {
  filas: { where: { eliminado_en: null }, select: filaSelect, orderBy: { orden: "asc" } },
  versiones: {
    select: { id: true, version: true, guardada_por: true, guardada_en: true, reemplazada_por: true, reemplazada_en: true },
    orderBy: { version: "desc" },
  },
} satisfies Prisma.PlanillaProduccionInclude;

async function cargarDetalle(where: Prisma.PlanillaProduccionWhereUniqueInput) {
  const p = await prisma.planillaProduccion.findUnique({ where, include: detalleInclude });
  return p as unknown as PlanillaDB | null;
}

export async function getPlanillaDelDia(estacion: Estacion, fecha: string) {
  const p = await cargarDetalle({ area_estacion_fecha: { area: AREA_TERMOLAMINADO, estacion, fecha: parseFecha(fecha) } });
  return p ? planillaDTO(p) : null;
}

export async function getPlanilla(id: string) {
  const p = await cargarDetalle({ id });
  if (!p) throw new AppError("Planilla no encontrada.", 404);
  return planillaDTO(p);
}

export async function getVersion(id: string) {
  const v = await prisma.planillaVersion.findUnique({ where: { id }, include: { planilla: { select: { estacion: true } } } });
  if (!v) throw new AppError("Versión no encontrada.", 404);
  return {
    id: v.id,
    planilla_id: v.planilla_id,
    estacion: v.planilla.estacion,
    version: v.version,
    guardada_por: v.guardada_por,
    guardada_en: v.guardada_en.toISOString(),
    reemplazada_por: v.reemplazada_por,
    reemplazada_en: v.reemplazada_en.toISOString(),
    datos: v.datos,
  };
}

const filaVacia = (f: FilaInput) =>
  !f.pedido_codigo && !f.hora_inicio && !f.hora_fin && f.cantidad_piezas === null && !f.observaciones &&
  !f.colocacion_pvc && !f.perfilado && !f.colores && f.mesa_chica === null && f.mesa_grande === null;

const aMinutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

// Reglas al cerrar la planilla (BORRADOR acepta filas incompletas).
function validarGuardada(estacion: Estacion, filas: FilaInput[]) {
  if (filas.length === 0) throw new AppError("La planilla no tiene filas: cargá al menos un pedido.", 400);
  filas.forEach((f, i) => {
    const n = `Fila ${i + 1}: `;
    if (filaVacia(f)) throw new AppError(`${n}está vacía; completala o quitala.`, 400);
    if (!f.pedido_codigo) throw new AppError(`${n}falta el N° de pedido.`, 400);
    if (!f.hora_inicio) throw new AppError(`${n}falta la hora de inicio.`, 400);
    if (estacion === "PVC" && f.mesa_chica === null && f.mesa_grande === null) {
      throw new AppError(`${n}cargá las piezas en mesa chica y/o mesa grande.`, 400);
    }
    if (estacion !== "PVC" && f.cantidad_piezas === null) throw new AppError(`${n}falta la cantidad de piezas.`, 400);
  });
}

function validarHoras(filas: FilaInput[]) {
  filas.forEach((f, i) => {
    if (f.hora_inicio && f.hora_fin && aMinutos(f.hora_fin) < aMinutos(f.hora_inicio)) {
      throw new AppError(`Fila ${i + 1}: la hora de fin es anterior a la de inicio.`, 400);
    }
  });
}

// Deja en cada fila solo los campos de su estación; en PVC la cantidad de piezas es mesa chica + mesa grande.
function normalizarFila(estacion: Estacion, f: FilaInput) {
  const pvc = estacion === "PVC";
  const piezasPvc = f.mesa_chica === null && f.mesa_grande === null ? null : (f.mesa_chica ?? 0) + (f.mesa_grande ?? 0);
  return {
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
    pedido_codigo: f.pedido_codigo,
    cantidad_piezas: pvc ? piezasPvc : f.cantidad_piezas,
    observaciones: f.observaciones,
    colocacion_pvc: pvc ? f.colocacion_pvc : null,
    perfilado: pvc ? f.perfilado : null,
    colores: pvc ? f.colores : null,
    mesa_chica: pvc ? f.mesa_chica : null,
    mesa_grande: pvc ? f.mesa_grande : null,
  };
}

// Pedidos sincronizados a los que coincide exactamente el código cargado (mayúsculas).
async function pedidosPorCodigo(codigos: string[]) {
  const unicos = [...new Set(codigos.filter(Boolean))];
  if (unicos.length === 0) return new Map<string, string>();
  const pedidos = await prisma.pedido.findMany({
    where: { codigo_pedido: { in: unicos, mode: "insensitive" }, estado: { not: "ELIMINADO" }, orden: { estado: { not: "ELIMINADO" } } },
    select: { id: true, codigo_pedido: true },
    orderBy: { creado_en: "desc" },
  });
  const m = new Map<string, string>();
  for (const p of pedidos) if (!m.has(p.codigo_pedido.toUpperCase())) m.set(p.codigo_pedido.toUpperCase(), p.id);
  return m;
}

/**
 * Crea o actualiza la planilla de una estación y un día con el estado completo que manda
 * el formulario (se usa tanto para el guardado automático del borrador como para cerrarla
 * o corregirla). Corregir una planilla GUARDADA guarda antes la versión previa.
 */
export async function guardarPlanilla(estacion: Estacion, fechaStr: string, body: PlanillaBody, usuario: string, usuarioId: string) {
  const fecha = parseFecha(fechaStr);
  validarHoras(body.filas);
  if (body.estado === "GUARDADA") validarGuardada(estacion, body.filas);

  const pedidos = await pedidosPorCodigo(body.filas.map((f) => f.pedido_codigo));

  const id = await prisma.$transaction(async (tx) => {
    const where = { area: AREA_TERMOLAMINADO, estacion, fecha };
    let existente = await tx.planillaProduccion.findUnique({
      where: { area_estacion_fecha: where },
      include: { filas: { where: { eliminado_en: null }, select: filaSelect, orderBy: { orden: "asc" } } },
    });

    if (existente?.estado === "GUARDADA" && body.estado === "BORRADOR") {
      throw new AppError("La planilla ya está guardada: guardá los cambios para corregirla.", 409);
    }

    if (!existente) {
      const creada = await tx.planillaProduccion.create({
        data: { ...where, estado: "BORRADOR", operarios: [], creado_por: usuario, modificado_por: usuario },
      });
      existente = { ...creada, filas: [] };
    } else if (existente.estado === "GUARDADA") {
      // Versión previa antes de aplicar la corrección.
      const version = (await tx.planillaVersion.count({ where: { planilla_id: existente.id } })) + 1;
      await tx.planillaVersion.create({
        data: {
          planilla_id: existente.id,
          version,
          datos: {
            estado: existente.estado,
            operarios: existente.operarios,
            // Las fotos quedan en la base aunque se quite el ítem (borrado lógico): se guardan sus datos para verlas en el historial.
            filas: existente.filas.map((f) => ({ ...f, fotos: f.fotos.length, fotos_lista: f.fotos })),
          } as unknown as Prisma.InputJsonValue,
          guardada_por: existente.modificado_por,
          guardada_en: existente.actualizado_en,
          reemplazada_por: usuario,
        },
      });
    }

    // Los operarios se eligen a mano para cada planilla y se guardan como nombre: lo que cambie
    // después en la lista del área no altera las planillas ya creadas.
    const pool = new Set((await tx.usuarioOperario.findMany({ where: { usuario_id: usuarioId }, select: { nombre: true } })).map((o) => o.nombre));
    const elegidos = [...new Set(body.operarios)];
    for (const n of elegidos) {
      if (!pool.has(n) && !existente.operarios.includes(n)) throw new AppError(`El operario "${n}" no está entre los operarios de tu estación.`, 400);
    }

    const planillaId = existente.id;
    const idsExistentes = new Set(existente.filas.map((f) => f.id));
    const idsEnviados = body.filas.map((f) => f.id).filter((x): x is string => !!x);
    if (idsEnviados.some((x) => !idsExistentes.has(x))) throw new AppError("Una fila no pertenece a esta planilla.", 400);

    // Los ítems que ya no vienen se quitan con borrado lógico: conservan sus datos y sus fotos.
    await tx.planillaFila.updateMany({ where: { planilla_id: planillaId, eliminado_en: null, id: { notIn: idsEnviados } }, data: { eliminado_en: new Date() } });

    for (const [orden, f] of body.filas.entries()) {
      const datos = { ...normalizarFila(estacion, f), orden, pedido_id: pedidos.get(f.pedido_codigo) ?? null };
      if (f.id) await tx.planillaFila.update({ where: { id: f.id }, data: datos });
      else await tx.planillaFila.create({ data: { ...datos, planilla_id: planillaId } });
    }

    await tx.planillaProduccion.update({
      where: { id: planillaId },
      data: {
        estado: body.estado,
        operarios: elegidos,
        modificado_por: usuario,
        actualizado_en: new Date(),
        ...(body.estado === "GUARDADA" && !existente.guardada_en ? { guardada_en: new Date() } : {}),
      },
    });
    return planillaId;
  });

  return getPlanilla(id);
}

// ───────────────────────── Consultas (tabla, indicadores, trazabilidad) ─────────────────────────

const DIA_MS = 86_400_000;

function rango(desdeRaw?: string, hastaRaw?: string) {
  const hoy = new Date();
  const hasta = hastaRaw ? parseFecha(hastaRaw, "La fecha 'hasta'") : parseFecha(fechaISO(hoy));
  const desde = desdeRaw ? parseFecha(desdeRaw, "La fecha 'desde'") : new Date(hasta.getTime() - 29 * DIA_MS);
  if (desde > hasta) throw new AppError("La fecha 'desde' es posterior a 'hasta'.", 400);
  if ((hasta.getTime() - desde.getTime()) / DIA_MS > 400) throw new AppError("El rango no puede superar los 400 días.", 400);
  return { desde, hasta };
}

export interface FiltrosRegistros {
  desde?: string;
  hasta?: string;
  estacion?: Estacion;
  /** Estaciones que el usuario puede ver (las de su acceso si es de fábrica). */
  estaciones: readonly Estacion[];
  estado?: "BORRADOR" | "GUARDADA";
  pedido?: string;
}

export async function listarRegistros(f: FiltrosRegistros) {
  const { desde, hasta } = rango(f.desde, f.hasta);
  const filas = await prisma.planillaFila.findMany({
    where: {
      eliminado_en: null,
      planilla: {
        area: AREA_TERMOLAMINADO,
        fecha: { gte: desde, lte: hasta },
        estacion: f.estacion ? f.estacion : { in: [...f.estaciones] },
        ...(f.estado ? { estado: f.estado } : {}),
      },
      ...(f.pedido ? { pedido_codigo: { contains: f.pedido.trim().toUpperCase() } } : {}),
    },
    select: {
      id: true,
      orden: true,
      hora_inicio: true,
      hora_fin: true,
      pedido_codigo: true,
      pedido_id: true,
      cantidad_piezas: true,
      observaciones: true,
      colocacion_pvc: true,
      perfilado: true,
      colores: true,
      mesa_chica: true,
      mesa_grande: true,
      _count: { select: { fotos: { where: { eliminado_en: null } } } },
      planilla: { select: { id: true, estacion: true, fecha: true, estado: true, operarios: true, _count: { select: { versiones: true } } } },
    },
    orderBy: [{ planilla: { fecha: "desc" } }, { planilla: { estacion: "asc" } }, { orden: "asc" }],
    take: 3000,
  });
  return filas.map(({ _count, planilla, ...fila }) => ({
    ...fila,
    fotos: _count.fotos,
    planilla_id: planilla.id,
    estacion: planilla.estacion,
    fecha: fechaISO(planilla.fecha),
    estado: planilla.estado,
    operarios: planilla.operarios,
    versiones: planilla._count.versiones,
  }));
}

const minutos = (ini: string | null, fin: string | null) => (ini && fin && aMinutos(fin) >= aMinutos(ini) ? aMinutos(fin) - aMinutos(ini) : 0);

interface FilaTraza {
  pedido_codigo: string;
  estacion: Estacion;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  cantidad_piezas: number | null;
  fotos: number;
  estado: "BORRADOR" | "GUARDADA";
  observaciones: string | null;
  planilla_id: string;
}

async function filasPorCodigos(codigos: string[], estaciones: readonly Estacion[] = ESTACIONES): Promise<FilaTraza[]> {
  if (codigos.length === 0) return [];
  const filas = await prisma.planillaFila.findMany({
    where: { eliminado_en: null, pedido_codigo: { in: codigos }, planilla: { area: AREA_TERMOLAMINADO, estacion: { in: [...estaciones] } } },
    select: {
      pedido_codigo: true,
      hora_inicio: true,
      hora_fin: true,
      cantidad_piezas: true,
      observaciones: true,
      _count: { select: { fotos: { where: { eliminado_en: null } } } },
      planilla: { select: { id: true, estacion: true, fecha: true, estado: true } },
    },
    orderBy: [{ planilla: { fecha: "asc" } }, { hora_inicio: "asc" }],
  });
  return filas.map((f) => ({
    pedido_codigo: f.pedido_codigo,
    estacion: f.planilla.estacion,
    fecha: fechaISO(f.planilla.fecha),
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
    cantidad_piezas: f.cantidad_piezas,
    fotos: f._count.fotos,
    estado: f.planilla.estado,
    observaciones: f.observaciones,
    planilla_id: f.planilla.id,
  }));
}

function resumenPedido(codigo: string, filas: FilaTraza[], estaciones: readonly Estacion[] = ESTACIONES) {
  const porEstacion = Object.fromEntries(
    estaciones.map((e) => {
      const fs = filas.filter((f) => f.estacion === e);
      return [
        e,
        {
          registros: fs.length,
          piezas: fs.reduce((s, f) => s + (f.cantidad_piezas ?? 0), 0),
          minutos: fs.reduce((s, f) => s + minutos(f.hora_inicio, f.hora_fin), 0),
          primera: fs[0]?.fecha ?? null,
          ultima: fs.at(-1)?.fecha ?? null,
        },
      ];
    }),
  ) as Partial<Record<Estacion, { registros: number; piezas: number; minutos: number; primera: string | null; ultima: string | null }>>;
  const pasadas = estaciones.filter((e) => porEstacion[e]!.registros > 0);
  const piezas = pasadas.map((e) => porEstacion[e]!.piezas);
  return {
    pedido: codigo,
    estaciones: porEstacion,
    completo: pasadas.length === estaciones.length,
    // La estación siguiente a la última por la que pasó, si falta.
    siguiente: pasadas.length === estaciones.length ? null : (estaciones.find((e) => porEstacion[e]!.registros === 0) ?? null),
    diferencia: pasadas.length > 1 && new Set(piezas).size > 1,
  };
}

export async function trazabilidadDePedido(codigo: string, estaciones: readonly Estacion[] = ESTACIONES) {
  const c = codigo.trim().toUpperCase();
  if (!c) throw new AppError("Indicá el N° de pedido.", 400);
  const filas = await filasPorCodigos([c], estaciones);
  const pedido = await prisma.pedido.findFirst({
    where: { codigo_pedido: { equals: c, mode: "insensitive" }, estado: { not: "ELIMINADO" } },
    select: { id: true, referencia: true },
  });
  return { ...resumenPedido(c, filas, estaciones), pedido_id: pedido?.id ?? null, referencia: pedido?.referencia ?? null, registros: filas };
}

export async function indicadores(desdeRaw?: string, hastaRaw?: string) {
  const { desde, hasta } = rango(desdeRaw, hastaRaw);
  const enRango = await prisma.planillaFila.findMany({
    where: { eliminado_en: null, planilla: { area: AREA_TERMOLAMINADO, fecha: { gte: desde, lte: hasta } } },
    select: {
      pedido_codigo: true,
      hora_inicio: true,
      hora_fin: true,
      cantidad_piezas: true,
      planilla: { select: { estacion: true, fecha: true } },
    },
  });

  const porEstacion = ESTACIONES.map((e) => {
    const fs = enRango.filter((f) => f.planilla.estacion === e);
    const min = fs.reduce((s, f) => s + minutos(f.hora_inicio, f.hora_fin), 0);
    const piezas = fs.reduce((s, f) => s + (f.cantidad_piezas ?? 0), 0);
    return {
      estacion: e,
      dias: new Set(fs.map((f) => fechaISO(f.planilla.fecha))).size,
      registros: fs.length,
      pedidos: new Set(fs.map((f) => f.pedido_codigo).filter(Boolean)).size,
      piezas,
      minutos: min,
      piezasPorHora: min > 0 ? Math.round((piezas / (min / 60)) * 10) / 10 : null,
    };
  });

  const dias = new Map<string, Record<Estacion, number>>();
  for (const f of enRango) {
    const d = fechaISO(f.planilla.fecha);
    const reg = dias.get(d) ?? { LIJADO: 0, ENCOLADO: 0, PVC: 0 };
    reg[f.planilla.estacion] += f.cantidad_piezas ?? 0;
    dias.set(d, reg);
  }
  const porDia = [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, piezas]) => ({ fecha, piezas }));

  // Trazabilidad de los pedidos que aparecen en el rango, con todo su historial.
  const codigos = [...new Set(enRango.map((f) => f.pedido_codigo).filter(Boolean))];
  const todas = await filasPorCodigos(codigos);
  const porPedido = new Map<string, FilaTraza[]>();
  for (const f of todas) porPedido.set(f.pedido_codigo, [...(porPedido.get(f.pedido_codigo) ?? []), f]);
  const pedidos = codigos.map((c) => resumenPedido(c, porPedido.get(c) ?? []));

  return {
    desde: fechaISO(desde),
    hasta: fechaISO(hasta),
    porEstacion,
    porDia,
    pedidos: {
      total: pedidos.length,
      completos: pedidos.filter((p) => p.completo).length,
      enProceso: pedidos.filter((p) => !p.completo).length,
      conDiferencia: pedidos.filter((p) => p.diferencia).length,
      detalle: pedidos.sort((a, b) => Number(a.completo) - Number(b.completo) || a.pedido.localeCompare(b.pedido)),
    },
  };
}

export async function sugerirPedidos(q: string, estaciones: readonly Estacion[] = ESTACIONES) {
  const t = q.trim().toUpperCase();
  if (t.length < 2) return [];
  const [sync, usados] = await Promise.all([
    prisma.pedido.findMany({
      where: { codigo_pedido: { contains: t, mode: "insensitive" }, estado: { not: "ELIMINADO" }, orden: { estado: { not: "ELIMINADO" } } },
      select: { codigo_pedido: true, referencia: true },
      distinct: ["codigo_pedido"],
      take: 8,
    }),
    prisma.planillaFila.findMany({ where: { eliminado_en: null, pedido_codigo: { contains: t }, planilla: { estacion: { in: [...estaciones] } } }, select: { pedido_codigo: true }, distinct: ["pedido_codigo"], take: 8 }),
  ]);
  const out = new Map<string, { codigo: string; referencia: string | null }>();
  for (const p of sync) out.set(p.codigo_pedido.toUpperCase(), { codigo: p.codigo_pedido.toUpperCase(), referencia: p.referencia });
  for (const u of usados) if (!out.has(u.pedido_codigo)) out.set(u.pedido_codigo, { codigo: u.pedido_codigo, referencia: null });
  return [...out.values()].slice(0, 10);
}

// Códigos de color ya usados, del más al menos frecuente (autocompletado).
export async function coloresUsados(estaciones: readonly Estacion[] = ESTACIONES) {
  const g = await prisma.planillaFila.groupBy({
    by: ["colores"],
    where: { eliminado_en: null, colores: { not: null }, planilla: { estacion: { in: [...estaciones] } } },
    _count: { _all: true },
    orderBy: { _count: { colores: "desc" } },
    take: 200,
  });
  return g.map((x) => x.colores as string);
}
