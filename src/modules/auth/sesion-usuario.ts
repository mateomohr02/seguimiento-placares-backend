import { PlanillaEstacion, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

// Lo que se sabe del usuario de la sesión (lo usan el middleware, /auth/login y /auth/me). Las planillas que puede
// completar salen de sus estaciones de trabajo ACTIVAS (diseño.md §17): un usuario inactivo no tiene sesión y una
// estación inactiva no aporta nada.

export interface EstacionDeSesion {
  id: string;
  nombre: string;
  planillas: PlanillaEstacion[];
  estado_id: string | null;
}

export interface UsuarioDeSesion {
  id: string;
  nombre: string;
  apellido: string;
  rol: string;
  permisos: string[];
  /** Tipos de planilla distintos de sus estaciones activas (compatibilidad con la forma anterior). */
  planillas: PlanillaEstacion[];
  /** Sus estaciones de trabajo activas. */
  estaciones: EstacionDeSesion[];
}

const ORDEN_PLANILLAS = Object.values(PlanillaEstacion);

const usuarioSesionSelect = {
  id: true,
  nombre: true,
  apellido: true,
  activo: true,
  rol: { select: { nombre: true, permisos: { select: { permiso_clave: true } } } },
  estaciones: {
    where: { estacion: { activa: true } },
    select: { estacion: { select: { id: true, nombre: true, estado_id: true, planillas: { select: { planilla: true } } } } },
  },
} satisfies Prisma.UsuarioSelect;

const ordenarPlanillas = (p: PlanillaEstacion[]) => ORDEN_PLANILLAS.filter((x) => p.includes(x));

/** null si el usuario no existe o está inactivo. */
export async function cargarUsuarioDeSesion(where: Prisma.UsuarioWhereUniqueInput): Promise<UsuarioDeSesion | null> {
  const u = await prisma.usuario.findUnique({ where, select: usuarioSesionSelect });
  if (!u || !u.activo) return null;
  const estaciones = u.estaciones
    .map(({ estacion: e }) => ({ id: e.id, nombre: e.nombre, estado_id: e.estado_id, planillas: ordenarPlanillas(e.planillas.map((p) => p.planilla)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    id: u.id,
    nombre: u.nombre,
    apellido: u.apellido,
    rol: u.rol.nombre,
    permisos: u.rol.permisos.map((p) => p.permiso_clave),
    planillas: ordenarPlanillas([...new Set(estaciones.flatMap((e) => e.planillas))]),
    estaciones,
  };
}
