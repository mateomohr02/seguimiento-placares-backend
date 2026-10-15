import { evaluar, grupos, oculto, type Entorno } from "./expresion";

// Intérprete (solo lectura) de los .3d de TeoWin — diseño.md §13. Devuelve una
// geometría liviana para el visor: cajas (tableros y extrusiones rectangulares),
// caras de pared y el contorno del suelo. Respeta `nuncavis3d` e `invisibilidad(...)` (piezas
// que TeoWin no dibuja según las medidas del mueble). No interpreta tube / malla ni
// extrusiones no rectangulares (herrajes, ventanas) ni luces o cotas. Detecta las piezas que se
// mueven (cajones y hojas corredizas) para animarlas, y los materiales de paredes y piso.
// Subir PARSER_VERSION cuando cambie la salida (el original se conserva en la
// base, así se puede re-interpretar).
export const PARSER_VERSION = 14;

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

export interface ParedEscena {
  lado: "int" | "ext";
  /** 4 vértices del rectángulo (mm). */
  p: [number, number, number][];
  /** Material decorativo de la cara (ej. papel pintado), si lo declara. */
  m?: string;
  /** Medida (mm) de la baldosa del revestimiento (patrón `enrajolat`): la textura entera cubre una baldosa. */
  t?: [number, number];
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
const NODOS_IGNORADOS = new Set(["mecanizado", "label", "defespigameca", "objpath", "objformapath"]);

function parsearArbol(texto: string): Nodo {
  const raiz = new Nodo("ROOT");
  const pila: Nodo[] = [raiz];
  let pendiente: Nodo | null = null;
  let etiPendiente: string | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^obj"([^"]*)"$/.exec(t))) {
      const n = new Nodo(m[1]);
      pila[pila.length - 1].kids.push(n);
      pendiente = n;
      continue;
    }
    if (t === "{") {
      if (pendiente) pila.push(pendiente);
      continue;
    }
    if (t === "}") {
      if (pila.length > 1) pila.pop();
      continue;
    }
    const o = pila[pila.length - 1];
    // `nuncavis3d` e `invisib` (ej. los tiradores de un armario sin tirador): TeoWin no dibuja la pieza.
    if (/\b(nuncavis3d|invisib)\b/.test(t) && !t.startsWith("eti")) o.nuncaVisible = true;
    if (!t.startsWith("eti")) {
      if (/\bseabre\b/.test(t)) o.seAbre = true;
      if (/\bcorredera\b/.test(t)) o.corredera = true;
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
    else if ((m = /^idEscena\((\d+)\)/.exec(t))) o.idEscena = Number(m[1]);
    else if ((m = /^objeti"(\w*)"/.exec(t))) o.objeti = m[1];
    else if ((m = /^familia"(\w+)"/.exec(t))) o.familia = m[1];
    else if ((m = /^IDCatalogo"(\d+)"/.exec(t))) o.catalogo = m[1];
    else if ((m = /^matTablero 128,"[^"]*","([\d.]+)"/.exec(t))) o.espesor = Number(m[1]);
    else if (t.startsWith("invisibilidad(")) o.invisibilidad = t.slice(14, t.lastIndexOf(")"));
    else if ((m = /^nombreModulo"([^"]*)"/.exec(t))) o.nombreModulo = m[1];
    else if (t.startsWith("eti") || /^mat"/.test(t) || (etiPendiente !== null && /^(taulerv|taulerh|taulerf|extrudeSp|extrude)\(/.test(t))) {
      // A veces la primitiva viene en la línea siguiente a la de `eti"..." mat"..."` (tiras de canto): se unen.
      const esEti = t.startsWith("eti") || /^mat"/.test(t);
      const completa: string = !esEti && etiPendiente !== null ? `${etiPendiente} ${t}` : t;
      const prim = /\b(taulerv|taulerh|taulerf|extrudeSp|extrude|faceset|face)(\(.*)$/.exec(completa);
      etiPendiente = prim ? null : esEti ? t : etiPendiente;
      if (prim) {
        const mat = /mat"([^"]*)"/.exec(completa)?.[1] ?? "";
        const col = /color\(([\d.]+),([\d.]+),([\d.]+)\)/.exec(completa);
        o.prims.push({
          tipo: prim[1],
          // extrudeSp trae un segundo perfil de tangentes después de `tg`: solo se usa el primero.
          args: grupos(prim[1] === "extrudeSp" ? prim[2].split(/tg\(/)[0] : prim[2]),
          m: mat,
          c: col ? [Number(col[1]), Number(col[2]), Number(col[3])] : null,
          invisible: /\btransp\(0(\.0+)?\)/.test(completa),
          opacidad: opacidadDe(completa),
          materialCad: /<MATERIAL>([^<]+)<\/MATERIAL>/.exec(completa)?.[1]?.trim() || null,
          tile: tileDeCad(completa),
        });
      }
    }
  }
  return raiz;
}

type Mat3 = number[]; // por filas, 9
type Vec3 = [number, number, number];
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
  if (plano < 0 || rango.filter((r) => r < 1e-6).length > 1) return null;
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

export function interpretarEscena3D(texto: string): Escena3D {
  const cab = {
    pedido: /^metai P (.+)$/m.exec(texto)?.[1]?.trim() ?? null,
    version3d: /^\/\/version (.+)$/m.exec(texto)?.[1]?.trim() ?? null,
  };
  const raiz = parsearArbol(texto);
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
  ) => {
    if (NODOS_IGNORADOS.has(n.nombre) || n.nuncaVisible) return;
    // Un objeto de un catálogo de fábrica colgado de una pared (ej. una puerta de paso, catálogo 658)
    // también se dibuja; los del catálogo 1 (ventanas, cotas) y 641 (decoración) no.
    const cat = n.catalogo || catPadre;
    const enModulo = enModuloPadre || (n.catalogo !== "" && n.catalogo !== "1" && n.catalogo !== "641");
    const env: Entorno = { ...envPadre };
    for (const [k, v] of Object.entries(n.param)) {
      if (/^-?\d+(\.\d+)?$/.test(v)) env[k] = Number(v);
      else if (v === "") env[k] = 0; // parámetro sin uso en este mueble
      else if (/^mat/i.test(v)) {
        espesorVars.add(k);
        env[k] = env[k] ?? ESPESOR_DEFECTO;
      }
    }
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
        // Puerta con bisagra: gira sobre el canto de su lado exterior (la bisagra está del lado del mueble
        // al que pertenece la hoja) hacia el frente (+Z local del mueble).
        const derecha = pos[0] + env.L / 2 > envPadre.L / 2 + 1;
        const lp: Vec3 = [derecha ? env.L : 0, 0, 0];
        const d = apply(M2, lp);
        const eje = apply(M2, [0, 1, 0]);
        const grados = n.anguloAper * (buscarPorcen(n) ?? 0.85);
        out.animaciones.push({
          tipo: "giro",
          mod: id,
          eje: [r4(eje[0]), r4(eje[1]), r4(eje[2])],
          pivote: rv([T2[0] + d[0], T2[1] + d[1], T2[2] + d[2]]),
          dist: r1(derecha ? grados : -grados),
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
        if (n.objeti !== "PAI" && n.objeti !== "PAE") continue;
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
        const lado = n.objeti === "PAI" ? "int" : "ext";
        // Una puerta de paso colgada de la pared (su `objpath` es el vano) deja un hueco en la cara.
        const huecos: [number, number, number, number][] = [];
        if (lado === "int") {
          for (const k of n.kids) {
            if (k.nuncaVisible || !k.pos) continue;
            const kp = evVec(k.pos, env);
            const vano = buscarNodo(k, "objpath")?.prims.find((q) => q.tipo === "extrude" || q.tipo === "extrudeSp");
            if (!kp || !vano) continue;
            const pts = vano.args.slice(2).filter((g) => g.length >= 3).map((g) => evVec(g, {}));
            if (pts.length < 3 || pts.some((q) => q === null)) continue;
            const xs = (pts as Vec3[]).map((q) => q[0]);
            const ys = (pts as Vec3[]).map((q) => q[1]);
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
            ? { lado, p, m: pr.materialCad, ...(pr.tile ? { t: pr.tile } : {}), ...(huecos.length ? { h: huecos } : {}) }
            : lado === "int" && huecos.length
              ? { lado, p, h: huecos }
              : { lado, p },
        );
        if (lado === "int") inicioParedes.push([p[0][0], p[0][2]]);
      } else if (enModulo) {
        let off: Vec3 | null;
        let dim: Vec3 | null;
        if (pr.tipo === "extrude" || pr.tipo === "extrudeSp") {
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
        if (pr.m === "" && pr.c && pr.c[0] === 1 && pr.c[1] === 1 && pr.c[2] === 1) continue;
        if (Math.min(dim[0], dim[1], dim[2]) < 0.5) continue;
        const o = apply(M2, off);
        out.cajas.push({
          mod: id,
          m: pr.m,
          c: pr.c,
          t: rv([T2[0] + o[0], T2[1] + o[1], T2[2] + o[2]]),
          r: M2.map((x) => Math.round(x * 1e4) / 1e4),
          s: [r1(dim[0]), r1(dim[1]), r1(dim[2])],
          ...(anim !== null ? { a: anim } : {}),
          ...(pr.opacidad !== null ? { o: pr.opacidad } : {}),
          ...(cat !== "4" ? { k: cat } : {}),
        });
      }
    }
    for (const k of n.kids) caminar(k, env, M2, T2, id, enModulo, anim, cat, enCorr || n.corredera);
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
        ...out.paredes.filter((w) => w.m).map((w) => `641/${w.m}`),
        ...(out.materialSuelo ? [`641/${out.materialSuelo}`] : []),
      ],
    ),
  ];
  out.sinResolver = [...sinResolver].slice(0, 50);
  return out;
}
