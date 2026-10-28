import type { Modulo, ModuloPartida } from "@prisma/client";
import type { ModuloResponseDTO, PartidaResponseDTO } from "../dtos/modulo-response.dto";

function toPartidaDTO(p: ModuloPartida, verPrecios: boolean): PartidaResponseDTO {
  return {
    unidades: p.unidades,
    referencia: p.referencia,
    titulo: p.titulo,
    descripcion: p.descripcion,
    largo: p.largo,
    alto: p.alto,
    profundidad: p.profundidad,
    capitulo: p.capitulo,
    // Los importes se omiten (no se mandan en null) si el usuario no tiene `modulos.precios`.
    ...(verPrecios ? { variantes: p.variantes, precio: p.precio_unitario, total: p.total } : {}),
  };
}

export function toModuloResponseDTO(
  modulo: Modulo & { despieceTipos: { id: string }[]; partida: ModuloPartida | null },
  verPrecios: boolean,
): ModuloResponseDTO {
  return {
    id: modulo.id,
    idEscena: modulo.idEscena,
    descripcion: modulo.descripcion,
    linea: modulo.linea,
    estado: modulo.estado,
    despieceTiposCount: modulo.despieceTipos.length,
    partida: modulo.partida ? toPartidaDTO(modulo.partida, verPrecios) : null,
  };
}
