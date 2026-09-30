import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarPedidoPendiente } from "../services/marcar-pedido-pendiente.service";
import { toPedidoResponseDTO } from "../mappers/to-pedido-response.dto";

export const marcarPedidoPendienteController = catchAsync(async (req, res) => {
  const pedido = await marcarPedidoPendiente(parseIdParam(req.params.id));
  return sendResponse(res, 200, toPedidoResponseDTO(pedido));
});
