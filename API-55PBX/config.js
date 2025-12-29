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
  username: process.env.API_55_USERNAME || '',
  password: process.env.API_55_PASSWORD || process.env.API_55_TOKEN || '',
  
  // Token (usado também como senha) - OBRIGATÓRIO via .env
  token: process.env.API_55_TOKEN || '',
  
  // Timezone Brasil
  timezone: '-3',
  
  // Filtros padrão
  defaultFilters: {
    queue: 'all_queues',
    number: 'all_numbers',
    agent: 'all_agent',
    report: 'report_01',
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
