import { AppError } from "./AppError";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Los id propios de la base (§8.1: clave sustituta) son UUID, no enteros.
export function parseIdParam(raw: string): string {
  if (!UUID_RE.test(raw)) {
    throw new AppError("El id debe ser un UUID válido.", 400);
  }
  return raw;
}
