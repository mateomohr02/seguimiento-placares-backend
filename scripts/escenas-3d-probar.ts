// Prueba el intérprete de escenas 3D contra una carpeta de archivos .3d (copias, nunca la carpeta de TeoWin):
//   npm run escenas3d:probar -- <carpeta> [filtro]
// Por cada escena informa tiempo, piezas, tamaño del JSON y problemas (coordenadas no finitas, sin muebles,
// mallas omitidas). No toca la base de datos.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { leerBibliotecaTeoWin } from "../src/modules/escenas-pedido/parser/biblioteca-3d";
import { interpretarEscena3D } from "../src/modules/escenas-pedido/parser/escena-3d.parser";

const carpeta = process.argv[2];
const filtro = process.argv[3] ?? "";
if (!carpeta) {
  console.error("Uso: npm run escenas3d:probar -- <carpeta> [filtro]");
  process.exit(1);
}

const noFinito = (a: number[]) => a.some((x) => !Number.isFinite(x));
let mal = 0;
let total = 0;
for (const f of readdirSync(carpeta).filter((x) => x.endsWith(".3d") && x.includes(filtro)).sort()) {
  total++;
  const t0 = Date.now();
  try {
    const e = interpretarEscena3D(readFileSync(path.join(carpeta, f)).toString("latin1"), { biblioteca: leerBibliotecaTeoWin });
    const ms = Date.now() - t0;
    const kb = Math.round(JSON.stringify(e).length / 1024);
    const problemas: string[] = [];
    if (e.cajas.some((c) => noFinito(c.t) || noFinito(c.s) || noFinito(c.r))) problemas.push("cajas no finitas");
    if (e.mallas.some((m) => noFinito(m.t) || noFinito(m.v) || noFinito(m.r))) problemas.push("mallas no finitas");
    if (e.mallas.some((m) => m.i.some((i) => i * 3 + 2 >= m.v.length))) problemas.push("índice fuera de rango");
    if (e.modulos.length === 0 && e.paredes.length === 0) problemas.push("vacía");
    if (e.sinResolver.some((s) => s.startsWith("malla omitida"))) problemas.push("mallas omitidas");
    if (kb > 6000) problemas.push("JSON enorme");
    if (ms > 5000) problemas.push("lenta");
    if (problemas.length) mal++;
    console.log(
      `${problemas.length ? "!!" : "ok"} ${f.padEnd(24)} ${String(ms).padStart(5)} ms  mod ${String(e.modulos.length).padStart(2)}  cajas ${String(e.cajas.length).padStart(4)}  mallas ${String(e.mallas.length).padStart(3)}  anim ${String(e.animaciones.length).padStart(2)}  ${String(kb).padStart(5)} KB  ${problemas.join(", ")}`,
    );
  } catch (err) {
    mal++;
    console.log(`!! ${f.padEnd(24)} EXCEPCIÓN ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\n${total} escenas, ${mal} con problemas`);
