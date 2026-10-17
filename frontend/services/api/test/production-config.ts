/** Deterministic deployment fixture, never a live credential or endpoint. */
export const productionEnv = {
  APP_ENV: 'production',
  ENCRYPTION_KEY: 'encryption-fixture-key-with-enough-variety-67890',
  REFERRAL_HASH_SALT: 'referral-fixture-salt-with-enough-variety-abcde',
  API_KEY_PEPPER: 'api-key-fixture-pepper-with-enough-variety-fghij',
  DATABASE_URL: 'postgresql://fixture:database-fixture-password-0123456789@database.test/app',
  DB_SSL_MODE: 'require',
  FRONTEND_URL: 'https://app.example.test',
};
