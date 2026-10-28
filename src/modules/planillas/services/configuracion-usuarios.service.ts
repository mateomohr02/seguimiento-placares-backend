import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Catálogo de estados de producción (diseño.md §14 y §17). La configuración por usuario (planillas, estado y operarios)
// pasó a las estaciones de trabajo (módulo estaciones-trabajo); las tablas viejas se conservan sin uso.

// ───────────────────────── Catálogo de estados de producción ─────────────────────────

/**
 * `estaciones`: cuántas estaciones de trabajo lo tienen asignado (el contador de usos). `usuarios` se mantiene solo por
 * compatibilidad con la forma anterior y vale lo mismo que `estaciones` (el estado lo tiene la estación, no el usuario).
 */
export async function listarEstados() {
  const e = await prisma.estadoProduccion.findMany({
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, color: true, _count: { select: { estaciones: true, marcas: true } } },
  });
  return e.map((x) => ({ id: x.id, nombre: x.nombre, color: x.color, estaciones: x._count.estaciones, usuarios: x._count.estaciones, marcas: x._count.marcas }));
}

/**
 * Reemplaza el catálogo con la lista enviada: los que traen `id` se renombran, los nuevos se crean y los que ya no
 * están se borran, salvo que estén asignados a estaciones de trabajo o tengan marcas en la planificación: se rechaza.
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
