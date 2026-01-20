/**
 * Logger de Requisições e Cálculos da API 55PBX
 * Salva todas as requisições, dados captados, cálculos e resultados em JSON
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { format } from 'date-fns';
import { join } from 'path';

// Salva na raiz do projeto (C:\Users\gabri\Desktop\Reports day)
// process.cwd() retorna BACKEND/ReportsDAY-Backend-main, então sobe 2 níveis
const LOG_DIR = join(process.cwd(), 'api-logs');
const LOG_FILE = join(process.cwd(), '..', '..', 'api-requests-log.json');

// Estrutura do log
let logData = {
  ultimaAtualizacao: null,
  totalRequisicoes: 0,
  requisicoes: []
};

/**
 * Inicializa o logger
 */
export async function initLogger() {
  try {
    // Cria diretório se não existir
    if (!existsSync(LOG_DIR)) {
      await mkdir(LOG_DIR, { recursive: true });
    }
    
    // Carrega log existente se houver
    if (existsSync(LOG_FILE)) {
      const fs = await import('fs/promises');
      const data = await fs.readFile(LOG_FILE, 'utf-8');
      logData = JSON.parse(data);
    }
    
    console.log('📝 API Logger inicializado');
  } catch (error) {
    console.error('❌ Erro ao inicializar logger:', error.message);
  }
}

/**
 * Registra uma requisição à API
 */
export async function logRequest(requestData) {
  try {
    const timestamp = new Date();
    
    // Se já tem ID, atualiza a requisição existente
    if (requestData.id) {
      const existingRequest = logData.requisicoes.find(r => r.id === requestData.id);
      if (existingRequest) {
        // Atualiza campos fornecidos
        if (requestData.url) existingRequest.url = requestData.url;
        if (requestData.metodo) existingRequest.metodo = requestData.metodo;
        if (requestData.parametros) existingRequest.parametros = { ...existingRequest.parametros, ...requestData.parametros };
        if (requestData.dadosRetornados !== undefined) existingRequest.dadosRetornados = requestData.dadosRetornados;
        if (requestData.statusHTTP !== undefined) existingRequest.statusHTTP = requestData.statusHTTP;
        if (requestData.erro !== undefined) existingRequest.erro = requestData.erro;
        if (requestData.resultado !== undefined) existingRequest.resultado = requestData.resultado;
        
        existingRequest.ultimaAtualizacao = timestamp.toISOString();
        logData.ultimaAtualizacao = timestamp.toISOString();
        await saveLog();
        return requestData.id;
      }
    }
    
    // Cria nova requisição
    const id = `req_${format(timestamp, 'yyyyMMdd_HHmmss')}_${logData.totalRequisicoes + 1}`;
    
    const logEntry = {
      id: id,
      timestamp: timestamp.toISOString(),
      timestampFormatado: format(timestamp, 'dd/MM/yyyy HH:mm:ss'),
      tipo: requestData.tipo || 'desconhecido',
      url: requestData.url || null,
      metodo: requestData.metodo || 'GET',
      parametros: requestData.parametros || {},
      dadosRetornados: requestData.dadosRetornados || null,
      statusHTTP: requestData.statusHTTP || null,
      erro: requestData.erro || null,
      calculos: requestData.calculos || [],
      resultado: requestData.resultado || null
    };
    
    logData.requisicoes.push(logEntry);
    logData.totalRequisicoes++;
    logData.ultimaAtualizacao = timestamp.toISOString();
    
    // Mantém apenas as últimas 100 requisições
    if (logData.requisicoes.length > 100) {
      logData.requisicoes = logData.requisicoes.slice(-100);
    }
    
    // Salva no arquivo
    await saveLog();
    
    return id;
  } catch (error) {
    console.error('❌ Erro ao registrar requisição:', error.message);
    return null;
  }
}

/**
 * Adiciona cálculos a uma requisição existente
 */
export async function addCalculations(requestId, calculations) {
  try {
    const request = logData.requisicoes.find(r => r.id === requestId);
    if (request) {
      if (!request.calculos) {
        request.calculos = [];
      }
      request.calculos.push(...calculations);
      await saveLog();
    }
  } catch (error) {
    console.error('❌ Erro ao adicionar cálculos:', error.message);
  }
}

/**
 * Atualiza o resultado de uma requisição
 */
export async function updateResult(requestId, resultado) {
  try {
    const request = logData.requisicoes.find(r => r.id === requestId);
    if (request) {
      request.resultado = resultado;
      await saveLog();
    }
  } catch (error) {
    console.error('❌ Erro ao atualizar resultado:', error.message);
  }
}

/**
 * Salva o log no arquivo
 */
async function saveLog() {
  try {
    await writeFile(LOG_FILE, JSON.stringify(logData, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ Erro ao salvar log:', error.message);
  }
}

/**
 * Obtém o log completo
 */
export function getLog() {
  return logData;
}

/**
 * Limpa o log (mantém apenas estrutura)
 */
export async function clearLog() {
  logData = {
    ultimaAtualizacao: new Date().toISOString(),
    totalRequisicoes: 0,
    requisicoes: []
  };
  await saveLog();
}

