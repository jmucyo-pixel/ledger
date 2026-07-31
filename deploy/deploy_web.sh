#!/usr/bin/env bash


SERVER_LABEL="${1:-web01}"
API_HOST="${2:?Usage: ./deploy_web.sh <server_label> <api_host_ip>}"

if ! command -v nginx >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y nginx
fi

mkdir -p /var/www/ledger
cp -r ./web/* /var/www/ledger/

# Point nginx's default site at our app
cat > /etc/nginx/sites-available/default << EOF
server {
    listen 80 default_server;
    root /var/www/ledger;
    index index.html;

    add_header X-Served-By "${SERVER_LABEL}" always;

    location /api/ {
        proxy_pass http://${API_HOST}:3000/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

service nginx restart

echo "Ledger deployed on ${SERVER_LABEL}, serving from /var/www/ledger, proxying /api/ to ${API_HOST}:3000"
