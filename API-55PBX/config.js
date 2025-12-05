/**
 * API-55PBX - Configurações
 * 
 * Configurações para integração com a API 55PBX via REST
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // URL base da API 55PBX Reports
  apiUrl: process.env.API_55_URL || 'https://reportapi02.55pbx.com:50500/api/pbx/reports/metrics',
  
  // Credenciais para Basic Auth
  username: process.env.API_55_USERNAME || 'Gabriel_Validação Ligações',
  password: process.env.API_55_PASSWORD || process.env.API_55_TOKEN || '',
  
  // Token (usado também como senha)
  token: process.env.API_55_TOKEN || 'ebd331c1-44b7-4947-aa8f-91e5df9479e3-202581414188',
  
  // Timezone Brasil
  timezone: '-3',
  
  // Filas específicas para filtrar (separadas por vírgula no .env)
  queues: process.env.API_55_QUEUES 
    ? process.env.API_55_QUEUES.split(',').map(q => q.trim())
    : ['4961-CALCULADORA', '4961-IRPF', '4961-CREDITO__P2', '4961-CREDITO_P1'],
  
  // Filtros padrão
  defaultFilters: {
    queue: 'all_queues', // Será sobrescrito pelas filas específicas
    number: 'all_numbers',
    agent: 'all_agent',
    report: 'report_01', // Relatório Macro de ligações
    quiz_id: 'undefined',
    interval: 'undefined',
  },
};

/**
 * Gera os headers de autenticação
 * A API 55PBX usa headers customizados
 * @returns {Object} Headers de autenticação
 */
export function getAuthHeaders() {
  return {
    'key': config.token,
    'Chave': config.token,
  };
}

/**
 * Verifica se a API está configurada
 * @returns {boolean}
 */
export function isConfigured() {
  return !!(config.apiUrl && config.token);
}

export default config;
