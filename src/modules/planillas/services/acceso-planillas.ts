import type { Prisma } from "@prisma/client";
import { AppError } from "../../../utils/AppError";
import { PERMISOS } from "../../auth/permisos";
import type { UsuarioAutenticado } from "../../auth/auth.middleware";
import { ESTACIONES, type Estacion } from "../schemas/planilla.schema";

// Acceso a las planillas por estación de trabajo (diseño.md §17). Una planilla es de una estación de trabajo y un tipo
// (LIJADO, ENCOLADO, PVC). Completarla exige ser miembro activo de esa estación (que tenga ese tipo y esté activa) o
// tener `planillas.configurar` (técnica/admin corrigen planillas de cualquier estación). Verlas: `fabrica` solo las de
// sus estaciones; técnica, gerencia y admin, todas.

export interface UbicacionPlanilla {
  estacion_trabajo_id: string;
  estacion: Estacion;
}

export const puedeConfigurar = (u: UsuarioAutenticado) => u.permisos.includes(PERMISOS.PLANILLAS_CONFIGURAR);

const esMiembroConTipo = (u: UsuarioAutenticado, p: UbicacionPlanilla) =>
  u.estaciones.some((e) => e.id === p.estacion_trabajo_id && e.planillas.includes(p.estacion));

/** El usuario es miembro activo de la estación y esta tiene ese tipo de planilla (las estaciones de la sesión son activas). */
export const esMiembro = esMiembroConTipo;

/** 403 si no puede completar (ni abrir para corregir) esa planilla. */
export function exigirAcceso(u: UsuarioAutenticado, p: UbicacionPlanilla) {
  if (puedeConfigurar(u) || esMiembroConTipo(u, p)) return;
  throw new AppError("No tenés acceso a esta planilla: no es de una de tus estaciones de trabajo.", 403);
}

const esDeFabrica = (u: UsuarioAutenticado) => u.rol === "fabrica";

/** Si el usuario puede ver los registros de esa planilla. */
export function puedeVer(u: UsuarioAutenticado, p: UbicacionPlanilla) {
  return !esDeFabrica(u) || esMiembroConTipo(u, p);
}

export function exigirVisible(u: UsuarioAutenticado, p: UbicacionPlanilla) {
  if (!puedeVer(u, p)) throw new AppError("No tenés acceso a los registros de esta planilla.", 403);
}

/** Filtro Prisma sobre `planilla_produccion` con lo que el usuario puede ver ({} = todo; sin estaciones, nada). */
export function whereVisible(u: UsuarioAutenticado): Prisma.PlanillaProduccionWhereInput {
  if (!esDeFabrica(u)) return {};
  return { OR: u.estaciones.flatMap((e) => e.planillas.map((estacion) => ({ estacion_trabajo_id: e.id, estacion }))) };
}

/** Tipos de planilla que el usuario puede ver en algún lado (para resúmenes por tipo). */
export function tiposVisibles(u: UsuarioAutenticado): Estacion[] {
  return esDeFabrica(u) ? ESTACIONES.filter((t) => u.planillas.includes(t)) : [...ESTACIONES];
}
