import type { RequestHandler } from "express";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import type { Permiso } from "./permisos";
import { verificarToken } from "./sesion";
import { cargarUsuarioDeSesion, type UsuarioDeSesion } from "./sesion-usuario";

export interface UsuarioAutenticado extends UsuarioDeSesion {
  /** "Nombre Apellido": lo que queda registrado como autor (creado_por, modificado_por, marcado_por…). */
  nombre_completo: string;
}

declare module "express-serve-static-core" {
  interface Request {
    usuario?: UsuarioAutenticado;
  }
}

const SESION_INVALIDA = "Sesión inválida o vencida. Ingresá tu PIN.";

export const nombreCompleto = (u: { nombre: string; apellido: string }) => [u.nombre, u.apellido].filter(Boolean).join(" ");

// Lee el token (Authorization: Bearer ...), lo verifica y carga usuario, rol, permisos y estaciones de trabajo
// activas desde la base. 401 si falta, venció, es inválido o el usuario está inactivo.
export const autenticar: RequestHandler = catchAsync(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const uid = token ? verificarToken(token) : null;
  if (!uid) throw new AppError(SESION_INVALIDA, 401);

  const u = await cargarUsuarioDeSesion({ id: uid });
  if (!u) throw new AppError(SESION_INVALIDA, 401);

  req.usuario = { ...u, nombre_completo: nombreCompleto(u) };
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
