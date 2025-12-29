/**
 * DB-Reports - Serviço de Armazenamento
 * 
 * Armazena dados em arquivos JSON na pasta DB.Reports
 * Substitui o Redis para armazenamento local
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Caminho da pasta de dados
const DB_PATH = join(__dirname, '..', 'DB.Reports');

// TTL padrão: 25 horas (90000 segundos)
const DEFAULT_TTL = 90000;

/**
 * Garante que a pasta DB.Reports existe
 */
async function ensureDbPath() {
  try {
    await fs.mkdir(DB_PATH, { recursive: true });
  } catch (error) {
    // Pasta já existe ou erro de permissão
  }
}

/**
 * Gera o caminho do arquivo para uma data
 * @param {Date} date - Data de referência
 * @returns {string} Caminho do arquivo
 */
function getCallsFilePath(date = new Date()) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return join(DB_PATH, `calls-${dateStr}.json`);
}

/**
 * Gera o caminho do arquivo de metadados
 * @param {Date} date - Data de referência
 * @returns {string} Caminho do arquivo
 */
function getMetadataFilePath(date = new Date()) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return join(DB_PATH, `metadata-${dateStr}.json`);
}

/**
 * Conecta ao sistema de armazenamento (cria pasta se necessário)
 * @returns {Promise<void>}
 */
export async function connect() {
  await ensureDbPath();
}

/**
 * Desconecta (não faz nada, mas mantém compatibilidade)
 * @returns {Promise<void>}
 */
export async function disconnect() {
  // Não precisa fazer nada para arquivos
}

/**
 * Adiciona uma chamada à lista do dia
 * @param {Object} callData - Dados normalizados da chamada
 * @returns {Promise<boolean>} True se sucesso
 */
export async function addCall(callData) {
  try {
    await ensureDbPath();
    const filePath = getCallsFilePath();
    
    // Lê arquivo existente ou cria novo
    let calls = [];
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      calls = JSON.parse(data);
    } catch (error) {
      // Arquivo não existe, cria novo array
      calls = [];
    }
    
    // Adiciona nova chamada
    calls.push({
      ...callData,
      timestamp: new Date().toISOString(),
    });
    
    // Salva arquivo
    await fs.writeFile(filePath, JSON.stringify(calls, null, 2), 'utf-8');
    
    // Atualiza metadados (TTL)
    await updateMetadata(new Date());
    
    return true;
  } catch (error) {
    console.error('❌ DB-Reports: Erro ao adicionar chamada:', error.message);
    return false;
  }
}

/**
 * Atualiza metadados do arquivo (TTL, etc)
 * @param {Date} date - Data de referência
 */
async function updateMetadata(date) {
  try {
    const metadataPath = getMetadataFilePath(date);
    const metadata = {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + DEFAULT_TTL * 1000).toISOString(),
      ttl: DEFAULT_TTL,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    // Ignora erro de metadados
  }
}

/**
 * Busca todas as chamadas do dia
 * @param {Date} date - Data de referência
 * @returns {Promise<Array>} Lista de chamadas
 */
export async function getTodayCalls(date = new Date()) {
  try {
    const filePath = getCallsFilePath(date);
    
    const data = await fs.readFile(filePath, 'utf-8');
    const calls = JSON.parse(data);
    
    // Filtra chamadas inválidas
    return calls.filter(call => call && typeof call === 'object');
    
  } catch (error) {
    // Arquivo não existe ou erro de leitura
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
    const calls = await getTodayCalls(date);
    return calls.length;
  } catch (error) {
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
    const filePath = getCallsFilePath(date);
    await fs.access(filePath);
    
    // Verifica se não expirou
    const metadataPath = getMetadataFilePath(date);
    try {
      const metadataData = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataData);
      const expiresAt = new Date(metadata.expiresAt);
      
      if (expiresAt < new Date()) {
        // Expirou, remove arquivo
        await fs.unlink(filePath).catch(() => {});
        await fs.unlink(metadataPath).catch(() => {});
        return false;
      }
      
      return true;
    } catch {
      // Sem metadados, assume que existe
      return true;
    }
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
    const metadataPath = getMetadataFilePath(date);
    const metadataData = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataData);
    
    const expiresAt = new Date(metadata.expiresAt);
    const now = new Date();
    const diff = Math.floor((expiresAt - now) / 1000);
    
    return diff > 0 ? diff : -1;
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
    const filePath = getCallsFilePath(date);
    const metadataPath = getMetadataFilePath(date);
    
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(metadataPath).catch(() => {});
    
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Retorna status da conexão
 * @returns {Object} Status do armazenamento
 */
export function getStatus() {
  return {
    connected: true, // Sempre conectado (arquivos locais)
    type: 'file-system',
    path: DB_PATH,
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

