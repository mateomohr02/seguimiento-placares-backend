import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { RolUsuario, UsuarioCrearInput, UsuarioEditarInput } from "../schemas/usuario.schema";

// Alta y edición de usuarios (personas) desde la app (diseño.md §12 y §17). Lo usa técnica: puede asignar cualquier
// rol menos `admin` (solo un admin crea/edita admins) y no ve a los usuarios admin. Un usuario no se borra
// (activo = false) y nadie puede desactivarse a sí mismo. El PIN se guarda en texto plano (decisión vieja) y es único.

export interface Actor {
  id: string;
  rol: string;
}

const esAdmin = (a: Actor) => a.rol === "admin";
const SOLO_ADMIN = "Solo un admin puede crear o editar usuarios admin.";

const usuarioSelect = {
  id: true,
  nombre: true,
  apellido: true,
  activo: true,
  pin: true,
  ultimo_acceso: true,
  rol: { select: { nombre: true } },
  estaciones: { select: { estacion: { select: { id: true, nombre: true, activa: true } } } },
} satisfies Prisma.UsuarioSelect;

type UsuarioDB = Prisma.UsuarioGetPayload<{ select: typeof usuarioSelect }>;

function usuarioDTO(u: UsuarioDB) {
  return {
    id: u.id,
    nombre: u.nombre,
    apellido: u.apellido,
    rol: u.rol.nombre,
    activo: u.activo,
    pin: u.pin,
    ultimo_acceso: u.ultimo_acceso ? u.ultimo_acceso.toISOString() : null,
    estaciones: u.estaciones.map((e) => e.estacion).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  };
}

export async function listarUsuarios(actor: Actor) {
  const usuarios = await prisma.usuario.findMany({
    where: esAdmin(actor) ? {} : { rol: { nombre: { not: "admin" } } },
    orderBy: [{ activo: "desc" }, { nombre: "asc" }, { apellido: "asc" }],
    select: usuarioSelect,
  });
  return usuarios.map(usuarioDTO);
}

async function getUsuarioDTO(id: string) {
  return usuarioDTO(await prisma.usuario.findUniqueOrThrow({ where: { id }, select: usuarioSelect }));
}

async function rolId(rol: RolUsuario) {
  const r = await prisma.rol.findUnique({ where: { nombre: rol }, select: { id: true } });
  if (!r) throw new AppError(`El rol "${rol}" no existe.`, 400);
  return r.id;
}

// Límite de conflictos de PIN por usuario que llama (en memoria, se reinicia con el servidor; mismo patrón que el login
// en auth.service.ts): probar PINs en el alta/edición permitiría descubrir el de otra persona por el 409 «en uso».
const MAX_CONFLICTOS_PIN = 5;
const VENTANA_PIN_MS = 10 * 60 * 1000;
const conflictosPin = new Map<string, { cuenta: number; desde: number }>();

function chequearBloqueoPin(actorId: string) {
  const f = conflictosPin.get(actorId);
  if (!f) return;
  if (Date.now() - f.desde > VENTANA_PIN_MS) {
    conflictosPin.delete(actorId);
    return;
  }
  if (f.cuenta >= MAX_CONFLICTOS_PIN) {
    const min = Math.ceil((VENTANA_PIN_MS - (Date.now() - f.desde)) / 60000);
    throw new AppError(`Demasiados PIN en uso probados. Probá de nuevo en ${min} min.`, 429);
  }
}

function registrarConflictoPin(actorId: string) {
  const f = conflictosPin.get(actorId);
  if (!f || Date.now() - f.desde > VENTANA_PIN_MS) conflictosPin.set(actorId, { cuenta: 1, desde: Date.now() });
  else f.cuenta += 1;
}

async function exigirPinLibre(pin: string, actor: Actor, excepto?: string) {
  chequearBloqueoPin(actor.id);
  const otro = await prisma.usuario.findUnique({ where: { pin }, select: { id: true } });
  if (!otro || otro.id === excepto) return;
  // Respuesta siempre igual (409 genérico, también cuando el dueño es un admin y quien llama no): cada conflicto cuenta como intento.
  registrarConflictoPin(actor.id);
  throw new AppError("Ese PIN ya está en uso. Elegí otro.", 409);
}

// Mismo criterio que el índice único usuario_nombre_apellido_ci_key: lower(nombre), lower(apellido).
async function exigirNombreLibre(nombre: string, apellido: string, excepto?: string) {
  const otros = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS "id" FROM "usuario" WHERE lower("nombre") = lower(${nombre}) AND lower("apellido") = lower(${apellido})`;
  if (otros.some((o) => o.id !== excepto)) throw new AppError(`Ya existe un usuario llamado "${[nombre, apellido].filter(Boolean).join(" ")}".`, 409);
}

async function exigirEstaciones(ids: string[]) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return unicos;
  const n = await prisma.estacionTrabajo.count({ where: { id: { in: unicos } } });
  if (n !== unicos.length) throw new AppError("Una de las estaciones de trabajo no existe.", 400);
  return unicos;
}

// Si dos pedidos simultáneos pasan las verificaciones, el índice único de la base frena al segundo.
function traducirUnico(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError("Ya existe un usuario con ese PIN o con ese nombre y apellido.", 409);
  }
  throw e;
}

export async function crearUsuario(input: UsuarioCrearInput, actor: Actor) {
  // Nadie crea usuarios admin desde la app (ni un admin): el alta de un admin se hace por base.
  if (input.rol === "admin") throw new AppError("No se pueden crear usuarios con el rol admin.", 403);
  await exigirPinLibre(input.pin, actor);
  await exigirNombreLibre(input.nombre, input.apellido);
  const estaciones = await exigirEstaciones(input.estaciones_ids);
  const rol_id = await rolId(input.rol);
  try {
    const creado = await prisma.usuario.create({
      data: {
        nombre: input.nombre,
        apellido: input.apellido,
        pin: input.pin,
        rol_id,
        estaciones: { create: estaciones.map((estacion_trabajo_id) => ({ estacion_trabajo_id })) },
      },
      select: { id: true },
    });
    return getUsuarioDTO(creado.id);
  } catch (e) {
    traducirUnico(e);
  }
}

export async function actualizarUsuario(id: string, input: UsuarioEditarInput, actor: Actor) {
  const actual = await prisma.usuario.findUnique({ where: { id }, select: { nombre: true, apellido: true, rol: { select: { nombre: true } } } });
  if (!actual) throw new AppError("Usuario no encontrado.", 404);
  if (!esAdmin(actor) && (actual.rol.nombre === "admin" || input.rol === "admin")) throw new AppError(SOLO_ADMIN, 403);
  if (input.activo === false && id === actor.id) throw new AppError("No podés desactivarte a vos mismo.", 400);
  if (input.rol !== undefined && id === actor.id && input.rol !== actual.rol.nombre) throw new AppError("No podés cambiar tu propio rol.", 400);
  if (input.apellido === "" && actual.apellido !== "") throw new AppError("El apellido es obligatorio.", 400);

  if (input.pin !== undefined) await exigirPinLibre(input.pin, actor, id);
  if (input.nombre !== undefined || input.apellido !== undefined) {
    await exigirNombreLibre(input.nombre ?? actual.nombre, input.apellido ?? actual.apellido, id);
  }
  const estaciones = input.estaciones_ids === undefined ? undefined : await exigirEstaciones(input.estaciones_ids);
  const rol_id = input.rol === undefined ? undefined : await rolId(input.rol);

  try {
    await prisma.$transaction([
      prisma.usuario.update({
        where: { id },
        data: { nombre: input.nombre, apellido: input.apellido, pin: input.pin, activo: input.activo, rol_id },
      }),
      ...(estaciones === undefined
        ? []
        : [
            prisma.usuarioEstacionTrabajo.deleteMany({ where: { usuario_id: id, estacion_trabajo_id: { notIn: estaciones } } }),
            prisma.usuarioEstacionTrabajo.createMany({ data: estaciones.map((estacion_trabajo_id) => ({ usuario_id: id, estacion_trabajo_id })), skipDuplicates: true }),
          ]),
    ]);
  } catch (e) {
    traducirUnico(e);
  }
  return getUsuarioDTO(id);
}
