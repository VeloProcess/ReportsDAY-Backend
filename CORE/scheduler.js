/**
 * CORE - Scheduler
 * 
 * Agendamento de tarefas com node-cron
 */

import cron from 'node-cron';
import api55Service from '../API-55PBX/service.js';
import whatsappService from '../API-WHATSAPP/service.js';
import websocket from './websocket.js';

// Armazena os jobs agendados
const jobs = {};

// Histórico de execuções
const executionHistory = [];

// Horários de disparo do relatório (configurável)
let scheduledTimes = process.env.REPORT_TIMES 
  ? process.env.REPORT_TIMES.split(',').map(t => t.trim())
  : ['18:00']; // Padrão: 18:00

/**
 * Inicializa os agendamentos
 */
export function initScheduler() {
  console.log('⏰ Scheduler: Inicializando...');
  
  // Agenda disparo do relatório nos horários configurados
  scheduledTimes.forEach(time => {
    const [hour, minute] = time.split(':');
    const cronExpression = `${minute || '0'} ${hour} * * *`; // Diariamente no horário
    
    jobs[`report_${time}`] = cron.schedule(cronExpression, async () => {
      console.log(`⏰ Scheduler: Executando relatório agendado (${time})`);
      await executeReport();
    });
    
    console.log(`   📅 Relatório agendado para ${time} diariamente`);
  });
  
  // Atualização do D0 a cada hora cheia
  jobs['d0_update'] = cron.schedule('0 * * * *', async () => {
    console.log('⏰ Scheduler: Atualizando KPIs D0...');
    await updateD0();
  });
  
  console.log('✅ Scheduler: Agendamentos configurados');
}

/**
 * Executa o envio do relatório
 * @returns {Promise<Object>} Resultado da execução
 */
export async function executeReport() {
  const startTime = Date.now();
  
  try {
    websocket.broadcastLog('Iniciando geração do relatório...', 'info');
    
    // 1. Calcula KPIs do dia
    const kpis = await api55Service.calculateDayKPIs();
    websocket.broadcastLog(`KPIs calculados: ${kpis.totalCalls} chamadas`, 'info');
    
    // 2. Busca análise histórica (15 dias)
    websocket.broadcastLog('Buscando análise histórica (15 dias)...', 'info');
    const analise = await api55Service.analisarDiaAtual();
    
    // 3. Envia via WhatsApp (passa os KPIs + análise)
    const result = await whatsappService.sendRelatorio(kpis, analise);
    
    const elapsed = Date.now() - startTime;
    
    // 4. Registra no histórico
    const execution = {
      timestamp: new Date().toISOString(),
      success: result.success,
      kpis,
      duration: elapsed,
      messageId: result.messageId,
      error: result.error,
    };
    
    addToHistory(execution);
    
    if (result.success) {
      websocket.broadcastLog(`Relatório enviado com sucesso! (${elapsed}ms)`, 'success');
      websocket.broadcast({ type: 'execution_complete', payload: execution });
    } else {
      websocket.broadcastLog(`Erro ao enviar: ${result.error}`, 'error');
      websocket.broadcast({ type: 'execution_error', payload: execution });
    }
    
    return execution;
    
  } catch (error) {
    const execution = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
    
    addToHistory(execution);
    websocket.broadcastLog(`Erro na execução: ${error.message}`, 'error');
    websocket.broadcast({ type: 'execution_error', payload: execution });
    
    return execution;
  }
}

/**
 * Atualiza os KPIs D0 e envia para o painel
 */
async function updateD0() {
  try {
    const kpis = await api55Service.calculateDayKPIs();
    websocket.sendD0Update(kpis);
    websocket.broadcastLog('KPIs D0 atualizados', 'info');
  } catch (error) {
    console.error('Scheduler: Erro ao atualizar D0:', error.message);
  }
}

/**
 * Adiciona execução ao histórico
 * @param {Object} execution - Dados da execução
 */
function addToHistory(execution) {
  executionHistory.unshift(execution); // Adiciona no início
  
  // Mantém apenas as últimas 50 execuções
  if (executionHistory.length > 50) {
    executionHistory.pop();
  }
}

/**
 * Retorna o histórico de execuções
 * @returns {Array} Histórico
 */
export function getHistory() {
  return executionHistory;
}

/**
 * Retorna o próximo horário de disparo
 * @returns {Date|null} Próximo disparo
 */
export function getNextRun() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Encontra o próximo horário
  for (const time of scheduledTimes.sort()) {
    const [hour, minute] = time.split(':').map(Number);
    const scheduled = new Date(today);
    scheduled.setHours(hour, minute || 0, 0, 0);
    
    if (scheduled > now) {
      return scheduled;
    }
  }
  
  // Se todos já passaram, retorna o primeiro de amanhã
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [hour, minute] = scheduledTimes[0].split(':').map(Number);
  tomorrow.setHours(hour, minute || 0, 0, 0);
  
  return tomorrow;
}

/**
 * Atualiza os horários de disparo
 * @param {Array<string>} times - Novos horários
 */
export function setScheduledTimes(times) {
  scheduledTimes = times;
  
  // Cancela jobs antigos e recria
  Object.values(jobs).forEach(job => job.stop());
  initScheduler();
}

/**
 * Para todos os agendamentos
 */
export function stopAll() {
  Object.values(jobs).forEach(job => job.stop());
  console.log('⏰ Scheduler: Todos os agendamentos parados');
}

export default {
  initScheduler,
  executeReport,
  getHistory,
  getNextRun,
  setScheduledTimes,
  stopAll,
};

