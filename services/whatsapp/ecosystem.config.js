module.exports = {
  apps: [{
    name: 'eidosform-whatsapp',
    script: 'server.js',
    cwd: '/home/sidney/eidosform/services/whatsapp',
    env_file: '/home/sidney/eidosform/services/whatsapp/.env',
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    error_file: '/home/sidney/eidosform/services/whatsapp/logs/error.log',
    out_file: '/home/sidney/eidosform/services/whatsapp/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 5000,
    max_restarts: 20,
    kill_timeout: 5000,
  }],
}
