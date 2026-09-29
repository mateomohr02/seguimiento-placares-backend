import cors from "cors";
import express from "express";
import { errorController } from "./middlewares/errorController";
import { ordenesRouter } from "./modules/ordenes/ordenes.router";
import { pedidosRouter } from "./modules/pedidos/pedidos.router";
import { modulosRouter } from "./modules/modulos/modulos.router";
import { piezasRouter } from "./modules/piezas/piezas.router";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/ordenes", ordenesRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/modulos", modulosRouter);
app.use("/api/piezas", piezasRouter);

app.use(errorController);
