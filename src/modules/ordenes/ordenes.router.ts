import { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
import { validateBody } from "../../middlewares/validateBody";
import { CreateOrdenSchema } from "./schemas/create-orden.schema";
import { createOrdenController } from "./controllers/create-orden.controller";
import { listOrdenesController } from "./controllers/list-ordenes.controller";
import { getOrdenController } from "./controllers/get-orden.controller";
import { archivarOrdenController, desarchivarOrdenController } from "./controllers/archivar-orden.controller";
import { listPedidosDeOrdenController } from "../pedidos/controllers/list-pedidos-de-orden.controller";
import { eliminarOrdenController } from "./controllers/orden-estado.controller";
import { reordenarOrdenesController } from "./controllers/reordenar-ordenes.controller";

export const ordenesRouter = Router();

ordenesRouter.get("/", requierePermiso(PERMISOS.PRODUCCION_VER), listOrdenesController);
ordenesRouter.post("/", requierePermiso(PERMISOS.ORDENES_GESTIONAR), validateBody(CreateOrdenSchema), createOrdenController);
// Reordenar la cartera (drag and drop del listado inicial; orden compartido): body { ids } → 204.
ordenesRouter.put("/reordenar", requierePermiso(PERMISOS.ORDENES_GESTIONAR), reordenarOrdenesController);
ordenesRouter.get("/:id", requierePermiso(PERMISOS.PRODUCCION_VER), getOrdenController);
ordenesRouter.get("/:id/pedidos", requierePermiso(PERMISOS.PRODUCCION_VER), listPedidosDeOrdenController);
ordenesRouter.patch("/:id/archivar", requierePermiso(PERMISOS.ORDENES_GESTIONAR), archivarOrdenController);
ordenesRouter.patch("/:id/desarchivar", requierePermiso(PERMISOS.ORDENES_GESTIONAR), desarchivarOrdenController);
ordenesRouter.delete("/:id", requierePermiso(PERMISOS.ORDENES_GESTIONAR), eliminarOrdenController);
