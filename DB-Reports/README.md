# DB-Reports

Sistema de armazenamento local usando arquivos JSON.

## Descrição

Este módulo substitui o Redis, armazenando dados de chamadas em arquivos JSON na pasta `DB.Reports`.

## Estrutura de Arquivos

```
DB.Reports/
├── calls-YYYY-MM-DD.json    # Lista de chamadas do dia
└── metadata-YYYY-MM-DD.json # Metadados (TTL, etc)
```

## Funcionalidades

- Armazenamento persistente em arquivos JSON
- TTL automático (25 horas por padrão)
- Limpeza automática de arquivos expirados
- Mesma interface do Redis (compatibilidade)

## Uso

O serviço é usado automaticamente pelo sistema. Não requer configuração adicional.

## Limpeza

Arquivos expirados são removidos automaticamente ao verificar o cache. Você também pode limpar manualmente removendo arquivos antigos da pasta.

