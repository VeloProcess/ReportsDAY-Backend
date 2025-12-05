# 55SYSTEM - Backend

Backend do sistema de ETL e notificação para relatórios de telefonia.

## 🚀 Deploy no Render

1. Conecte este repositório no [Render](https://render.com)
2. Crie um **Web Service**
3. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Adicione as variáveis de ambiente (Environment Variables)

## ⚙️ Variáveis de Ambiente

```env
# Redis (Upstash)
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# API 55PBX
API_55_TOKEN=seu_token_aqui
API_55_USER=seu_usuario

# WhatsApp API
WHATSAPP_API_URL=https://sua-api-baileys.onrender.com
WHATSAPP_DESTINATION=5511999999999

# Horários de disparo (separados por vírgula)
REPORT_TIMES=12:00,18:00
```

## 📁 Estrutura

```
55SYSTEM/
├── CORE/           # Servidor principal
├── API-55PBX/      # Integração 55PBX
├── API-REDIS/      # Cache Redis
├── API-WHATSAPP/   # Envio WhatsApp
├── package.json
└── .env
```

## 🔧 Rodar Localmente

```bash
npm install
npm start
```

Servidor roda em: `http://localhost:3000`

---
**55SYSTEM** © 2024

