import { z } from "zod";
import { parsearBody } from "../../../utils/parsearBody";

// Body de PUT /ordenes/reordenar: las órdenes (ids) en el orden nuevo. Puede ser un subconjunto de la cartera (lo que se ve
// con el filtro por línea o en archivadas); se reubican entre sí conservando los lugares que ocupaban.
export const ReordenarOrdenesSchema = z.object({
  ids: z
    .array(z.string().uuid("no es un id válido"), { required_error: "es obligatorio", invalid_type_error: "debe ser una lista" })
    .min(1, "debe tener al menos una orden")
    .max(5000)
    .refine((ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length, "no puede repetir órdenes")
    .transform((ids) => ids.map((i) => i.toLowerCase())),
});

export const parsearReordenarOrdenes = (body: unknown) => parsearBody(ReordenarOrdenesSchema, body);
