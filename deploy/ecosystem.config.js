// AirRO Water — pm2 process config for the backend API.
// From the project root on the VPS:  pm2 startOrReload deploy/ecosystem.config.js --update-env
// (deploy/update.sh does this for you). Run `pm2 startup` once + `pm2 save` so it
// survives reboots. Single fork instance — SQLite + the /state store expect ONE writer.
module.exports = {
  apps: [
    {
      name: 'airro-api',
      cwd: './server',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',   // explicit: exactly one process (never cluster) on :4000
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        // Bind to localhost only — Nginx is the public entry point.
        HOST: '127.0.0.1',
        PORT: '4000',
      },
    },
  ],
};
