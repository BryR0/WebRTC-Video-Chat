# 🎥 WebRTC Video Chat

Proyecto de videollamadas P2P con WebRTC, Socket.IO y diseño mobile-first.

## 🚀 Uso

### Option 1: Node.js (Recomendado)
```bash
npm install
node server.js
```

### Option 2: Python
```bash
pip install Flask Flask-SocketIO python-socketio eventlet pyOpenSSL
python3 server.py
```

Abre: `https://localhost:3030`

---

## 📦 Requisitos

- **Node.js** 16+ o **Python** 3.8+
- **OpenSSL** (para generar certificados)

---

## 🔐 Generar Certificados SSL

WebRTC requiere HTTPS. Genera certificados locales:

```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem \
  -out cert.pem \
  -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Org/CN=localhost"
```

> ⚠️ Al abrir la app, el navegador mostrará advertencia de seguridad. Click en "Avanzado" → "Continuar de todos modos".

---

## ⚙️ Servidor TURN/STUN (Opcional)

Solo necesario para conexiones a través de Internet con NAT estricto.

### Instalación rápida (coturn):

```bash
# Instalar
sudo apt-get install coturn

# Configurar
sudo nano /etc/turnserver.conf
```

Configuración mínima:
```conf
listening-port=3478
external-ip=YOUR_PUBLIC_IP
realm=localhost
user=webrtc:webrtc123
```

```bash
# Iniciar
sudo systemctl start coturn
```

---

## ✨ Características

- 📹 Video/Audio P2P
- 💬 Chat en tiempo real
- 📱 UI mobile optimizada
- 🔄 Auto-rejoin
- 📤 Compartir archivos
- 🌓 Dark/Light mode

---

## 📁 Estructura

```
webRTC/
├── public/          # Frontend (HTML/CSS/JS)
├── server.js        # Servidor Node.js
├── server.py        # Servidor Python (equivalente)
├── key.pem          # Clave privada SSL
└── cert.pem         # Certificado SSL
```

---

## 📄 Licencia

MIT
