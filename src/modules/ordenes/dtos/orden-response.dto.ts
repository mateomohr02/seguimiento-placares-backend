export interface OrdenResponseDTO {
  id: string;
  codigoOrdenFabricacion: number;
  numeroOrdenCustom: string;
  descripcion: string;
  estado: string;
  creado_en: string;
  pedidosCount: number;
}
