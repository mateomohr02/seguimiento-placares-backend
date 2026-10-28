// El alta normal de usuarios es desde la app (técnica, /api/usuarios). Esto queda para emergencias (ej. el primer
// admin de una base nueva): genera el INSERT para dar de alta un usuario a mano (diseño.md §12; apellido queda '').
//   npm run usuario:sql -- "<nombre>" <rol> <pin>
// Pegar el resultado en psql / pgAdmin / Prisma Studio. Roles: admin, tecnica, fabrica, gerencia.
import { PIN_REGEX } from "../src/modules/auth/pin";

const [nombre, rol, pin] = process.argv.slice(2);
if (!nombre || !rol || !pin) {
  console.error('Uso: npm run usuario:sql -- "<nombre>" <rol> <pin>');
  process.exit(1);
}
if (!PIN_REGEX.test(pin)) {
  console.error("El PIN debe ser numérico (4 a 10 dígitos; se recomienda 6).");
  process.exit(1);
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
console.log(
  `INSERT INTO usuario (nombre, pin, rol_id) VALUES (${lit(nombre)}, ${lit(pin)}, (SELECT id FROM rol WHERE nombre = ${lit(rol)}));`,
);
