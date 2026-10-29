import { env } from "./config/env";
import { app } from "./app";

const alEscuchar = () => {
  console.log(`Backend escuchando en ${env.HOST ?? "todas las interfaces"}, puerto ${env.PORT}`);
};

if (env.HOST) app.listen(env.PORT, env.HOST, alEscuchar);
else app.listen(env.PORT, alEscuchar);
