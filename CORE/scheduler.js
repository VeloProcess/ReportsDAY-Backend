/**
 * CORE - Scheduler
 * 
 * Agendamento de tarefas com node-cron
 */

import cron from 'node-cron';
import api55Service from '../API-55PBX/service.js';
import whatsappService from '../API-WHATSAPP/service.js';
import websocket from './websocket.js';
import calculationLogger from './calculationLogger.js';

// Armazena os jobs agendados
const jobs = {};

// Histórico de execuções
const executionHistory = [];

// Horários de disparo do relatório (configurável)
// FORÇA os horários corretos: 10:00, 14:00, 17:00, 19:15
let scheduledTimes = ['10:00', '14:00', '17:00', '19:15'];

/**
 * Inicializa os agendamentos
 */
export function initScheduler() {
  console.log('⏰ Scheduler: Inicializando...');
  
  // Horários fixos: 10:00, 14:00, 17:00, 19:15
  const times = [
    { time: '10:00', hour: 10, minute: 0 },
    { time: '14:00', hour: 14, minute: 0 },
    { time: '17:00', hour: 17, minute: 0 },
    { time: '19:15', hour: 19, minute: 15 }
  ];
  
  // Agenda disparo do relatório nos horários configurados
  times.forEach(({ time, hour, minute }) => {
    const cronExpression = `${minute} ${hour} * * *`; // Diariamente no horário
    
    jobs[`report_${time}`] = cron.schedule(cronExpression, async () => {
      console.log(`⏰ Scheduler: Executando relatório agendado (${time})`);
      console.log(`📱 Scheduler: Enviando para TODOS os números configurados no .env`);
      await executeReport('automatico');
    }, {
      scheduled: true, // Garante que o job está ativo
      timezone: "America/Sao_Paulo" // Timezone do Brasil
    });
    
    console.log(`   📅 Relatório agendado para ${time} diariamente (ATIVO)`);
  });
  
  // Atualização do D0 a cada hora cheia
  jobs['d0_update'] = cron.schedule('0 * * * *', async () => {
    console.log('⏰ Scheduler: Atualizando KPIs D0...');
    await updateD0();
  }, {
    scheduled: true, // Garante que o job está ativo
    timezone: "America/Sao_Paulo" // Timezone do Brasil
  });
  
  console.log('✅ Scheduler: Agendamentos configurados');
}

/**
 * Executa o envio do relatório
 * @param {string} tipo - Tipo de acionamento ('manual' ou 'automatico')
 * @returns {Promise<Object>} Resultado da execução
 */
export async function executeReport(tipo = 'automatico') {
  const startTime = Date.now();
  
  try {
    websocket.broadcastLog('Iniciando geração do relatório...', 'info');
    
    // 1. Calcula KPIs do dia
    const kpis = await api55Service.calculateDayKPIs();
    websocket.broadcastLog(`KPIs calculados: ${kpis.totalCalls} chamadas`, 'info');
    
    // 2. Busca análise histórica (15 dias)
    websocket.broadcastLog('Buscando análise histórica (15 dias)...', 'info');
    const analise = await api55Service.analisarDiaAtual();
    
    // Log detalhado da análise
    console.log('📊 Análise recebida:', {
      existe: !!analise,
      temAnalise: !!(analise && analise.analise),
      temEscalonada: !!(analise && analise.escalonada),
      escalonadaKeys: analise && analise.escalonada ? Object.keys(analise.escalonada) : null
    });
    
    if (!analise) {
      websocket.broadcastLog('⚠️ Análise histórica não disponível, enviando apenas KPIs do dia', 'warning');
      console.log('⚠️ Análise é null - não será possível mostrar comparativo');
    } else if (!analise.escalonada) {
      websocket.broadcastLog('⚠️ Análise escalonada não disponível, enviando apenas KPIs do dia', 'warning');
      console.log('⚠️ Análise escalonada é null - não será possível mostrar comparativo');
    } else {
      console.log('✅ Análise escalonada disponível - será usado formato completo com comparativo');
    }
    
    // 3. Envia via WhatsApp (passa os KPIs + análise)
    // ⚠️ IMPORTANTE: sendRelatorio já envia para TODOS os números do .env automaticamente
    console.log('📱 Iniciando envio via WhatsApp...');
    console.log('📱 Enviando para TODOS os números configurados no WHATSAPP_DESTINATION');
    websocket.broadcastLog('Enviando relatório via WhatsApp...', 'info');
    const result = await whatsappService.sendRelatorio(kpis, analise);
    console.log('📱 Resultado do envio:', result);
    if (result.enviados !== undefined) {
      console.log(`📱 ✅ Enviado para ${result.enviados} de ${result.total} número(s)`);
    }
    
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
    
    // 5. Salva JSON com cálculos utilizados
    try {
      const jsonPath = await calculationLogger.logCalculation({
        tipo: tipo,
        kpis: kpis,
        analise: analise,
        result: result,
        duration: elapsed,
      });
      if (jsonPath) {
        websocket.broadcastLog(`📄 Cálculos salvos em: ${jsonPath}`, 'info');
      }
    } catch (logError) {
      console.error('⚠️ Erro ao salvar JSON de cálculo:', logError.message);
      // Não interrompe o fluxo principal
    }
    
    if (result.success) {
      websocket.broadcastLog(`Relatório enviado com sucesso! (${elapsed}ms)`, 'success');
      websocket.broadcast({ type: 'execution_complete', payload: execution });
    } else {
      websocket.broadcastLog(`Erro ao enviar: ${result.error}`, 'error');
      websocket.broadcast({ type: 'execution_error', payload: execution });
    }
    
    return execution;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const execution = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message,
      duration: elapsed,
    };
    
    addToHistory(execution);
    
    // Tenta salvar JSON mesmo em caso de erro (com dados parciais)
    try {
      await calculationLogger.logCalculation({
        tipo: tipo,
        kpis: null,
        analise: null,
        result: { success: false, error: error.message },
        duration: elapsed,
      });
    } catch (logError) {
      // Ignora erro de log
    }
    
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
 * ⚠️ IMPORTANTE: Usa timezone America/Sao_Paulo para calcular corretamente
 * @returns {Date|null} Próximo disparo
 */
export function getNextRun() {
  // ⚠️ CRÍTICO: Converte para timezone do Brasil (America/Sao_Paulo)
  // O Render roda em UTC, então precisamos converter para horário de Brasília
  const now = new Date();
  
  // Converte para horário de Brasília
  // UTC-3 (horário de Brasília)
  const brasiliaOffset = -3 * 60; // -180 minutos
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const brasiliaTime = new Date(utcTime + (brasiliaOffset * 60000));
  
  // Cria data de hoje em Brasília às 00:00:00
  const today = new Date(brasiliaTime.getFullYear(), brasiliaTime.getMonth(), brasiliaTime.getDate(), 0, 0, 0, 0);
  
  // Horários fixos: 10:00, 14:00, 17:00, 19:15 (horário de Brasília)
  const times = [
    { hour: 10, minute: 0 },
    { hour: 14, minute: 0 },
    { hour: 17, minute: 0 },
    { hour: 19, minute: 15 }
  ];
  
  // Pega hora e minuto atual em Brasília
  const currentHour = brasiliaTime.getHours();
  const currentMinute = brasiliaTime.getMinutes();
  
  console.log(`   ⏰ getNextRun: Hora atual em Brasília: ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);
  console.log(`   ⏰ getNextRun: Procurando próximo agendamento entre: ${times.map(t => `${t.hour}:${t.minute.toString().padStart(2, '0')}`).join(', ')}`);
  
  // Encontra o próximo horário de hoje
  for (const { hour, minute } of times) {
    // Compara diretamente hora e minuto
    if (hour > currentHour || (hour === currentHour && minute > currentMinute)) {
      const scheduled = new Date(today);
      scheduled.setHours(hour, minute, 0, 0);
      
      // Converte de volta para UTC para retornar
      const scheduledUTC = new Date(scheduled.getTime() - (brasiliaOffset * 60000));
      
      console.log(`   ✅ getNextRun: Próximo agendamento encontrado: ${hour}:${minute.toString().padStart(2, '0')} (hoje)`);
      console.log(`   📅 getNextRun: Data retornada: ${scheduledUTC.toISOString()} (${scheduledUTC.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`);
      
      return scheduledUTC;
    }
  }
  
  // Se todos já passaram, retorna o primeiro de amanhã (10:00)
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  
  // Converte de volta para UTC
  const tomorrowUTC = new Date(tomorrow.getTime() - (brasiliaOffset * 60000));
  
  console.log(`   ⚠️ getNextRun: Todos os horários de hoje já passaram, retornando primeiro de amanhã: 10:00`);
  console.log(`   📅 getNextRun: Data retornada: ${tomorrowUTC.toISOString()} (${tomorrowUTC.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`);
  
  return tomorrowUTC;
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

