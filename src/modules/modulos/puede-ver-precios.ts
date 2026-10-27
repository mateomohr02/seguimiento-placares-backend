import type { UsuarioAutenticado } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";

// Los importes de la partida (variantes, precio, total) solo los ven quienes tienen `modulos.precios`.
export const puedeVerPrecios = (usuario: UsuarioAutenticado | undefined): boolean =>
  !!usuario?.permisos.includes(PERMISOS.MODULOS_PRECIOS);
