import { PlantillaPlanificacion } from "@prisma/client";
import { z } from "zod";
import { parsearBody } from "../../../utils/parsearBody";
import { MAX_FILAS } from "./importar.parser";

// Cuerpo de POST /api/planificacion/importar/confirmar. Acá solo se valida la forma; cada fila se revalida con las mismas reglas
// que POST /planificacion/items (ItemSchema) en el servicio, para poder indicar hoja y fila en el mensaje.

export const ConfirmarSchema = z.object({
  semana: z.string({ required_error: "es obligatoria" }).regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener el formato AAAA-MM-DD"),
  sin_pedido: z.enum(["cargar", "excluir"], { errorMap: () => ({ message: "debe ser «cargar» o «excluir»" }) }),
  hojas: z
    .array(
      z.object({
        plantilla: z.nativeEnum(PlantillaPlanificacion, { errorMap: () => ({ message: "elegí la planificación (TERMOLAMINADO o CALIDAD)" }) }),
        modo: z.enum(["pisar", "agregar"], { errorMap: () => ({ message: "debe ser «pisar» o «agregar»" }) }),
        filas: z.array(z.unknown(), { required_error: "es obligatorio", invalid_type_error: "debe ser una lista" }).max(MAX_FILAS, `admite hasta ${MAX_FILAS} filas`),
      }),
      { required_error: "es obligatorio", invalid_type_error: "debe ser una lista" },
    )
    .min(1, "no hay hojas para cargar")
    .max(30, "admite hasta 30 hojas"),
});
export type ConfirmarInput = z.infer<typeof ConfirmarSchema>;

export const parsearConfirmar = (body: unknown) => parsearBody(ConfirmarSchema, body);
