export interface PiezaResponseDTO {
  id: string;
  idUnico: number | null;
  familia: string;
  articulo: string;
  color: string;
  descripcion: string | null;
  medida1: string;
  medida2: string;
  estado: string;
  escaneado_en: string | null;
}
