import { z } from "zod";
import { AppError } from "../../../utils/AppError";
import { parsearBody } from "../../../utils/parsearBody";

// Validación de lo que entra a /api/planificacion (diseño.md §14.4). Los mensajes salen como 400 ("campo: mensaje").

const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(max, `admite hasta ${max} caracteres`).nullable());
const fechaOpc = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener el formato AAAA-MM-DD").nullable(),
);
const uuid = (mensaje: string) => z.string({ required_error: mensaje, invalid_type_error: mensaje }).uuid(mensaje);

/**
 * Alta y edición de una fila. La fila se arma sobre un pedido ya cargado (`pedido_id`): N° TW, N° de orden y cliente se
 * derivan de él y no se aceptan en el body (las claves de más se ignoran).
 */
export const ItemSchema = z.object({
  estacion_id: uuid("elegí la estación"),
  tipo: z.enum(["PEDIDOS", "RECLAMOS"], { errorMap: () => ({ message: "debe ser PEDIDOS o RECLAMOS" }) }),
  semana: z.string({ required_error: "es obligatoria" }).regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener el formato AAAA-MM-DD"),
  pedido_id: uuid("elegí el pedido"),
  modelo: texto(80),
  color: texto(80),
  compromiso: fechaOpc,
  finalizado_en: fechaOpc,
  distribuidor: texto(80),
  ticket: texto(40),
  tipo_reclamo: texto(200),
  observaciones: texto(500),
});
export type ItemInput = z.infer<typeof ItemSchema>;

export const ReordenarSchema = z.object({
  estacion_id: uuid("elegí la estación"),
  semana: z.string({ required_error: "es obligatoria" }).regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener el formato AAAA-MM-DD"),
  tipo: z.enum(["PEDIDOS", "RECLAMOS"], { errorMap: () => ({ message: "debe ser PEDIDOS o RECLAMOS" }) }),
  ids: z
    .array(z.string().uuid("no es un id válido"), { required_error: "es obligatorio", invalid_type_error: "debe ser una lista" })
    .max(2000)
    .refine((ids) => new Set(ids).size === ids.length, "no puede repetir filas"),
});
export type ReordenarInput = z.infer<typeof ReordenarSchema>;

export const ObservacionSchema = z.object({
  texto: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, "Escribí la observación.").max(500, "La observación admite hasta 500 caracteres.")),
});

export const MarcaSchema = z.object({ marcado: z.boolean(), estado_id: z.string().uuid().optional() });

// Querystrings. `q` se recorta; `limit` se acota a 1..50 (por defecto 20).
const q = z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 60) : ""), z.string());

export const BuscarPedidosQuery = z.object({
  q,
  limit: z.preprocess((v) => (typeof v === "string" && v !== "" ? Number(v) : 20), z.number().int("debe ser un entero").min(1).max(50).catch(20)),
});
export const BuscarEnEstacionQuery = z.object({ estacion: uuid("elegí la estación"), q });

export const parsearItem = (body: unknown) => parsearBody(ItemSchema, body);
export const parsearReordenar = (body: unknown) => parsearBody(ReordenarSchema, body);
// Observaciones y marcas: igual que antes (el mensaje de la observación sale sin prefijo de campo).
export function parsearObservacion(body: unknown) {
  const r = ObservacionSchema.safeParse(body);
  if (r.success) return r.data;
  throw new AppError(r.error.issues[0].message, 400);
}
export const parsearMarca = (body: unknown) => MarcaSchema.parse(body);
export const parsearBuscarPedidos = (query: unknown) => parsearBody(BuscarPedidosQuery, query);
export const parsearBuscarEnEstacion = (query: unknown) => parsearBody(BuscarEnEstacionQuery, query);
