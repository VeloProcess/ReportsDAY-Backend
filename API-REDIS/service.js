/**
 * API-REDIS - Serviço de Cache
 * 
 * Funções para armazenar e recuperar dados do Redis
 */

import { getClient, DEFAULT_TTL, isConnected } from './config.js';
import { format } from 'date-fns';

/**
 * Gera a chave para as chamadas do dia
 * @param {Date} date - Data de referência
 * @returns {string} Chave no formato calls:YYYY-MM-DD
 */
function getCallsKey(date = new Date()) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return `calls:${dateStr}`;
}

/**
 * Conecta ao Redis
 * @returns {Promise<void>}
 */
export async function connect() {
  try {
    const client = getClient();
    if (client.status !== 'ready') {
      await client.connect();
    }
  } catch (error) {
    if (!error.message.includes('already')) {
      throw error;
    }
  }
}

/**
 * Desconecta do Redis
 * @returns {Promise<void>}
 */
export async function disconnect() {
  try {
    const client = getClient();
    await client.quit();
    console.log('👋 Redis: Desconectado');
  } catch (error) {
    console.error('❌ Redis: Erro ao desconectar:', error.message);
  }
}

/**
 * Adiciona uma chamada à lista do dia
 * @param {Object} callData - Dados normalizados da chamada
 * @returns {Promise<boolean>} True se sucesso
 */
export async function addCall(callData) {
  try {
    const client = getClient();
    const key = getCallsKey();
    
    // Adiciona à lista
    await client.rpush(key, JSON.stringify(callData));
    
    // Define TTL se não existir
    const ttl = await client.ttl(key);
    if (ttl < 0) {
      await client.expire(key, DEFAULT_TTL);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Redis: Erro ao adicionar chamada:', error.message);
    return false;
  }
}

/**
 * Busca todas as chamadas do dia
 * @param {Date} date - Data de referência
 * @returns {Promise<Array>} Lista de chamadas
 */
export async function getTodayCalls(date = new Date()) {
  try {
    const client = getClient();
    const key = getCallsKey(date);
    
    const calls = await client.lrange(key, 0, -1);
    
    return calls.map(call => {
      try {
        return JSON.parse(call);
      } catch {
        console.warn('⚠️  Redis: Chamada com formato inválido descartada');
        return null;
      }
    }).filter(Boolean);
    
  } catch (error) {
    console.error('❌ Redis: Erro ao buscar chamadas:', error.message);
    return [];
  }
}

/**
 * Conta as chamadas do dia
 * @param {Date} date - Data de referência
 * @returns {Promise<number>} Quantidade de chamadas
 */
export async function countTodayCalls(date = new Date()) {
  try {
    const client = getClient();
    const key = getCallsKey(date);
    return await client.llen(key);
  } catch (error) {
    console.error('❌ Redis: Erro ao contar chamadas:', error.message);
    return 0;
  }
}

/**
 * Verifica se existe cache para o dia
 * @param {Date} date - Data de referência
 * @returns {Promise<boolean>}
 */
export async function hasCache(date = new Date()) {
  try {
    const client = getClient();
    const key = getCallsKey(date);
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    return false;
  }
}

/**
 * Obtém o TTL restante do cache do dia
 * @param {Date} date - Data de referência
 * @returns {Promise<number>} TTL em segundos ou -1 se não existe
 */
export async function getCacheTTL(date = new Date()) {
  try {
    const client = getClient();
    const key = getCallsKey(date);
    return await client.ttl(key);
  } catch (error) {
    return -1;
  }
}

/**
 * Limpa o cache do dia (para testes)
 * @param {Date} date - Data de referência
 * @returns {Promise<boolean>}
 */
export async function clearCache(date = new Date()) {
  try {
    const client = getClient();
    const key = getCallsKey(date);
    await client.del(key);
    return true;
  } catch (error) {
    console.error('❌ Redis: Erro ao limpar cache:', error.message);
    return false;
  }
}

/**
 * Retorna status da conexão
 * @returns {Object} Status do Redis
 */
export function getStatus() {
  return {
    connected: isConnected(),
  };
}

export default {
  connect,
  disconnect,
  addCall,
  getTodayCalls,
  countTodayCalls,
  hasCache,
  getCacheTTL,
  clearCache,
  getStatus,
};

