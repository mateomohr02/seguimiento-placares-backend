import { PlantillaPlanificacion } from "@prisma/client";

// Catálogo de planificaciones (diseño.md §19.5). Las planificaciones NO dependen de las estaciones de trabajo: cada fila de
// `planificacion_item` pertenece a una (columna `plantilla`) y a una estación se le asigna una (`estacion_trabajo.plantilla_planificacion`,
// opcional; varias estaciones pueden tener la misma). El catálogo es fijo, en código.
//
// PARA AGREGAR UNA PLANIFICACIÓN NUEVA (p. ej. «Corte»):
//   1. Agregar el valor al enum `PlantillaPlanificacion` de prisma/schema.prisma y crear la migración (ALTER TYPE ... ADD VALUE).
//   2. Agregarla en `PLANIFICACIONES` (clave del enum + nombre para mostrar). El nombre también es el que usa el importador de
//      Excel para reconocer la hoja (sin mayúsculas, tildes ni espacios de más).
//   3. Definir su formato: `datosDe` en planificacion.service.ts (qué campos usa y si lleva día), las reglas de día/orden
//      (`proximoOrden`, `reordenarItems`), y cómo se lee su hoja en importar/importar.parser.ts (`leer`).
//   4. El frontend lista lo que devuelve GET /api/planificacion/planificaciones; solo hay que darle formato de tabla a la nueva.

export type Plantilla = PlantillaPlanificacion;

export interface PlanificacionCatalogo {
  clave: Plantilla;
  nombre: string;
}

/** En este orden se listan. */
export const PLANIFICACIONES: readonly PlanificacionCatalogo[] = [
  { clave: "TERMOLAMINADO", nombre: "Termolaminado" },
  { clave: "CALIDAD", nombre: "Calidad" },
];

export const esPlantilla = (v: unknown): v is Plantilla => PLANIFICACIONES.some((p) => p.clave === v);

export function planificacionDe(clave: Plantilla): PlanificacionCatalogo {
  return PLANIFICACIONES.find((p) => p.clave === clave)!;
}
