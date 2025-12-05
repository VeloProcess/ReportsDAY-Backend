# API-REDIS

Módulo de cache e persistência temporária com Redis.

## Função

Armazena as ligações recebidas do webhook 55PBX para cálculo de KPIs.

## Estrutura de Dados

### Chaves utilizadas

| Chave | Tipo | Descrição | TTL |
|-------|------|-----------|-----|
| `calls:YYYY-MM-DD` | List | Lista de chamadas do dia | 25 horas |
| `kpis:YYYY-MM-DD` | Hash | KPIs calculados do dia | 25 horas |

## Configuração

No arquivo `.env`:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

## Arquivos

- `config.js` - Configuração de conexão
- `service.js` - Funções de armazenamento e busca

