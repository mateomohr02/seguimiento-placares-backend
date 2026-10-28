import { z } from "zod";
import { AppError } from "../../../utils/AppError";

// Planillas de producción de Termolaminado (diseño.md §14).
export const AREA_TERMOLAMINADO = "TERMOLAMINADO";
export const ESTACIONES = ["LIJADO", "ENCOLADO", "PVC"] as const;
export type Estacion = (typeof ESTACIONES)[number];

export const ETIQUETA_ESTACION: Record<Estacion, string> = { LIJADO: "Lijado", ENCOLADO: "Encolado", PVC: "PVC" };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseEstacion(raw: string): Estacion {
  const e = raw.toUpperCase();
  if (!(ESTACIONES as readonly string[]).includes(e)) throw new AppError("Tipo de planilla inválido (lijado, encolado o pvc).", 400);
  return e as Estacion;
}

/** `YYYY-MM-DD` válido → Date a medianoche UTC (columna `date`). */
export function parseFecha(raw: string, etiqueta = "La fecha"): Date {
  if (!FECHA_RE.test(raw)) throw new AppError(`${etiqueta} debe tener el formato AAAA-MM-DD.`, 400);
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw new AppError(`${etiqueta} no es válida.`, 400);
  return d;
}

export const fechaISO = (d: Date) => d.toISOString().slice(0, 10);

// "" y undefined cuentan como "sin dato".
const vacioANull = (v: unknown) => (v === "" || v === undefined ? null : v);
const texto = (max: number) => z.preprocess(vacioANull, z.string().trim().max(max).nullable());
const entero = z.preprocess(vacioANull, z.number().int().min(0).max(100000).nullable());
const hora = z.preprocess(vacioANull, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "debe ser una hora HH:MM").nullable());

/** Colores: código en mayúsculas, sin puntos (diseño.md §14.3). */
export function normalizarColor(v: string): string {
  return v.trim().toUpperCase();
}

export const MESA_TAMANOS = ["CHICA", "GRANDE"] as const;
export type MesaTamano = (typeof MESA_TAMANOS)[number];
export const MAX_PEDIDOS_POR_TANDA = 30;

/** Pedido de una tanda de PVC con las piezas de ese pedido que entraron en la tanda (diseño.md §14.12). */
export const PedidoTandaSchema = z.object({
  id: z.string().uuid().optional(),
  // Un pedido por línea: sin espacios (varios pedidos van cada uno en su propia línea, con «Agregar pedido»).
  pedido_codigo: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : (v ?? "")),
    z.string().max(40).refine((s) => !/\s/.test(s), "el N° de pedido no puede llevar espacios (cargá cada pedido por separado)"),
  ),
  cantidad_piezas: entero,
});
export type PedidoTandaInput = z.infer<typeof PedidoTandaSchema>;

export const FilaSchema = z.object({
  id: z.string().uuid().optional(),
  hora_inicio: hora,
  hora_fin: hora,
  pedido_codigo: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : (v ?? "")), z.string().max(40)),
  cantidad_piezas: entero,
  observaciones: texto(500),
  colocacion_pvc: texto(200),
  perfilado: texto(200),
  colores: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? normalizarColor(v) : null),
    z.string().max(30).refine((s) => !s.includes("."), "no puede llevar puntos").nullable(),
  ),
  // Solo PVC: la fila es una tanda de mesas (tamaño + cantidad) con sus pedidos. En Lijado/Encolado se ignoran.
  mesa_tamano: z.preprocess(vacioANull, z.enum(MESA_TAMANOS, { errorMap: () => ({ message: "el tamaño de mesa debe ser CHICA o GRANDE" }) }).nullable()),
  mesa_cantidad: entero,
  pedidos: z.array(PedidoTandaSchema).max(MAX_PEDIDOS_POR_TANDA, `una tanda admite hasta ${MAX_PEDIDOS_POR_TANDA} pedidos`).default([]),
});
export type FilaInput = z.infer<typeof FilaSchema>;

export const PlanillaBodySchema = z.object({
  estado: z.enum(["BORRADOR", "GUARDADA"]),
  /** `usuario_id` de las personas que trabajaron en esta planilla (miembros de la estación). */
  operarios: z.array(z.string().uuid("Un operario no es válido.")).max(40).default([]),
  filas: z.array(FilaSchema).max(60),
});
export type PlanillaBody = z.infer<typeof PlanillaBodySchema>;

/** Valida con un mensaje legible (ej. "Fila 2: hora_inicio debe ser una hora HH:MM"). */
export function parsearPlanillaBody(body: unknown): PlanillaBody {
  const r = PlanillaBodySchema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const [campo, idx, nombre, idxPedido, nombrePedido] = issue.path;
  let donde = "";
  if (campo === "filas" && typeof idx === "number") {
    donde =
      nombre === "pedidos" && typeof idxPedido === "number"
        ? `Fila ${idx + 1}, pedido ${idxPedido + 1}${nombrePedido ? ` (${String(nombrePedido)})` : ""}: `
        : `Fila ${idx + 1}${nombre ? ` (${String(nombre)})` : ""}: `;
  }
  throw new AppError(`${donde}${issue.message}`, 400);
}
