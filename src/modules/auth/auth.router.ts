import { Router } from "express";
import { z } from "zod";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { autenticar } from "./auth.middleware";
import { loginPorPin } from "./auth.service";
import { PIN_REGEX } from "./pin";

const LoginSchema = z.object({ pin: z.string().regex(PIN_REGEX, "El PIN debe ser numérico.") });

export const authRouter = Router();

// Única ruta pública (junto con /api/health).
authRouter.post(
  "/login",
  catchAsync(async (req, res) => {
    const { pin } = LoginSchema.parse(req.body);
    return sendResponse(res, 200, await loginPorPin(pin, req.ip ?? "desconocida"));
  }),
);

// Quién soy y qué puedo hacer (el frontend decide qué mostrar con esto; el backend
// igual valida cada acción).
authRouter.get(
  "/me",
  autenticar,
  catchAsync(async (req, res) => {
    const { nombre, rol, permisos, planillas } = req.usuario!;
    return sendResponse(res, 200, { nombre, rol, permisos, planillas });
  }),
);
