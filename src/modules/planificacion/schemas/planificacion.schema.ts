import { PlantillaPlanificacion } from "@prisma/client";
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

// Planificación (clave del catálogo): TERMOLAMINADO o CALIDAD.
const plantilla = z.nativeEnum(PlantillaPlanificacion, { errorMap: () => ({ message: "elegí la planificación (TERMOLAMINADO o CALIDAD)" }) });

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const entero = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number({ invalid_type_error: "debe ser un número entero" }).int("debe ser un número entero").min(0, "no puede ser negativo").max(100000, "es demasiado grande").nullable(),
);

/**
 * Alta y edición de una fila (planificación de Termolaminado o de Calidad: el servicio aplica lo que corresponde a la
 * `plantilla` y ignora el resto). `n_tw` identifica el pedido: obligatorio y sin espacios, salvo que venga
 * `pedido_id` (entonces `n_tw` se toma del pedido). `cliente` es texto libre. Las claves de más (p. ej. las de los reclamos que
 * ya no existen: `tipo`, `distribuidor`, `ticket`, `tipo_reclamo`, `finalizado_en`) se ignoran.
 */
export const ItemSchema = z
  .object({
    plantilla,
    semana: z.string({ required_error: "es obligatoria" }).regex(FECHA_RE, "debe tener el formato AAAA-MM-DD"),
    dia: fechaOpc,
    n_tw: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(40, "admite hasta 40 caracteres")),
    pedido_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string({ invalid_type_error: "no es un id válido" }).uuid("no es un id válido").nullable()),
    cliente: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(200, "admite hasta 200 caracteres")),
    modelo: texto(80),
    color: texto(80),
    compromiso: fechaOpc,
    modulos: entero,
    observaciones: texto(500),
  })
  .superRefine((v, ctx) => {
    if (v.pedido_id) return; // con pedido, el N° TW sale del pedido
    if (v.n_tw === "") ctx.addIssue({ code: "custom", path: ["n_tw"], message: "es obligatorio" });
    else if (/\s/.test(v.n_tw)) ctx.addIssue({ code: "custom", path: ["n_tw"], message: "el N° TW no puede llevar espacios" });
  });
export type ItemInput = z.infer<typeof ItemSchema>;

export const ReordenarSchema = z.object({
  plantilla,
  semana: z.string({ required_error: "es obligatoria" }).regex(FECHA_RE, "debe tener el formato AAAA-MM-DD"),
  dia: fechaOpc,
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
export const BuscarEnPlanificacionQuery = z.object({ plantilla, q });
export const PedidoPorTwQuery = z.object({ n_tw: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 40) : ""), z.string()) });

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
export const parsearBuscarEnPlanificacion = (query: unknown) => parsearBody(BuscarEnPlanificacionQuery, query);
export const parsearPedidoPorTw = (query: unknown) => parsearBody(PedidoPorTwQuery, query);
