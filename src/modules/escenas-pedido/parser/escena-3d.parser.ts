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

// v38: veta de los tableros tal cual TeoWin (campo `v` de la caja, ver CajaEscena): sale del tipo (`taulerh/v/f`), de `orient N` en la cabecera del
// objeto y de la marca `texV` de la primitiva (veta alterna); y se descarta el trozo de encimera reconstruido que queda dentro de otro módulo
// (≥ 40 % de su volumen sobre cajas de otros muebles: el piso de un módulo apoyado sobre el bajo, no una mesada).
// v37: las cajas de las bisagras de un frente abatible (`ang(180,0,±90)` el cuerpo, `ang(90,0,-90)` la placa) se orientan con el orden de giro
// de TeoWin para los herrajes (X, luego Y, luego Z; `rotacionHerraje`): el cuerpo queda pegado al canto de la hoja (y acompaña su giro) y la placa
// cuelga del panel superior del hueco (antes: cuerpo 40 mm adentro del canto y placa parada sobre el techo, asomando por encima del mueble).
// v36: un frente abatible (pistón a gas `ABAT*`) gira sobre su borde superior (o inferior) con un eje paralelo al ancho del mueble: lo dicen sus
// bisagras de cuerpo, que llevan `ang(180,0,±90)` (el lado largo de la bisagra, el del eje, queda horizontal); antes siempre giraba sobre un eje vertical.
// v35: un frente `extraible` con herrajes de alambre (cestos `seabre` + `AsiEsAbierto`, familia ACM bajo un `AIP3D`) se anima como un solo
// cajón: el frente, los rieles y los cestos salen juntos (antes cada cesto corría solo 425 mm y el frente quedaba cerrado). El recorrido es
// AsiEsAbierto − AsiEsCerrado del cesto (diseño.md §16.4).
// v34: se descarta el `encim.` propio de un mueble que flota más de 50 mm sobre el tope de su cuerpo (guardado dentro de la carcasa
// IZ queda Hz más alto; TeoWin no lo muestra): aparecía como un estante de granito dentro de un armario alto apoyado sobre el bajo.
// v33: los perfiles de aluminio con inglete de las puertas de vidrio (familia PER, `extrude` en un plano a 45° escrito en la línea siguiente a
// `eti` tras un `mantAngulo`) ahora se dibujan: marco de la hoja, que gira con ella (diseño.md §13.7).
// v32: la placa de una bisagra de apertura derecha se apoya en la cara interior del lateral (antes quedaba dentro del lateral y
// asomaba al frente); un contorno de encimera `CPT` sin sólido no se dibuja cuando la encimera ya se reconstruye desde los almacenes
// de los muebles (salía una mesada doble). El visor deja de listar los módulos de decoración y equipamiento (diseño.md §13.7).
// v31: bisagras dibujadas como cajas (cuerpo en la hoja y placa en el lateral); el lado de la bisagra y el sentido de giro de una hoja
// salen de la posición de sus bisagras; un `pos(...)` posterior a una malla ya no pisa la posición del objeto (laterales de cajón
// Tandembox desplazados); falta de un lateral de cajón (ver diseño.md §13.7).
// v30: cocinas (catálogo 3): encimera reconstruida cuando el .3d la trae vacía, catálogo de cada pieza
// siempre explícito si difiere del de su mueble, animaciones sin piezas descartadas (diseño.md §13.7).
export const PARSER_VERSION = 38;

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
  /** Catálogo de la pieza cuando difiere del de su mueble (ej. 658 = puertas, 636 = encimeras): define dónde buscar su textura; si falta es el del mueble. */
  k?: string;
  /** Foto de paisaje (`eti"PSJ"`): la imagen entera cubre la cara y se ve sin sombras. */
  p?: 1;
  /**
   * Veta del tablero: eje LOCAL de la caja a lo largo del cual corre (0 = L/x, 1 = H/y, 2 = P/z), según `orient`/`texV` de TeoWin.
   * Falta = la textura se ve como siempre (escenas anteriores a v38, extrusiones, mesadas, zócalos y marcas no interpretadas).
   */
  v?: 0 | 1 | 2;
}

/** Grupo de piezas que se desplazan juntas: un cajón que se abre o una hoja corrediza. */
export interface AnimacionEscena {
  tipo: "cajon" | "puerta" | "giro";
  mod: number | null;
  /** Solo `giro` (puerta con bisagra): punto del eje de la bisagra, en el sistema de la escena. */
  pivote?: [number, number, number];
  /** Desplazamiento inicial (mm) sobre `eje`: la pieza se guardó abierta y se muestra cerrada (parte de `ini` y llega a `dist`). */
  ini?: number;
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
  /** Marca `texV` (línea siguiente a la primitiva): veta alterna respecto de la de fábrica. */
  texV: boolean;
  /** Etiqueta de la línea (`eti"PSJ"`): PSJ es la foto de paisaje que se ve a través de una abertura. */
  etiqueta: string;
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
  /** `pos(x,y,z)` que sigue a la malla: su desplazamiento dentro del objeto. */
  pos?: string[] | null;
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
  /** Marca `almacenCMB`: contenedor oculto de los trozos de encimera de un mueble (TeoWin los une en el objeto `EN`). */
  almacen = false;
  /** Espesor del tablero (matTablero con la cara 128), si es numérico. */
  espesor: number | null = null;
  /** Condición de `invisibilidad(...)`, se evalúa con las medidas del mueble. */
  invisibilidad: string | null = null;
  /** Marca `seabre`: cajón que se desliza hacia el frente. */
  seAbre = false;
  /** Marca `extraible`: frente solidario con el herraje interior (cestos, rieles) que sale con él. */
  extraible = false;
  /** `AsiEsAbierto(x,y,z)` / `AsiEsCerrado(x,y,z)`: posición del nodo (en el sistema de su padre) abierto y cerrado; "_" = no cambia. */
  asiAbierto: string[] | null = null;
  asiCerrado: string[] | null = null;
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
  /** Marca `opened`: la hoja se guardó ABIERTA (su desplazamiento en el .3d es el de apertura); cerrada vale 0. */
  abierto = false;
  /** Marca `esBiblioteca`: la geometría está en el archivo del catálogo de TeoWin, no en la escena. */
  biblioteca = false;
  /** Marca `hinge`: pieza de bisagra (su geometría real está en la biblioteca de TeoWin, familia BIS3D/BIB3D). */
  hinge = false;
  /** `bisName"B"`: la bisagra es la placa fijada al lateral del mueble (sin él es el cuerpo que va en la hoja). */
  bisPlaca = false;
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
// Catálogos de TeoWin cuyos objetos no se animan (decoración y equipamiento; 522 es la versión anterior de 658).
const SIN_ANIMACION = new Set(["636", "637", "638", "640", "641", "646", "647", "648", "649", "650", "651", "652", "653", "654", "655", "656", "658", "522"]);

const NODOS_IGNORADOS = new Set(["mecanizado", "label", "defespigameca", "objpath", "RECORTA-PARED", "RECORTA_PARED"]);

const ATTR = /^(eti"|mat"|color\()/;
const PRIM = /\b(taulerv|taulerh|taulerf|extrudeSp|extrude|tubeSp|tube|revolSp|revol|faceset|face|poly)(\(.*)$/;
const PRIM_LINEA = /^(?:mantAngulo\s+)*(taulerv|taulerh|taulerf|extrudeSp|extrude|tubeSp|tube|revolSp|revol)\(/;

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
 * Perfil de aluminio con inglete (marcos de puertas de vidrio): el contorno (sección del perfil) está escrito sobre el plano del corte a
 * 45° (x = y o x + y = c) y el perfil se extruye a lo largo de X con el largo `largo` (medida L del objeto): el extremo izquierdo es el
 * corte dado (x = p.x) y el derecho el simétrico (x = largo - p.x). La sección es (y, z). null si el contorno no tiene esa forma.
 */
function prismaDeInglete(Q: Vec3[], largo: number): { v: number[]; i: number[] } | null {
  if (!(largo > 0.5) || Q.length < 4) return null;
  const dif = Q.map((q) => q[0] - q[1]);
  const sum = Q.map((q) => q[0] + q[1]);
  const rango = (a: number[]) => Math.max(...a) - Math.min(...a);
  if (rango(dif) > 1e-3 && rango(sum) > 1e-3) return null;
  const pts = Q.length > 3 && Q[0].every((x, j) => Math.abs(x - Q[Q.length - 1][j]) < 1e-6) ? Q.slice(0, -1) : Q;
  if (pts.length < 3) return null;
  const flat: number[] = [];
  for (const p of pts) flat.push(p[1], p[2]);
  const tri = earcut(flat);
  if (tri.length < 3) return null;
  const n = pts.length;
  const v: number[] = [];
  for (const p of pts) v.push(p[0], p[1], p[2]);
  for (const p of pts) v.push(largo - p[0], p[1], p[2]);
  const idx: number[] = [];
  for (let k = 0; k < tri.length; k += 3) {
    idx.push(tri[k], tri[k + 1], tri[k + 2]);
    idx.push(n + tri[k], n + tri[k + 2], n + tri[k + 1]);
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
  if (planos.length === 0) {
    const pi = prismaDeInglete(Q, size[0]);
    if (!pi) return null;
    const Ri = pr.ang ? rotacion(...(pr.ang.slice(0, 3).map((x) => ev(x, env) ?? 0) as [number, number, number])) : ID3;
    for (let k = 0; k < pi.v.length; k += 3) {
      const q = apply(Ri, [pi.v[k], pi.v[k + 1], pi.v[k + 2]]);
      pi.v[k] = q[0] + off[0];
      pi.v[k + 1] = q[1] + off[1];
      pi.v[k + 2] = q[2] + off[2];
    }
    return pi;
  }
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
    if (/\balmacenCMB\b/.test(t) && !t.startsWith("eti")) o.almacen = true;
    // texV suelto en la línea siguiente a la primitiva (idJq(1) idJqT"…"  texV, o tipoNucleo(0)texV en extrusiones): es de la última primitiva del objeto.
    if (t.includes("texV") && !t.startsWith("eti") && o.prims.length > 0) o.prims[o.prims.length - 1].texV = true;
    if (!t.startsWith("eti")) {
      if (/\bseabre\b/.test(t)) o.seAbre = true;
      if (/\bcorredera\b/.test(t)) o.corredera = true;
      if (/\bextraible\b/.test(t) && !t.startsWith("observaciones")) o.extraible = true;
      if (/\besAtrezzo\b/.test(t)) o.atrezzo = true;
      if (/\bopened\b/.test(t)) o.abierto = true;
      if (/\besBiblioteca\b/.test(t)) o.biblioteca = true;
      if (/\bhinge\b/.test(t)) o.hinge = true;
      if (/\bbisName"B"/.test(t)) o.bisPlaca = true;
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
    else if (t.startsWith("AsiEsAbierto(")) o.asiAbierto = grupos(t)[0] ?? null;
    else if (t.startsWith("AsiEsCerrado(")) o.asiCerrado = grupos(t)[0] ?? null;
    else if (t.startsWith("ang(")) o.ang = grupos(t)[0] ?? null;
    else if (t.startsWith("pos(")) {
      // Un `pos(...)` que sigue a las líneas `malla`/`caras` es la posición de la malla dentro del objeto (casi siempre 0,0,0):
      // no reemplaza la posición del objeto (el `virtual`/`pos` previo); si no, la malla quedaba en el origen del padre.
      const g = grupos(t)[0] ?? null;
      if (o.mallaActual) o.mallaActual.pos = g;
      else o.pos = g;
    }
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
          etiqueta: /eti"([^"]*)"/.exec(completa)?.[1] ?? "",
          texV: false,
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
/**
 * Rotación de un herraje (`hinge`): TeoWin compone sus ángulos en el orden inverso al de las piezas (Rx·Ry·Rz, no Rz·Ry·Rx). Solo importa con
 * dos ejes a la vez: la placa de bisagra derecha `ang(180,-90,0)` (apoyada en el lateral, sin el giro de 180° de la v32) y las de un frente
 * abatible, `ang(180,0,±90)` el cuerpo (pegado al canto de la hoja) y `ang(90,0,-90)` la placa (colgada del panel superior).
 */
function rotacionHerraje(ax: number, ay: number, az: number): Mat3 {
  const c = (g: number) => Math.cos((g * Math.PI) / 180);
  const s = (g: number) => Math.sin((g * Math.PI) / 180);
  const rx = [1, 0, 0, 0, c(ax), -s(ax), 0, s(ax), c(ax)];
  const ry = [c(ay), 0, s(ay), 0, 1, 0, -s(ay), 0, c(ay)];
  const rz = [c(az), -s(az), 0, s(az), c(az), 0, 0, 0, 1];
  return mul(rx, mul(ry, rz));
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

/**
 * Veta de un tablero (`taulerh/v/f`) según TeoWin: `orient N` del objeto + marca `texV` de la primitiva.
 * Códigos de `orient`: taulerf 4 normal / 1 alterno; taulerh 2 / 6; taulerv 3 / 5. `texV` manda (24 taulerh la traen con el `orient` en un padre).
 * Veta normal: taulerh a lo ancho (L, 0); taulerv y taulerf vertical (H, 1 = lo que el visor ya hacía: se omite → null). Alterna: gira al otro eje
 * del plano de la pieza: taulerh y taulerv → profundidad (P, 2); taulerf → ancho (L, 0). PENDIENTE de confirmar en TeoWin la dirección de la
 * alterna de taulerh/taulerv (taulerf alterno confirmado: frentes de cajón BB2-00078_004). null = sin cambios (extrusiones, orient raros).
 */
function vetaDe(n: Nodo, pr: Primitiva): 0 | 1 | 2 | null {
  const normal = pr.tipo === "taulerh" ? 2 : pr.tipo === "taulerv" ? 3 : pr.tipo === "taulerf" ? 4 : null;
  const alterno = pr.tipo === "taulerh" ? 6 : pr.tipo === "taulerv" ? 5 : pr.tipo === "taulerf" ? 1 : null;
  if (normal === null || alterno === null) return null;
  const esAlterno = pr.texV || n.orient === alterno;
  if (!esAlterno && n.orient !== null && n.orient !== normal) return null;
  if (esAlterno) return pr.tipo === "taulerf" ? 0 : 2;
  return pr.tipo === "taulerh" ? 0 : null;
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
/** El `.3d` de TeoWin trae algunos nombres con el carácter de reemplazo (EF BF BD) en lugar de la tilde. */
function limpiarTexto(t: string): string {
  return t.replace(/Lï¿½mpara/g, "Lámpara").replace(/ï¿½/g, "?");
}

function tieneGeometria(n: Nodo): boolean {
  return n.prims.length > 0 || n.meshes.length > 0 || n.kids.some(tieneGeometria);
}

/** ¿Cuelga del nodo (visible) un herraje que se abre por su `AsiEsAbierto` (cesto, extraíble)? */
function tieneHerrajeAbierto(n: Nodo): boolean {
  return n.kids.some((k) => !k.nuncaVisible && ((k.seAbre && k.asiAbierto !== null) || tieneHerrajeAbierto(k)));
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

// Herrajes de bisagra como cajas (en el sistema de la pieza `hinge` ya girada por su `ang`): [desplazamiento, tamaño] en mm.
// Cuerpo de la hoja (C0CS y afines): placa plana de 66 mm y el cuerpo redondo (copa) que sobresale hacia el interior del mueble.
const HERRAJE_CUERPO: [Vec3, Vec3][] = [
  [[0, -33, 0], [37.4, 66, 2.2]],
  [[3, -17.5, 2.2], [34.4, 35, 9.2]],
];
// Placa fijada al lateral: base plana (se apoya en el lateral) y el taco donde engancha el brazo.
const HERRAJE_PLACA: [Vec3, Vec3][] = [
  [[0, -25.5, 0], [44.5, 51, 3]],
  [[4, -10, 3], [36, 20, 5.5]],
];
const COLOR_HERRAJE: [number, number, number] = [0.72, 0.74, 0.78];

// Espesor por defecto cuando una medida depende de un material (GRCI="matci"): ese
// valor vive en los scripts del catálogo, no en el .3d.
const ESPESOR_DEFECTO = 18;

// Solo para escenas que no traen catálogo (pieza sin `k` y sin mueble): el parser siempre lo declara, esto es un respaldo.
const CAT_DEFECTO = "4";

/**
 * Bisagras de cuerpo (40,4 mm de ancho) que cuelgan de una hoja con bisagra: centro (x, y locales de la hoja) y orientación del eje de
 * giro, o null si no tiene (puertas de otros catálogos, bisagras que no son del tipo clásico). Una bisagra izquierda se coloca en
 * `virtual(40.4,…) ang(0,180,0)` y una derecha en `virtual(L-pl,…) ang(180,0,0)`: el cuerpo (37,4 mm de ancho) siempre queda hacia el
 * interior de la hoja y su lado largo (66 mm, Y local) corre a lo largo del eje de la bisagra. Un frente abatible (hacia arriba o hacia
 * abajo, con pistón a gas) lleva las bisagras giradas `ang(180,0,±90)`: ese lado largo queda horizontal, o sea el eje es paralelo al
 * ancho de la hoja (`horizontal`).
 */
function bisagrasHoja(hoja: Nodo, env: Entorno): { x: number; y: number; horizontal: boolean } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let horiz = 0;
  const e: Entorno = { ...env };
  const rec = (k: Nodo) => {
    for (const h of k.kids) {
      if (h.hinge && !h.bisPlaca && h.virtual) {
        const p = h.virtual[0]?.slice(0, 3).map((x) => evaluar(x, e));
        const s = h.virtual[1]?.slice(0, 3).map((x) => evaluar(x, e));
        if (p && s && !p.includes(null) && s[0] !== null && Math.abs(s[0] - 40.4) < 0.1) {
          const a = (h.ang ?? []).slice(0, 3).map((x) => evaluar(x, e) ?? 0);
          const R = rotacionHerraje(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
          const d = apply(R, [20.2, 0, 0]);
          const largo = apply(R, [0, 1, 0]);
          xs.push((p[0] as number) + d[0]);
          ys.push((p[1] as number) + d[1]);
          if (Math.abs(largo[0]) > Math.abs(largo[1])) horiz++;
        }
      } else if (!h.hinge) rec(h);
    }
  };
  rec(hoja);
  if (!xs.length) return null;
  const prom = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return { x: prom(xs), y: prom(ys), horizontal: horiz * 2 > xs.length };
}

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
  // Material de encimera por defecto de la escena: `hdrDataLin <636 EN;MIT/BLANCO_NORTE/BNO>` (catálogo 636, código BNO).
  // Las piezas de encimera que traen el marcador `enci` se dibujan con él.
  const hdrEncimera = (() => {
    const lin = /^\s*hdrDataLin (.*)$/m.exec(texto)?.[1] ?? "";
    const m = /<636 EN;[^/>]*\/[^/>]*\/([^>]+)>/.exec(lin);
    return m ? `<636>${m[1].trim()}` : null;
  })();
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

  // Catálogo de cada mueble (4 = Placares, 3 = Cocinas…). Una pieza lleva `k` (su catálogo) siempre que difiera del de su
  // mueble: así nunca se supone el de Placares para una pieza de Cocinas (los códigos de color se repiten entre catálogos).
  const catDeModulo = new Map<number, string>();

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
      ...(cat !== catDeModulo.get(id ?? -1) ? { k: cat } : {}),
      ...(/paisaje|skyline/i.test(nombre) || /^(skyline|paisaje)/i.test(datos.m) ? { e: 1 as const } : {}),
    });
  };

  // Cajas de bisagra (se dibujan solo si la hoja a la que acompañan se dibuja).
  const cajasHerraje = new WeakSet<CajaEscena>();

  // Cocinas: ¿viene vacío el objeto de primer nivel EN (encimera)? Entonces se arma con los trozos que guarda cada mueble.
  let reconEncimera = false;
  /** Cajas de la encimera reconstruida desde los almacenes (para detectar contornos `CPT` que dibujarían una segunda mesada encima). */
  const cajasRecon: CajaEscena[] = [];
  /** Losas hechas con el contorno de un `CPT`/`EN` sin sólido: se descartan al final las que la encimera reconstruida ya cubre. */
  const losasContorno: { malla: MallaEscena; poli: [number, number][] }[] = [];
  /** El mueble que se está recorriendo ya trae su encimera a la vista (no se repite la del almacén). */
  let moduloConEncimera = false;
  const reconDibujadas = new Set<string>();
  /** Trozos de encimera propios de un mueble (`encim.`), para descartar los que flotan sobre su cuerpo (ver el final). */
  const encimasModulo: CajaEscena[] = [];

  /** Animaciones de frentes `extraible` (índice → ya se fijó su recorrido con el cesto). */
  const extraibles = new Map<number, boolean>();

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
    recon: "EN" | null = null,
  ) => {
    // Las patas (objeti PAT) quedan bajo el zócalo y TeoWin no las muestra desde afuera: no se dibujan.
    // Las fuentes de luz (objeti LZ: el cono amarillo de una lámpara) no se dibujan: TeoWin solo muestra la lámpara.
    if (NODOS_IGNORADOS.has(n.nombre) || n.objeti === "PAT" || n.objeti === "LZ") return;
    // Cocinas: cuando el objeto de primer nivel EN (encimera) viene vacío en el .3d (`nTrozosSaved` sin hijos), TeoWin la arma
    // al abrir la escena con los trozos que cada mueble guarda ocultos (`encim.` dentro de un `almacenCMB`, nuncavis3d): se
    // dibujan esos trozos (y solo ellos) para que las bases no queden sin tapa. Con el zócalo no se hace lo mismo: solo
    // algunos muebles traen su pieza y quedaría a medias (los ZC vacíos se dejan como están).
    if (recon === null && n.nuncaVisible && n.almacen && reconEncimera && !moduloConEncimera) recon = "EN";
    if (n.nuncaVisible && recon === null) return;
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
    env.pl = env.pl ?? 40.4; // largo de la placa de bisagra: la bisagra de una hoja se ubica en L-pl
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
    // Los catálogos de decoración y equipamiento (encimeras, electrodomésticos, puertas y ventanas, lámparas…)
    // no se animan: ni se mueven solos ni acompañan a un mueble que se abre.
    const sinAnim = SIN_ANIMACION.has(cat);
    let anim = sinAnim || recon !== null ? null : animPadre;
    if (enModulo && !sinAnim && recon === null) {
      if (n.extraible && !enCorr && tieneHerrajeAbierto(n)) {
        // Frente `extraible` con herraje de alambre (cestos, rieles): TeoWin lo saca como un solo cajón. El frente y todo lo que cuelga de
        // él comparten esta animación; el recorrido sale del primer cesto que trae `AsiEsAbierto` (ver el caso siguiente).
        const e = apply(M, [0, 0, 1]);
        out.animaciones.push({ tipo: "cajon", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: 0 });
        anim = out.animaciones.length - 1;
        extraibles.set(anim, false);
      } else if (n.seAbre && animPadre !== null && extraibles.has(animPadre)) {
        // Cesto (u otra pieza `seabre`) dentro de un frente extraible: no se anima por su cuenta, sale con el frente. Su `AsiEsAbierto`
        // (posición abierta, en el sistema del padre; "_" = no cambia) menos `AsiEsCerrado` (o su propia posición) es el recorrido.
        if (!extraibles.get(animPadre)) {
          extraibles.set(animPadre, true);
          const comp = (g: string[] | null, k: number) => (g && g[k] && g[k] !== "_" ? ev(g[k], envPadre) : null);
          const d: Vec3 = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const a = comp(n.asiAbierto, k);
            if (a !== null) d[k] = a - (comp(n.asiCerrado, k) ?? pos[k]);
          }
          const largo = Math.hypot(d[0], d[1], d[2]);
          const dir: Vec3 = largo > 1 ? [d[0] / largo, d[1] / largo, d[2] / largo] : [0, 0, 1];
          const e = apply(M, dir);
          out.animaciones[animPadre] = {
            ...out.animaciones[animPadre],
            eje: [r4(e[0]), r4(e[1]), r4(e[2])],
            dist: r1(largo > 1 ? largo : (n.porcen ?? 0.85) * (env.P > 0 ? env.P : 0)),
          };
        }
      } else if (n.seAbre && enCorr && envPadre.L !== undefined && env.L !== undefined && envPadre.L - env.L >= 1) {
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
        // El lado de la bisagra lo dicen las bisagras que cuelgan de la hoja (TeoWin las dibuja ahí): una hoja de ancho completo
        // de un mueble de una sola puerta tiene su centro justo en el medio y la posición no alcanza (`apertura 2` = bisagra a la derecha).
        const bis = bisagrasHoja(n, env);
        const cb = bis ? bis.x : null;
        let izquierda: boolean;
        let bisagra: Vec3;
        if (cb !== null) {
          bisagra = cb < env.L / 2 ? pA : pB;
          izquierda = bisagra === pA ? xa <= xb : xb <= xa;
        } else {
          izquierda = (xa + xb) / 2 <= mk.L / 2 + 1;
          bisagra = izquierda ? (xa <= xb ? pA : pB) : xa >= xb ? pA : pB;
        }
        const grados = n.anguloAper * (buscarPorcen(n) ?? 0.85);
        if (bis !== null && bis.horizontal) {
          // Frente abatible (pistón a gas): bisagras en el borde superior (o inferior) con el eje paralelo al ancho de la hoja. Gira sobre
          // ese borde hacia el frente del mueble (+Z); el sentido sale de la velocidad del centro de la hoja (eje × radio).
          const eje = apply(M2, [1, 0, 0]);
          const borde = apply(M2, [0, bis.y >= env.H / 2 ? env.H : 0, 0]);
          const centro = apply(M2, [env.L / 2, env.H / 2, 0]);
          const rad = [centro[0] - borde[0], centro[1] - borde[1], centro[2] - borde[2]];
          const fr = apply(mk.M, [0, 0, 1]);
          const vel = [eje[1] * rad[2] - eje[2] * rad[1], eje[2] * rad[0] - eje[0] * rad[2], eje[0] * rad[1] - eje[1] * rad[0]];
          const sentido = vel[0] * fr[0] + vel[1] * fr[1] + vel[2] * fr[2] >= 0 ? 1 : -1;
          out.animaciones.push({
            tipo: "giro",
            mod: id,
            eje: [r4(eje[0]), r4(eje[1]), r4(eje[2])],
            pivote: rv([T2[0] + borde[0], T2[1] + borde[1], T2[2] + borde[2]]),
            dist: r1(sentido * grados),
          });
        } else {
          const eje = apply(mk.M, [0, 1, 0]);
          out.animaciones.push({
            tipo: "giro",
            mod: id,
            eje: [r4(eje[0]), r4(eje[1]), r4(eje[2])],
            pivote: rv(bisagra),
            dist: r1(izquierda ? -grados : grados),
          });
        }
        anim = out.animaciones.length - 1;
      } else if (n.seAbre && !enCorr && env.P > 0) {
        const e = apply(M, [0, 0, 1]);
        out.animaciones.push({ tipo: "cajon", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: r1((n.porcen ?? 0.85) * env.P) });
        anim = out.animaciones.length - 1;
      } else if (n.abierto && Math.abs(pos[0]) >= 100) {
        // Hoja corrediza de un placard guardada abierta (`opened`): el desplazamiento de su `virtual` es el de apertura
        // (porcenAperOpn × recorrido) y cerrada vale 0. Se muestra cerrada y se anima hasta su posición guardada.
        const largo = Math.abs(pos[0]);
        const e = apply(M, [Math.sign(pos[0]), 0, 0]);
        out.animaciones.push({ tipo: "puerta", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: 0, ini: -r1(largo) });
        anim = out.animaciones.length - 1;
      } else if (n.corredera && !n.kids.some((k) => k.abierto) && envPadre.L !== undefined && env.L !== undefined && env.L < envPadre.L - 1) {
        const sentido = pos[0] + env.L / 2 < envPadre.L / 2 ? 1 : -1;
        const e = apply(M, [sentido, 0, 0]);
        const dist = (buscarPorcen(n) ?? 0.85) * (envPadre.L - env.L);
        out.animaciones.push({ tipo: "puerta", mod: id, eje: [r4(e[0]), r4(e[1]), r4(e[2])], dist: r1(dist) });
        anim = out.animaciones.length - 1;
      }
    }

    // Bisagras (familia BIS3D/BIB3D): el cuerpo que va en la hoja (40,4×66) y la placa del lateral (8,5×51×44,5) se dibujan como cajas
    // chicas; la hoja las lleva consigo al girar (heredan su animación). Los otros herrajes (elevables, pistones, push) no se dibujan.
    if (n.hinge && enModulo && recon === null && env.L !== undefined && env.H !== undefined && env.P !== undefined) {
      const mide = (a: number, b: number, c: number) => Math.abs(env.L - a) < 0.1 && Math.abs(env.H - b) < 0.1 && Math.abs(env.P - c) < 0.1;
      const partes = mide(40.4, 66, 14.5) ? HERRAJE_CUERPO : mide(8.5, 51, 44.5) ? HERRAJE_PLACA : null;
      // La placa se apoya en la cara interior del lateral y se extiende hacia el fondo del mueble. Con `ang(0,90,0)` (lateral
      // izquierdo) el grosor de la placa (+Z local) entra al mueble; con `ang(180,-90,0)` (lateral derecho) el marco queda
      // espejado y la placa entraba en el lateral y asomaba al frente: se gira 180° sobre su eje vertical.
      let Rh = M2;
      if (n.ang) {
        const a = n.ang.slice(0, 3).map((x) => ev(x, env) ?? 0);
        Rh = mul(M, rotacionHerraje(a[0], a[1], a[2]));
      }
      if (partes === HERRAJE_PLACA && marco) {
        const ex = apply(marco.M, [1, 0, 0]);
        const xl = (T2[0] - marco.T[0]) * ex[0] + (T2[1] - marco.T[1]) * ex[1] + (T2[2] - marco.T[2]) * ex[2];
        const adentro: Vec3 = xl < marco.L / 2 ? ex : [-ex[0], -ex[1], -ex[2]];
        const z = apply(Rh, [0, 0, 1]);
        if (z[0] * adentro[0] + z[1] * adentro[1] + z[2] * adentro[2] < -0.5) Rh = mul(Rh, rotacion(0, 180, 0));
      }
      for (const [off, dim] of partes ?? []) {
        const o = apply(Rh, off);
        const caja: CajaEscena = {
          mod: id,
          m: "",
          c: COLOR_HERRAJE,
          t: rv([T2[0] + o[0], T2[1] + o[1], T2[2] + o[2]]),
          r: Rh.map((x) => Math.round(x * 1e4) / 1e4),
          s: dim,
          ...(anim !== null ? { a: anim } : {}),
        };
        cajasHerraje.add(caja);
        out.cajas.push(caja);
      }
    }

    for (const pr of n.prims) {
      // En una reconstrucción solo cuentan las piezas del propio encim.
      if (recon !== null && (n.objeti !== recon || (pr.tipo !== "extrude" && pr.tipo !== "extrudeSp") || pr.sinEti)) continue;
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
        if (recon !== null) {
          // Un almacén guarda varios trozos del mismo módulo en el mismo lugar (los de cada variante de corte): se dibuja uno.
          const dup = `${id}|${pr.m}|${rv([T2[0] + o[0], T2[1] + o[1], T2[2] + o[2]]).join()}|${dim.join()}|${Mc.join()}`;
          if (reconDibujadas.has(dup)) continue;
          reconDibujadas.add(dup);
        }
        const cajaNueva: CajaEscena = {
          mod: id,
          m: n.objeti === "EN" && pr.m === "enci" && hdrEncimera ? hdrEncimera : pr.m,
          c: pr.c,
          t: rv([T2[0] + o[0], T2[1] + o[1], T2[2] + o[2]]),
          r: Mc.map((x) => Math.round(x * 1e4) / 1e4),
          s: [r1(dim[0]), r1(dim[1]), r1(dim[2])],
          ...(anim !== null ? { a: anim } : {}),
          ...(pr.opacidad !== null ? { o: pr.opacidad } : {}),
          ...(cat !== catDeModulo.get(id ?? -1) ? { k: cat } : {}),
          ...(pr.etiqueta === "PSJ" ? { p: 1 as const } : {}),
          ...(vetaDe(n, pr) !== null && !(cat === "636" && n.objeti === "EN") && recon === null && n.objeti !== "ZC" && pr.m !== "enci" && pr.etiqueta !== "PSJ"
            ? { v: vetaDe(n, pr) as 0 | 1 | 2 }
            : {}),
        };
        out.cajas.push(cajaNueva);
        if (recon !== null) cajasRecon.push(cajaNueva);
        if (n.objeti === "EN" && id !== null && cat === catDeModulo.get(id)) encimasModulo.push(cajaNueva);
      }
    }
    if (enModulo && recon === null && n.camino.length >= 3 && !tieneGeometria(n) && (n.objeti === "SWL" || n.objeti === "EN" || n.objeti === "CPT")) {
      // Encimera sin sólido en el .3d: TeoWin la genera desde el recorrido (cara inferior a 870 mm, 30 mm de espesor).
      const losa = prismaDeContorno(n.camino, 30);
      if (losa) {
        const antes = out.mallas.length;
        emitirMalla({ v: losa.v, i: losa.i, uv: null }, { m: "", c: [0.93, 0.93, 0.93], opacidad: null }, M2, T2, id, anim, cat, n.nombre);
        if (out.mallas.length > antes && n.objeti !== "SWL") {
          // Contorno en planta (x, z de la escena) para el control de cobertura del final.
          const poli = n.camino.map((q): [number, number] => {
            const d = apply(M2, q);
            return [T2[0] + d[0], T2[2] + d[2]];
          });
          losasContorno.push({ malla: out.mallas[out.mallas.length - 1], poli });
        }
      }
    }
    if (enModulo && recon === null) {
      for (const mc of n.meshes) {
        if (mc.invisible) continue;
        const dm = mc.pos ? evVec(mc.pos, env) : null;
        if (dm && (dm[0] !== 0 || dm[1] !== 0 || dm[2] !== 0)) {
          // La malla no se muta (el mismo nodo puede recorrerse más de una vez): se desplaza una copia.
          const v2 = mc.v.slice();
          for (let k = 0; k + 2 < v2.length; k += 3) {
            v2[k] += dm[0];
            v2[k + 1] += dm[1];
            v2[k + 2] += dm[2];
          }
          emitirMalla({ v: v2, i: mc.i, uv: mc.uv }, { m: mc.m, c: mc.c, opacidad: mc.opacidad }, M2, T2, id, anim, cat, n.nombre);
          continue;
        }
        emitirMalla({ v: mc.v, i: mc.i, uv: mc.uv },{ m: mc.m, c: mc.c, opacidad: mc.opacidad }, M2, T2, id, anim, cat, n.nombre);
      }
    }
    for (const k of n.kids) caminar(k, env, M2, T2, id, enModulo, anim, cat, enCorr || (n.corredera && n.objeti === "PT"), marco, recon);
  };

  const sinContenido = (nodos: Nodo[]) => nodos.length > 0 && nodos.every((k) => !tieneGeometria(k) && k.camino.length < 3);
  reconEncimera = sinContenido(escena.kids.filter((k) => k.objeti === "EN" && k.catalogo === "1"));
  const encimeraVisible = (n: Nodo): boolean =>
    n.kids.some((c) => !c.nuncaVisible && ((c.objeti === "EN" && c.prims.some((q) => !q.invisible && !q.sinEti)) || encimeraVisible(c)));

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
        nombre: limpiarTexto(k.nombreModulo || k.nombre),
        familia: limpiarTexto(k.familia || k.nombre),
        catalogo: k.catalogo,
        frente: frenteDe(k),
        dim: [env.L ?? 0, env.H ?? 0, env.P ?? 0],
      });
      moduloConEncimera = encimeraVisible(k);
      catDeModulo.set(k.idEscena, k.catalogo);
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
  // Contornos de encimera (`CPT`) que la encimera reconstruida ya cubre: son la misma mesada dibujada dos veces (la losa del
  // contorno queda encima, a 900-930 mm, de la reconstruida a 870-900 mm). Se descartan solo si la cubren casi por completo; si
  // el contorno abarca más (huecos de artefactos, prolongaciones), se conserva como antes.
  if (cajasRecon.length > 0 && losasContorno.length > 0) {
    const dentroPoli = (x: number, z: number, poli: [number, number][]) => {
      let dentro = false;
      for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        const [xi, zi] = poli[i];
        const [xj, zj] = poli[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dentro = !dentro;
      }
      return dentro;
    };
    const dentroCaja = (x: number, z: number, c: CajaEscena) => {
      const dx = x - c.t[0];
      const dy = c.s[1] * 0.5 * c.r[4];
      const dz = z - c.t[2];
      const lx = c.r[0] * dx + c.r[3] * dy + c.r[6] * dz;
      const lz = c.r[2] * dx + c.r[5] * dy + c.r[8] * dz;
      return lx >= -1 && lx <= c.s[0] + 1 && lz >= -1 && lz <= c.s[2] + 1;
    };
    const cubiertas = new Set<MallaEscena>();
    for (const { malla, poli } of losasContorno) {
      const xs = poli.map((q) => q[0]);
      const zs = poli.map((q) => q[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const z0 = Math.min(...zs);
      const z1 = Math.max(...zs);
      const paso = Math.max(30, Math.sqrt(((x1 - x0) * (z1 - z0)) / 4000));
      let total = 0;
      let cubierto = 0;
      for (let x = x0 + paso / 2; x < x1; x += paso) {
        for (let z = z0 + paso / 2; z < z1; z += paso) {
          if (!dentroPoli(x, z, poli)) continue;
          total++;
          if (cajasRecon.some((c) => dentroCaja(x, z, c))) cubierto++;
        }
      }
      if (total > 0 && cubierto / total >= 0.9) cubiertas.add(malla);
    }
    if (cubiertas.size > 0) out.mallas = out.mallas.filter((m) => !cubiertas.has(m));
  }
  // Trozo de encimera reconstruido (almacén `almacenCMB`) que en realidad es el piso de otro módulo apoyado sobre el bajo: la losa de 30 mm
  // lo tapa y se vería como mesada. Se descarta si el 40 % o más de su volumen cae dentro de cajas (AABB) de OTROS módulos que no son encimera.
  // Riesgo: una mesada real con un módulo apoyado encima (estante o armario sobre la losa) podría superar el umbral y perderse.
  if (cajasRecon.length > 0) {
    const aabb = (c: CajaEscena): [Vec3, Vec3] => {
      const lo: Vec3 = [Infinity, Infinity, Infinity];
      const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const x of [0, c.s[0]]) {
        for (const y of [0, c.s[1]]) {
          for (const z of [0, c.s[2]]) {
            for (let k = 0; k < 3; k++) {
              const q = c.t[k] + c.r[k * 3] * x + c.r[k * 3 + 1] * y + c.r[k * 3 + 2] * z;
              lo[k] = Math.min(lo[k], q);
              hi[k] = Math.max(hi[k], q);
            }
          }
        }
      }
      return [lo, hi];
    };
    const mesadas = new Set([...cajasRecon, ...encimasModulo]);
    const otras = out.cajas.filter((c) => c.mod !== null && !mesadas.has(c) && c.k !== "636" && !cajasHerraje.has(c)).map((c) => ({ mod: c.mod, b: aabb(c) }));
    const tapadas = new Set<CajaEscena>();
    for (const c of cajasRecon) {
      const [lo, hi] = aabb(c);
      const cand = otras.filter((o) => o.mod !== c.mod && o.b[0].every((x, k) => x < hi[k]) && o.b[1].every((x, k) => x > lo[k]));
      if (cand.length === 0) continue;
      const N = 24;
      let dentro = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let l = 0; l < N; l++) {
            const p = [lo[0] + ((hi[0] - lo[0]) * (i + 0.5)) / N, lo[1] + ((hi[1] - lo[1]) * (j + 0.5)) / N, lo[2] + ((hi[2] - lo[2]) * (l + 0.5)) / N];
            if (cand.some((o) => p.every((x, k) => x >= o.b[0][k] && x <= o.b[1][k]))) dentro++;
          }
        }
      }
      if (dentro / (N * N * N) >= 0.4) tapadas.add(c);
    }
    if (tapadas.size > 0) out.cajas = out.cajas.filter((c) => !tapadas.has(c));
  }
  // Encimera propia de un mueble que no apoya sobre él: el `encim.` de un mueble va a `H+Hz` sobre el origen del mueble (tapa del
  // cuerpo); cuando el .3d lo guarda dentro de la carcasa `IZ` (cuyo origen ya está a `Hz` del piso) queda `Hz` (150 mm) más alto,
  // flotando sobre el mueble (y, si hay un armario alto encima, dentro de su hueco como un estante). TeoWin no lo muestra. Una
  // encimera apoyada tiene su cara inferior a la altura del tope del cuerpo del mueble; se descarta si queda más de 50 mm sobre él.
  if (encimasModulo.length > 0) {
    const tope = new Map<number, number>();
    const subir = (mod: number | null, r: number[], t: Vec3, pts: Iterable<Vec3>) => {
      if (mod === null) return;
      let y = tope.get(mod) ?? -Infinity;
      for (const [x, yy, z] of pts) y = Math.max(y, t[1] + r[3] * x + r[4] * yy + r[5] * z);
      tope.set(mod, y);
    };
    const esquinas = function* (s: Vec3): Generator<Vec3> {
      for (const x of [0, s[0]]) for (const y of [0, s[1]]) for (const z of [0, s[2]]) yield [x, y, z];
    };
    const conjunto = new Set(encimasModulo);
    for (const c of out.cajas) if (!conjunto.has(c)) subir(c.mod, c.r, c.t, esquinas(c.s));
    for (const q of out.mallas) {
      const pts: Vec3[] = [];
      for (let k = 0; k + 2 < q.v.length; k += 3) pts.push([q.v[k], q.v[k + 1], q.v[k + 2]]);
      subir(q.mod, q.r, q.t, pts);
    }
    const flotan = new Set<CajaEscena>();
    for (const c of encimasModulo) {
      const t = tope.get(c.mod ?? -1);
      if (t === undefined) continue;
      let base = Infinity;
      for (const [x, y, z] of esquinas(c.s)) base = Math.min(base, c.t[1] + c.r[3] * x + c.r[4] * y + c.r[5] * z);
      if (base > t + 50) flotan.add(c);
    }
    if (flotan.size > 0) out.cajas = out.cajas.filter((c) => !flotan.has(c));
  }
  // Una animación sin ninguna pieza (la hoja o el cajón se omitieron: invisibles o sin medida) no abre nada: se descarta
  // para que el visor no ofrezca un botón que no mueve nada.
  const conPiezas = new Set<number>();
  for (const c of out.cajas) if (c.a !== undefined && !cajasHerraje.has(c)) conPiezas.add(c.a);
  for (const q of out.mallas) if (q.a !== undefined) conPiezas.add(q.a);
  // Las bisagras de una hoja que no se dibuja (todas sus piezas omitidas) tampoco quedan sueltas en el aire.
  out.cajas = out.cajas.filter((c) => !(cajasHerraje.has(c) && c.a !== undefined && !conPiezas.has(c.a)));
  if (conPiezas.size < out.animaciones.length) {
    const nuevo = new Map<number, number>();
    out.animaciones = out.animaciones.filter((_, i) => {
      if (!conPiezas.has(i)) return false;
      nuevo.set(i, nuevo.size);
      return true;
    });
    for (const c of out.cajas) if (c.a !== undefined) c.a = nuevo.get(c.a);
    for (const q of out.mallas) if (q.a !== undefined) q.a = nuevo.get(q.a);
  }
  out.suelo = inicioParedes;
  // Los colores de un mueble son de su catálogo; paredes y piso son decoración (catálogo 641).
  const catDe = new Map(out.modulos.map((m) => [m.idEscena, m.catalogo]));
  out.materiales = [
    ...new Set(
      [
        ...out.cajas.filter((c) => c.m !== "").map((c) => `${c.k ?? catDe.get(c.mod ?? -1) ?? CAT_DEFECTO}/${c.m}`),
        ...out.mallas.filter((q) => q.m !== "").map((q) => `${q.k ?? catDe.get(q.mod ?? -1) ?? CAT_DEFECTO}/${q.m}`),
        ...out.paredes.filter((w) => w.m).map((w) => `641/${w.m}`),
        ...(out.materialSuelo ? [`641/${out.materialSuelo}`] : []),
      ],
    ),
  ];
  out.sinResolver = [...sinResolver, ...omitidas].slice(0, 50);
  return out;
}
