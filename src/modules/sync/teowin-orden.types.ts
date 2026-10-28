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
  /** Catálogo de la fila raíz del módulo (3 = Cocinas, 4 = Placares): define Modulo.linea. */
  idCatalogo: number | null;
}

/** Partida de TeoWin (fila de tpresupuestoLineas) de la raíz de un módulo, tal como sale de la consulta. */
export interface TeowinPartidaRow {
  orden_fabricacion: number;
  pedido: string;
  modulo_id: number;
  partida_linea: number;
  uds: number | null;
  referencia: string;
  descripcion_partida: string | null;
  titulo_partida: string | null;
  L: number | null;
  H: number | null;
  P: number | null;
  variantes: number | null;
  precio_unitario: number | null;
  total: number | null;
  capitulo: string | null;
}
