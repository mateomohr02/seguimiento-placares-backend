import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarPedidoFinalizado } from "../services/marcar-pedido-finalizado.service";
import { toPedidoResponseDTO } from "../mappers/to-pedido-response.dto";

export const marcarPedidoFinalizadoController = catchAsync(async (req, res) => {
  const pedido = await marcarPedidoFinalizado(parseIdParam(req.params.id));
  return sendResponse(res, 200, toPedidoResponseDTO(pedido));
});
