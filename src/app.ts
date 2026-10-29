import cors from "cors";
import express from "express";
import { errorController } from "./middlewares/errorController";
import { autenticar } from "./modules/auth/auth.middleware";
import { authRouter } from "./modules/auth/auth.router";
import { ordenesRouter } from "./modules/ordenes/ordenes.router";
import { pedidosRouter } from "./modules/pedidos/pedidos.router";
import { modulosRouter } from "./modules/modulos/modulos.router";
import { piezasRouter } from "./modules/piezas/piezas.router";
import { documentosDePedidoRouter, documentosPedidoRouter } from "./modules/documentos-pedido/documentos-pedido.router";
import { planosDePedidoRouter, planosPedidoRouter } from "./modules/planos-pedido/planos-pedido.router";
import { escenasDePedidoRouter, escenasPedidoRouter } from "./modules/escenas-pedido/escenas-pedido.router";
import { texturas3dRouter } from "./modules/texturas-3d/texturas-3d.router";
import { planillasRouter } from "./modules/planillas/planillas.router";
import { planificacionRouter } from "./modules/planificacion/planificacion.router";
import { hojasCorteRouter, hojasDeOrdenRouter } from "./modules/hojas-corte/hojas-corte.router";
import { usuariosRouter } from "./modules/usuarios/usuarios.router";
import { estacionesTrabajoRouter } from "./modules/estaciones-trabajo/estaciones-trabajo.router";

export const app = express();

app.use(cors());
// La confirmación del importador de planificación lleva hasta 2000 filas: necesita más que el límite por defecto (100 kb).
const jsonNormal = express.json();
const jsonImportador = express.json({ limit: "3mb" });
app.use((req, res, next) => (req.path === "/api/planificacion/importar/confirmar" ? jsonImportador(req, res, next) : jsonNormal(req, res, next)));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);

// Desde acá, todo requiere sesión (token de PIN). Cada ruta declara además su
// permiso con requierePermiso (diseño.md §12).
app.use("/api", autenticar);

app.use("/api/ordenes/:ordenId/hojas-corte", hojasDeOrdenRouter);
app.use("/api/hojas-corte", hojasCorteRouter);
app.use("/api/ordenes", ordenesRouter);
app.use("/api/pedidos/:pedidoId/documentos", documentosDePedidoRouter);
app.use("/api/documentos-pedido", documentosPedidoRouter);
app.use("/api/pedidos/:pedidoId/planos", planosDePedidoRouter);
app.use("/api/planos-pedido", planosPedidoRouter);
app.use("/api/pedidos/:pedidoId/escenas", escenasDePedidoRouter);
app.use("/api/escenas-pedido", escenasPedidoRouter);
app.use("/api/texturas-3d", texturas3dRouter);
app.use("/api/planillas", planillasRouter);
app.use("/api/planificacion", planificacionRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/modulos", modulosRouter);
app.use("/api/piezas", piezasRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/estaciones-trabajo", estacionesTrabajoRouter);

app.use(errorController);
