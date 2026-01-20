# 🚀 Guia Completo: Deploy no Render

## ✅ Status Atual

- ✅ Repositório Git criado: `https://github.com/VeloProcess/ReportsDAY-Backend.git`
- ✅ Código commitado e enviado
- ✅ `render.yaml` configurado
- ✅ Código compatível com Render (usa `process.env.PORT`)

## 📋 Passo a Passo no Render

### 1. Acessar Render e Criar Novo Serviço

1. Acesse https://render.com e faça login
2. Clique em **"New +"** no canto superior direito
3. Selecione **"Web Service"**

### 2. Conectar Repositório GitHub

1. Clique em **"Connect GitHub"** (se ainda não conectou)
2. Autorize o Render a acessar seus repositórios
3. Selecione o repositório: **`VeloProcess/ReportsDAY-Backend`**
4. Clique em **"Connect"**

### 3. Configurar Serviço Web

Preencha os seguintes campos:

| Campo | Valor |
|-------|-------|
| **Name** | `reportsday-backend` |
| **Environment** | `Node` |
| **Region** | `São Paulo (Brazil)` ou mais próxima |
| **Branch** | `main` |
| **Root Directory** | (deixe vazio) |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | `Free` (pode dormir) ou `Starter` ($7/mês - sempre online) |

### 4. Configurar Health Check

- **Health Check Path**: `/health`
- **Auto-Deploy**: ✅ Habilitar (deploy automático ao fazer push)

### 5. Configurar Variáveis de Ambiente

Clique em **"Advanced"** → **"Environment Variables"** e adicione:

#### Variáveis Obrigatórias:

```env
NODE_ENV=production
API_55_TOKEN=seu_token_55pbx_aqui
API_55_URL=https://reportapi02.55pbx.com:50500/api/pbx/reports/metrics
WHATSAPP_API_URL=https://baileys-api-relat-rios.onrender.com
WHATSAPP_DESTINATION=5511922048764
```

#### Variáveis Opcionais:

```env
API_55_USERNAME=Gabriel_Validação Ligações
API_55_PASSWORD=
REPORT_TIMES=10:00,14:00,17:00,19:15
```

**⚠️ IMPORTANTE:**
- `PORT` é definido automaticamente pelo Render (não precisa adicionar)
- Para múltiplos números WhatsApp: `WHATSAPP_DESTINATION=5511922048764,5511999999999`
- `REPORT_TIMES` separa horários por vírgula: `10:00,14:00,17:00,19:15`

### 6. Criar Serviço

1. Clique em **"Create Web Service"**
2. Render iniciará o build automaticamente
3. Acompanhe os logs do deploy

### 7. Verificar Deploy

Após o deploy, você receberá uma URL como:
- `https://reportsday-backend.onrender.com`

**Teste os endpoints:**

1. **Health Check:**
   ```
   GET https://reportsday-backend.onrender.com/health
   ```
   Deve retornar: `{"status":"ok","timestamp":"...","uptime":...}`

2. **Status do Sistema:**
   ```
   GET https://reportsday-backend.onrender.com/api/status
   ```

3. **Relatório D0:**
   ```
   GET https://reportsday-backend.onrender.com/api/report/d0
   ```

4. **Trigger Manual:**
   ```
   POST https://reportsday-backend.onrender.com/api/trigger
   ```

## 🔍 Verificar Logs

1. No painel do Render, clique na aba **"Logs"**
2. Verifique se aparecem as mensagens:
   - ✅ `SERVIDOR RODANDO NA PORTA XXXX`
   - ✅ `WebSocket: Servidor inicializado`
   - ✅ `Scheduler: Agendamentos configurados`

## ⚠️ Considerações Importantes

### Plano Free vs Starter

**Plano Free:**
- ✅ Gratuito
- ⚠️ Serviço "dorme" após 15 minutos de inatividade
- ⚠️ Primeira requisição após dormir pode demorar ~30s
- ⚠️ Pode não funcionar bem para agendamentos

**Plano Starter ($7/mês):**
- ✅ Sempre online
- ✅ Ideal para agendamentos automáticos
- ✅ Melhor performance

### Armazenamento

- Arquivos JSON locais (`DB.Reports/`, `calculation-logs/`) serão perdidos ao reiniciar
- Dados históricos podem ser recalculados da API 55PBX
- Para persistência real, considere usar Redis ou banco de dados

### WebSocket

- Render suporta WebSocket em planos pagos
- Plano free pode ter limitações
- Frontend precisa usar URL do Render para conectar

## 🔧 Troubleshooting

### Servidor não inicia

1. Verifique os logs no Render
2. Confirme que todas as variáveis de ambiente estão configuradas
3. Verifique se `package.json` tem o script `start` correto

### Erro de porta

- Render define `PORT` automaticamente
- Código já usa `process.env.PORT || 3005`
- Não adicione `PORT` nas variáveis de ambiente

### API 55PBX não retorna dados

1. Verifique se o token está correto e atualizado
2. Confirme que a URL da API está correta
3. Veja os logs detalhados no Render

### Agendamentos não funcionam

1. Verifique se `REPORT_TIMES` está configurado corretamente
2. Confirme que está usando plano Starter (free pode dormir)
3. Veja os logs para verificar se scheduler inicializou

## 📝 Próximos Passos

Após deploy bem-sucedido:

1. ✅ Testar todos os endpoints
2. ✅ Verificar se agendamentos estão funcionando
3. ✅ Testar envio de WhatsApp
4. ✅ Monitorar logs nas primeiras 24h
5. ✅ Atualizar frontend para usar URL do Render (se necessário)

## 🔗 Links Úteis

- **Render Dashboard**: https://dashboard.render.com
- **Documentação Render**: https://render.com/docs
- **Repositório**: https://github.com/VeloProcess/ReportsDAY-Backend

---

**55SYSTEM** © 2024

