// Claves de permiso (tabla `permiso`). Qué rol tiene cuál vive en la tabla
// `rol_permiso` (se edita desde la base); acá solo se nombran las funcionalidades.
export const PERMISOS = {
  PRODUCCION_VER: "produccion.ver",
  PIEZAS_MARCAR: "piezas.marcar",
  DOCUMENTACION_VER: "documentacion.ver",
  DOCUMENTACION_ANOTAR: "documentacion.anotar",
  ANOTACIONES_ELIMINAR: "documentacion.anotaciones.eliminar",
  DOCUMENTACION_GESTIONAR: "documentacion.gestionar",
  ORDENES_GESTIONAR: "ordenes.gestionar",
  USUARIOS_GESTIONAR: "usuarios.gestionar",
  PLANILLAS_COMPLETAR: "planillas.completar",
  PLANILLAS_VER: "planillas.ver",
  PLANILLAS_CONFIGURAR: "planillas.configurar",
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];
