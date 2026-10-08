import { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
import { validateBody } from "../../middlewares/validateBody";
import { EscanearPiezaSchema } from "./schemas/escanear-pieza.schema";
import { escanearPiezaController } from "./controllers/escanear-pieza.controller";
import { confirmarPiezaController } from "./controllers/confirmar-pieza.controller";

import { marcarPiezaPendienteController } from "./controllers/marcar-pieza-pendiente.controller";
export const piezasRouter = Router();

piezasRouter.post("/escanear", requierePermiso(PERMISOS.PIEZAS_MARCAR), validateBody(EscanearPiezaSchema), escanearPiezaController);
piezasRouter.patch("/:id/confirmar", requierePermiso(PERMISOS.PIEZAS_MARCAR), confirmarPiezaController);
piezasRouter.patch("/:id/pendiente", requierePermiso(PERMISOS.PIEZAS_MARCAR), marcarPiezaPendienteController);
