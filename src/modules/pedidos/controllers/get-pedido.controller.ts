import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getPedido } from "../services/get-pedido.service";
import { toPedidoResponseDTO } from "../mappers/to-pedido-response.dto";

export const getPedidoController = catchAsync(async (req, res) => {
  const pedido = await getPedido(parseIdParam(req.params.id));
  return sendResponse(res, 200, {
    ...toPedidoResponseDTO(pedido),
    orden: {
      id: pedido.orden.id,
      numeroOrdenCustom: pedido.orden.numeroOrdenCustom,
      descripcion: pedido.orden.descripcion,
    },
  });
});
