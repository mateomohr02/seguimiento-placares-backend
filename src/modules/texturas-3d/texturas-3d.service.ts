import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";

// Texturas de los materiales de las escenas 3D (diseño.md §13). Se buscan en la carpeta de datos de
// TeoWin (TEOWIN_3D_DIR, solo lectura) y se copian a la base la primera vez, así el visor no
// depende de ese disco. También se pueden subir a mano. Un mismo código puede ser otra textura en
// otro catálogo (ej. 83 códigos están en Placares y en Cocinas), por eso se resuelven por catálogo.
export const MAX_TEXTURA_BYTES = 8 * 1024 * 1024;
const RAIZ = () => env.TEOWIN_3D_DIR ?? "T:/datos/3d/E_50";
const EXTENSIONES = [".jpg", ".jpeg", ".png"];

/** Código de material de TeoWin → clave estable: sin prefijo `<n>`, minúsculas. */
export function normalizarClave(material: string): string {
  return material.trim().replace(/^<\d+>/, "").trim().toLowerCase();
}

// Catálogos con textura propia: 4 = Placares (fábrica), 3 = Cocinas, 641 = pavimentos y
// revestimientos (decoración: pisos, papel pintado, cemento). Carpetas "planas" de colores (rápidas
// de listar) y árboles de texturas (se indexan una sola vez).
const DIRS: Record<string, { planas: string[]; arboles: string[] }> = {
  "4": { planas: ["4/Colores", "Showroom/4/colores"], arboles: ["4/Texturas"] },
  "3": { planas: ["3/Colores", "Showroom/3/colores"], arboles: ["3/Texturas"] },
  "641": { planas: ["Showroom/641/colores", "641/Colores"], arboles: ["641/Texturas"] },
};
const CATALOGOS = Object.keys(DIRS);

const cacheCarpetas = new Map<string, Map<string, string>>();
const indices = new Map<string, Promise<Map<string, string>>>();

function conTiempo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function listarCarpeta(rel: string): Promise<Map<string, string>> {
  const hit = cacheCarpetas.get(rel);
  if (hit) return hit;
  const mapa = new Map<string, string>();
  try {
    const dir = path.join(RAIZ(), rel);
    for (const f of (await conTiempo(readdir(dir), 8000)) ?? []) {
      const ext = path.extname(f).toLowerCase();
      if (EXTENSIONES.includes(ext)) mapa.set(path.basename(f, path.extname(f)).toLowerCase(), path.join(dir, f));
    }
  } catch {
    // carpeta inexistente o disco no disponible: sin resultados
  }
  // Solo se cachea lo que encontró algo (un disco caído no debe quedar "recordado" como vacío).
  if (mapa.size > 0) cacheCarpetas.set(rel, mapa);
  return mapa;
}

async function indexarArbol(rel: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const recorrer = async (dir: string, nivel: number) => {
    if (nivel > 6) return;
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await recorrer(p, nivel + 1);
      else if (EXTENSIONES.includes(path.extname(e.name).toLowerCase())) {
        const k = path.basename(e.name, path.extname(e.name)).toLowerCase();
        if (!mapa.has(k)) mapa.set(k, p);
      }
    }
  };
  await recorrer(path.join(RAIZ(), rel), 0);
  return mapa;
}

async function buscarEnArbol(rel: string, clave: string): Promise<string | null> {
  let idx = indices.get(rel);
  if (!idx) {
    idx = conTiempo(indexarArbol(rel), 120_000).then((m) => m ?? new Map<string, string>());
    indices.set(rel, idx);
  }
  const mapa = await idx;
  if (mapa.size === 0) indices.delete(rel); // reintenta la próxima vez si el disco no respondió
  return mapa.get(clave) ?? null;
}

/** Busca la textura en el catálogo pedido y, si no está, en los demás (en ese orden). */
async function buscarEnDisco(catalogo: string, clave: string): Promise<string | null> {
  const orden = [catalogo, ...CATALOGOS.filter((c) => c !== catalogo)].filter((c) => DIRS[c]);
  for (const cat of orden) {
    for (const rel of DIRS[cat].planas) {
      const hit = (await listarCarpeta(rel)).get(clave);
      if (hit) return hit;
    }
    for (const rel of DIRS[cat].arboles) {
      const hit = await buscarEnArbol(rel, clave);
      if (hit) return hit;
    }
  }
  return null;
}

const mimeDe = (archivo: string) => (path.extname(archivo).toLowerCase() === ".png" ? "image/png" : "image/jpeg");
const claveDb = (catalogo: string, clave: string) => `${catalogo}/${clave}`;

function catalogoValido(c: string): string {
  if (!/^\d{1,4}$/.test(c)) throw new AppError("Catálogo inválido.", 400);
  return c;
}

/** Copia a la base la textura de `material` (del catálogo dado) si está en la carpeta de TeoWin. */
export async function asegurarTextura(catalogo: string, material: string): Promise<boolean> {
  const clave = normalizarClave(material);
  if (!clave) return false;
  const id = claveDb(catalogo, clave);
  if (await prisma.textura3D.findUnique({ where: { clave: id }, select: { clave: true } })) return true;
  const archivo = await buscarEnDisco(catalogo, clave);
  if (!archivo) return false;
  const info = await stat(archivo);
  if (info.size > MAX_TEXTURA_BYTES) return false;
  const contenido = await readFile(archivo);
  await prisma.textura3D.upsert({
    where: { clave: id },
    create: { clave: id, nombre: material, mime: mimeDe(archivo), tamano: contenido.length, contenido, origen: "teowin" },
    update: {},
  });
  return true;
}

/** Mejor esfuerzo: nunca hace fallar la carga de una escena. `materiales` = "catálogo/código". */
export async function asegurarTexturas(materiales: string[]): Promise<void> {
  for (const m of materiales) {
    const i = m.indexOf("/");
    if (i < 1) continue;
    try {
      await asegurarTextura(m.slice(0, i), m.slice(i + 1));
    } catch (err) {
      console.error("No se pudo copiar la textura", m, err instanceof Error ? err.message : err);
    }
  }
}

export async function getTextura(catalogo: string, material: string) {
  const cat = catalogoValido(catalogo);
  const clave = normalizarClave(material);
  if (!clave) throw new AppError("Textura no encontrada.", 404);
  if (!(await asegurarTextura(cat, clave).catch(() => false))) throw new AppError("Textura no encontrada.", 404);
  const t = await prisma.textura3D.findUnique({ where: { clave: claveDb(cat, clave) }, select: { contenido: true, mime: true } });
  if (!t) throw new AppError("Textura no encontrada.", 404);
  return { contenido: Buffer.from(t.contenido), mime: t.mime };
}

function coincideFirma(mime: string, b: Buffer): boolean {
  if (mime === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

/** Alta o reemplazo manual de una textura (permiso documentacion.gestionar). */
export async function guardarTextura(catalogo: string, material: string, mime: string, contenido: Buffer) {
  const cat = catalogoValido(catalogo);
  const clave = normalizarClave(material);
  if (!clave || clave.length > 120) throw new AppError("Nombre de material inválido.", 400);
  if (mime !== "image/jpeg" && mime !== "image/png") throw new AppError("Formato no soportado. Usá JPG o PNG.", 415);
  if (contenido.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (contenido.length > MAX_TEXTURA_BYTES) throw new AppError("La imagen supera el tamaño máximo (8 MB).", 413);
  if (!coincideFirma(mime, contenido)) throw new AppError("El contenido del archivo no coincide con su formato.", 400);
  const id = claveDb(cat, clave);
  await prisma.textura3D.upsert({
    where: { clave: id },
    create: { clave: id, nombre: material, mime, tamano: contenido.length, contenido, origen: "manual" },
    update: { nombre: material, mime, tamano: contenido.length, contenido, origen: "manual" },
  });
  return { clave: id, tamano: contenido.length };
}
