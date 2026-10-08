import type { RequestHandler } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import type { Permiso } from "./permisos";
import { verificarToken } from "./sesion";

export interface UsuarioAutenticado {
  id: string;
  nombre: string;
  rol: string;
  permisos: string[];
}

declare module "express-serve-static-core" {
  interface Request {
    usuario?: UsuarioAutenticado;
  }
}

const SESION_INVALIDA = "Sesión inválida o vencida. Ingresá tu PIN.";

// Lee el token (Authorization: Bearer ...), lo verifica y carga usuario, rol y
// permisos desde la base. 401 si falta, venció, es inválido o el usuario está inactivo.
export const autenticar: RequestHandler = catchAsync(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const uid = token ? verificarToken(token) : null;
  if (!uid) throw new AppError(SESION_INVALIDA, 401);

  const u = await prisma.usuario.findUnique({
    where: { id: uid },
    select: {
      id: true,
      nombre: true,
      activo: true,
      rol: { select: { nombre: true, permisos: { select: { permiso_clave: true } } } },
    },
  });
  if (!u || !u.activo) throw new AppError(SESION_INVALIDA, 401);

  req.usuario = { id: u.id, nombre: u.nombre, rol: u.rol.nombre, permisos: u.rol.permisos.map((p) => p.permiso_clave) };
  next();
});

// 403 si el usuario autenticado no tiene el permiso. Va siempre después de `autenticar`.
export const requierePermiso =
  (permiso: Permiso): RequestHandler =>
  (req, _res, next) => {
    if (!req.usuario) return next(new AppError(SESION_INVALIDA, 401));
    if (!req.usuario.permisos.includes(permiso)) {
      return next(new AppError("No tenés permiso para realizar esta acción.", 403));
    }
    next();
  };
