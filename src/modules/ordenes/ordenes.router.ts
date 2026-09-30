import { Router } from "express";
import { validateBody } from "../../middlewares/validateBody";
import { CreateOrdenSchema } from "./schemas/create-orden.schema";
import { createOrdenController } from "./controllers/create-orden.controller";
import { listOrdenesController } from "./controllers/list-ordenes.controller";
import { getOrdenController } from "./controllers/get-orden.controller";
import { archivarOrdenController, desarchivarOrdenController } from "./controllers/archivar-orden.controller";
import { listPedidosDeOrdenController } from "../pedidos/controllers/list-pedidos-de-orden.controller";

import { eliminarOrdenController, marcarOrdenPendienteController } from "./controllers/orden-estado.controller";
export const ordenesRouter = Router();

ordenesRouter.get("/", listOrdenesController);
ordenesRouter.post("/", validateBody(CreateOrdenSchema), createOrdenController);
ordenesRouter.get("/:id", getOrdenController);
ordenesRouter.get("/:id/pedidos", listPedidosDeOrdenController);
ordenesRouter.patch("/:id/archivar", archivarOrdenController);
ordenesRouter.patch("/:id/desarchivar", desarchivarOrdenController);
ordenesRouter.patch("/:id/pendiente", marcarOrdenPendienteController);
ordenesRouter.delete("/:id", eliminarOrdenController);
