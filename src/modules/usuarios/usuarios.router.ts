import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { parsearUsuarioCrear, parsearUsuarioEditar } from "./schemas/usuario.schema";
import { actualizarUsuario, crearUsuario, listarUsuarios } from "./services/usuarios.service";

// Usuarios (personas) — diseño.md §12 y §17. Montado en /api/usuarios. Todo con usuarios.gestionar (técnica y admin).
export const usuariosRouter = Router();

usuariosRouter.get(
  "/",
  requierePermiso(PERMISOS.USUARIOS_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 200, await listarUsuarios(req.usuario!))),
);

usuariosRouter.post(
  "/",
  requierePermiso(PERMISOS.USUARIOS_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 201, await crearUsuario(parsearUsuarioCrear(req.body), req.usuario!))),
);

usuariosRouter.patch(
  "/:id",
  requierePermiso(PERMISOS.USUARIOS_GESTIONAR),
  catchAsync(async (req, res) =>
    sendResponse(res, 200, await actualizarUsuario(parseIdParam(String(req.params.id)), parsearUsuarioEditar(req.body), req.usuario!)),
  ),
);
