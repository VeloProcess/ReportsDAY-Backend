# CORE

Núcleo do sistema 55SYSTEM - Orquestrador principal.

## Componentes

- **server.js** - Servidor Express + WebSocket (porta 3000)
- **routes.js** - Rotas da API REST
- **scheduler.js** - Agendamento de tarefas
- **websocket.js** - Gerenciamento de conexões WebSocket

## Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/webhook/55pbx` | Recebe webhooks da 55PBX |
| GET | `/api/status` | Status geral do sistema |
| GET | `/api/report/d0` | KPIs do dia atual |
| GET | `/api/history` | Histórico de execuções |
| POST | `/api/trigger` | Disparo manual do relatório |
| WS | `/ws` | WebSocket para tempo real |

## Executando

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## Porta

O servidor roda na porta **3000** (conforme regra do projeto).

