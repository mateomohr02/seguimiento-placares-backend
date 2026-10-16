import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { env } from "../../../config/env";

// Biblioteca de objetos de TeoWin (diseño.md §13.6): los objetos de decoración (atrezzo: boles, persianas,
// radiadores, plantas…) no traen su geometría en la escena, solo el nombre y el catálogo; la malla está en
// `<TEOWIN_3D_DIR>\<catálogo>\Catalogo\<familia>\<nombre>.3d`. Solo lectura: esa carpeta nunca se modifica.
const SEGURO = /^[A-Za-z0-9_.\- ]{1,80}$/;
const MAX_BYTES = 20 * 1024 * 1024;

/** Texto del `.3d` de la biblioteca, o null si no existe (disco no disponible, nombre raro, muy grande). */
export function leerBibliotecaTeoWin(catalogo: string, familia: string, nombre: string): string | null {
  if (!/^\d{1,6}$/.test(catalogo) || !SEGURO.test(familia) || !SEGURO.test(nombre)) return null;
  try {
    const raiz = env.TEOWIN_3D_DIR ?? "T:/datos/3d/E_50";
    const archivo = path.join(raiz, catalogo, "Catalogo", familia, `${nombre}.3d`);
    if (!existsSync(archivo) || statSync(archivo).size > MAX_BYTES) return null;
    return readFileSync(archivo).toString("latin1");
  } catch {
    return null;
  }
}
