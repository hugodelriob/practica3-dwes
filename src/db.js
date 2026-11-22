import pg from 'pg';

const requeridas = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
const faltan = requeridas.filter((v) => !process.env[v]);
if (faltan.length > 0) {
  console.error(`Faltan variables de entorno: ${faltan.join(', ')}. Revisa tu archivo .env`);
  process.exit(1);
}

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 10,
  // Todas las consultas usan el esquema de la práctica
  options: '-c search_path=practica_prestamos',
});

// Evita que un error en un cliente inactivo tumbe el proceso
pool.on('error', (err) => {
  console.error('Error inesperado en un cliente inactivo del pool:', err.message);
});
