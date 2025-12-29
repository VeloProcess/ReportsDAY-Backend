/**
 * API-WHATSAPP - Configurações
 * 
 * Configurações para integração com a API Baileys
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // URL base da API Baileys
  apiUrl: process.env.WHATSAPP_API_URL || 'https://baileys-api-relat-rios.onrender.com',
  
  // Número de destino para relatórios - OBRIGATÓRIO via .env
  destination: process.env.WHATSAPP_DESTINATION || '',
  
  // Endpoints da API
  endpoints: {
    status: '/status',
    grupos: '/grupos',
    enviar: '/enviar',
    enviarRelatorio: '/enviar-relatorio',
    enviarRelatorioTodos: '/enviar-relatorio-todos',
  },
  
  // Timeout para requisições (ms) - 60s para acordar o Render
  timeout: 60000,
};

/**
 * Verifica se a API está configurada
 * @returns {boolean}
 */
export function isConfigured() {
  return !!(config.apiUrl && config.destination);
}

export default config;
