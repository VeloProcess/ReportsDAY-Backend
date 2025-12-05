# API-55PBX

Módulo de integração com a API 55PBX via Webhook.

## Como funciona

A 55PBX envia dados de ligações via **webhook (PUSH)** para nosso servidor.
A cada ligação (início e fim), recebemos um POST com os dados.

## Configuração no Painel 55PBX

Acesse: **Configurações → Integrações → Webservice (API)**

| Campo | Valor |
|-------|-------|
| Método | POST |
| URL | `http://seu-servidor:3000/webhook/55pbx` |
| Chave (token) | Seu token de validação |

## Token configurado

```
API_55_TOKEN=ebd331c1-44b7-4947-aa8f-91e5df9479e3-202581414188
```

## Campos recebidos

| Campo | Descrição |
|-------|-----------|
| call_id | ID único da ligação |
| call_date | Data/hora da ligação |
| call_type | ativo/receptivo/sms |
| call_status | Status da ligação |
| call_queue | Fila de atendimento |
| call_ura | Opções escolhidas na URA |
| call_time_waiting | Tempo de espera (segundos) |
| call_duration | Duração total (segundos) |
| call_disconnection | Quem desligou |

## Arquivos

- `config.js` - Configurações e token
- `service.js` - Lógica de processamento dos webhooks

