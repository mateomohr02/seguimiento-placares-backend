export interface OrdenResponseDTO {
  id: string;
  codigoOrdenFabricacion: number;
  numeroOrdenCustom: string;
  descripcion: string;
  estado: string;
  creado_en: string;
  archivada_en: string | null;
  pedidosCount: number;
  /** Códigos de pedido de la orden (para buscar por pedido en el listado). */
  codigosPedido: string[];
}
