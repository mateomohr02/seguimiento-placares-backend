import { Router } from "express";
import { validateBody } from "../../middlewares/validateBody";
import { EscanearPiezaSchema } from "./schemas/escanear-pieza.schema";
import { escanearPiezaController } from "./controllers/escanear-pieza.controller";
import { confirmarPiezaController } from "./controllers/confirmar-pieza.controller";

export const piezasRouter = Router();

piezasRouter.post("/escanear", validateBody(EscanearPiezaSchema), escanearPiezaController);
piezasRouter.patch("/:id/confirmar", confirmarPiezaController);
