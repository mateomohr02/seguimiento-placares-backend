import type { DespieceTipo, PiezaFisica } from "@prisma/client";
import type { PiezaResponseDTO } from "../dtos/pieza-response.dto";

export function toPiezaResponseDTO(
  pieza: PiezaFisica & { despieceTipo: DespieceTipo },
): PiezaResponseDTO {
  return {
    id: pieza.id,
    idUnico: pieza.idUnico,
    familia: pieza.despieceTipo.familia,
    articulo: pieza.despieceTipo.articulo,
    color: pieza.despieceTipo.color,
    descripcion: pieza.despieceTipo.descripcion,
    medida1: pieza.despieceTipo.medida1.toString(),
    medida2: pieza.despieceTipo.medida2.toString(),
    estado: pieza.estado,
    escaneado_en: pieza.escaneado_en ? pieza.escaneado_en.toISOString() : null,
  };
}
