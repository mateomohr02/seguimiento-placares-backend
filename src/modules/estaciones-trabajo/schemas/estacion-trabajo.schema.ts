import { PlanillaEstacion, PlantillaPlanificacion } from "@prisma/client";
import { z } from "zod";
import { parsearBody } from "../../../utils/parsearBody";
import { textoLimpio } from "../../usuarios/schemas/usuario.schema";

const nombre = z.preprocess(textoLimpio, z.string({ required_error: "es obligatorio" }).min(1, "es obligatorio").max(60, "admite hasta 60 caracteres"));
const planillas = z.array(z.nativeEnum(PlanillaEstacion, { errorMap: () => ({ message: "debe ser LIJADO, ENCOLADO o PVC" }) })).max(3);
const estadoId = z.string().uuid("no es un id válido").nullable();
// Planificación asignada a la estación (campo `plantilla_planificacion`): null = ninguna; TERMOLAMINADO o CALIDAD. Varias estaciones pueden tener la misma.
const plantilla = z
  .preprocess((v) => (v === "" ? null : v), z.nativeEnum(PlantillaPlanificacion, { errorMap: () => ({ message: "debe ser TERMOLAMINADO, CALIDAD o null" }) }).nullable());

const CrearSchema = z.object({ nombre, planillas: planillas.default([]), estado_id: estadoId.default(null), plantilla_planificacion: plantilla.default(null) });
const EditarSchema = z
  .object({ nombre, planillas, estado_id: estadoId, plantilla_planificacion: plantilla, activa: z.boolean(), usuarios_ids: z.array(z.string().uuid("no es un id válido")).max(200) })
  .partial();

export type EstacionCrearInput = z.infer<typeof CrearSchema>;
export type EstacionEditarInput = z.infer<typeof EditarSchema>;

export const parsearEstacionCrear = (body: unknown) => parsearBody(CrearSchema, body);
export const parsearEstacionEditar = (body: unknown) => parsearBody(EditarSchema, body);
