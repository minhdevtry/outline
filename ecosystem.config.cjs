module.exports = {
  apps: [
    {
      name: "outline",
      cwd: "/home/lucas/Documents/code/outline",
      script: "./build/server/index.js",
      interpreter: "node",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
