import type { z } from "zod";
import { AppError } from "./AppError";

// Valida con Zod y, si falla, responde 400 con el primer error en castellano ("pin: debe tener de 4 a 10 dígitos").
export function parsearBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const campo = issue.path.length ? `${issue.path.join(".")}: ` : "";
  throw new AppError(`${campo}${issue.message}`, 400);
}
