import { PlanillaEstacion, Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { EstacionCrearInput, EstacionEditarInput } from "../schemas/estacion-trabajo.schema";

// Estaciones de trabajo (diseño.md §17): las crea técnica; no tienen login. Cada una tiene un estado productivo
// opcional (el que marcan sus operarios en la planificación), las planillas que completan sus operarios y sus
// usuarios (muchos a muchos). No se borran: activa = false. Técnica no ve ni toca a los usuarios admin.

export interface Actor {
  id: string;
  rol: string;
}

const esAdmin = (a: Actor) => a.rol === "admin";
const ORDEN_PLANILLAS = Object.values(PlanillaEstacion);

const estacionSelect = {
  id: true,
  nombre: true,
  activa: true,
  estado_id: true,
  planillas: { select: { planilla: true } },
  usuarios: { select: { usuario: { select: { id: true, nombre: true, apellido: true, activo: true, rol: { select: { nombre: true } } } } } },
} satisfies Prisma.EstacionTrabajoSelect;

type EstacionDB = Prisma.EstacionTrabajoGetPayload<{ select: typeof estacionSelect }>;

function estacionDTO(e: EstacionDB, actor: Actor) {
  const planillas = e.planillas.map((p) => p.planilla);
  return {
    id: e.id,
    nombre: e.nombre,
    activa: e.activa,
    planillas: ORDEN_PLANILLAS.filter((p) => planillas.includes(p)),
    estado_id: e.estado_id,
    usuarios: e.usuarios
      .map(({ usuario: u }) => ({ id: u.id, nombre: u.nombre, apellido: u.apellido, rol: u.rol.nombre, activo: u.activo }))
      .filter((u) => esAdmin(actor) || u.rol !== "admin")
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.apellido.localeCompare(b.apellido, "es")),
  };
}

export async function listarEstaciones(actor: Actor) {
  const estaciones = await prisma.estacionTrabajo.findMany({ orderBy: [{ activa: "desc" }, { nombre: "asc" }], select: estacionSelect });
  return estaciones.map((e) => estacionDTO(e, actor));
}

async function getEstacionDTO(id: string, actor: Actor) {
  return estacionDTO(await prisma.estacionTrabajo.findUniqueOrThrow({ where: { id }, select: estacionSelect }), actor);
}

// Mismo criterio que el índice único estacion_trabajo_nombre_ci_key: lower(nombre).
async function exigirNombreLibre(nombre: string, excepto?: string) {
  const otras = await prisma.$queryRaw<{ id: string }[]>`SELECT "id"::text AS "id" FROM "estacion_trabajo" WHERE lower("nombre") = lower(${nombre})`;
  if (otras.some((o) => o.id !== excepto)) throw new AppError(`Ya existe una estación de trabajo llamada "${nombre}".`, 409);
}

async function exigirEstado(estadoId: string | null | undefined) {
  if (!estadoId) return;
  const e = await prisma.estadoProduccion.findUnique({ where: { id: estadoId }, select: { id: true } });
  if (!e) throw new AppError("El estado de producción no existe.", 400);
}

function traducirUnico(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("Ya existe una estación de trabajo con ese nombre.", 409);
  throw e;
}

export async function crearEstacion(input: EstacionCrearInput, actor: Actor) {
  await exigirNombreLibre(input.nombre);
  await exigirEstado(input.estado_id);
  try {
    const creada = await prisma.estacionTrabajo.create({
      data: {
        nombre: input.nombre,
        estado_id: input.estado_id,
        planillas: { create: [...new Set(input.planillas)].map((planilla) => ({ planilla })) },
      },
      select: { id: true },
    });
    return getEstacionDTO(creada.id, actor);
  } catch (e) {
    traducirUnico(e);
  }
}

export async function actualizarEstacion(id: string, input: EstacionEditarInput, actor: Actor) {
  const actual = await prisma.estacionTrabajo.findUnique({ where: { id }, select: { id: true } });
  if (!actual) throw new AppError("Estación de trabajo no encontrada.", 404);
  if (input.nombre !== undefined) await exigirNombreLibre(input.nombre, id);
  await exigirEstado(input.estado_id);

  let usuarios: string[] | undefined;
  if (input.usuarios_ids !== undefined) {
    usuarios = [...new Set(input.usuarios_ids)];
    const encontrados = await prisma.usuario.findMany({ where: { id: { in: usuarios } }, select: { id: true, rol: { select: { nombre: true } } } });
    if (encontrados.length !== usuarios.length) throw new AppError("Uno de los usuarios no existe.", 400);
    if (!esAdmin(actor)) {
      if (encontrados.some((u) => u.rol.nombre === "admin")) throw new AppError("Solo un admin puede asignar usuarios admin.", 403);
      // Técnica no ve a los admin: los que ya estaban asignados se conservan.
      const adminsAsignados = await prisma.usuarioEstacionTrabajo.findMany({
        where: { estacion_trabajo_id: id, usuario: { rol: { nombre: "admin" } } },
        select: { usuario_id: true },
      });
      usuarios.push(...adminsAsignados.map((a) => a.usuario_id));
    }
  }
  const planillas = input.planillas === undefined ? undefined : [...new Set(input.planillas)];

  try {
    await prisma.$transaction([
      prisma.estacionTrabajo.update({ where: { id }, data: { nombre: input.nombre, estado_id: input.estado_id, activa: input.activa } }),
      ...(planillas === undefined
        ? []
        : [
            prisma.estacionTrabajoPlanilla.deleteMany({ where: { estacion_trabajo_id: id, planilla: { notIn: planillas } } }),
            prisma.estacionTrabajoPlanilla.createMany({ data: planillas.map((planilla) => ({ estacion_trabajo_id: id, planilla })), skipDuplicates: true }),
          ]),
      ...(usuarios === undefined
        ? []
        : [
            prisma.usuarioEstacionTrabajo.deleteMany({ where: { estacion_trabajo_id: id, usuario_id: { notIn: usuarios } } }),
            prisma.usuarioEstacionTrabajo.createMany({ data: usuarios.map((usuario_id) => ({ usuario_id, estacion_trabajo_id: id })), skipDuplicates: true }),
          ]),
    ]);
  } catch (e) {
    traducirUnico(e);
  }
  return getEstacionDTO(id, actor);
}
