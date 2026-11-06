#!/bin/bash
# Первая установка nginx и сертификата. Повторный запуск обновляет настройки.
#   sudo bash ops/nginx/setup.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd)
DOMAIN=pelena.space
WWW=www.pelena.space
SERVER_IP=82.202.142.132
CONF=/etc/nginx/conf.d/pelena.conf

echo "== DNS"
for NAME in "$DOMAIN" "$WWW"; do
  for RESOLVER in 8.8.8.8 77.88.8.8; do
    FOUND=$(dig +short "@$RESOLVER" A "$NAME" | tr '\n' ' ' | sed 's/ $//')
    [ "$FOUND" = "$SERVER_IP" ] || { echo "$NAME у $RESOLVER: [$FOUND], ожидается $SERVER_IP. Остановлено."; exit 1; }
  done
done
echo "Оба имени указывают на сервер."

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq --no-install-recommends nginx certbot > /dev/null
rm -f /etc/nginx/sites-enabled/default
install -d -m 755 /var/www/certbot

if [ ! -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "== Временная настройка для выпуска сертификата"
  cat > "$CONF" <<NGINX
server {
    listen 80 default_server;
    server_name $DOMAIN $WWW _;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }
    location / {
        return 404;
    }
}
NGINX
  nginx -t -q
  systemctl enable --now nginx > /dev/null 2>&1
  systemctl reload nginx

  echo "== Сертификат"
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" -d "$WWW" \
    --non-interactive --agree-tos --register-unsafely-without-email
fi

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx <<'HOOK'
#!/bin/bash
systemctl reload nginx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx

echo "== Рабочая настройка"
install -m 644 "$DIR/pelena.conf" "$CONF"
nginx -t -q
systemctl enable --now nginx > /dev/null 2>&1
systemctl reload nginx
systemctl enable --now certbot.timer > /dev/null 2>&1
echo "Готово."
