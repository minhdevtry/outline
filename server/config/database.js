const shared = {
  use_env_variable: process.env.DATABASE_URL ? "DATABASE_URL" : undefined,
  dialect: "postgres",
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT || 5432,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD || undefined,
  database: process.env.DATABASE_NAME,
};

// When PGSSLMODE=disable, don't configure SSL at all
const sslEnabled = process.env.PGSSLMODE !== "disable";

module.exports = {
  development: shared,
  test: shared,
  "production-ssl-disabled": shared,
  production: sslEnabled
    ? {
        ...shared,
        dialectOptions: {
          ssl: {
            rejectUnauthorized: false,
          },
        },
      }
    : shared,
};
