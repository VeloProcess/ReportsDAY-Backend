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

1. **Copie o arquivo de exemplo:**
   ```bash
   cp env.example .env
   ```

2. **Edite o arquivo `.env`** e preencha com suas credenciais reais.

3. **⚠️ IMPORTANTE:** O arquivo `.env` está no `.gitignore` e NUNCA deve ser commitado!

Veja o arquivo `env.example` para a lista completa de variáveis disponíveis.

## 📁 Estrutura

```
55SYSTEM/
├── CORE/           # Servidor principal
├── API-55PBX/      # Integração 55PBX
├── DB-Reports/     # Armazenamento local (JSON)
├── API-WHATSAPP/   # Envio WhatsApp
├── DB.Reports/     # Pasta de dados (criada automaticamente)
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

