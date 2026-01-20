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
  // Pode ser um número único ou múltiplos separados por vírgula
  destination: process.env.WHATSAPP_DESTINATION || '',
  
  // Lista de números de destino (parseada de WHATSAPP_DESTINATION)
  // ⚠️ IMPORTANTE: Envia para TODOS os números configurados (separados por vírgula)
  destinations: process.env.WHATSAPP_DESTINATION 
    ? process.env.WHATSAPP_DESTINATION.split(',').map(n => n.trim()).filter(n => n)
    : [],
  
  // Endpoints da API
  endpoints: {
    status: '/status',
    grupos: '/grupos',
    enviar: '/enviar',
    enviarRelatorio: '/enviar-relatorio',
    enviarRelatorioTodos: '/enviar-relatorio-todos',
  },
  
  // Timeout para requisições (ms) - 120s para dar tempo suficiente para API responder
  timeout: 120000,
};

// ⚠️ LOG: Mostra quantos números foram carregados do .env
if (config.destinations.length > 0) {
  console.log(`📱 WhatsApp: ${config.destinations.length} número(s) configurado(s): ${config.destinations.join(', ')}`);
  console.log(`📱 ⚠️ IMPORTANTE: Relatórios serão enviados para TODOS os números configurados`);
} else {
  console.warn('⚠️ WhatsApp: Nenhum número configurado no WHATSAPP_DESTINATION');
}

/**
 * Verifica se a API está configurada
 * @returns {boolean}
 */
export function isConfigured() {
  return !!(config.apiUrl && (config.destination || config.destinations.length > 0));
}

export default config;
