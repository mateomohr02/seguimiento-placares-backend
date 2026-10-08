import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

// Token de sesión sin estado: base64url(payload).firma. El payload solo lleva el
// id de usuario y el vencimiento; el rol y los permisos se leen de la base en
// cada pedido (así un cambio de rol o una baja rige de inmediato).
interface Payload {
  uid: string;
  exp: number; // epoch en segundos
}

const firmar = (cuerpo: string) =>
  createHmac("sha256", env.SESSION_SECRET).update(`sesion:${cuerpo}`).digest("base64url");

export const SESION_SEGUNDOS = Math.round(env.SESSION_HORAS * 3600);

export function crearToken(uid: string): string {
  const payload: Payload = { uid, exp: Math.floor(Date.now() / 1000) + SESION_SEGUNDOS };
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${cuerpo}.${firmar(cuerpo)}`;
}

export function verificarToken(token: string): string | null {
  const [cuerpo, firma, resto] = token.split(".");
  if (!cuerpo || !firma || resto !== undefined) return null;
  const esperada = Buffer.from(firmar(cuerpo));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<Payload>;
    if (typeof p.uid !== "string" || typeof p.exp !== "number") return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.uid;
  } catch {
    return null;
  }
}
