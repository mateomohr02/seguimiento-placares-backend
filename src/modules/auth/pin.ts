import { createHmac } from "node:crypto";
import { env } from "../../config/env";

// El PIN identifica al usuario, así que el hash tiene que ser determinístico (se
// busca por hash) y por eso es un HMAC con clave secreta, no un hash con sal.
// Un PIN de 6 dígitos tiene pocas combinaciones: la protección real es que el
// pin_hash no sea legible sin PIN_PEPPER y el límite de intentos del login.
export const PIN_REGEX = /^\d{4,10}$/;

export function hashPin(pin: string): string {
  return createHmac("sha256", env.PIN_PEPPER).update(`pin:${pin}`).digest("hex");
}
