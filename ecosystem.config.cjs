module.exports = {
  apps: [
    // ── Production ────────────────────────────────────────────────────────────
    {
      name: 'burgundy-bid-prod',
      script: 'server/index.js',
      interpreter: 'node',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      error_file: 'logs/prod-error.log',
      out_file: 'logs/prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    // ── Staging ───────────────────────────────────────────────────────────────
    {
      name: 'burgundy-bid-staging',
      script: 'server/index.js',
      interpreter: 'node',
      node_args: '--env-file=.env.staging',
      env: {
        NODE_ENV: 'staging',
        PORT: 3002,
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      error_file: 'logs/staging-error.log',
      out_file: 'logs/staging-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
