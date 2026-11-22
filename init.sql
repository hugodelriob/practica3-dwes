-- Inicialización: gestión de préstamos de material informático
CREATE SCHEMA IF NOT EXISTS practica_prestamos;
SET search_path TO practica_prestamos;

CREATE TABLE equipos (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo      VARCHAR(20)  NOT NULL UNIQUE,
    nombre      VARCHAR(100) NOT NULL,
    categoria   VARCHAR(50)  NOT NULL,
    disponible  BOOLEAN      NOT NULL DEFAULT true,
    CONSTRAINT equipos_codigo_longitud CHECK (char_length(codigo) BETWEEN 1 AND 20),
    CONSTRAINT equipos_codigo_no_vacio CHECK (btrim(codigo) <> ''),
    CONSTRAINT equipos_nombre_no_vacio CHECK (btrim(nombre) <> ''),
    CONSTRAINT equipos_categoria_no_vacia CHECK (btrim(categoria) <> '')
);

CREATE TABLE usuarios (
    id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre  VARCHAR(100) NOT NULL,
    CONSTRAINT usuarios_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE prestamos (
    id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipo_id         INTEGER     NOT NULL
        REFERENCES equipos (id)  ON DELETE RESTRICT,
    usuario_id        INTEGER     NOT NULL
        REFERENCES usuarios (id) ON DELETE RESTRICT,
    fecha_prestamo    TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_devolucion  TIMESTAMPTZ NULL,
    CONSTRAINT prestamos_fechas_coherentes
        CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Solo un préstamo activo (sin devolución) por equipo
CREATE UNIQUE INDEX prestamos_un_activo_por_equipo
    ON prestamos (equipo_id)
    WHERE fecha_devolucion IS NULL;

CREATE INDEX prestamos_usuario_idx ON prestamos (usuario_id);

-- Datos de ejemplo ---------------------------------------------------------
INSERT INTO usuarios (nombre) VALUES
    ('Ana García'),
    ('Luis Martínez'),
    ('Marta López');

INSERT INTO equipos (codigo, nombre, categoria, disponible) VALUES
    ('PORT-001', 'Portátil Lenovo ThinkPad E14',   'Portátil',  true),
    ('PORT-002', 'Portátil HP ProBook 450',        'Portátil',  true),
    ('PORT-003', 'Portátil Dell Latitude 5440',    'Portátil',  false),  -- prestado (ver abajo)
    ('PORT-004', 'Portátil Acer Aspire 5',         'Portátil',  true),
    ('TAB-001',  'iPad 10.ª generación',           'Tableta',   true),
    ('TAB-002',  'Samsung Galaxy Tab A9',          'Tableta',   true),
    ('TAB-003',  'Lenovo Tab M10',                 'Tableta',   true),
    ('PROY-001', 'Proyector Epson EB-X49',         'Proyector', true),
    ('PROY-002', 'Proyector BenQ MS535',           'Proyector', true),
    ('CAM-001',  'Webcam Logitech C920',           'Accesorio', true),
    ('AUR-001',  'Auriculares Jabra Evolve 20',    'Accesorio', true),
    ('ROU-001',  'Router TP-Link Archer AX23',     'Redes',     true);

-- Préstamo activo (coherente con PORT-003 no disponible)
INSERT INTO prestamos (equipo_id, usuario_id, fecha_prestamo)
SELECT e.id, u.id, now() - interval '2 days'
FROM equipos e, usuarios u
WHERE e.codigo = 'PORT-003' AND u.nombre = 'Ana García';

-- Préstamo ya finalizado (TAB-001 tiene historial: no se podrá borrar)
INSERT INTO prestamos (equipo_id, usuario_id, fecha_prestamo, fecha_devolucion)
SELECT e.id, u.id, now() - interval '10 days', now() - interval '8 days'
FROM equipos e, usuarios u
WHERE e.codigo = 'TAB-001' AND u.nombre = 'Luis Martínez';
