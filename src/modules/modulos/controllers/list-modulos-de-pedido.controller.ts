import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getPedido } from "../../pedidos/services/get-pedido.service";
import { listModulosDePedido } from "../services/list-modulos-de-pedido.service";
import { toModuloResponseDTO } from "../mappers/to-modulo-response.dto";

export const listModulosDePedidoController = catchAsync(async (req, res) => {
  const pedidoId = parseIdParam(req.params.id);
  await getPedido(pedidoId);
  const modulos = await listModulosDePedido(pedidoId);
  return sendResponse(res, 200, modulos.map(toModuloResponseDTO));
});
