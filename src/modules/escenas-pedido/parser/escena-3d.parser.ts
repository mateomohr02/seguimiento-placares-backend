import { evaluar, grupos, type Entorno } from "./expresion";

// Intérprete (solo lectura) de los .3d de TeoWin — diseño.md §13. Devuelve una
// geometría liviana para el visor: cajas (tableros y extrusiones rectangulares),
// caras de pared y el contorno del suelo. v1: no interpreta tube / malla ni
// extrusiones no rectangulares (tiradores, herrajes, ventanas) ni luces, cotas o texturas de pared; solo paneles y paredes.
// Subir PARSER_VERSION cuando cambie la salida (el original se conserva en la
// base, así se puede re-interpretar).
export const PARSER_VERSION = 1;

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
}

export interface ParedEscena {
  lado: "int" | "ext";
  /** 4 vértices del rectángulo (mm). */
  p: [number, number, number][];
}

export interface ModuloEscena {
  idEscena: number;
  nombre: string;
  familia: string;
  /** Ancho, alto y profundidad del mueble (use L/H/P). */
  dim: [number, number, number];
}

export interface Escena3D {
  version: number;
  cabecera: { pedido: string | null; version3d: string | null };
  modulos: ModuloEscena[];
  cajas: CajaEscena[];
  paredes: ParedEscena[];
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
}

class Nodo {
  kids: Nodo[] = [];
  use: Record<string, string> = {};
  param: Record<string, string> = {};
  virtual: string[][] | null = null;
  ang: string[] | null = null;
  pos: string[] | null = null;
  idEscena: number | null = null;
  objeti = "";
  familia = "";
  catalogo = "";
  nombreModulo = "";
  prims: Primitiva[] = [];
  constructor(readonly nombre: string) {}
}

const NODOS_IGNORADOS = new Set(["mecanizado", "label", "defespigameca"]);

function parsearArbol(texto: string): Nodo {
  const raiz = new Nodo("ROOT");
  const pila: Nodo[] = [raiz];
  let pendiente: Nodo | null = null;
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
    if ((m = /^use (\w+)\s*=(.*)$/.exec(t))) o.use[m[1]] = m[2].trim();
    else if ((m = /^param (\w+)\s*=\s*"(.*)"/.exec(t))) o.param[m[1]] = m[2];
    else if (t.startsWith("virtual(")) o.virtual = grupos(t).slice(0, 2);
    else if (t.startsWith("ang(")) o.ang = grupos(t)[0] ?? null;
    else if (t.startsWith("pos(")) o.pos = grupos(t)[0] ?? null;
    else if ((m = /^idEscena\((\d+)\)/.exec(t))) o.idEscena = Number(m[1]);
    else if ((m = /^objeti"(\w*)"/.exec(t))) o.objeti = m[1];
    else if ((m = /^familia"(\w+)"/.exec(t))) o.familia = m[1];
    else if ((m = /^IDCatalogo"(\d+)"/.exec(t))) o.catalogo = m[1];
    else if ((m = /^nombreModulo"([^"]*)"/.exec(t))) o.nombreModulo = m[1];
    else if (t.startsWith("eti") || /^mat"/.test(t)) {
      const prim = /\b(taulerv|taulerh|taulerf|extrude|faceset|face)(\(.*)$/.exec(t);
      if (prim) {
        const mat = /mat"([^"]*)"/.exec(t)?.[1] ?? "";
        const col = /color\(([\d.]+),([\d.]+),([\d.]+)\)/.exec(t);
        o.prims.push({
          tipo: prim[1],
          args: grupos(prim[2]),
          m: mat,
          c: col ? [Number(col[1]), Number(col[2]), Number(col[3])] : null,
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
  const pts = args.slice(2).map((g) => evVec(g, env));
  if (!size || !off || pts.length < 3 || pts.some((p) => p === null)) return null;
  const P = pts as Vec3[];
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
  // Rectángulo alineado: todos los vértices están en las esquinas del bounding box.
  const eje = [0, 1, 2].filter((i) => i !== plano);
  if (!P.every((p) => eje.every((i) => Math.abs(p[i] - min[i]) < 1e-6 || Math.abs(p[i] - max[i]) < 1e-6))) return null;
  void ev;
  const dim: Vec3 = [rango[0], rango[1], rango[2]];
  // Espesor 0 en el .3d: depende del material del mueble (script del catálogo).
  dim[plano] = size[plano] > 0.5 ? size[plano] : ESPESOR_DEFECTO;
  return [[off[0] + min[0], off[1] + min[1], off[2] + min[2]], dim];
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

  const caminar = (n: Nodo, envPadre: Entorno, M: Mat3, T: Vec3, idEscena: number | null, enModulo: boolean) => {
    if (NODOS_IGNORADOS.has(n.nombre)) return;
    const env: Entorno = { ...envPadre };
    for (const [k, v] of Object.entries(n.param)) {
      if (/^-?\d+(\.\d+)?$/.test(v)) env[k] = Number(v);
      else if (v === "") env[k] = 0; // parámetro sin uso en este mueble
      else if (/^mat/i.test(v)) env[k] = ESPESOR_DEFECTO;
    }
    for (const [k, v] of Object.entries(n.use)) {
      const x = ev(v, env);
      if (x !== null) env[k] = x;
    }
    let pos: Vec3 = [0, 0, 0];
    if (n.virtual) {
      const p = evVec(n.virtual[0], env);
      if (p) pos = p;
      const s = evVec(n.virtual[1], env);
      if (s) [env.L, env.H, env.P] = s;
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

    for (const pr of n.prims) {
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
        out.paredes.push({ lado, p });
        if (lado === "int") inicioParedes.push([p[0][0], p[0][2]]);
      } else if (enModulo) {
        let off: Vec3 | null;
        let dim: Vec3 | null;
        if (pr.tipo === "extrude") {
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
        });
      }
    }
    for (const k of n.kids) caminar(k, env, M2, T2, id, enModulo);
  };

  for (const k of escena.kids) {
    if (k.idEscena === null) continue;
    if (k.catalogo === "4" && k.familia) {
      // Módulo de fábrica (catálogo 4 / Placares): lleva el idEscena de modulo.idEscena.
      const env: Entorno = {};
      for (const [kk, v] of Object.entries(k.use)) {
        const x = evaluar(v, env);
        if (x !== null) env[kk] = x;
      }
      out.modulos.push({
        idEscena: k.idEscena,
        nombre: k.nombreModulo || k.nombre,
        familia: k.familia,
        dim: [env.L ?? 0, env.H ?? 0, env.P ?? 0],
      });
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, true);
    } else if (k.objeti === "PA") {
      caminar(k, {}, ID3, [0, 0, 0], k.idEscena, false);
    }
  }
  out.suelo = inicioParedes;
  out.sinResolver = [...sinResolver].slice(0, 50);
  return out;
}
