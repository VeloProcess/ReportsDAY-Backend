# API-WHATSAPP

Módulo de integração com sua API Baileys customizada para envio de mensagens WhatsApp.

## Configuração

Preencha no arquivo `.env`:

```env
# URL da sua API Baileys
WHATSAPP_API_URL=http://sua-api-baileys:porta

# Token de autenticação (se necessário)
WHATSAPP_API_TOKEN=seu_token

# Número de destino padrão para relatórios
WHATSAPP_DESTINATION=5511999999999

# Instance/Session name (se aplicável)
WHATSAPP_INSTANCE=default
```

## Endpoints esperados da sua API

Para integrar, sua API Baileys deve ter:

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/send/text` | Envia mensagem de texto |
| GET | `/status` | Retorna status da conexão |

### Exemplo de payload para envio:

```json
{
  "number": "5511999999999",
  "text": "Sua mensagem aqui"
}
```

## Arquivos

- `config.js` - Configurações da API
- `service.js` - Funções de envio de mensagem

## A fazer

Quando você tiver os detalhes da sua API Baileys customizada:
1. Atualize o `config.js` com a URL e token
2. Ajuste o `service.js` conforme o formato de payload da sua API

