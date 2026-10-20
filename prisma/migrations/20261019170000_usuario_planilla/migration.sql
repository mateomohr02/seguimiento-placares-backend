-- CreateTable
CREATE TABLE "usuario_planilla" (
    "usuario_id" UUID NOT NULL,
    "estacion" "PlanillaEstacion" NOT NULL,

    CONSTRAINT "usuario_planilla_pkey" PRIMARY KEY ("usuario_id","estacion")
);

-- AddForeignKey
ALTER TABLE "usuario_planilla" ADD CONSTRAINT "usuario_planilla_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Datos iniciales: termolaminado1 completa las tres planillas (si el usuario existe; los usuarios se cargan a mano).
INSERT INTO "usuario_planilla" ("usuario_id", "estacion")
SELECT u."id", e."estacion" FROM "usuario" u CROSS JOIN (VALUES ('LIJADO'::"PlanillaEstacion"), ('ENCOLADO'::"PlanillaEstacion"), ('PVC'::"PlanillaEstacion")) AS e("estacion") WHERE u."nombre" = 'termolaminado1';
