import express, { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { AppError } from "../../utils/AppError";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { getTextura, guardarTextura, MAX_TEXTURA_BYTES } from "./texturas-3d.service";

// Texturas de materiales de las escenas 3D (diseño.md §13), por catálogo (4 = Placares, 3 = Cocinas,
// 641 = pavimentos y revestimientos). Ver: documentacion.ver; alta manual: documentacion.gestionar.
// Montado en app.ts en /api/texturas-3d.
export const texturas3dRouter = Router();

texturas3dRouter.get(
  "/:catalogo/:material",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { contenido, mime } = await getTextura(String(req.params.catalogo), String(req.params.material));
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", contenido.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(contenido);
  }),
);

texturas3dRouter.post(
  "/:catalogo/:material",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  express.raw({ type: ["image/jpeg", "image/png"], limit: MAX_TEXTURA_BYTES }),
  catchAsync(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError("Formato no soportado. Usá JPG o PNG.", 415);
    const mime = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    return sendResponse(res, 201, await guardarTextura(String(req.params.catalogo), String(req.params.material), mime, req.body));
  }),
);
