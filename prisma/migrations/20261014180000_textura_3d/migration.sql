-- CreateTable
CREATE TABLE "textura_3d" (
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "origen" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "textura_3d_pkey" PRIMARY KEY ("clave")
);
