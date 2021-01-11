export default {
  type: 'postgres',
  host: process.env['DB_HOST'] ?? 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'foodies',
  synchronize: true,
  dropSchema: false,
  logging: false,
  cache: true,
  entities: ['src/main/entity/**/*.ts'],
  migrations: ['src/main/migration/**/*.ts'],
  migrationsRun: true,
  subscribers: ['src/main/subscriber/**/*.ts'],
  cli: {
    entitiesDir: 'src/main/entity',
    migrationsDir: 'src/main/migration',
    subscribersDir: 'src/main/subscriber',
  },
};
