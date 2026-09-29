export interface TeowinOrdenCabecera {
  numeroOrden: number;
  numeroOrdenCustom: string;
  descripcion: string;
}

export interface TeowinDespieceRow {
  orden_fabricacion: number;
  pedido: string;
  modulo_id: number;
  pieza_tipo_id: number;
  familia: string;
  articulo: string;
  color: string;
  idCatalogo: number;
  medida1: number;
  medida2: number;
  unidades: number;
  idunico: number | null;
  pieza_descripcion: string | null;
}

export interface TeowinPedidoInfo {
  codigo_pedido: string;
  referencia: string;
  nombreComercial: string | null;
}

export interface TeowinModuloInfo {
  modulo_id: number;
  familia_mueble: string;
  articulo_mueble: string;
  descripcion_mueble: string | null;
  L: number | null;
  H: number | null;
  P: number | null;
}
