#!/bin/bash
# =============================================================
#  PROXY AUTO-INSTALLER
#  VLESS+Reality (Xray) + SOCKS5 (Dante) + MTProto (mtg)
#  Ubuntu 22.04 / Debian 12
#  Запуск: sudo bash proxy_install.sh
# =============================================================
set -euo pipefail

# ─── Цвета ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
sep()  { echo -e "${CYAN}$(printf '─%.0s' {1..62})${NC}"; }
SEP()  { echo -e "${CYAN}$(printf '═%.0s' {1..62})${NC}"; }

# ─── Заголовок ────────────────────────────────────────────
clear
SEP
echo -e "${BOLD}  PROXY INSTALLER — VLESS + SOCKS5 (Dante) + MTProto (mtg)${NC}"
SEP
echo ""

# ─── Проверки ─────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Нужен root: sudo bash $0"

. /etc/os-release 2>/dev/null || true
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    warn "Скрипт тестировался на Ubuntu/Debian. Продолжаем на свой риск."
fi

# ─── Порты ────────────────────────────────────────────────
VLESS_PORT=443
SOCKS_PORT=1080
MTP_PORT=8443

# ─── Публичный IP ─────────────────────────────────────────
log "Определяем публичный IP сервера..."
SERVER_IP=""
for svc in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com" "https://ipecho.net/plain"; do
    SERVER_IP=$(curl -s --max-time 6 "$svc" 2>/dev/null | tr -d '[:space:]') && [[ -n "$SERVER_IP" ]] && break
done
[[ -z "$SERVER_IP" ]] && err "Не удалось определить публичный IP. Проверьте интернет."
ok "Публичный IP: ${BOLD}$SERVER_IP${NC}"

# ─── Сетевой интерфейс ────────────────────────────────────
IFACE=$(ip route get 8.8.8.8 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)
[[ -z "$IFACE" ]] && IFACE="eth0"
log "Сетевой интерфейс: ${BOLD}$IFACE${NC}"

# ─── Архитектура ──────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  MTG_ARCH="linux-amd64" ;;
    aarch64) MTG_ARCH="linux-arm64" ;;
    armv7l)  MTG_ARCH="linux-arm"   ;;
    *)       err "Неподдерживаемая архитектура: $ARCH" ;;
esac
log "Архитектура: ${BOLD}$ARCH${NC} → ${BOLD}$MTG_ARCH${NC}"

echo ""
log "Запускаем установку... (займёт 2–5 минут)"
echo ""

# =============================================================
# ЭТАП 1 — БАЗОВЫЕ ПАКЕТЫ
# =============================================================
sep; echo -e "${BOLD}  [1/6] Базовые пакеты${NC}"; sep
apt-get update -qq
apt-get install -y -qq curl ca-certificates unzip wget openssl ufw dante-server 2>&1 | tail -3
ok "Пакеты установлены"

# =============================================================
# ЭТАП 2 — FIREWALL
# =============================================================
sep; echo -e "${BOLD}  [2/6] Firewall (UFW)${NC}"; sep
ufw --force reset > /dev/null 2>&1
ufw default deny incoming  > /dev/null 2>&1
ufw default allow outgoing > /dev/null 2>&1
ufw allow OpenSSH          > /dev/null 2>&1
ufw allow ${VLESS_PORT}/tcp > /dev/null 2>&1
ufw allow ${SOCKS_PORT}/tcp > /dev/null 2>&1
ufw allow ${MTP_PORT}/tcp   > /dev/null 2>&1
ufw --force enable          > /dev/null 2>&1
ok "Порты открыты: ${VLESS_PORT}(VLESS)  ${SOCKS_PORT}(SOCKS5)  ${MTP_PORT}(MTProto)"

# =============================================================
# ЭТАП 3 — DANTE SOCKS5
# =============================================================
sep; echo -e "${BOLD}  [3/6] SOCKS5 — Dante${NC}"; sep

# Генерируем логин/пароль
SOCKS_USER="proxy$(openssl rand -hex 3)"
SOCKS_PASS="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9!@#%' | head -c 22)"

# Системный пользователь
useradd -r -s /sbin/nologin "$SOCKS_USER" 2>/dev/null && log "Создан пользователь: $SOCKS_USER" || warn "Пользователь $SOCKS_USER уже существует"
echo "$SOCKS_USER:$SOCKS_PASS" | chpasswd

# Конфиг Dante
cat > /etc/danted.conf <<EOF
logoutput: syslog

internal: 0.0.0.0 port = ${SOCKS_PORT}
external: ${IFACE}

socksmethod: username
clientmethod: none

user.privileged: root
user.unprivileged: nobody

client pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    log: error
}

socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    socksmethod: username
    log: error
}
EOF

systemctl enable danted > /dev/null 2>&1
systemctl restart danted
sleep 1
systemctl is-active --quiet danted && ok "Dante запущен на :${SOCKS_PORT}" || err "Dante не запустился. Проверьте: journalctl -u danted -n 30"

# =============================================================
# ЭТАП 4 — MTG (MTProto)
# =============================================================
sep; echo -e "${BOLD}  [4/6] MTProto — mtg${NC}"; sep

MTP_FAKE_DOMAIN="www.cloudflare.com"

# Скачиваем последний релиз
log "Скачиваем mtg (архитектура: $MTG_ARCH)..."
MTG_VER=$(curl -s --max-time 10 "https://api.github.com/repos/9seconds/mtg/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
[[ -z "$MTG_VER" ]] && err "Не удалось получить версию mtg с GitHub"
log "mtg версия: $MTG_VER"

MTG_VER_NUM="${MTG_VER#v}"
MTG_URL="https://github.com/9seconds/mtg/releases/download/${MTG_VER}/mtg-${MTG_VER_NUM}-${MTG_ARCH}.tar.gz"

wget -q --show-progress -O /tmp/mtg.tar.gz "$MTG_URL" 2>&1 | tail -1 || \
    err "Не удалось скачать mtg с: $MTG_URL"

tar -xzf /tmp/mtg.tar.gz -C /tmp/
# Ищем бинарник в разных местах архива
MTG_BIN=$(find /tmp -maxdepth 3 -name "mtg" -type f 2>/dev/null | head -1)
[[ -z "$MTG_BIN" ]] && err "Бинарник mtg не найден в архиве"
mv "$MTG_BIN" /usr/local/bin/mtg
chmod +x /usr/local/bin/mtg
rm -rf /tmp/mtg.tar.gz /tmp/mtg-*
ok "mtg установлен: $(/usr/local/bin/mtg --version 2>&1 | head -1)"

# Генерируем секрет
MTP_SECRET=$(/usr/local/bin/mtg generate-secret "$MTP_FAKE_DOMAIN" 2>/dev/null | tr -d '[:space:]')
[[ -z "$MTP_SECRET" ]] && err "Не удалось сгенерировать секрет MTProto"
ok "Секрет MTProto сгенерирован"

# Systemd-сервис
cat > /etc/systemd/system/mtg.service <<EOF
[Unit]
Description=MTG — MTProto Proxy for Telegram
After=network.target

[Service]
ExecStart=/usr/local/bin/mtg simple-run -n 0.0.0.0:${MTP_PORT} ${MTP_SECRET}
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mtg > /dev/null 2>&1
systemctl start mtg
sleep 1
systemctl is-active --quiet mtg && ok "mtg запущен на :${MTP_PORT}" || err "mtg не запустился. Проверьте: journalctl -u mtg -n 30"

# =============================================================
# ЭТАП 5 — XRAY VLESS + REALITY
# =============================================================
sep; echo -e "${BOLD}  [5/6] VLESS+Reality — Xray${NC}"; sep

log "Устанавливаем Xray..."
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install > /dev/null 2>&1
ok "Xray установлен: $(xray version | head -1)"

# Генерируем UUID и Reality-ключи
VLESS_UUID=$(xray uuid)
REALITY_STEAL="www.microsoft.com"

KEYPAIR=$(xray x25519 2>/dev/null)
REALITY_PRIVATE=$(echo "$KEYPAIR" | grep -i "private" | awk '{print $NF}')
REALITY_PUBLIC=$(echo "$KEYPAIR" | grep -i "public"  | awk '{print $NF}')
REALITY_SID=$(openssl rand -hex 8)

[[ -z "$REALITY_PRIVATE" || -z "$REALITY_PUBLIC" ]] && err "Не удалось сгенерировать ключи Reality"
ok "UUID, ключи Reality сгенерированы"

# Конфиг Xray
cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${VLESS_PORT},
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "${VLESS_UUID}",
            "flow": "xtls-rprx-vision"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${REALITY_STEAL}:443",
          "xver": 0,
          "serverNames": ["${REALITY_STEAL}", "microsoft.com"],
          "privateKey": "${REALITY_PRIVATE}",
          "shortIds": ["${REALITY_SID}", ""]
        }
      },
      "tag": "in-vless"
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" }
  ]
}
EOF

# Проверка конфига
xray run -test -c /usr/local/etc/xray/config.json > /dev/null 2>&1 || err "Конфиг Xray невалиден. Проверьте: xray run -test -c /usr/local/etc/xray/config.json"

systemctl enable xray > /dev/null 2>&1
systemctl restart xray
sleep 2
systemctl is-active --quiet xray && ok "Xray (VLESS+Reality) запущен на :${VLESS_PORT}" || err "Xray не запустился. Проверьте: journalctl -u xray -n 30"

# =============================================================
# ЭТАП 6 — ПРОВЕРКА ПОРТОВ
# =============================================================
sep; echo -e "${BOLD}  [6/6] Проверка сервисов${NC}"; sep

sleep 2
check_port() {
    ss -tlnp 2>/dev/null | grep -q ":$1 " \
        && ok "Порт ${BOLD}$1${NC} слушает ($2)" \
        || warn "Порт $1 НЕ слушает ($2) — проверьте: journalctl -u $3 -n 20"
}
check_port "$VLESS_PORT" "VLESS"  "xray"
check_port "$SOCKS_PORT" "SOCKS5" "danted"
check_port "$MTP_PORT"   "MTProto" "mtg"

# Статус сервисов
echo ""
for svc in xray danted mtg; do
    if systemctl is-active --quiet "$svc"; then
        ok "Сервис ${BOLD}$svc${NC} активен"
    else
        warn "Сервис ${BOLD}$svc${NC} НЕ активен"
    fi
done

# =============================================================
# ФОРМИРУЕМ ССЫЛКИ
# =============================================================
VLESS_URL="vless://${VLESS_UUID}@${SERVER_IP}:${VLESS_PORT}?encryption=none&security=reality&sni=${REALITY_STEAL}&fp=chrome&pbk=${REALITY_PUBLIC}&sid=${REALITY_SID}&flow=xtls-rprx-vision&type=tcp#VLESS-Reality-${SERVER_IP}"
MTP_LINK="tg://proxy?server=${SERVER_IP}&port=${MTP_PORT}&secret=${MTP_SECRET}"
SOCKS_CURL="curl --proxy socks5h://${SOCKS_USER}:${SOCKS_PASS}@127.0.0.1:${SOCKS_PORT} https://ifconfig.me"

# =============================================================
# ВЫВОД ИТОГОВЫХ ДАННЫХ
# =============================================================
echo ""
SEP
echo -e "${BOLD}${GREEN}  ✓  УСТАНОВКА ЗАВЕРШЕНА — ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ${NC}"
SEP

# ── VLESS ──
echo ""
echo -e "${BOLD}${CYAN}  ┌─ 1. VLESS + Reality (Xray)  — порт ${VLESS_PORT}${NC}"
echo -e "  │  Сервер:         ${SERVER_IP}"
echo -e "  │  UUID:           ${VLESS_UUID}"
echo -e "  │  Публ. ключ:     ${REALITY_PUBLIC}"
echo -e "  │  Short ID:       ${REALITY_SID}"
echo -e "  │  SNI:            ${REALITY_STEAL}"
echo -e "  │  Flow:           xtls-rprx-vision"
echo -e "  │  Fingerprint:    chrome"
echo -e "  │"
echo -e "  │  ${BOLD}Ссылка (v2rayN / Hiddify / NekoBox / Streisand):${NC}"
echo -e "  └─ ${CYAN}${VLESS_URL}${NC}"

# ── SOCKS5 ──
echo ""
echo -e "${BOLD}${CYAN}  ┌─ 2. SOCKS5 (Dante)  — порт ${SOCKS_PORT}${NC}"
echo -e "  │  Сервер:   ${SERVER_IP}"
echo -e "  │  Порт:     ${SOCKS_PORT}"
echo -e "  │  Логин:    ${SOCKS_USER}"
echo -e "  │  Пароль:   ${SOCKS_PASS}"
echo -e "  │"
echo -e "  │  ${BOLD}Проверка (выполнить на сервере):${NC}"
echo -e "  └─ ${CYAN}${SOCKS_CURL}${NC}"

# ── MTProto ──
echo ""
echo -e "${BOLD}${CYAN}  ┌─ 3. MTProto (mtg)  — порт ${MTP_PORT}${NC}"
echo -e "  │  Сервер:  ${SERVER_IP}"
echo -e "  │  Порт:    ${MTP_PORT}"
echo -e "  │  Секрет:  ${MTP_SECRET}"
echo -e "  │"
echo -e "  │  ${BOLD}Ссылка для Telegram:${NC}"
echo -e "  └─ ${CYAN}${MTP_LINK}${NC}"

# ── Управление ──
echo ""
SEP
echo -e "${BOLD}  УПРАВЛЕНИЕ СЕРВИСАМИ${NC}"
SEP
echo -e "  Статус:      systemctl status xray danted mtg"
echo -e "  Перезапуск:  systemctl restart xray danted mtg"
echo -e "  Логи VLESS:  journalctl -u xray -n 50 --no-pager -f"
echo -e "  Логи SOCKS:  journalctl -u danted -n 50 --no-pager -f"
echo -e "  Логи MTP:    journalctl -u mtg -n 50 --no-pager -f"

# ── Сохраняем данные в файл ──
CREDS_FILE="/root/proxy_credentials.txt"
cat > "$CREDS_FILE" <<CREDS
PROXY CREDENTIALS — $(date '+%Y-%m-%d %H:%M:%S %Z')
================================================================

SERVER IP: ${SERVER_IP}

════════════════════════════════════════
 1. VLESS + Reality (Xray)  — port ${VLESS_PORT}
════════════════════════════════════════
Server:       ${SERVER_IP}
Port:         ${VLESS_PORT}
UUID:         ${VLESS_UUID}
Public key:   ${REALITY_PUBLIC}
Private key:  ${REALITY_PRIVATE}
Short ID:     ${REALITY_SID}
SNI:          ${REALITY_STEAL}
Flow:         xtls-rprx-vision
Fingerprint:  chrome

VLESS URL:
${VLESS_URL}

════════════════════════════════════════
 2. SOCKS5 (Dante)  — port ${SOCKS_PORT}
════════════════════════════════════════
Host:     ${SERVER_IP}
Port:     ${SOCKS_PORT}
User:     ${SOCKS_USER}
Password: ${SOCKS_PASS}

Test command (on server):
${SOCKS_CURL}

════════════════════════════════════════
 3. MTProto (mtg)  — port ${MTP_PORT}
════════════════════════════════════════
Host:   ${SERVER_IP}
Port:   ${MTP_PORT}
Secret: ${MTP_SECRET}

Telegram link:
${MTP_LINK}

================================================================
MANAGE:
  systemctl restart xray danted mtg
  systemctl status  xray danted mtg
  journalctl -u xray   -n 50 --no-pager
  journalctl -u danted -n 50 --no-pager
  journalctl -u mtg    -n 50 --no-pager
================================================================
CREDS

chmod 600 "$CREDS_FILE"

echo ""
SEP
echo -e "  ${GREEN}${BOLD}Данные сохранены:${NC} ${BOLD}${CREDS_FILE}${NC}"
SEP
echo ""
