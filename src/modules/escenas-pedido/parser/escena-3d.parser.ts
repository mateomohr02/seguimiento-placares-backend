import earcut from "earcut";
import { evaluar, grupos, oculto, type Entorno } from "./expresion";

// Intérprete (solo lectura) de los .3d de TeoWin — diseño.md §13. Devuelve una
// geometría liviana para el visor: cajas (tableros y extrusiones rectangulares),
// caras de pared y el contorno del suelo. Respeta `nuncavis3d` e `invisibilidad(...)` (piezas
// que TeoWin no dibuja según las medidas del mueble). No interpreta tube / malla ni
// extrusiones no rectangulares (herrajes, ventanas) ni luces o cotas. Detecta las piezas que se
// mueven (cajones y hojas corredizas) para animarlas, y los materiales de paredes y piso.
// Subir PARSER_VERSION cuando cambie la salida (el original se conserva en la
// base, así se puede re-interpretar).
type Vec3 = [number, number, number];

export const PARSER_VERSION = 25;

export interface CajaEscena {
  /** idEscena del módulo al que pertenece (null = no asociada). */
  mod: number | null;
  /** Código de color/material de TeoWin (ej. "FSG"); "" si no tiene. */
  m: string;
  /** color(r,g,b) 0..1 cuando el material viene vacío. */
  c: [number, number, number] | null;
  /** Posición del origen de la caja. */
  t: [number, number, number];
  /** Matriz de rotación 3×3 por filas. */
  r: number[];
  /** Tamaño local (L, H, P) en mm. */
  s: [number, number, number];
  /** Índice en `animaciones` si la pieza se mueve con un cajón o una hoja corrediza. */
  a?: number;
  /** Opacidad (transp) cuando la pieza es translúcida (vidrio); se omite si es opaca. */
  o?: number;
  /** Catálogo de la pieza cuando no es el 4 (ej. 658 = puertas, 3 = cocinas): define dónde buscar su textura. */
  k?: string;
}

/** Grupo de piezas que se desplazan juntas: un cajón que se abre o una hoja corrediza. */
export interface AnimacionEscena {
  tipo: "cajon" | "puerta" | "giro";
  mod: number | null;
  /** Solo `giro` (puerta con bisagra): punto del eje de la bisagra, en el sistema de la escena. */
  pivote?: [number, number, number];
  /** Dirección del desplazamiento, o eje de giro (vector unitario, en el sistema de la escena). */
  eje: [number, number, number];
  /** Recorrido de apertura en mm (en `giro`: ángulo en grados, con signo). */
  dist: number;
}

/** Malla de triángulos (cortinas, barandas, tubos, vidrios con forma…): vértices ya compactados. */
export interface MallaEscena {
  mod: number | null;
  /** Código de material de TeoWin; "" si no tiene. */
  m: string;
  c: [number, number, number] | null;
  /** Origen y rotación (3×3 por filas) del objeto al que pertenece la malla. */
  t: [number, number, number];
  r: number[];
  /** Vértices x,y,z consecutivos (mm, en el sistema del objeto). */
  v: number[];
  /** Triángulos: 3 índices de vértice por cara. */
  i: number[];
  /** Coordenadas de textura u,v por vértice, si las trae. */
  uv?: number[];
  a?: number;
  o?: number;
  k?: string;
  /** Sin iluminación: foto de paisaje (se ve igual desde cualquier lado). */
  e?: 1;
}

export interface ParedEscena {
  lado: "int" | "ext";
  /** 4 vértices del rectángulo (mm). */
  p: [number, number, number][];
  /** Material decorativo de la cara (ej. papel pintado), si lo declara. */
  m?: string;
  /** Medida (mm) de la baldosa del revestimiento (patrón `enrajolat`): la textura entera cubre una baldosa. */
  t?: [number, number];
  /** Cara de un tabique o una columna: se dibuja de los dos lados (no mira al centro del cuarto). */
  d?: 1;
  /** Huecos de la cara (puertas de paso), como [x0, y0, x1, y1] en mm sobre la cara: x desde el vértice 0 hacia el 1, y hacia arriba. */
  h?: [number, number, number, number][];
}

export interface ModuloEscena {
  idEscena: number;
  nombre: string;
  familia: string;
  /** Catálogo del mueble (4 = Placares, 3 = Cocinas): los códigos de material son de ese catálogo. */
  catalogo: string;
  /** Hacia dónde mira el frente del mueble en la escena (vector unitario en planta). */
  frente: [number, number, number];
  /** Ancho, alto y profundidad del mueble (use L/H/P). */
  dim: [number, number, number];
}

export interface Escena3D {
  version: number;
  cabecera: { pedido: string | null; version3d: string | null };
  modulos: ModuloEscena[];
  cajas: CajaEscena[];
  /** Mallas de triángulos (`malla`/`caras`) y tubos (`tube`/`tubeSp`). */
  mallas: MallaEscena[];
  paredes: ParedEscena[];
  animaciones: AnimacionEscena[];
  /** Material decorativo del piso (ej. parquet), si lo declara. */
  materialSuelo: string | null;
  /** Medida (mm) de la baldosa del piso, si el piso lleva un patrón de baldosas. */
  sueloTile: [number, number] | null;
  /** Materiales usados como "catálogo/código" (cajas, paredes y piso), para buscar sus texturas. */
  materiales: string[];
  /** Contorno del suelo en planta [x, z] (mm), tomado de las paredes interiores. */
  suelo: [number, number][];
  /** Expresiones/variables que no se pudieron resolver (diagnóstico). */
  sinResolver: string[];
}

interface Primitiva {
  tipo: string;
  args: string[][];
  m: string;
  c: [number, number, number] | null;
  /** transp(0): la pieza está en el .3d pero TeoWin no la dibuja (volumen auxiliar). */
  invisible: boolean;
  /** transp(x) con x < 1: pieza translúcida (vidrio). */
  opacidad: number | null;
  /** <MATERIAL> declarado en el CAD de la propia línea (paredes). */
  materialCad: string | null;
  /** Medida de la baldosa del patrón del CAD (paredes). */
  tile: [number, number] | null;
  /** Texto completo de la primitiva (tubos). */
  raw: string;
  /** `ang(x,y,z)` intercalado en una extrusión (zócalos): la gira sobre su desplazamiento. */
  ang: string[] | null;
  /** Línea `eti""` (sin etiqueta): en una encimera es el hueco de la bacha o la hornalla, no se dibuja. */
  sinEti: boolean;
}

/** Malla leída del .3d, todavía sin compactar. */
interface MallaCruda {
  m: string;
  c: [number, number, number] | null;
  opacidad: number | null;
  invisible: boolean;
  v: number[];
  i: number[];
  uv: number[];
}

class Nodo {
  kids: Nodo[] = [];
  use: Record<string, string> = {};
  /** `local L=1500`: medida propia del objeto (puertas de paso, que no declaran `use`). */
  local: Record<string, number> = {};
  param: Record<string, string> = {};
  virtual: string[][] | null = null;
  ang: string[] | null = null;
  pos: string[] | null = null;
  idEscena: number | null = null;
  objeti = "";
  familia = "";
  catalogo = "";
  nombreModulo = "";
  /** Marca `nuncavis3d`: la pieza no se dibuja nunca en 3D (se salta con todo lo que cuelga). */
  nuncaVisible = false;
  /** Espesor del tablero (matTablero con la cara 128), si es numérico. */
  espesor: number | null = null;
  /** Condición de `invisibilidad(...)`, se evalúa con las medidas del mueble. */
  invisibilidad: string | null = null;
  /** Marca `seabre`: cajón que se desliza hacia el frente. */
  seAbre = false;
  /** Marca `corredera`: hoja de puerta corrediza. */
  corredera = false;
  /** anguloAper(n): puerta con bisagra, ángulo máximo de apertura en grados. */
  anguloAper: number | null = null;
  /** porcenAperOpn: fracción del recorrido que se abre (0..1). */
  porcen: number | null = null;
  /** <MATERIAL> del CAD del nodo (piso). */
  materialCad: string | null = null;
  /** Medida de la baldosa del patrón del CAD del nodo (piso). */
  tile: [number, number] | null = null;
  prims: Primitiva[] = [];
  meshes: MallaCruda[] = [];
  /** `idrep(n)`: número de repetición del objeto en una serie (travesaños, listones): lo usan las fórmulas. */
  idrep: number | null = null;
  /** `orient n`: plano de un contorno extruido (2 = planta); la cubeta de una bacha es orient 2. */
  orient: number | null = null;
  /** Marca `esAtrezzo`: pieza decorativa real aunque no tenga material (tiras LED). */
  atrezzo = false;
  /** Marca `esBiblioteca`: la geometría está en el archivo del catálogo de TeoWin, no en la escena. */
  biblioteca = false;
  bibliotecaCargada = false;
  /** Contorno `camino(R)(0,0)(x,y,z)…` (losas de encimera que TeoWin genera desde el recorrido). */
  camino: Vec3[] = [];
  /** Solo la raíz: `globalParam` de cada catálogo (`DatosCat(n)`), p. ej. Hz = altura del zócalo. */
  globales: Record<string, Record<string, string>> = {};
  mallaActual: MallaCruda | null = null;
  /** Último material declarado (`mat"X"`): las líneas `color(...)` sin material lo heredan. */
  lastMat = "";
  constructor(readonly nombre: string) {}
}

// transp(0.6) → 0.6; opaco (1) o sin dato → null.
function opacidadDe(t: string): number | null {
  const m = /\btransp\(([\d.]+)\)/.exec(t);
  const v = m ? Number(m[1]) : 1;
  return v > 0 && v < 1 ? v : null;
}

// Patrón de baldosas de un CAD (`<J>0</J><Y>200</Y><X>200</X>`): medida de cada baldosa en mm.
function tileDeCad(t: string): [number, number] | null {
  const m = /<J>[-\d.]+<\/J><Y>([\d.]+)<\/Y><X>([\d.]+)<\/X>/.exec(t);
  if (!m) return null;
  const x = Number(m[2]);
  const y = Number(m[1]);
  return x > 10 && y > 10 ? [x, y] : null;
}

// "objpath" es el volumen del hueco que la puerta de paso abre en la pared y "objformapath" el marco de cada hoja (un sólido sin el hueco, que no se puede restar): no se dibujan.
const NODOS_IGNORADOS = new Set(["mecanizado", "label", "defespigameca", "objpath", "RECORTA-PARED", "RECORTA_PARED"]);

const ATTR = /^(eti"|mat"|color\()/;
const PRIM = /\b(taulerv|taulerh|taulerf|extrudeSp|extrude|tubeSp|tube|revolSp|revol|faceset|face|poly)(\(.*)$/;
const PRIM_LINEA = /^(taulerv|taulerh|taulerf|extrudeSp|extrude|tubeSp|tube|revolSp|revol)\(/;

/** Recorre los grupos `(...)` de una línea a partir de `desde`, sin armar arreglos intermedios. */
function recorrerGrupos(s: string, desde: number, cb: (g: string) => void) {
  let i = desde;
  while (i < s.length) {
    const a = s.indexOf("(", i);
    if (a < 0) break;
    const b = s.indexOf(")", a);
    if (b < 0) break;
    cb(s.slice(a + 1, b));
    i = b + 1;
  }
}

function leerMalla(t: string, mc: MallaCruda) {
  if (t.startsWith("malla(")) {
    recorrerGrupos(t, 5, (g) => {
      const p = g.split(",");
      if (p.length >= 3) mc.v.push(Number(p[0]), Number(p[1]), Number(p[2]));
    });
  } else if (t.startsWith("caras(")) {
    // El primer grupo (sin comas) es la cantidad de caras; cada cara son índices terminados en -1.
    recorrerGrupos(t, 5, (g) => {
      if (!g.includes(",")) return;
      const idx = g.split(",").map(Number).filter((x) => x >= 0);
      for (let k = 1; k + 1 < idx.length; k++) mc.i.push(idx[0], idx[k], idx[k + 1]);
    });
  } else if (t.startsWith("texcoord(")) {
    recorrerGrupos(t, 8, (g) => {
      const p = g.split(",");
      if (p.length >= 2) mc.uv.push(Number(p[0]), Number(p[1]));
    });
  }
}

/** Quita vértices repetidos y redondea (0,1 mm; 0,001 en UV): el JSON queda más chico. */
function compactarMalla(v: number[], idx: number[], uv: number[] | null) {
  const mapa = new Map<string, number>();
  const nv: number[] = [];
  const nuv: number[] = [];
  const nuevo = new Array<number>(v.length / 3);
  for (let k = 0; k < v.length / 3; k++) {
    const x = Math.round(v[k * 3] * 10) / 10;
    const y = Math.round(v[k * 3 + 1] * 10) / 10;
    const z = Math.round(v[k * 3 + 2] * 10) / 10;
    const u = uv ? Math.round(uv[k * 2] * 1000) / 1000 : 0;
    const w = uv ? Math.round(uv[k * 2 + 1] * 1000) / 1000 : 0;
    const clave = `${x},${y},${z},${u},${w}`;
    let n = mapa.get(clave);
    if (n === undefined) {
      n = nv.length / 3;
      mapa.set(clave, n);
      nv.push(x, y, z);
      if (uv) nuv.push(u, w);
    }
    nuevo[k] = n;
  }
  const ni: number[] = [];
  for (let k = 0; k + 2 < idx.length; k += 3) {
    const a = nuevo[idx[k]];
    const b = nuevo[idx[k + 1]];
    const c = nuevo[idx[k + 2]];
    if (a === undefined || b === undefined || c === undefined || a === b || b === c || a === c) continue;
    ni.push(a, b, c);
  }
  return { v: nv, i: ni, uv: uv ? nuv : null };
}

/** Sólido de revolución sobre el eje Y: el perfil son pares (radio, altura); `alfa` grados de barrido. */
function mallaDeRevolucion(perfil: [number, number][], alfa: number): { v: number[]; i: number[] } {
  const barrido = Math.min(360, Math.max(1, alfa));
  const cerrado = barrido >= 359.9;
  const lados = Math.max(6, Math.round((barrido / 360) * 20));
  const anillos = cerrado ? lados : lados + 1;
  const v: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < anillos; k++) {
    const a = ((k / lados) * barrido * Math.PI) / 180;
    for (const [r, y] of perfil) v.push(r * Math.cos(a), y, r * Math.sin(a));
  }
  const n = perfil.length;
  const filas = cerrado ? lados : lados;
  for (let k = 0; k < filas; k++) {
    const k2 = (k + 1) % anillos;
    for (let j = 0; j + 1 < n; j++) {
      const a0 = k * n + j;
      const b0 = k * n + j + 1;
      const a1 = k2 * n + j;
      const b1 = k2 * n + j + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { v, i: idx };
}

/** Tubo redondo que recorre `pts` con un radio por punto (cilindros troncocónicos, 10 lados). */
function mallaDeTubo(pts: Vec3[], radios: number[]): { v: number[]; i: number[] } {
  const LADOS = 10;
  const v: number[] = [];
  const idx: number[] = [];
  const base = (d: Vec3): [Vec3, Vec3] => {
    const a: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u: Vec3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const ln = Math.hypot(u[0], u[1], u[2]) || 1;
    const un: Vec3 = [u[0] / ln, u[1] / ln, u[2] / ln];
    const w: Vec3 = [d[1] * un[2] - d[2] * un[1], d[2] * un[0] - d[0] * un[2], d[0] * un[1] - d[1] * un[0]];
    return [un, w];
  };
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ln = Math.hypot(d[0], d[1], d[2]);
    if (ln < 1e-6) continue;
    const dn: Vec3 = [d[0] / ln, d[1] / ln, d[2] / ln];
    const [u, w] = base(dn);
    const ra = Math.max(0.1, radios[s] ?? radios[0] ?? 5);
    const rb = Math.max(0.1, radios[s + 1] ?? ra);
    const o = v.length / 3;
    for (let k = 0; k < LADOS; k++) {
      const ang = (k / LADOS) * Math.PI * 2;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const dir: Vec3 = [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn];
      v.push(a[0] + dir[0] * ra, a[1] + dir[1] * ra, a[2] + dir[2] * ra);
      v.push(b[0] + dir[0] * rb, b[1] + dir[1] * rb, b[2] + dir[2] * rb);
    }
    for (let k = 0; k < LADOS; k++) {
      const k2 = (k + 1) % LADOS;
      const a0 = o + k * 2;
      const b0 = o + k * 2 + 1;
      const a1 = o + k2 * 2;
      const b1 = o + k2 * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { v, i: idx };
}


/**
 * Prisma recto de un contorno plano: el eje en que el contorno no varía es el de extrusión (espesor `esp`).
 * Triangula con earcut (soporta los contornos con huecos que TeoWin escribe como un único recorrido).
 * `sinTapa` deja abierta la cara superior (cubetas de bachas). null si el contorno no es plano.
 */
function prismaDeContorno(P: Vec3[], esp: number, sinTapa = false): { v: number[]; i: number[] } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of P) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const planos = [0, 1, 2].filter((k) => max[k] - min[k] < 1e-6);
  if (planos.length !== 1) return null;
  const eje = planos[0];
  const [a, b] = [0, 1, 2].filter((k) => k !== eje);
  const pts = P.length > 3 && P[0].every((x, j) => Math.abs(x - P[P.length - 1][j]) < 1e-6) ? P.slice(0, -1) : P;
  if (pts.length < 3) return null;
  const flat: number[] = [];
  for (const p of pts) flat.push(p[a], p[b]);
  const tri = earcut(flat);
  if (tri.length < 3) return null;
  const n = pts.length;
  const v: number[] = [];
  for (const h of [0, esp]) {
    for (const p of pts) {
      const q: Vec3 = [0, 0, 0];
      q[a] = p[a];
      q[b] = p[b];
      q[eje] = p[eje] + h;
      v.push(q[0], q[1], q[2]);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < tri.length; k += 3) {
    idx.push(tri[k], tri[k + 1], tri[k + 2]);
    if (!sinTapa) idx.push(n + tri[k], n + tri[k + 1], n + tri[k + 2]);
  }
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    idx.push(k, k2, n + k, k2, n + k2, n + k);
  }
  return { v, i: idx };
}

/**
 * `extrude`/`extrudeSp` con un contorno plano que no es un rectángulo alineado (marcos de abertura, bordes de
 * bacha, perfiles con relieve) → prisma exacto en el sistema del objeto. null: se dibuja como caja.
 */
function prismaDePrimitiva(
  pr: Primitiva,
  n: Nodo,
  env: Entorno,
  ev: (e: string, env: Entorno) => number | null,
  evVec: (g: string[] | undefined, env: Entorno) => Vec3 | null,
): { v: number[]; i: number[] } | null {
  const size = evVec(pr.args[0], env);
  const off = evVec(pr.args[1], env);
  if (!size || !off) return null;
  const pts = pr.args.slice(2).filter((g) => g.length >= 3).map((g) => evVec(g, env));
  if (pts.length < 3 || pts.some((q) => q === null)) return null;
  let Q = pts as Vec3[];
  const cierre = Q.findIndex((q, k) => k > 1 && q.every((x, j) => Math.abs(x - Q[0][j]) < 1e-6));
  if (cierre > 1) Q = Q.slice(0, cierre + 1);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const q of Q) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], q[k]);
      max[k] = Math.max(max[k], q[k]);
    }
  }
  const planos = [0, 1, 2].filter((k) => max[k] - min[k] < 1e-6);
  if (planos.length !== 1) return null;
  const eje = planos[0];
  const [a, b] = [0, 1, 2].filter((k) => k !== eje);
  const marco = n.nombre === "objformapath";
  if (!marco) {
    // Rectángulo alineado (o casi): la caja alcanza.
    let area = 0;
    for (let k = 0; k < Q.length; k++) {
      const p = Q[k];
      const q = Q[(k + 1) % Q.length];
      area += p[a] * q[b] - q[a] * p[b];
    }
    const caja = (max[a] - min[a]) * (max[b] - min[b]);
    if (caja <= 0 || Math.abs(area) / 2 / caja > 0.985) return null;
  }
  const esp = size[eje] > 0.5 ? size[eje] : ESPESOR_DEFECTO;
  const sinTapa = marco && n.orient === 2 && eje === 1 && esp >= 50;
  const pm = prismaDeContorno(Q, esp, sinTapa);
  if (!pm) return null;
  const R = pr.ang ? rotacion(...(pr.ang.slice(0, 3).map((x) => ev(x, env) ?? 0) as [number, number, number])) : ID3;
  for (let k = 0; k < pm.v.length; k += 3) {
    const q = apply(R, [pm.v[k], pm.v[k + 1], pm.v[k + 2]]);
    pm.v[k] = q[0] + off[0];
    pm.v[k + 1] = q[1] + off[1];
    pm.v[k + 2] = q[2] + off[2];
  }
  return pm;
}

function parsearArbol(texto: string): Nodo {
  const raiz = new Nodo("ROOT");
  const pila: Nodo[] = [raiz];
  let pendiente: Nodo | null = null;
  let attr: string | null = null;
  let catDatos: string | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^obj"([^"]*)"$/.exec(t))) {
      const n = new Nodo(m[1]);
      pila[pila.length - 1].kids.push(n);
      pendiente = n;
      attr = null;
      continue;
    }
    if (t === "{") {
      if (pendiente) pila.push(pendiente);
      attr = null;
      continue;
    }
    if (t === "}") {
      if (pila.length > 1) pila.pop();
      attr = null;
      continue;
    }
    // Parámetros globales de cada catálogo (Hz, He, Pe…): los usan las fórmulas de los muebles.
    if ((m = /^DatosCat\((\d+)\)/.exec(t))) {
      catDatos = m[1];
      continue;
    }
    if (t === "FinDatosCat") {
      catDatos = null;
      continue;
    }
    if (catDatos && (m = /^globalParam\s+(\S+)\s*=\s*"([^"]*)"/.exec(t))) {
      (raiz.globales[catDatos] ??= {})[m[1]] = m[2];
      continue;
    }
    const o = pila[pila.length - 1];
    // `nuncavis3d` e `invisib` (ej. los tiradores de un armario sin tirador): TeoWin no dibuja la pieza.
    if (/\b(nuncavis3d|invisib)\b/.test(t) && !t.startsWith("eti")) o.nuncaVisible = true;
    if (!t.startsWith("eti")) {
      if (/\bseabre\b/.test(t)) o.seAbre = true;
      if (/\bcorredera\b/.test(t)) o.corredera = true;
      if (/\besAtrezzo\b/.test(t)) o.atrezzo = true;
      if (/\besBiblioteca\b/.test(t)) o.biblioteca = true;
      const aa = /\banguloAper\((\d+(?:\.\d+)?)\)/.exec(t);
      if (aa) o.anguloAper = Number(aa[1]);
      const po = /porcenAperOpn\(([\d.]+)\)/.exec(t);
      if (po) o.porcen = Number(po[1]);
    }
    if (t.includes("<MATERIAL>") && o.materialCad === null) {
      o.materialCad = /<MATERIAL>([^<]+)<\/MATERIAL>/.exec(t)?.[1]?.trim() || null;
    }
    if (o.tile === null) o.tile = tileDeCad(t);
    if ((m = /^local (\w+)\s*=(-?\d+(?:\.\d+)?)$/.exec(t))) o.local[m[1]] = Number(m[2]);
    else if ((m = /^use (\w+)\s*=(.*)$/.exec(t))) o.use[m[1]] = m[2].trim();
    else if ((m = /^param (\w+)\s*=\s*"(.*)"/.exec(t))) o.param[m[1]] = m[2];
    else if (t.startsWith("virtual(")) o.virtual = grupos(t).slice(0, 2);
    else if (t.startsWith("ang(")) o.ang = grupos(t)[0] ?? null;
    else if (t.startsWith("pos(")) o.pos = grupos(t)[0] ?? null;
    else if ((m = /(?:^|\s)idEscena\((\d+)\)/.exec(t))) o.idEscena = Number(m[1]);
    else if ((m = /^camino\(R\)\([^)]*\)\(([^)]*)\)/.exec(t))) {
      const q = m[1].split(",").map(Number);
      if (q.length === 3 && q.every(Number.isFinite)) o.camino.push([q[0], q[1], q[2]]);
    }
    else if ((m = /^orient (\d)/.exec(t))) o.orient = Number(m[1]);
    else if ((m = /^idrep\((\d+)\)/.exec(t))) o.idrep = Number(m[1]);
    else if ((m = /^objeti"(\w*)"/.exec(t))) o.objeti = m[1];
    else if ((m = /^familia"(\w+)"/.exec(t))) o.familia = m[1];
    else if ((m = /^IDCatalogo"(\d+)"/.exec(t))) o.catalogo = m[1];
    else if ((m = /^matTablero 128,"[^"]*","([\d.]+)"/.exec(t))) o.espesor = Number(m[1]);
    else if (t.startsWith("invisibilidad(")) o.invisibilidad = t.slice(14, t.lastIndexOf(")"));
    else if ((m = /^nombreModulo"([^"]*)"/.exec(t))) o.nombreModulo = m[1];
    else if (ATTR.test(t) || (attr !== null && PRIM_LINEA.test(t))) {
      // La primitiva puede venir en la misma línea que `eti"..." mat"..."` o en la siguiente (tiras de canto,
      // marcos de puertas); una línea `color(...)` sin material hereda el último `mat"..."`.
      const esAttr = ATTR.test(t);
      const completa: string = !esAttr && attr !== null ? `${attr} ${t}` : t;
      const matTxt = /mat"([^"]*)"/.exec(completa);
      if (esAttr) {
        o.mallaActual = null;
        if (matTxt) o.lastMat = matTxt[1];
      }
      const prim = PRIM.exec(completa);
      attr = prim ? null : esAttr ? t : attr;
      if (prim) {
        const col = /color\(([\d.]+),([\d.]+),([\d.]+)\)/.exec(completa);
        let cuerpo = prim[2];
        let angPrim: string[] | null = null;
        if (/^(extrude|extrudeSp|tube|tubeSp|revol|revolSp)$/.test(prim[1])) {
          const ma = /\bang\(([^)]*)\)/.exec(cuerpo);
          if (ma) {
            angPrim = ma[1].split(",");
            cuerpo = cuerpo.replace(ma[0], "");
          }
        }
        o.prims.push({
          tipo: prim[1],
          // extrudeSp trae un segundo perfil de tangentes después de `tg`: solo se usa el primero.
          args: grupos(prim[1] === "extrudeSp" ? cuerpo.split(/tg\(/)[0] : cuerpo),
          m: matTxt ? matTxt[1] : o.lastMat,
          c: col ? [Number(col[1]), Number(col[2]), Number(col[3])] : null,
          invisible: /\btransp\(0(\.0+)?\)/.test(completa),
          opacidad: opacidadDe(completa),
          materialCad: /<MATERIAL>([^<]+)<\/MATERIAL>/.exec(completa)?.[1]?.trim() || null,
          tile: tileDeCad(completa),
          raw: cuerpo,
          ang: angPrim,
          sinEti: /(?:^|\s)eti""/.test(completa),
        });
      }
    } else if (/^(malla|caras|texcoord)\(/.test(t)) {
      if (!o.mallaActual) {
        const base = attr ?? "";
        const matTxt = /mat"([^"]*)"/.exec(base);
        const col = /color\(([\d.]+),([\d.]+),([\d.]+)\)/.exec(base);
        o.mallaActual = {
          m: matTxt ? matTxt[1] : o.lastMat,
          c: col ? [Number(col[1]), Number(col[2]), Number(col[3])] : null,
          opacidad: opacidadDe(base),
          invisible: /\btransp\(0(\.0+)?\)/.test(base),
          v: [],
          i: [],
          uv: [],
        };
        o.meshes.push(o.mallaActual);
      }
      leerMalla(t, o.mallaActual);
    }
  }
  return raiz;
}

type Mat3 = number[]; // por filas, 9
const ID3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  }
  return r;
};
const apply = (a: Mat3, v: Vec3): Vec3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];
function rotacion(ax: number, ay: number, az: number): Mat3 {
  const cx = Math.cos((ax * Math.PI) / 180);
  const sx = Math.sin((ax * Math.PI) / 180);
  const cy = Math.cos((ay * Math.PI) / 180);
  const sy = Math.sin((ay * Math.PI) / 180);
  const cz = Math.cos((az * Math.PI) / 180);
  const sz = Math.sin((az * Math.PI) / 180);
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(rz, mul(ry, rx));
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const rv = (v: Vec3): Vec3 => [r1(v[0]), r1(v[1]), r1(v[2])];

// extrude(L,H,P)(offset)(punto)(punto)...: polígono plano extruido. Solo se soportan los
// rectángulos alineados a los ejes (tapas, paneles); el espesor es la medida (L, H o P)
// del eje en el que el polígono es plano. Otras formas (marcos, perfiles) se omiten.
function cajaDeExtrusion(
  args: string[][],
  env: Entorno,
  ev: (e: string, env: Entorno) => number | null,
  evVec: (g: string[] | undefined, env: Entorno) => Vec3 | null,
): [Vec3, Vec3] | null {
  const size = evVec(args[0], env);
  const off = evVec(args[1], env);
  // Los grupos de menos de 3 valores que siguen al perfil (`NumCapas(12)(1)`) no son puntos.
  const pts = args.slice(2).filter((g) => g.length >= 3).map((g) => evVec(g, env));
  if (!size || !off || pts.length < 3 || pts.some((p) => p === null)) return null;
  // Perfiles con relieve (puertas con moldura): solo cuenta el primer contorno cerrado.
  let P = pts as Vec3[];
  const cierre = P.findIndex((p, i) => i > 1 && p.every((v, j) => Math.abs(v - P[0][j]) < 1e-6));
  if (cierre > 1) P = P.slice(0, cierre + 1);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of P) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  const rango = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const plano = rango.findIndex((r) => r < 1e-6);
  if (plano < 0 || rango.filter((r) => r < 1e-6).length > 1) {
    // Perfil en 3D (zócalos con inglete): se dibuja como la caja de su tamaño declarado.
    return size.every((x) => x > 0.5) ? [off, size] : null;
  }
  // Un perfil que no es un rectángulo (tiras de canto con relieve, zócalos) se dibuja como su caja
  // envolvente: no es el perfil exacto, pero muestra la tira con su material y su tamaño.
  void ev;
  const dim: Vec3 = [rango[0], rango[1], rango[2]];
  // Espesor 0 en el .3d: depende del material del mueble (script del catálogo).
  dim[plano] = size[plano] > 0.5 ? size[plano] : ESPESOR_DEFECTO;
  return [[off[0] + min[0], off[1] + min[1], off[2] + min[2]], dim];
}

// Un objeto de primer nivel es un mueble si es de un catálogo de fábrica (no del 1, general, ni del 641,
// decoración) y no es un elemento del entorno (pared, suelo, techo, cota, luz).
const NO_MUEBLE = new Set(["PA", "SL", "ST", "CTH", "CTV", "CL", "LZ"]);
function esMueble(k: Nodo): boolean {
  return k.idEscena !== null && k.catalogo !== "" && k.catalogo !== "1" && k.catalogo !== "641" && !NO_MUEBLE.has(k.objeti);
}

// Parámetros cuyo valor es una expresión sobre otros (HUE1 = "LIZQ+[LHUECO-LIZQ-LDER]/2+AJCR"):
// se resuelven con lo que ya está definido, repitiendo hasta que no avance nada (pueden depender
// unos de otros en cualquier orden). Los que no se pueden resolver (colores, textos) se ignoran.
function resolverParametros(n: Nodo, env: Entorno) {
  const pendientes = Object.entries(n.param).filter(([, v]) => v !== "" && !/^-?\d+(\.\d+)?$/.test(v) && !/^mat/i.test(v));
  for (let pasada = 0; pasada < 6 && pendientes.length > 0; pasada++) {
    let avanzo = false;
    for (let i = pendientes.length - 1; i >= 0; i--) {
      const x = evaluar(pendientes[i][1], env);
      if (x === null) continue;
      env[pendientes[i][0]] = x;
      pendientes.splice(i, 1);
      avanzo = true;
    }
    if (!avanzo) break;
  }
}

// El frente de un mueble es su +Z local; la rotación del mueble lo orienta en la escena.
function frenteDe(k: Nodo): [number, number, number] {
  const a = (k.ang ?? []).slice(0, 3).map((x) => evaluar(x, {}) ?? 0);
  const f = apply(rotacion(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0), [0, 0, 1]);
  return [r4(f[0]), r4(f[1]), r4(f[2])];
}

// Volumen que la abertura (puerta, ventana, balconera) recorta en la pared: `objpath` (puertas, fijos,
// balconeras) o `RECORTA-PARED` / `RECORTA_PARED` (ventanas corredizas, practicables); ambos llevan `recortaCamino`.
// No es `HOLE`, que también lo lleva pero es un rebaje del panel de un mueble.
const NOMBRES_HUECO = new Set(["objpath", "RECORTA-PARED", "RECORTA_PARED"]);
function buscarHueco(n: Nodo): Nodo | null {
  for (const k of n.kids) {
    if (NOMBRES_HUECO.has(k.nombre) && k.prims.some((q) => q.tipo === "extrude" || q.tipo === "extrudeSp")) return k;
    const x = buscarHueco(k);
    if (x) return x;
  }
  return null;
}

/** ¿El nodo o algún descendiente trae geometría propia (primitivas o mallas)? */
function tieneGeometria(n: Nodo): boolean {
  return n.prims.length > 0 || n.meshes.length > 0 || n.kids.some(tieneGeometria);
}

function buscarNodo(n: Nodo, nombre: string): Nodo | null {
  for (const k of n.kids) {
    if (k.nombre === nombre) return k;
    const x = buscarNodo(k, nombre);
    if (x) return x;
  }
  return null;
}

// Fracción de apertura (porcenAperOpn) declarada en el propio nodo o en algún descendiente.
function buscarPorcen(n: Nodo): number | null {
  if (n.porcen !== null) return n.porcen;
  for (const k of n.kids) {
    const v = buscarPorcen(k);
    if (v !== null) return v;
  }
  return null;
}

// Espesor por defecto cuando una medida depende de un material (GRCI="matci"): ese
// valor vive en los scripts del catálogo, no en el .3d.
const ESPESOR_DEFECTO = 18;

/** Opciones del intérprete: `biblioteca` devuelve el texto del `.3d` de un objeto de la biblioteca de TeoWin. */
export interface OpcionesInterprete {
  biblioteca?: (catalogo: string, familia: string, nombre: string) => string | null;
}

export function interpretarEscena3D(texto: string, opciones: OpcionesInterprete = {}): Escena3D {
  const cab = {
    pedido: /^metai P (.+)$/m.exec(texto)?.[1]?.trim() ?? null,
    version3d: /^\/\/version (.+)$/m.exec(texto)?.[1]?.trim() ?? null,
  };
  const raiz = parsearArbol(texto);
  const globales = raiz.globales;
  const escena = raiz.kids[0];
  const out: Escena3D = {
    version: PARSER_VERSION,
    cabecera: cab,
    modulos: [],
    cajas: [],
    paredes: [],
    animaciones: [],
    materialSuelo: null,
    sueloTile: null,
    mallas: [],
    materiales: [],
    suelo: [],
    sinResolver: [],
  };
  if (!escena) return out;
  const sinResolver = new Set<string>();
  const ev = (e: string, env: Entorno) => {
    const v = evaluar(e, env);
    if (v === null) sinResolver.add(e);
    return v;
  };
  const evVec = (g: string[] | undefined, env: Entorno): Vec3 | null => {
    if (!g || g.length < 3) return null;
    const v = g.slice(0, 3).map((x) => ev(x, env));
    return v.includes(null) ? null : (v as Vec3);
  };

  const inicioParedes: [number, number][] = [];

  // Variables que en el .3d valen "el espesor del material de esta pieza" (mymat, y los GRxx = "matxx"):
  // su valor real está en el matTablero de cada pieza, no en un parámetro.
  const espesorVars = new Set<string>(["mymat"]);

  // Presupuesto de números (vértices, índices y UV) de todas las mallas: el JSON que recibe el navegador
  // no puede crecer sin límite (hay escenas con decenas de MB de mallas).
  let presupuesto = 1_500_000;
  const omitidas = new Set<string>();
  const emitirMalla = (
    crudo: { v: number[]; i: number[]; uv: number[] | null },
    datos: { m: string; c: [number, number, number] | null; opacidad: number | null },
    M2: Mat3,
    T2: Vec3,
    id: number | null,
    anim: number | null,
    cat: string,
    nombre: string,
  ) => {
    if (crudo.v.length < 9 || crudo.i.length < 3) return;
    const uvOk = crudo.uv && crudo.uv.length === (crudo.v.length / 3) * 2 ? crudo.uv : null;
    const c = compactarMalla(crudo.v, crudo.i, uvOk);
    if (c.i.length === 0) return;
    const peso = c.v.length + c.i.length + (c.uv?.length ?? 0);
    if (peso > presupuesto) {
      omitidas.add(`malla omitida por tamaño: ${nombre}`);
      return;
    }
    presupuesto -= peso;
    out.mallas.push({
      mod: id,
      m: datos.m,
      c: datos.c,
      t: rv(T2),
      r: M2.map((x) => Math.round(x * 1e4) / 1e4),
      v: c.v,
      i: c.i,
      ...(c.uv ? { uv: c.uv } : {}),
      ...(anim !== null ? { a: anim } : {}),
      ...(datos.opacidad !== null ? { o: datos.opacidad } : {}),
      ...(cat !== "4" ? { k: cat } : {}),
      ...(/paisaje|skyline/i.test(nombre) || /^(skyline|paisaje)/i.test(datos.m) ? { e: 1 as const } : {}),
    });
  };

  const caminar = (
    n: Nodo,
    envPadre: Entorno,
    M: Mat3,
    T: Vec3,
    idEscena: number | null,
    enModuloPadre: boolean,
    animPadre: number | null,
    catPadre: string,
    enCorr = false,
    marcoPadre: { M: Mat3; T: Vec3; L: number } | null = null,
  ) => {
    // Las patas (objeti PAT) quedan bajo el zócalo y TeoWin no las muestra desde afuera: no se dibujan.
    if (NODOS_IGNORADOS.has(n.nombre) || n.nuncaVisible || n.objeti === "PAT") return;
    // Objeto de la biblioteca de TeoWin (atrezzo) sin geometría en la escena: se toma del archivo del catálogo.
    if (n.biblioteca && !n.bibliotecaCargada && opciones.biblioteca && !tieneGeometria(n)) {
      n.bibliotecaCargada = true;
      const txt = opciones.biblioteca(n.catalogo, n.familia, n.nombre);
      const cat = txt ? parsearArbol(txt).kids[0] : undefined;
      if (cat) {
        // La escena puede escalar el objeto (`escalable`): la malla del catálogo se ajusta a su tamaño.
        const f: Vec3 = [1, 1, 1];
        (["L", "H", "P"] as const).forEach((k, j) => {
          const a = n.local[k] ?? Number(n.use[k]);
          const b = cat.local[k];
          if (Number.isFinite(a) && b && Math.abs(a / b - 1) > 0.01) f[j] = a / b;
        });
        const escalar = (nodo: Nodo) => {
          for (const mc of nodo.meshes) for (let k = 0; k < mc.v.length; k += 3) for (let j = 0; j < 3; j++) mc.v[k + j] *= f[j];
          nodo.kids.forEach(escalar);
        };
        if (f.some((x) => x !== 1)) escalar(cat);
        n.kids.push(...cat.kids);
        n.prims.push(...cat.prims);
        n.meshes.push(...cat.meshes);
      }
    }
    // Un objeto de un catálogo de fábrica colgado de una pared (ej. una puerta de paso, catálogo 658)
    // también se dibuja; los del catálogo 1 (ventanas, cotas) y 641 (decoración) no.
    const cat = n.catalogo || catPadre;
    const enModulo = enModuloPadre || (n.catalogo !== "" && n.catalogo !== "1" && n.catalogo !== "641");
    const env: Entorno = { ...envPadre };
    if (n.catalogo && globales[n.catalogo]) {
      for (const [k, v] of Object.entries(globales[n.catalogo])) if (/^-?\d+(\.\d+)?$/.test(v) && !k.startsWith("$")) env[k] = Number(v);
    }
    for (const [k, v] of Object.entries(n.param)) {
      if (/^-?\d+(\.\d+)?$/.test(v)) env[k] = Number(v);
      else if (v === "") env[k] = 0; // parámetro sin uso en este mueble
      else if (/^mat/i.test(v)) {
        espesorVars.add(k);
        env[k] = env[k] ?? ESPESOR_DEFECTO;
      }
    }
    if (n.idrep !== null) env.idrep = n.idrep;
    env.getcxh = env.getcxh ?? 0; // altura propia de un cajón/frente: 0 = la del mueble (cmp[getcxh;0;=]*H+getcxh)
    env.mymat = env.mymat ?? ESPESOR_DEFECTO;
    if (n.espesor !== null && n.espesor > 0) for (const v of espesorVars) env[v] = n.espesor;
    for (const [k, v] of Object.entries(n.use)) {
      const x = ev(v, env);
      if (x !== null) env[k] = x;
    }
    // Un objeto sin `use` pero con `local L/H/P` (puerta de paso) tiene esa medida, no la del padre.
    for (const k of ["L", "H", "P"]) if (n.use[k] === undefined && n.local[k] !== undefined && !n.virtual) env[k] = n.local[k];
    resolverParametros(n, env);
    // La condición usa las medidas del mueble (las del padre), antes de aplicar las propias.
    if (n.invisibilidad && oculto(n.invisibilidad, env) === true) return;
    let pos: Vec3 = [0, 0, 0];
    if (n.virtual) {
      const p = evVec(n.virtual[0], env);
      const s = evVec(n.virtual[1], env);
      // Sin posición o medida no se puede ubicar la pieza ni lo que cuelga de ella: se omite
      // (heredar el tamaño del padre dibujaba cajas gigantes).
      if (!p || !s) return;
      pos = p;
      [env.L, env.H, env.P] = s;
    }
    if (n.pos) {
      const p = evVec(n.pos, env);
      if (p) pos = p;
    }
    let R = ID3;
    if (n.ang) {
      const a = n.ang.slice(0, 3).map((x) => ev(x, env) ?? 0);
      R = rotacion(a[0], a[1], a[2]);
    }
    const M2 = mul(M, R);
    const d0 = apply(M, pos);
    const T2: Vec3 = [T[0] + d0[0], T[1] + d0[1], T[2] + d0[2]];
    const id = n.idEscena ?? idEscena;
    // Marco del mueble (el objeto con su propio idEscena): las bisagras se resuelven respecto de él.
    const marco = n.idEscena !== null && env.L !== undefined ? { M: M2, T: T2, L: env.L } : marcoPadre;

    // Animación (solo muebles): un cajón (`seabre`) se desliza hacia el frente el porcenAperOpn de su
    // profundidad; una hoja `corredera` más angosta que el mueble corre hacia el otro extremo.
    let anim = animPadre;
    if (enModulo) {
      if (n.seAbre && enCorr && envPadre.L !== undefined && env.L !== undefined) {
        // Hoja de una puerta de paso corrediza: corre en el plano de la puerta (X), no hacia el frente.
        const sentido = pos[0] + env.L / 2 < envPadre.L / 2 ? 1 : -1;
        const e = apply(M, [sentido, 0, 0]);
        const dist = (n.porcen ?? 0.85) * Math.max(0, envPadre.L - env.L);
        out.animaciones.push({ tipo: "puerta", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: r1(dist) });
        anim = out.animaciones.length - 1;
      } else if (n.anguloAper !== null && envPadre.L !== undefined && env.L !== undefined && env.L > 0 && env.H > 0) {
        // Puerta con bisagra: gira sobre el canto exterior de la mitad del mueble en que está la hoja, hacia el
        // frente (+Z del mueble). Se resuelve en la escena (no en el sistema de la hoja): una hoja derecha de un
        // mueble de cocina suele estar girada 180° y sus ejes locales quedan al revés.
        const mk = marco ?? { M, T, L: envPadre.L };
        const ejeX = apply(mk.M, [1, 0, 0]);
        const xPar = (p: Vec3) => (p[0] - mk.T[0]) * ejeX[0] + (p[1] - mk.T[1]) * ejeX[1] + (p[2] - mk.T[2]) * ejeX[2];
        const dB = apply(M2, [env.L, 0, 0]);
        const pA: Vec3 = T2;
        const pB: Vec3 = [T2[0] + dB[0], T2[1] + dB[1], T2[2] + dB[2]];
        const xa = xPar(pA);
        const xb = xPar(pB);
        const izquierda = (xa + xb) / 2 <= mk.L / 2 + 1;
        const bisagra = izquierda ? (xa <= xb ? pA : pB) : xa >= xb ? pA : pB;
        const eje = apply(mk.M, [0, 1, 0]);
        const grados = n.anguloAper * (buscarPorcen(n) ?? 0.85);
        out.animaciones.push({
          tipo: "giro",
          mod: id,
          eje: [r4(eje[0]), r4(eje[1]), r4(eje[2])],
          pivote: rv(bisagra),
          dist: r1(izquierda ? -grados : grados),
        });
        anim = out.animaciones.length - 1;
      } else if (n.seAbre && env.P > 0) {
        const e = apply(M, [0, 0, 1]);
        out.animaciones.push({ tipo: "cajon", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: r1((n.porcen ?? 0.85) * env.P) });
        anim = out.animaciones.length - 1;
      } else if (n.corredera && envPadre.L !== undefined && env.L !== undefined && env.L < envPadre.L - 1) {
        const sentido = pos[0] + env.L / 2 < envPadre.L / 2 ? 1 : -1;
        const e = apply(M, [sentido, 0, 0]);
        const dist = (buscarPorcen(n) ?? 0.85) * (envPadre.L - env.L);
        out.animaciones.push({ tipo: "puerta", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: r1(dist) });
        anim = out.animaciones.length - 1;
      }
    }

    for (const pr of n.prims) {
      if (pr.invisible) continue;
      if (pr.tipo === "faceset" || pr.tipo === "face") {
        const esCara = n.objeti === "TQC" || n.objeti === "CLC";
        if (n.objeti !== "PAI" && n.objeti !== "PAE" && !esCara) continue;
        const dim = evVec(pr.args[1], env);
        if (!dim) continue;
        const [w, h] = dim;
        const esq: Vec3[] = [
          [0, 0, 0],
          [w, 0, 0],
          [w, h, 0],
          [0, h, 0],
        ];
        const p = esq.map((c) => {
          const d = apply(M2, c);
          return rv([T2[0] + d[0], T2[1] + d[1], T2[2] + d[2]]);
        }) as ParedEscena["p"];
        const lado = n.objeti === "PAE" ? "ext" : "int";
        // Una puerta de paso colgada de la pared (su `objpath` es el vano) deja un hueco en la cara.
        const huecos: [number, number, number, number][] = [];
        if (lado === "int") {
          for (const k of n.kids) {
            if (k.nuncaVisible || !k.pos) continue;
            const kp = evVec(k.pos, env);
            const vano = buscarHueco(k);
            if (!kp || !vano) continue;
            const prim = vano.prims.find((q) => q.tipo === "extrude" || q.tipo === "extrudeSp");
            if (!prim) continue;
            // El perfil puede usar L/H/P del propio objeto (ventanas) y el nodo del hueco puede tener su `virtual`.
            const envK: Entorno = { ...env, ...k.local };
            const off = vano.virtual ? (evVec(vano.virtual[0], envK) ?? [0, 0, 0]) : [0, 0, 0];
            const pts = prim.args.slice(2).filter((g) => g.length >= 3).map((g) => evVec(g, envK));
            if (pts.length < 3 || pts.some((q) => q === null)) continue;
            const xs = (pts as Vec3[]).map((q) => q[0] + off[0]);
            const ys = (pts as Vec3[]).map((q) => q[1] + off[1]);
            huecos.push([
              r1(kp[0] + Math.min(...xs)),
              r1(kp[1] + Math.min(...ys)),
              r1(kp[0] + Math.max(...xs)),
              r1(kp[1] + Math.max(...ys)),
            ]);
          }
        }
        out.paredes.push(
          lado === "int" && pr.materialCad
            ? { lado, p, m: pr.materialCad, ...(pr.tile ? { t: pr.tile } : {}), ...(huecos.length ? { h: huecos } : {}), ...(esCara ? { d: 1 as const } : {}) }
            : lado === "int" && huecos.length
              ? { lado, p, h: huecos, ...(esCara ? { d: 1 as const } : {}) }
              : { lado, p, ...(esCara ? { d: 1 as const } : {}) },
        );
        if (lado === "int" && !esCara) inicioParedes.push([p[0][0], p[0][2]]);
      } else if (pr.tipo === "poly") {
        // Viga (objeti VG): polígono plano en abanico. Las paredes y los techos también usan `poly`: no se dibujan.
        if (n.objeti !== "VG") continue;
        const pv = pr.args.filter((g) => g.length >= 3).map((g) => evVec(g, env));
        if (pv.length < 3 || pv.some((q) => q === null)) continue;
        const vv: number[] = [];
        for (const q of pv as Vec3[]) vv.push(q[0], q[1], q[2]);
        const ii: number[] = [];
        for (let k = 1; k + 1 < pv.length; k++) ii.push(0, k, k + 1);
        emitirMalla({ v: vv, i: ii, uv: null }, { m: pr.m, c: pr.c, opacidad: pr.opacidad }, M2, T2, id, anim, cat, n.nombre);
      } else if (enModulo && (pr.tipo === "revol" || pr.tipo === "revolSp")) {
        // revol(tamaño)(desplazamiento) [ang(x,y,z)] alfa(grados)(p0)…(pn): el perfil (radio, altura) se gira sobre Y.
        // En el plano XY el radio es x; en el ZY (x = 0) es z.
        if (pr.invisible) continue;
        const G = grupos(pr.raw.split(/tg\(/)[0]);
        const off = evVec(G[1], env);
        const alfa = G.find((g) => g.length === 1)?.[0];
        const perfil = G.slice(2)
          .filter((g) => g.length >= 3)
          .map((g) => evVec(g, env));
        if (!off || perfil.length < 3 || perfil.some((q) => q === null)) continue;
        const rev = mallaDeRevolucion(
          (perfil as Vec3[]).map((q) => [Math.hypot(q[0], q[2]), q[1]] as [number, number]),
          Number(alfa ?? 360) || 360,
        );
        const Rp = pr.ang ? rotacion(...(pr.ang.slice(0, 3).map((x) => ev(x, env) ?? 0) as [number, number, number])) : ID3;
        for (let k = 0; k < rev.v.length; k += 3) {
          const q = apply(Rp, [rev.v[k], rev.v[k + 1], rev.v[k + 2]]);
          rev.v[k] = q[0] + off[0];
          rev.v[k + 1] = q[1] + off[1];
          rev.v[k + 2] = q[2] + off[2];
        }
        emitirMalla({ v: rev.v, i: rev.i, uv: null }, { m: pr.m, c: pr.c, opacidad: pr.opacidad }, M2, T2, id, anim, cat, n.nombre);
      } else if (enModulo && (pr.tipo === "tube" || pr.tipo === "tubeSp")) {
        // tube(tamaño)(desplazamiento)[ang(x,y,z)](p0)(p1)(r0)(r1) · tubeSp(…)[aspectR(x)](p0)…(pn)tg(…)(r0)…(rn)
        const [antes, despues] = pr.raw.split(/tg\(/);
        const G = grupos(antes);
        const off = evVec(G[1], env);
        const pts = G.slice(2).filter((g) => g.length >= 3).map((g) => evVec(g, env));
        const rads = (pr.tipo === "tubeSp" && despues !== undefined ? grupos(`(${despues}`) : G.slice(2)).filter((g) => g.length === 1);
        const radios = rads.map((g) => ev(g[0], env) ?? 5);
        if (!off || pts.length < 2 || pts.some((q) => q === null)) continue;
        if (pr.invisible) continue;
        const Rt = pr.ang ? rotacion(...(pr.ang.slice(0, 3).map((x) => ev(x, env) ?? 0) as [number, number, number])) : ID3;
        const local = (pts as Vec3[]).map((q) => {
          const r = apply(Rt, q);
          return [off[0] + r[0], off[1] + r[1], off[2] + r[2]] as Vec3;
        });
        const tubo = mallaDeTubo(local, radios);
        emitirMalla({ v: tubo.v, i: tubo.i, uv: null }, { m: pr.m, c: pr.c, opacidad: pr.opacidad }, M2, T2, id, anim, cat, n.nombre);
      } else if (enModulo) {
        let off: Vec3 | null = null;
        let dim: Vec3 | null = null;
        if (cat === "636" && n.objeti === "EN") {
          // Encimera (catálogo 636): una losa de 30 mm del tamaño declarado; el `extrude` sin etiqueta es el hueco.
          if (pr.sinEti) continue;
          const tam = evVec(pr.args[0], env);
          off = evVec(pr.args[1], env);
          dim = tam && tam.every((x) => x > 0.5) ? tam : null;
        } else if (pr.tipo === "extrude" || pr.tipo === "extrudeSp") {
          // Contorno plano que no es un rectángulo (marcos, perfiles, bordes de bacha): prisma exacto.
          const prisma = prismaDePrimitiva(pr, n, env, ev, evVec);
          if (prisma) {
            emitirMalla({ v: prisma.v, i: prisma.i, uv: null }, { m: pr.m, c: pr.c, opacidad: pr.opacidad }, M2, T2, id, anim, cat, n.nombre);
            continue;
          }
        }
        if (cat === "636" && n.objeti === "EN") {
          // ya resuelta arriba
        } else if (pr.tipo === "extrude" || pr.tipo === "extrudeSp") {
          const caja = cajaDeExtrusion(pr.args, env, ev, evVec);
          if (!caja) continue;
          [off, dim] = caja;
        } else {
          off = evVec(pr.args[0], env);
          dim = evVec(pr.args[1], env);
        }
        if (!off || !dim) continue;
        // Volúmenes auxiliares (sin material ni color propio) y piezas planas (rieles
        // de 0 mm de espesor) no se dibujan: TeoWin tampoco las muestra como sólidos.
        if (!n.atrezzo && pr.m === "" && pr.c && pr.c[0] === 1 && pr.c[1] === 1 && pr.c[2] === 1) continue;
        if (Math.min(dim[0], dim[1], dim[2]) < 0.5) continue;
        const o = apply(M2, off);
        let Mc = M2;
        if (pr.ang) {
          const a = pr.ang.slice(0, 3).map((x) => ev(x, env) ?? 0);
          Mc = mul(M2, rotacion(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0));
        }
        out.cajas.push({
          mod: id,
          m: pr.m,
          c: pr.c,
          t: rv([T2[0] + o[0], T2[1] + o[1], T2[2] + o[2]]),
          r: Mc.map((x) => Math.round(x * 1e4) / 1e4),
          s: [r1(dim[0]), r1(dim[1]), r1(dim[2])],
          ...(anim !== null ? { a: anim } : {}),
          ...(pr.opacidad !== null ? { o: pr.opacidad } : {}),
          ...(cat !== "4" ? { k: cat } : {}),
        });
      }
    }
    if (enModulo && n.camino.length >= 3 && !tieneGeometria(n) && (n.objeti === "SWL" || n.objeti === "EN" || n.objeti === "CPT")) {
      // Encimera sin sólido en el .3d: TeoWin la genera desde el recorrido (cara inferior a 870 mm, 30 mm de espesor).
      const losa = prismaDeContorno(n.camino, 30);
      if (losa) emitirMalla({ v: losa.v, i: losa.i, uv: null }, { m: "", c: [0.93, 0.93, 0.93], opacidad: null }, M2, T2, id, anim, cat, n.nombre);
    }
    if (enModulo) {
      for (const mc of n.meshes) {
        if (mc.invisible) continue;
        emitirMalla({ v: mc.v, i: mc.i, uv: mc.uv }, { m: mc.m, c: mc.c, opacidad: mc.opacidad }, M2, T2, id, anim, cat, n.nombre);
      }
    }
    for (const k of n.kids) caminar(k, env, M2, T2, id, enModulo, anim, cat, enCorr || n.corredera, marco);
  };

  for (const k of escena.kids) {
    if (k.idEscena === null) continue;
    if (esMueble(k)) {
      // Mueble de fábrica (catálogo 4 Placares, 3 Cocinas, …): lleva el idEscena de modulo.idEscena.
      // Algunos (ej. los armarios "2200") no declaran `familia`.
      const env: Entorno = {};
      for (const [kk, v] of Object.entries(k.use)) {
        const x = evaluar(v, env);
        if (x !== null) env[kk] = x;
      }
      out.modulos.push({
        idEscena: k.idEscena,
        nombre: k.nombreModulo || k.nombre,
        familia: k.familia || k.nombre,
        catalogo: k.catalogo,
        frente: frenteDe(k),
        dim: [env.L ?? 0, env.H ?? 0, env.P ?? 0],
      });
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, true, null, k.catalogo);
    } else if (k.objeti === "TQ" || k.objeti === "CL" || k.objeti === "VG") {
      // Tabique, columna o viga del cuarto: caras (`cara0…5`, TQC/CLC) o polígono (VG), en el catálogo 641.
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, k.objeti === "VG", null, "641");
    } else if ((k.objeti === "EN" || k.objeti === "CPT") && k.catalogo === "1") {
      // Encimera y copete de la cocina: objeto de nivel 1 cuyos hijos son del catálogo 636.
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, true, null, "636");
    } else if (k.objeti === "ZCH" || k.objeti === "ZC") {
      // Zócalo del cuarto (ZCH, perfiles del 641) o de la cocina (ZC, catálogo 3): se dibuja como cajas.
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, true, null, k.objeti === "ZC" ? "3" : "641");
    } else if (k.objeti === "PA") {
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, false, null, "1");
    } else if (k.objeti === "SL") {
      if (k.materialCad && !out.materialSuelo) out.materialSuelo = k.materialCad;
      if (k.tile && !out.sueloTile) out.sueloTile = k.tile;
    }
  }
  out.suelo = inicioParedes;
  // Los colores de un mueble son de su catálogo; paredes y piso son decoración (catálogo 641).
  const catDe = new Map(out.modulos.map((m) => [m.idEscena, m.catalogo]));
  out.materiales = [
    ...new Set(
      [
        ...out.cajas.filter((c) => c.m !== "").map((c) => `${c.k ?? catDe.get(c.mod ?? -1) ?? "4"}/${c.m}`),
        ...out.mallas.filter((q) => q.m !== "").map((q) => `${q.k ?? catDe.get(q.mod ?? -1) ?? "4"}/${q.m}`),
        ...out.paredes.filter((w) => w.m).map((w) => `641/${w.m}`),
        ...(out.materialSuelo ? [`641/${out.materialSuelo}`] : []),
      ],
    ),
  ];
  out.sinResolver = [...sinResolver, ...omitidas].slice(0, 50);
  return out;
}
