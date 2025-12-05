/**
 * API-55PBX - Serviço de Consulta
 * 
 * Busca dados de ligações via API REST da 55PBX
 */

import axios from 'axios';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { config, getAuthHeaders, isConfigured } from './config.js';
import redisService from '../API-REDIS/service.js';

// Cria instância do axios
const api = axios.create({
  baseURL: config.apiUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Formata data para o padrão esperado pela API
 * Formato: "Fri May 22 2020 00:00:00 GMT -0300"
 * @param {Date} date - Data a formatar
 * @returns {string} Data formatada e codificada para URL
 */
function formatDateForAPI(date) {
  // A API espera formato como: "Fri May 22 2020 00:00:00 GMT -0300"
  const formatted = date.toUTCString().replace('GMT', 'GMT -0300');
  // Codifica para URL (espaços viram %20)
  return encodeURIComponent(formatted);
}

/**
 * Busca dados de ligações do dia atual
 * 
 * @param {Date} date - Data de referência (padrão: hoje)
 * @returns {Promise<Array>} Lista de ligações
 */
export async function fetchTodayCalls(date = new Date()) {
  if (!isConfigured()) {
    console.warn('⚠️  API-55PBX: Não configurada');
    return [];
  }
  
  try {
    console.log('📡 API-55PBX: Buscando ligações do dia...');
    
    // Define período: início do dia até agora
    const dateStart = startOfDay(date);
    const dateEnd = new Date();
    
    console.log(`   Período: ${dateStart.toLocaleString()} até ${dateEnd.toLocaleString()}`);
    
    // Monta a URL com path params
    // Formato: /{date_start}/{date_end}/{queue}/{number}/{agent}/{report}/{quiz_id}/{timezone}
    const urlPath = [
      formatDateForAPI(dateStart),
      formatDateForAPI(dateEnd),
      config.defaultFilters.queue,
      config.defaultFilters.number,
      config.defaultFilters.agent,
      config.defaultFilters.report,
      config.defaultFilters.quiz_id,
      config.timezone,
    ].join('/');
    
    console.log(`   URL: ${config.apiUrl}/${urlPath}`);
    
    const response = await api.get(`/${urlPath}`, {
      headers: getAuthHeaders(),
    });
    
    const data = response.data;
    
    // Verifica se retornou dados
    if (!data) {
      console.log('   Nenhum dado retornado');
      return [];
    }
    
    // Debug: descomente para ver resposta completa
    // console.log('   📋 Resposta:', JSON.stringify(data, null, 2));
    
    // A resposta pode vir em diferentes formatos
    let calls = [];
    
    if (Array.isArray(data)) {
      calls = data;
    } else if (data.calls) {
      calls = data.calls;
    } else if (data.data) {
      calls = data.data;
    } else if (data.result) {
      calls = Array.isArray(data.result) ? data.result : [data.result];
    } else {
      // Se for um objeto único, considera como resposta agregada
      return data;
    }
    
    console.log(`✅ API-55PBX: ${calls.length} registros obtidos`);
    
    return calls;
    
  } catch (error) {
    console.error('❌ API-55PBX: Erro ao buscar dados:', error.message);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data).substring(0, 500));
    }
    
    return [];
  }
}

/**
 * Classifica o status da chamada
 * @param {Object} callData - Dados da chamada
 * @returns {'answered'|'abandoned'|'retained_ura'|'other'} Classificação
 */
export function classifyCallStatus(callData) {
  // Adaptar conforme o formato real da resposta da API
  const status = (callData.call_status || callData.status || '').toUpperCase();
  const queue = callData.call_queue || callData.queue || '';
  const answered = callData.answered || callData.atendida;
  
  // Se tem flag de atendida
  if (answered === true || answered === 1 || answered === '1') {
    return 'answered';
  }
  
  // Verifica por status textual
  if (status.includes('ANSWERED') || status.includes('ATENDIDA')) {
    return 'answered';
  }
  
  if (status.includes('ABANDONED') || status.includes('ABANDONADA') || status.includes('NO ANSWER')) {
    return 'abandoned';
  }
  
  if (status.includes('URA') || status.includes('IVR') || !queue) {
    return 'retained_ura';
  }
  
  return 'other';
}

/**
 * Calcula os KPIs do dia atual buscando da API
 * @returns {Promise<Object>} KPIs calculados
 */
export async function calculateDayKPIs() {
  try {
    console.log('📊 API-55PBX: Calculando KPIs do dia...');
    
    // Busca dados da API
    const data = await fetchTodayCalls();
    
    // Se não houver dados, retorna zerado
    if (!data || (Array.isArray(data) && data.length === 0)) {
      console.log('   Sem dados para calcular KPIs');
      return {
        totalCalls: 0,
        answered: 0,
        abandoned: 0,
        retainedURA: 0,
        other: 0,
        peakHour: null,
        avgWaitTime: 0,
        lastUpdate: new Date().toISOString(),
      };
    }
    
    // Se a resposta for agregada (Report_01 macro)
    if (!Array.isArray(data)) {
      // Extrai os valores da resposta da API 55PBX
      // APENAS LIGAÇÕES DE ENTRADA (RECEPTIVAS):
      const atendidas = parseInt(data.totalCallAttendedReceptive || 0);  // Atendidas receptivas
      const abandonadas = parseInt(data.totalCallAbandonedQueue || 0);   // Abandonadas na fila
      const retidasURA = parseInt(data.totalCallAbandonedURA || 0);      // Retidas/abandonadas na URA
      
      // Total = soma das 3 categorias (apenas entrada)
      const totalCalls = atendidas + abandonadas + retidasURA;
      
      // Tempo médio de espera (formato "00:00:06" -> segundos)
      let avgWaitTime = 0;
      const waitTimeStr = data.timeMediumWaitingAttendance || '00:00:00';
      const waitParts = waitTimeStr.split(':');
      if (waitParts.length === 3) {
        avgWaitTime = parseInt(waitParts[0]) * 3600 + parseInt(waitParts[1]) * 60 + parseInt(waitParts[2]);
      }
      
      const kpis = {
        totalCalls: totalCalls,
        answered: atendidas,           // Atendidas
        abandoned: abandonadas,         // Abandonadas na fila
        retainedURA: retidasURA,       // Retidas na URA
        other: 0,
        peakHour: null,
        avgWaitTime: avgWaitTime,
        lastUpdate: new Date().toISOString(),
        // Dados extras
        slaAttendance: data.sla_attendance || '0%',
        timeMediumDuration: data.timeMediumDurationCall || '00:00:00',
      };
      
      console.log(`   ✅ KPIs: ${kpis.totalCalls} total | ${kpis.answered} atendidas | ${kpis.abandoned} abandonadas | ${kpis.retainedURA} retidas URA`);
      
      return kpis;
    }
    
    // Se for array de ligações, processa cada uma
    const calls = data;
    let answered = 0;
    let abandoned = 0;
    let retainedURA = 0;
    let other = 0;
    let totalWaitTime = 0;
    const hourCounts = {};
    
    calls.forEach(call => {
      const classification = classifyCallStatus(call);
      
      switch (classification) {
        case 'answered':
          answered++;
          break;
        case 'abandoned':
          abandoned++;
          break;
        case 'retained_ura':
          retainedURA++;
          break;
        default:
          other++;
      }
      
      // Tempo de espera
      const waitTime = parseInt(call.call_time_waiting || call.wait_time || call.tempo_espera || 0);
      totalWaitTime += waitTime;
      
      // Conta por hora
      try {
        const callDate = new Date(call.call_date || call.date || call.data);
        const hour = `${String(callDate.getHours()).padStart(2, '0')}:00`;
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      } catch (e) {
        // Ignora erro de data
      }
    });
    
    // Encontra horário de pico
    let peakHour = null;
    let peakCount = 0;
    Object.entries(hourCounts).forEach(([hour, count]) => {
      if (count > peakCount) {
        peakCount = count;
        peakHour = hour;
      }
    });
    
    // Calcula média de espera
    const avgWaitTime = calls.length > 0 ? Math.round(totalWaitTime / calls.length) : 0;
    
    const kpis = {
      totalCalls: calls.length,
      answered,
      abandoned,
      retainedURA,
      other,
      peakHour: peakHour ? { hour: peakHour, count: peakCount } : null,
      avgWaitTime,
      lastUpdate: new Date().toISOString(),
    };
    
    console.log(`✅ KPIs calculados: ${kpis.totalCalls} ligações, ${kpis.answered} atendidas (${Math.round(kpis.answered/kpis.totalCalls*100)}%)`);
    
    return kpis;
    
  } catch (error) {
    console.error('❌ API-55PBX: Erro ao calcular KPIs:', error.message);
    
    // Retorna zerado em caso de erro
    return {
      totalCalls: 0,
      answered: 0,
      abandoned: 0,
      retainedURA: 0,
      other: 0,
      peakHour: null,
      avgWaitTime: 0,
      lastUpdate: new Date().toISOString(),
      error: error.message,
    };
  }
}

/**
 * Testa a conexão com a API
 * @returns {Promise<boolean>} True se conectou
 */
export async function testConnection() {
  try {
    console.log('🔌 API-55PBX: Testando conexão...');
    
    const response = await api.get('', {
      headers: getAuthHeaders(),
      timeout: 10000,
    });
    
    console.log('✅ API-55PBX: Conexão OK');
    return true;
    
  } catch (error) {
    console.error('❌ API-55PBX: Falha na conexão:', error.message);
    return false;
  }
}

// Mantém compatibilidade com webhook (caso queira usar no futuro)
export function validateToken(receivedToken) {
  return receivedToken === config.token;
}

export async function processWebhook(callData) {
  // Mantido para compatibilidade
  console.log('📞 API-55PBX: Webhook recebido (modo legado)');
  return { processed: false, reason: 'using_api_mode' };
}

/**
 * Busca dados de um dia específico
 * @param {Date} date - Data específica para buscar
 * @returns {Promise<Object>} KPIs do dia
 */
export async function fetchDayData(date) {
  if (!isConfigured()) {
    return null;
  }
  
  try {
    const dateStart = startOfDay(date);
    const dateEnd = endOfDay(date);
    
    const urlPath = [
      formatDateForAPI(dateStart),
      formatDateForAPI(dateEnd),
      config.defaultFilters.queue,
      config.defaultFilters.number,
      config.defaultFilters.agent,
      config.defaultFilters.report,
      config.defaultFilters.quiz_id,
      config.timezone,
    ].join('/');
    
    const response = await api.get(`/${urlPath}`, {
      headers: getAuthHeaders(),
    });
    
    const data = response.data;
    
    if (!data) return null;
    
    // Extrai apenas entrada (receptivas)
    return {
      date: format(date, 'dd/MM/yyyy'),
      atendidas: parseInt(data.totalCallAttendedReceptive || 0),
      abandonadas: parseInt(data.totalCallAbandonedQueue || 0),
      retidasURA: parseInt(data.totalCallAbandonedURA || 0),
      total: parseInt(data.totalCallAttendedReceptive || 0) + 
             parseInt(data.totalCallAbandonedQueue || 0) + 
             parseInt(data.totalCallAbandonedURA || 0),
    };
    
  } catch (error) {
    console.error(`   ❌ Erro ao buscar ${format(date, 'dd/MM')}: ${error.message}`);
    return null;
  }
}

/**
 * Busca dados dos últimos N dias
 * @param {number} days - Quantidade de dias (padrão: 15)
 * @returns {Promise<Object>} Histórico e análise
 */
export async function fetchHistoricalData(days = 15) {
  console.log(`📊 API-55PBX: Buscando histórico dos últimos ${days} dias...`);
  
  const historico = [];
  const hoje = new Date();
  
  // Busca cada dia (começa do dia anterior, não inclui hoje)
  for (let i = 1; i <= days; i++) {
    const data = subDays(hoje, i);
    console.log(`   📅 Buscando ${format(data, 'dd/MM/yyyy')}...`);
    
    const dadosDia = await fetchDayData(data);
    
    if (dadosDia) {
      historico.push(dadosDia);
      console.log(`      ✅ ${dadosDia.atendidas} atendidas`);
    }
    
    // Pequeno delay para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 500));
  }
  
  if (historico.length === 0) {
    console.log('   ⚠️ Nenhum dado histórico encontrado');
    return null;
  }
  
  // Calcula médias
  const somaAtendidas = historico.reduce((sum, d) => sum + d.atendidas, 0);
  const somaAbandonadas = historico.reduce((sum, d) => sum + d.abandonadas, 0);
  const somaRetidasURA = historico.reduce((sum, d) => sum + d.retidasURA, 0);
  const somaTotal = historico.reduce((sum, d) => sum + d.total, 0);
  
  const mediaAtendidas = Math.round(somaAtendidas / historico.length);
  const mediaAbandonadas = Math.round(somaAbandonadas / historico.length);
  const mediaRetidasURA = Math.round(somaRetidasURA / historico.length);
  const mediaTotal = Math.round(somaTotal / historico.length);
  
  console.log(`   📈 Média ${days} dias: ${mediaAtendidas} atendidas/dia`);
  
  return {
    dias: historico.length,
    historico: historico,
    medias: {
      atendidas: mediaAtendidas,
      abandonadas: mediaAbandonadas,
      retidasURA: mediaRetidasURA,
      total: mediaTotal,
    },
    lastUpdate: new Date().toISOString(),
  };
}

/**
 * Classifica o nível atual comparado com a média histórica
 * @param {number} valorAtual - Valor atual (ex: atendidas de hoje)
 * @param {number} media - Média histórica
 * @returns {Object} Classificação e percentual
 */
export function classificarNivel(valorAtual, media) {
  if (media === 0) {
    return { nivel: 'indefinido', emoji: '⚪', percentual: 0 };
  }
  
  const percentual = Math.round((valorAtual / media) * 100);
  
  if (percentual < 70) {
    return { 
      nivel: 'Abaixo do comum', 
      emoji: '🔴', 
      percentual,
      descricao: `${percentual}% da média (esperado: ${media})`
    };
  } else if (percentual < 100) {
    return { 
      nivel: 'Médio', 
      emoji: '🟡', 
      percentual,
      descricao: `${percentual}% da média (esperado: ${media})`
    };
  } else if (percentual < 130) {
    return { 
      nivel: 'Alto', 
      emoji: '🟢', 
      percentual,
      descricao: `${percentual}% da média (esperado: ${media})`
    };
  } else {
    return { 
      nivel: 'Altíssimo', 
      emoji: '🔥', 
      percentual,
      descricao: `${percentual}% da média (esperado: ${media})`
    };
  }
}

/**
 * Analisa o dia atual comparando com histórico
 * @returns {Promise<Object>} Análise completa
 */
export async function analisarDiaAtual() {
  console.log('📊 API-55PBX: Analisando dia atual vs histórico...');
  
  // Busca KPIs de hoje
  const kpisHoje = await calculateDayKPIs();
  
  // Busca histórico dos últimos 15 dias
  const historico = await fetchHistoricalData(15);
  
  if (!historico) {
    return {
      hoje: kpisHoje,
      historico: null,
      analise: null,
      erro: 'Sem dados históricos para comparação',
    };
  }
  
  // Classifica cada métrica
  const analise = {
    atendidas: classificarNivel(kpisHoje.answered, historico.medias.atendidas),
    abandonadas: classificarNivel(kpisHoje.abandoned, historico.medias.abandonadas),
    retidasURA: classificarNivel(kpisHoje.retainedURA, historico.medias.retidasURA),
    total: classificarNivel(kpisHoje.totalCalls, historico.medias.total),
  };
  
  console.log(`   📈 Atendidas: ${kpisHoje.answered} (${analise.atendidas.emoji} ${analise.atendidas.nivel})`);
  console.log(`   📈 Abandonadas: ${kpisHoje.abandoned} (${analise.abandonadas.emoji} ${analise.abandonadas.nivel})`);
  console.log(`   📈 Retidas URA: ${kpisHoje.retainedURA} (${analise.retidasURA.emoji} ${analise.retidasURA.nivel})`);
  
  return {
    hoje: kpisHoje,
    historico: historico,
    analise: analise,
    resumo: `Dia ${analise.total.emoji} ${analise.total.nivel} - ${analise.total.percentual}% do esperado`,
  };
}

export default {
  fetchTodayCalls,
  fetchDayData,
  fetchHistoricalData,
  calculateDayKPIs,
  analisarDiaAtual,
  classificarNivel,
  classifyCallStatus,
  testConnection,
  validateToken,
  processWebhook,
};
