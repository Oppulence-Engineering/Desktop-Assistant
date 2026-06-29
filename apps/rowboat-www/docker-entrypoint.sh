#!/bin/sh
set -eu

ROWBOAT_WWW_PUBLIC_API_BASE_URL="${ROWBOAT_WWW_PUBLIC_API_BASE_URL:-${ROWBOATX_PUBLIC_API_BASE_URL:-${ROWBOATX_API_BASE_URL:-https://api.oppulence.io}}}"
ROWBOAT_WWW_API_PROXY_URL="${ROWBOAT_WWW_API_PROXY_URL:-${ROWBOATX_API_PROXY_URL:-${ROWBOATX_API_BASE_URL:-https://api.oppulence.io}}}"
ROWBOAT_WWW_PUBLIC_API_BASE_URL="${ROWBOAT_WWW_PUBLIC_API_BASE_URL%/}"
ROWBOAT_WWW_API_PROXY_URL="${ROWBOAT_WWW_API_PROXY_URL%/}"
ROWBOAT_WWW_PORT="${ROWBOAT_WWW_PORT:-${ROWBOATX_PORT:-8080}}"

cat > /tmp/config.js <<EOF
window.config = {
  apiBase: "${ROWBOAT_WWW_PUBLIC_API_BASE_URL}"
};
EOF

cat > /tmp/nginx.conf <<EOF
worker_processes auto;
pid /tmp/nginx.pid;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /dev/stdout;
  error_log /dev/stderr warn;
  sendfile on;
  keepalive_timeout 65;
  server_tokens off;

  client_body_temp_path /tmp/client_temp;
  proxy_temp_path /tmp/proxy_temp;
  fastcgi_temp_path /tmp/fastcgi_temp;
  uwsgi_temp_path /tmp/uwsgi_temp;
  scgi_temp_path /tmp/scgi_temp;

  server {
    listen ${ROWBOAT_WWW_PORT};
    absolute_redirect off;
    root /usr/share/nginx/html;
    index index.html;

    location = /healthz {
      add_header Content-Type text/plain;
      return 200 "ok\n";
    }

    location = /readyz {
      add_header Content-Type text/plain;
      return 200 "ok\n";
    }

    location = /config.js {
      root /tmp;
      add_header Cache-Control "no-store";
      try_files /config.js =404;
    }

    location /api/ {
      proxy_http_version 1.1;
      proxy_ssl_server_name on;
      proxy_set_header Host \$proxy_host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_pass ${ROWBOAT_WWW_API_PROXY_URL};
    }

    location /_next/static/ {
      add_header Cache-Control "public, max-age=31536000, immutable";
      try_files \$uri =404;
    }

    location / {
      rewrite ^/(.+)/$ /\$1.html break;
      try_files \$uri \$uri.html /index.html;
    }
  }
}
EOF

exec nginx -c /tmp/nginx.conf -g "daemon off;"
