// Evaluador aritmético para las medidas del .3d (diseño.md §13): números, + - * /,
// paréntesis (TeoWin también usa [ ]) y variables. Sin eval. Devuelve null ante
// cualquier cosa que no entienda (funciones como cmp[...], variables sin valor).
export type Entorno = Record<string, number>;

export function evaluar(expr: string, env: Entorno): number | null {
  const src = expr.trim().replace(/\[/g, "(").replace(/\]/g, ")");
  if (src === "") return 0;
  let i = 0;
  let fallo = false;

  const ws = () => {
    while (src[i] === " ") i++;
  };
  const primario = (): number => {
    ws();
    const c = src[i];
    if (c === "(") {
      i++;
      const v = suma();
      ws();
      if (src[i] === ")") i++;
      else fallo = true;
      return v;
    }
    if (c === "-") {
      i++;
      return -primario();
    }
    if (c === "+") {
      i++;
      return primario();
    }
    // Operando vacío (ej. "/2": en el .3d quedó sin su variable): TeoWin lo toma como 0.
    if (c === "/" || c === "*") return 0;
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const id = /^[A-Za-z_$][A-Za-z_0-9$]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      if (src[i] === "(") {
        fallo = true; // función desconocida
        return 0;
      }
      const v = env[id[0]];
      if (v === undefined) fallo = true;
      return v ?? 0;
    }
    fallo = true;
    i++;
    return 0;
  };
  const producto = (): number => {
    let v = primario();
    for (;;) {
      ws();
      if (src[i] === "*") {
        i++;
        v *= primario();
      } else if (src[i] === "/") {
        i++;
        const d = primario();
        if (d === 0) fallo = true;
        else v /= d;
      } else return v;
    }
  };
  function suma(): number {
    let v = producto();
    for (;;) {
      ws();
      if (src[i] === "+") {
        i++;
        v += producto();
      } else if (src[i] === "-") {
        i++;
        v -= producto();
      } else return v;
    }
  }
  const r = suma();
  ws();
  if (i < src.length) fallo = true;
  return fallo || !Number.isFinite(r) ? null : r;
}

/**
 * Condición `invisibilidad(...)` de un objeto del .3d: términos `cmp[a;b;op]` y `not[x]`
 * pegados uno a otro, que se leen como "o" (basta que uno se cumpla para ocultarlo).
 * null si no hay ningún término que se pueda evaluar (en ese caso el objeto se muestra).
 */
export function oculto(expr: string, env: Entorno): boolean | null {
  const terminos = /(cmp|not)\[((?:[^\[\]]|\[[^\]]*\])*)\]/g;
  let alguno = false;
  let m: RegExpExecArray | null;
  while ((m = terminos.exec(expr))) {
    if (m[1] === "not") {
      const v = evaluar(m[2], env);
      if (v === null) continue;
      alguno = true;
      if (v === 0) return true;
      continue;
    }
    const [a, b, op] = m[2].split(";").map((x) => x.trim());
    const va = a === undefined ? null : evaluar(a, env);
    const vb = b === undefined ? null : evaluar(b, env);
    if (va === null || vb === null) continue;
    alguno = true;
    const cumple =
      op === "=" ? va === vb : op === "<>" ? va !== vb : op === "<" ? va < vb : op === ">" ? va > vb : op === "<=" ? va <= vb : op === ">=" ? va >= vb : false;
    if (cumple) return true;
  }
  return alguno ? false : null;
}

/** "(a,b)(c)" → [["a","b"],["c"]], respetando paréntesis y corchetes anidados. */
export function grupos(s: string): string[][] {
  const res: string[][] = [];
  let d = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "(") {
      if (d > 0) buf += ch;
      else buf = "";
      d++;
    } else if (ch === ")") {
      d--;
      if (d === 0) res.push(partir(buf));
      else buf += ch;
    } else if (d > 0) buf += ch;
  }
  return res;
}

function partir(g: string): string[] {
  const out: string[] = [];
  let cur = "";
  let d = 0;
  for (const ch of g) {
    if (ch === "(" || ch === "[") d++;
    if (ch === ")" || ch === "]") d--;
    if (ch === "," && d === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((p) => p.trim());
}
