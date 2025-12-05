/**
 * API-REDIS - Configurações
 * 
 * Configuração do cliente Redis usando ioredis
 * Suporta Upstash (nuvem) via URL
 */

import dotenv from 'dotenv';
import Redis from 'ioredis';

dotenv.config();

// TTL padrão: 25 horas (90000 segundos)
export const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 90000;

// Cria instância do cliente
let client = null;

/**
 * Obtém ou cria a instância do cliente Redis
 * @returns {Redis} Instância do cliente
 */
export function getClient() {
  if (!client) {
    // Usa REDIS_URL se disponível (Upstash/nuvem)
    if (process.env.REDIS_URL) {
      console.log('🔗 Redis: Conectando via URL (Upstash)...');
      
      client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            console.error('❌ Redis: Máximo de tentativas atingido');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      // Fallback para configuração local
      console.log('🔗 Redis: Conectando localmente...');
      
      const config = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        db: parseInt(process.env.REDIS_DB, 10) || 0,
        maxRetriesPerRequest: 3,
      };
      
      if (process.env.REDIS_PASSWORD) {
        config.password = process.env.REDIS_PASSWORD;
      }
      
      client = new Redis(config);
    }
    
    // Event listeners
    client.on('connect', () => {
      console.log('🔗 Redis: Conectando...');
    });
    
    client.on('ready', () => {
      console.log('✅ Redis: Conectado com sucesso!');
    });
    
    client.on('error', (err) => {
      console.error('❌ Redis: Erro:', err.message);
    });
    
    client.on('close', () => {
      console.log('🔌 Redis: Conexão fechada');
    });
  }
  
  return client;
}

/**
 * Verifica se o Redis está conectado
 * @returns {boolean}
 */
export function isConnected() {
  return client && client.status === 'ready';
}

export default { getClient, isConnected, DEFAULT_TTL };
