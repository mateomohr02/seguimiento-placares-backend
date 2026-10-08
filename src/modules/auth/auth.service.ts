import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { hashPin } from "./pin";
import { crearToken, SESION_SEGUNDOS } from "./sesion";

// Límite de intentos fallidos por IP (en memoria, se reinicia con el servidor):
// un PIN de 6 dígitos se adivina por fuerza bruta si no se frena. Ojo: el backend
// ve la IP del frontend (que le reenvía los pedidos), así que el límite es en la
// práctica global para todos los dispositivos.
const MAX_FALLOS = 8;
const VENTANA_MS = 10 * 60 * 1000;
const fallos = new Map<string, { cuenta: number; desde: number }>();

function chequearBloqueo(ip: string) {
  const f = fallos.get(ip);
  if (!f) return;
  if (Date.now() - f.desde > VENTANA_MS) {
    fallos.delete(ip);
    return;
  }
  if (f.cuenta >= MAX_FALLOS) {
    const min = Math.ceil((VENTANA_MS - (Date.now() - f.desde)) / 60000);
    throw new AppError(`Demasiados intentos fallidos. Probá de nuevo en ${min} min.`, 429);
  }
}

function registrarFallo(ip: string) {
  const f = fallos.get(ip);
  if (!f || Date.now() - f.desde > VENTANA_MS) fallos.set(ip, { cuenta: 1, desde: Date.now() });
  else f.cuenta += 1;
}

export async function loginPorPin(pin: string, ip: string) {
  chequearBloqueo(ip);
  const u = await prisma.usuario.findUnique({
    where: { pin_hash: hashPin(pin) },
    select: { id: true, nombre: true, activo: true, rol: { select: { nombre: true } } },
  });
  if (!u || !u.activo) {
    registrarFallo(ip);
    throw new AppError("PIN incorrecto.", 401);
  }
  fallos.delete(ip);
  await prisma.usuario.update({ where: { id: u.id }, data: { ultimo_acceso: new Date() } });
  return { token: crearToken(u.id), expiraEnSegundos: SESION_SEGUNDOS, usuario: { nombre: u.nombre, rol: u.rol.nombre } };
}
