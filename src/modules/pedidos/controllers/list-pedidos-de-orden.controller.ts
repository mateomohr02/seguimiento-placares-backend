import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getOrden } from "../../ordenes/services/get-orden.service";
import { listPedidosDeOrden } from "../services/list-pedidos-de-orden.service";
import { toPedidoResponseDTO } from "../mappers/to-pedido-response.dto";

export const listPedidosDeOrdenController = catchAsync(async (req, res) => {
  const ordenId = parseIdParam(req.params.id);
  await getOrden(ordenId); // 404 si no existe / está eliminada
  const pedidos = await listPedidosDeOrden(ordenId);
  return sendResponse(res, 200, pedidos.map(toPedidoResponseDTO));
});
