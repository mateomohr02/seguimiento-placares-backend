import type { Modulo } from "@prisma/client";
import type { ModuloResponseDTO } from "../dtos/modulo-response.dto";

export function toModuloResponseDTO(
  modulo: Modulo & { despieceTipos: { id: string }[] },
): ModuloResponseDTO {
  return {
    id: modulo.id,
    idEscena: modulo.idEscena,
    descripcion: modulo.descripcion,
    estado: modulo.estado,
    despieceTiposCount: modulo.despieceTipos.length,
  };
}
