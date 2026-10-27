import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { type Estacion } from "../schemas/planilla.schema";

// Operarios del usuario que completa una planilla y catálogo de estados de producción (diseño.md §14 y §17).
// La configuración por usuario (planillas y estado) pasó a las estaciones de trabajo (módulo estaciones-trabajo);
// el pool de operarios (usuario_operario) sigue acá hasta la fase 2 de «operarios por estación».

export const MAX_OPERARIOS = 10;

// Operarios entre los que el usuario elige al completar una planilla.
export async function operariosDe(usuarioId: string) {
  const o = await prisma.usuarioOperario.findMany({ where: { usuario_id: usuarioId }, orderBy: { orden: "asc" }, select: { nombre: true } });
  return o.map((x) => x.nombre);
}

/**
 * Operarios que se preseleccionan al abrir una planilla nueva, por estación asignada: los que el usuario dejó elegidos la
 * última vez en esa estación (se guardan al completar la planilla) o, si nunca los cambió, todos sus operarios. Solo se
 * devuelven los que siguen en la lista del usuario. (Lee las tablas viejas: lo reemplaza la fase 2.)
 */
export async function predeterminadosDe(usuarioId: string) {
  const [pool, asignadas] = await Promise.all([operariosDe(usuarioId), prisma.usuarioPlanilla.findMany({ where: { usuario_id: usuarioId }, select: { estacion: true, operarios_predeterminados: true } })]);
  const out: Partial<Record<Estacion, string[]>> = {};
  for (const a of asignadas) {
    const pref = Array.isArray(a.operarios_predeterminados) ? (a.operarios_predeterminados as unknown[]).filter((x): x is string => typeof x === "string") : null;
    out[a.estacion] = pref ? pool.filter((n) => pref.includes(n)) : pool;
  }
  return out;
}

// ───────────────────────── Catálogo de estados de producción ─────────────────────────

/**
 * `estaciones`: cuántas estaciones de trabajo lo tienen asignado. `usuarios` se mantiene por compatibilidad con la forma
 * anterior y ahora vale lo mismo que `estaciones` (el estado lo tiene la estación, no el usuario).
 */
export async function listarEstados() {
  const e = await prisma.estadoProduccion.findMany({
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, color: true, _count: { select: { estaciones: true, usuarios: true, marcas: true } } },
  });
  return e.map((x) => ({ id: x.id, nombre: x.nombre, color: x.color, estaciones: x._count.estaciones, usuarios: x._count.estaciones, marcas: x._count.marcas, asignaciones_viejas: x._count.usuarios }));
}

/**
 * Reemplaza el catálogo con la lista enviada: los que traen `id` se renombran, los nuevos se crean y los que ya no
 * están se borran, salvo que estén asignados a estaciones de trabajo, tengan marcas en la planificación o sigan
 * referenciados por la configuración vieja por usuario (usuario_estado_produccion, conservada sin uso): se rechaza.
 */
export async function guardarEstados(estados: { id?: string; nombre: string; color?: string | null }[]) {
  const limpios = estados.map((e) => ({ id: e.id, nombre: e.nombre.trim().replace(/\s+/g, " "), color: e.color ? e.color.toLowerCase() : null })).filter((e) => e.nombre);
  for (const e of limpios) if (e.color && !/^#[0-9a-f]{6}$/.test(e.color)) throw new AppError(`El color de "${e.nombre}" no es válido (usá #rrggbb).`, 400);
  const vistos = new Set<string>();
  for (const e of limpios) {
    const k = e.nombre.toLowerCase();
    if (vistos.has(k)) throw new AppError(`El estado "${e.nombre}" está repetido.`, 400);
    vistos.add(k);
  }
  const actuales = await listarEstados();
  const idsEnviados = new Set(limpios.map((e) => e.id).filter(Boolean));
  for (const e of limpios) if (e.id && !actuales.some((a) => a.id === e.id)) throw new AppError("Un estado no existe.", 400);
  const aBorrar = actuales.filter((a) => !idsEnviados.has(a.id));
  for (const b of aBorrar) {
    if (b.estaciones > 0) throw new AppError(`No se puede quitar "${b.nombre}": está asignado a ${b.estaciones} estación(es) de trabajo. Cambialo primero.`, 409);
    if (b.marcas > 0) throw new AppError(`No se puede quitar "${b.nombre}": ya tiene ${b.marcas} marca(s) en la planificación.`, 409);
    if (b.asignaciones_viejas > 0) {
      throw new AppError(`No se puede quitar "${b.nombre}": sigue asignado en la configuración anterior por usuario (se conserva como historial).`, 409);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Primero se liberan los nombres (renombrar entre sí no choca con la restricción de nombre único).
    for (const e of limpios.filter((x) => x.id)) await tx.estadoProduccion.update({ where: { id: e.id }, data: { nombre: `~${e.id}` } });
    await tx.estadoProduccion.deleteMany({ where: { id: { in: aBorrar.map((b) => b.id) } } });
    for (const [orden, e] of limpios.entries()) {
      if (e.id) await tx.estadoProduccion.update({ where: { id: e.id }, data: { nombre: e.nombre, color: e.color, orden } });
      else await tx.estadoProduccion.create({ data: { nombre: e.nombre, color: e.color, orden } });
    }
  });
  return listarEstados();
}
