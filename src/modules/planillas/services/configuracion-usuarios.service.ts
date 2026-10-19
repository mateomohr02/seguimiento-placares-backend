import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { ESTACIONES, type Estacion } from "../schemas/planilla.schema";

// Lo que técnica configura por cada usuario de fábrica (diseño.md §14): qué planillas completa, qué estado de
// producción marca en la planificación y qué operarios trabajan en su estación. Más el catálogo de estados.

export const MAX_OPERARIOS = 10;

// Operarios entre los que el usuario elige al completar una planilla.
export async function operariosDe(usuarioId: string) {
  const o = await prisma.usuarioOperario.findMany({ where: { usuario_id: usuarioId }, orderBy: { orden: "asc" }, select: { nombre: true } });
  return o.map((x) => x.nombre);
}

// ───────────────────────── Catálogo de estados de producción ─────────────────────────

export async function listarEstados() {
  const e = await prisma.estadoProduccion.findMany({
    orderBy: [{ orden: "asc" }, { creado_en: "asc" }],
    select: { id: true, nombre: true, _count: { select: { usuarios: true, marcas: true } } },
  });
  return e.map((x) => ({ id: x.id, nombre: x.nombre, usuarios: x._count.usuarios, marcas: x._count.marcas }));
}

/**
 * Reemplaza el catálogo con la lista enviada: los que traen `id` se renombran, los nuevos se crean y los que ya no
 * están se borran, salvo que tengan usuarios asignados o marcas en la planificación (se rechaza).
 */
export async function guardarEstados(estados: { id?: string; nombre: string }[]) {
  const limpios = estados.map((e) => ({ id: e.id, nombre: e.nombre.trim().replace(/\s+/g, " ") })).filter((e) => e.nombre);
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
    if (b.usuarios > 0) throw new AppError(`No se puede quitar "${b.nombre}": está asignado a ${b.usuarios} usuario(s). Cambialo primero.`, 409);
    if (b.marcas > 0) throw new AppError(`No se puede quitar "${b.nombre}": ya tiene ${b.marcas} marca(s) en la planificación.`, 409);
  }

  await prisma.$transaction(async (tx) => {
    // Primero se liberan los nombres (renombrar entre sí no choca con la restricción de nombre único).
    for (const e of limpios.filter((x) => x.id)) await tx.estadoProduccion.update({ where: { id: e.id }, data: { nombre: `~${e.id}` } });
    await tx.estadoProduccion.deleteMany({ where: { id: { in: aBorrar.map((b) => b.id) } } });
    for (const [orden, e] of limpios.entries()) {
      if (e.id) await tx.estadoProduccion.update({ where: { id: e.id }, data: { nombre: e.nombre, orden } });
      else await tx.estadoProduccion.create({ data: { nombre: e.nombre, orden } });
    }
  });
  return listarEstados();
}

// ───────────────────────── Configuración por usuario ─────────────────────────

export async function listarConfiguracionUsuarios() {
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      rol: { select: { nombre: true } },
      planillas: { select: { estacion: true } },
      estadoProduccion: { select: { estado_id: true } },
      operarios: { orderBy: { orden: "asc" }, select: { nombre: true } },
    },
  });
  return usuarios.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    rol: u.rol.nombre,
    estaciones: ESTACIONES.filter((e) => u.planillas.some((p) => p.estacion === e)),
    estado_id: u.estadoProduccion?.estado_id ?? null,
    operarios: u.operarios.map((o) => o.nombre),
  }));
}

export interface ConfiguracionUsuarioInput {
  estaciones: string[];
  estado_id: string | null;
  operarios: string[];
}

export async function guardarConfiguracionUsuario(usuarioId: string, input: ConfiguracionUsuarioInput) {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { activo: true } });
  if (!u || !u.activo) throw new AppError("Usuario no encontrado.", 404);

  const unicas = [...new Set(input.estaciones)];
  if (unicas.some((e) => !(ESTACIONES as readonly string[]).includes(e))) throw new AppError("Estación inválida.", 400);
  const estaciones = unicas as Estacion[];

  const nombres = input.operarios.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean);
  const vistos = new Set<string>();
  for (const n of nombres) {
    const k = n.toLowerCase();
    if (vistos.has(k)) throw new AppError(`El operario "${n}" está repetido.`, 400);
    vistos.add(k);
  }
  if (nombres.length > MAX_OPERARIOS) throw new AppError(`Se admiten hasta ${MAX_OPERARIOS} operarios.`, 400);

  if (input.estado_id && !(await prisma.estadoProduccion.findUnique({ where: { id: input.estado_id }, select: { id: true } }))) {
    throw new AppError("El estado de producción no existe.", 400);
  }

  await prisma.$transaction([
    prisma.usuarioPlanilla.deleteMany({ where: { usuario_id: usuarioId } }),
    prisma.usuarioPlanilla.createMany({ data: estaciones.map((estacion) => ({ usuario_id: usuarioId, estacion })) }),
    prisma.usuarioEstadoProduccion.deleteMany({ where: { usuario_id: usuarioId } }),
    ...(input.estado_id ? [prisma.usuarioEstadoProduccion.create({ data: { usuario_id: usuarioId, estado_id: input.estado_id } })] : []),
    prisma.usuarioOperario.deleteMany({ where: { usuario_id: usuarioId } }),
    prisma.usuarioOperario.createMany({ data: nombres.map((nombre, orden) => ({ usuario_id: usuarioId, nombre, orden })) }),
  ]);
}
