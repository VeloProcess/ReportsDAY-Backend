/**
 * API-55PBX - Serviço de Consulta
 * 
 * Busca dados de ligações via API REST da 55PBX
 */

import axios from 'axios';
import { format, startOfDay, endOfDay, subDays, addDays, getDay, setHours, setMinutes, setSeconds } from 'date-fns';

import { config, getAuthHeaders, isConfigured } from './config.js';
import { initLogger, logRequest, addCalculations, updateResult } from './apiLogger.js';
import { getReferenceDataForPeriod } from './referenceData.js';

// Inicializa o logger
initLogger();

// ============================================================================
// CALENDÁRIO DE FERIADOS BRASILEIROS 2026
// ============================================================================

/**
 * Lista de feriados nacionais brasileiros
 * Formato: "DD/MM/YYYY"
 * Inclui 2025 e 2026 para cobrir histórico
 */
const FERIADOS = [
  // 2025
  '01/01/2025', // Ano Novo
  '03/03/2025', // Carnaval
  '04/03/2025', // Carnaval
  '18/04/2025', // Sexta-feira Santa
  '21/04/2025', // Tiradentes
  '01/05/2025', // Dia do Trabalhador
  '19/06/2025', // Corpus Christi
  '07/09/2025', // Independência
  '12/10/2025', // Nossa Senhora Aparecida
  '02/11/2025', // Finados
  '15/11/2025', // Proclamação da República
  '25/12/2025', // Natal
  // 2026
  '01/01/2026', // Ano Novo
  '17/02/2026', // Carnaval
  '18/02/2026', // Carnaval
  '03/04/2026', // Sexta-feira Santa
  '21/04/2026', // Tiradentes
  '01/05/2026', // Dia do Trabalhador
  '11/06/2026', // Corpus Christi
  '07/09/2026', // Independência
  '12/10/2026', // Nossa Senhora Aparecida
  '02/11/2026', // Finados
  '15/11/2026', // Proclamação da República
  '25/12/2026', // Natal
];

/**
 * Verifica se uma data é feriado nacional brasileiro
 * @param {Date} date - Data a verificar
 * @returns {boolean} True se for feriado
 */
function isFeriado(date) {
  const dataFormatada = format(date, 'dd/MM/yyyy');
  return FERIADOS.includes(dataFormatada);
}

/**
 * Verifica se uma data é domingo
 * @param {Date} date - Data a verificar
 * @returns {boolean} True se for domingo
 */
function isDomingo(date) {
  return getDay(date) === 0; // 0 = domingo
}

/**
 * Verifica se uma data é sábado
 * @param {Date} date - Data a verificar
 * @returns {boolean} True se for sábado
 */
function isSabado(date) {
  return getDay(date) === 6; // 6 = sábado
}

/**
 * Verifica se uma data é dia útil (segunda a sexta, não feriado)
 * @param {Date} date - Data a verificar
 * @returns {boolean} True se for dia útil
 */
function isDiaUtil(date) {
  // Não é domingo nem sábado
  if (isDomingo(date) || isSabado(date)) {
    return false;
  }
  // Não é feriado
  if (isFeriado(date)) {
    return false;
  }
  return true;
}

// ============================================================================
// HORÁRIOS DE TRABALHO
// ============================================================================

/**
 * Obtém o horário de início do trabalho para uma data
 * @param {Date} date - Data
 * @returns {Date} Data com horário de início
 */
function getHorarioInicio(date) {
  if (isSabado(date)) {
    // Sábado: 09:00
    return setSeconds(setMinutes(setHours(startOfDay(date), 9), 0), 0);
  } else if (isDiaUtil(date)) {
    // Dia útil: 08:00
    return setSeconds(setMinutes(setHours(startOfDay(date), 8), 0), 0);
  }
  // Domingo ou feriado: não tem horário de trabalho
  return null;
}

/**
 * Obtém o horário de fim do trabalho para uma data
 * @param {Date} date - Data
 * @returns {Date} Data com horário de fim
 */
function getHorarioFim(date) {
  if (isSabado(date)) {
    // Sábado: 15:00
    return setSeconds(setMinutes(setHours(startOfDay(date), 15), 0), 0);
  } else if (isDiaUtil(date)) {
    // Dia útil: 19:00
    return setSeconds(setMinutes(setHours(startOfDay(date), 19), 0), 0);
  }
  // Domingo ou feriado: não tem horário de trabalho
  return null;
}

/**
 * Ajusta o horário de fim considerando o horário de trabalho
 * Se o horário atual for após o horário de fim, usa o horário de fim
 * @param {Date} date - Data
 * @param {Date} currentTime - Horário atual
 * @returns {Date} Horário ajustado
 */
function ajustarHorarioFim(date, currentTime) {
  const horarioFim = getHorarioFim(date);
  
  if (!horarioFim) {
    // Domingo ou feriado: retorna null (não deve processar)
    return null;
  }
  
  // Se o horário atual for após o horário de fim, usa o horário de fim
  if (currentTime > horarioFim) {
    return horarioFim;
  }
  
  // Se o horário atual for antes do horário de início, usa o horário de início
  const horarioInicio = getHorarioInicio(date);
  if (currentTime < horarioInicio) {
    return horarioInicio;
  }
  
  // Caso contrário, usa o horário atual
  return currentTime;
}

/**
 * Formata número sem arredondar (apenas trunca casas decimais para exibição)
 * Usa Math.floor para truncar, não Math.round
 * @param {number} value - Valor a formatar
 * @param {number} decimals - Número de casas decimais
 * @returns {string} Valor formatado (truncado, não arredondado)
 */
function formatarSemArredondar(value, decimals = 2) {
  if (decimals === 0) {
    return Math.floor(value).toString();
  }
  const multiplicador = Math.pow(10, decimals);
  const truncado = Math.floor(value * multiplicador) / multiplicador;
  // Converte para string e garante o número correto de casas decimais
  const partes = truncado.toString().split('.');
  if (partes.length === 1) {
    return truncado.toFixed(decimals);
  }
  const parteDecimal = partes[1].padEnd(decimals, '0').substring(0, decimals);
  return `${partes[0]}.${parteDecimal}`;
}

// Importa websocket para logs em tempo real (lazy load para evitar circular)
let websocket = null;
async function getWebsocket() {
  if (!websocket) {
    try {
      const ws = await import('../CORE/websocket.js');
      websocket = ws.default;
    } catch (e) {
      // Ignora se não conseguir importar
    }
  }
  return websocket;
}

// Envia log para o painel
async function sendLog(message, level = 'info') {
  const ws = await getWebsocket();
  if (ws && ws.broadcastLog) {
    ws.broadcastLog(message, level);
  }
}

// Cria instância do axios
const api = axios.create({
  baseURL: config.apiUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  // Remove o header Expect que pode causar erro 417
  maxRedirects: 0,
});

// Interceptor para remover header Expect que causa erro 417
api.interceptors.request.use((config) => {
  // Remove header Expect que pode causar erro 417
  if (config.headers) {
    delete config.headers.Expect;
    delete config.headers.expect;
  }
  return config;
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
 * Processa dados do report_02 da API
 * A API retorna dados dentro de data_report02
 * @param {Object} data - Resposta da API
 * @returns {Array} Array de chamadas
 */
function processReport02Data(data) {
  // A API retorna os dados dentro de data_report02
  if (data && data.data_report02) {
    if (Array.isArray(data.data_report02)) {
      return data.data_report02;
    }
  }
  
  // Fallback para outras estruturas
  if (Array.isArray(data)) return data;
  if (data.calls) return data.calls;
  if (data.data) return Array.isArray(data.data) ? data.data : [];
  
  return [];
}

/**
 * Filtra apenas chamadas receptivas
 * @param {Array} calls - Array de chamadas
 * @returns {Array} Array de chamadas receptivas
 */
function filterReceptiveCalls(calls) {
  return calls.filter(call => {
    const callType = call.call_type || call.type || call.callType || '';
    const callDirection = call.direction || call.call_direction || '';
    
    // EXCLUIR se for explicitamente ativo
    if (callType && (
      callType.toLowerCase().includes('active') || 
      callType.toLowerCase().includes('ativo') ||
      callType.toLowerCase().includes('outbound')
    )) {
      return false;
    }
    
    if (callDirection && (
      callDirection.toLowerCase().includes('outbound') || 
      callDirection.toLowerCase().includes('saida') ||
      callDirection.toLowerCase().includes('out')
    )) {
      return false;
    }
    
    // INCLUIR se for explicitamente receptivo
    if (callType && (
      callType.toLowerCase().includes('receptive') || 
      callType.toLowerCase().includes('receptivo') ||
      callType.toLowerCase().includes('inbound')
    )) {
      return true;
    }
    
    if (callDirection && (
      callDirection.toLowerCase().includes('inbound') || 
      callDirection.toLowerCase().includes('entrada') ||
      callDirection.toLowerCase().includes('in')
    )) {
      return true;
    }
    
    // Se não houver indicação, assumir receptivo
    // (já que estamos buscando dados de receptivo)
    return true;
  });
}

/**
 * Filtra apenas chamadas atendidas
 * @param {Array} calls - Array de chamadas
 * @returns {Array} Array de chamadas atendidas
 */
function filterAttendedCalls(calls) {
  return calls.filter(call => {
    // Verificar campo booleano
    if (call.attended === true) return true;
    
    // Verificar campo de status
    if (call.call_status === 'attended') return true;
    
    // Verificar se tem horário de atendimento
    if (call.wl_time_attended) return true;
    
    return false;
  });
}

/**
 * Filtra apenas chamadas abandonadas
 * @param {Array} calls - Array de chamadas
 * @returns {Array} Array de chamadas abandonadas
 */
function filterAbandonedCalls(calls) {
  return calls.filter(call => {
    // Verificar campo booleano
    if (call.abandoned === true) return true;
    
    // Verificar campo de status
    if (call.call_status === 'abandoned') return true;
    
    // Se não foi atendida e não foi recusada, pode ser abandonada
    if (!call.attended && !call.refused && !call.wl_time_attended) {
      return true;
    }
    
    return false;
  });
}

/**
 * Filtra apenas chamadas recusadas
 * @param {Array} calls - Array de chamadas
 * @returns {Array} Array de chamadas recusadas
 */
function filterRefusedCalls(calls) {
  return calls.filter(call => {
    // Verificar campo booleano
    if (call.refused === true) return true;
    
    // Verificar campo de status
    if (call.call_status === 'refused') return true;
    
    return false;
  });
}

/**
 * Busca dados de ligações do dia atual
 * 
 * @param {Date} date - Data de referência (padrão: hoje)
 * @param {Date|null} endTime - Horário limite (opcional). Se fornecido, busca dados até esse horário. Se null, busca até o momento atual.
 * @returns {Promise<Object>} Dados agregados
 */
export async function fetchTodayCalls(date = new Date(), endTime = null) {
  if (!isConfigured()) {
    console.warn('⚠️  API-55PBX: Não configurada');
    return null;
  }
  
  try {
    console.log('📡 API-55PBX: Buscando ligações do dia...');
    
    // Define período: início do dia até endTime (se fornecido) ou até agora
    const dateStart = startOfDay(date);
    const dateEnd = endTime || new Date();
    
    console.log(`   Período: ${dateStart.toLocaleString()} até ${dateEnd.toLocaleString()}`);
    
    // Monta a URL com path params
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
    
    const fullUrl = `${config.apiUrl}/${urlPath}`;
    console.log(`   🔗 URL: ${fullUrl.substring(0, 100)}...`);
    console.log(`   🔑 Token: ${config.token ? config.token.substring(0, 20) + '...' : 'NÃO CONFIGURADO'}`);
    
    const response = await api.get(`/${urlPath}`, {
      headers: {
        ...getAuthHeaders(),
        'Accept': 'application/json',
      },
      // Evita erro 417 removendo Expect header
      validateStatus: (status) => status < 500,
    });
    
    console.log(`   📊 Status HTTP: ${response.status}`);
    
    // Verifica status da resposta
    if (response.status >= 400) {
      console.error(`   ❌ API retornou status ${response.status}`);
      if (response.status === 404) {
        console.error('   ⚠️ Endpoint não encontrado - verifique a URL da API');
      } else if (response.status === 417) {
        console.error('   ⚠️ Erro 417 - verifique autenticação e formato da requisição');
      }
      return null;
    }
    
    const data = response.data;
    
    if (!data) {
      console.log('   ⚠️ Nenhum dado retornado pela API');
      return null;
    }
    
    // Verifica se a resposta está vazia ou com valores zerados
    // APENAS LIGAÇÕES RECEPTIVAS (report_01)
    if (typeof data === 'object' && !Array.isArray(data)) {
      const atendidas = parseInt(data.totalCallAttendedReceptive || 0);  // Total de chamadas atendidas (receptivo)
      // Soma todos os tipos de abandonadas
      const abandonadasFila = parseInt(data.totalCallAbandonedQueue || 0);
      const abandonadasBranch = parseInt(data.totalAbandonedCallsBranch || 0);
      const abandonadasActive = parseInt(data.totalAbandonedCallsActive || 0);
      const abandonadas = abandonadasFila + abandonadasBranch + abandonadasActive;
      const retidasURA = parseInt(data.totalCallAbandonedURA || 0);      // Total de chamadas retidas na URA (receptivo)
      // Total = APENAS atendidas + abandonadas (receptivo)
      const total = atendidas + abandonadas;
      
      console.log(`   📋 Dados recebidos (receptivo - report_01):`, {
        atendidas: atendidas,
        abandonadas: abandonadas,
        retidasURA: retidasURA,
        total: total, // Apenas atendidas + abandonadas
        retidasURA: retidasURA // Separado, não incluído no total
      });
      
      if (total === 0) {
        console.log('   ⚠️ API retornou dados, mas todos os valores estão zerados');
        console.log('   💡 Possíveis causas:');
        console.log('      - Período sem ligações');
        console.log('      - Filtros muito restritivos');
        console.log('      - Token expirado ou inválido');
      }
    }
    
    // Se for resposta agregada, retorna direto
    // APENAS LIGAÇÕES RECEPTIVAS (report_01) - CAMPOS OBRIGATÓRIOS
    if (!Array.isArray(data)) {
      const atendidas = parseInt(data.totalCallAttendedReceptive || 0);  // Total de chamadas atendidas (receptivo)
      const recusa = parseInt(data.totalTurnRefused || 0);               // Total de recusa (receptivo)
      const recusadas = parseInt(data.totalRefusedCalls || 0);           // Total de chamadas recusadas (receptivo)
      // Soma todos os tipos de abandonadas
      const abandonadasFila = parseInt(data.totalCallAbandonedQueue || 0);
      const abandonadasBranch = parseInt(data.totalAbandonedCallsBranch || 0);
      const abandonadasActive = parseInt(data.totalAbandonedCallsActive || 0);
      const abandonadas = abandonadasFila + abandonadasBranch + abandonadasActive;
      // Total = APENAS atendidas + abandonadas (receptivo)
      const total = atendidas + abandonadas;
      console.log(`✅ API-55PBX: ${total} ligações receptivas obtidas (report_01) - ${atendidas} atendidas + ${abandonadas} abandonadas`);
      return data;
    }
    
    return data;
    
  } catch (error) {
    if (error.response) {
      console.error(`   ❌ API-55PBX: Erro HTTP ${error.response.status}`);
      console.error(`   📄 Resposta:`, JSON.stringify(error.response.data).substring(0, 200));
    } else if (error.request) {
      console.error('   ❌ API-55PBX: Sem resposta do servidor');
      console.error('   💡 Verifique: URL da API, conexão de rede, firewall');
    } else {
    console.error('❌ API-55PBX: Erro ao buscar dados:', error.message);
    }
    return null;
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
 * Considera horários de trabalho (dias úteis 08:00-19:00, sábado 09:00-15:00)
 * @param {Date|null} currentTime - Horário atual (opcional)
 * @returns {Promise<Object>} KPIs calculados
 */
export async function calculateDayKPIs(currentTime = null) {
  try {
    console.log('📊 API-55PBX: Calculando KPIs do dia...');
    
    const agora = currentTime || new Date();
    const hoje = new Date(agora);
    
    // Verifica se é dia útil ou sábado
    if (!isDiaUtil(hoje) && !isSabado(hoje)) {
      console.log('   ⚠️ Hoje é domingo ou feriado - não há dados para processar');
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
    
    // ⚠️ CORREÇÃO CRÍTICA: Para dados de HOJE (D0), busca DIA INTEIRO (00:00 até 23:59)
    // Isso garante que TODAS as chamadas do dia sejam incluídas
    console.log(`   ⏰ DADOS DE HOJE (D0): Buscando DIA INTEIRO (00:00 até 23:59)`);
    console.log(`   ⚠️ IMPORTANTE: Para D0, busca DIA INTEIRO para incluir TODAS as chamadas`);
    
    // ⚠️ MÉTODO CORRETO: Busca dados de HOJE usando report_01 (método correto validado)
    // Passa null para endTime = busca dia inteiro
    console.log(`   🔍 CHAMANDO fetchDayDataAgregado para HOJE (DIA INTEIRO):`);
    console.log(`      Data: ${format(hoje, 'dd/MM/yyyy')}`);
    console.log(`      endTime: null (dia inteiro)`);
    
    const dadosHoje = await fetchDayDataAgregado(hoje, null); // null = dia inteiro
    
    console.log(`   🔍 RESULTADO de fetchDayDataAgregado para HOJE:`, JSON.stringify(dadosHoje, null, 2));
    
    // Se não houver dados, retorna zerado
    if (!dadosHoje) {
      console.log('   ⚠️ ⚠️ ⚠️ CRÍTICO: fetchDayDataAgregado retornou NULL para HOJE');
      console.log('   ⚠️ Isso não deveria acontecer - a função deveria retornar objeto zerado para hoje');
      return {
        totalCalls: 0,
        answered: 0,
        abandoned: 0,
        recusa: 0,
        recusadas: 0,
        other: 0,
        peakHour: null,
        avgWaitTime: 0,
        lastUpdate: new Date().toISOString(),
      };
    }
    
    // ⚠️ Retorna KPIs usando os dados processados de report_01 (método correto validado)
    const kpis = {
      totalCalls: dadosHoje.total || 0,
      answered: dadosHoje.atendidas || 0,
      abandoned: dadosHoje.abandonadas || 0,
      recusa: dadosHoje.recusa || 0,  // report_01 não retorna, mantém 0
      recusadas: dadosHoje.recusadas || 0,  // report_01 não retorna, mantém 0
      other: 0,
      peakHour: null,
      avgWaitTime: dadosHoje.avgWaitTime || 0,  // report_01 não retorna, mantém 0
      lastUpdate: new Date().toISOString(),
    };
    
    console.log(`   ✅ KPIs de HOJE (D0) - MÉTODO CORRETO (report_01): ${kpis.totalCalls} total (${kpis.answered} atendidas + ${kpis.abandoned} abandonadas)`);
    console.log(`   🔍 Dados completos retornados:`, JSON.stringify(kpis, null, 2));
    
    // ⚠️ LOG CRÍTICO: Se estiver zerado, mostra aviso
    if (kpis.totalCalls === 0 && kpis.answered === 0 && kpis.abandoned === 0) {
      console.error(`   ⚠️ ⚠️ ⚠️ ATENÇÃO: KPIs de HOJE estão ZERADOS!`);
      console.error(`   ⚠️ dadosHoje recebido:`, JSON.stringify(dadosHoje, null, 2));
    }
    
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
 * ⚠️ MÉTODO CORRETO PARA BUSCAR DADOS AGREGADOS DE LIGAÇÕES
 * 
 * Para obter valores CORRETOS de quantidade de ligações, use fetchDayDataAgregado() que usa report_01.
 * Esta função (fetchDayData) usa report_02 e pode retornar valores maiores que os corretos.
 * 
 * @see METODO_CORRETO_BUSCA_DADOS.md para documentação completa
 * 
 * ⚠️ NÃO ALTERAR A LÓGICA DE report_01 SEM AVISO PRÉVIO - VALORES VALIDADOS EM 15/01/2026
 * 
 * @param {Date} date - Data específica para buscar
 * @param {Date|null} endTime - Horário limite (opcional). Se fornecido, busca dados até esse horário. Se null, busca o dia inteiro.
 * @returns {Promise<Object>} KPIs do dia
 */
export async function fetchDayData(date, endTime = null) {
  if (!isConfigured()) {
    return null;
  }
  
  try {
    const dateStart = startOfDay(date);
    // Se endTime fornecido, usa esse horário. Caso contrário, usa endOfDay (dia inteiro)
    const dateEnd = endTime || endOfDay(date);
    
    console.log(`      🔍 fetchDayData: ${format(date, 'dd/MM/yyyy')} - Início: ${format(dateStart, 'HH:mm:ss')}, Fim: ${format(dateEnd, 'HH:mm:ss')}`);
    
    // ⚠️ ATENÇÃO: Esta função usa report_02 (detalhado) que pode retornar valores maiores
    // Para valores CORRETOS de contagem, use fetchDayDataAgregado() que usa report_01
    // @see METODO_CORRETO_BUSCA_DADOS.md
    const urlPath = [
      formatDateForAPI(dateStart),
      formatDateForAPI(dateEnd),
      config.defaultFilters.queue,
      config.defaultFilters.number,
      config.defaultFilters.agent,
      'report_02',  // ⚠️ Para contagem correta, usar report_01 (ver fetchDayDataAgregado)
      config.defaultFilters.quiz_id,
      config.timezone,
    ].join('/');
    
    const fullUrl = `${config.apiUrl}/${urlPath}`;
    
    // Registra a requisição
    const requestId = await logRequest({
      tipo: 'fetchDayData',
      url: fullUrl,
      metodo: 'GET',
      parametros: {
        data: format(date, 'dd/MM/yyyy'),
        dataInicio: format(dateStart, 'dd/MM/yyyy HH:mm:ss'),
        dataFim: format(dateEnd, 'dd/MM/yyyy HH:mm:ss'),
        report: 'report_02',
        queue: config.defaultFilters.queue,
        number: config.defaultFilters.number,
        agent: config.defaultFilters.agent,
        timezone: config.timezone
      }
    });
    
    const response = await api.get(`/${urlPath}`, {
      headers: {
        ...getAuthHeaders(),
        'Accept': 'application/json',
      },
      // Evita erro 417 removendo Expect header
      validateStatus: (status) => status < 500,
    });
    
    const data = response.data;
    
    // Atualiza a requisição com os dados retornados
    await logRequest({
      id: requestId,
      tipo: 'fetchDayData',
      statusHTTP: response.status,
      dadosRetornados: {
        totalItems: data?.totalItems || 0,
        reportCount: data?.reportCount || 0,
        data_report02_length: data?.data_report02?.length || 0,
        rawData: data // Dados completos
      }
    });
    
    if (!data) {
      console.log(`      ⚠️ API retornou null para ${format(date, 'dd/MM/yyyy')}`);
      return null;
    }
    
    // LOG COMPLETO DA RESPOSTA DA API
    console.log(`      📋 RESPOSTA COMPLETA DA API 55PBX para ${format(date, 'dd/MM/yyyy')}:`);
    console.log(`      📋 JSON completo:`, JSON.stringify(data, null, 2));
    
    // Processa dados do report_02 (dados estão dentro de data_report02)
    let calls = processReport02Data(data);
    console.log(`      📊 Total de chamadas retornadas: ${calls.length}`);
    
    // Filtra apenas chamadas receptivas
    calls = filterReceptiveCalls(calls);
    console.log(`      📊 Chamadas receptivas após filtro: ${calls.length}`);
    
    // Classifica por status usando os filtros
    const attendedCalls = filterAttendedCalls(calls);
    const abandonedCalls = filterAbandonedCalls(calls);
    const refusedCalls = filterRefusedCalls(calls);
    
    // Conta os totais
    const atendidas = attendedCalls.length;
    const abandonadas = abandonedCalls.length;
    const recusadas = refusedCalls.length;
    const recusa = refusedCalls.length; // totalTurnRefused
    const total = atendidas + abandonadas;  // Total = atendidas + abandonadas
    
    console.log(`      📊 Valores calculados (report_02 filtrado):`);
    console.log(`         Atendidas (filtradas): ${atendidas}`);
    console.log(`         Abandonadas (filtradas): ${abandonadas}`);
    console.log(`         Recusadas (filtradas): ${recusadas}`);
    console.log(`         Total calculado (atendidas + abandonadas): ${total}`);
    
    // Registra cálculos de filtragem
    await addCalculations(requestId, [{
      passo: 'filterCalls',
      descricao: 'Filtragem por status de chamada',
      entrada: { chamadasReceptivas: calls.length },
      calculos: {
        atendidas: `${attendedCalls.length} chamadas atendidas`,
        abandonadas: `${abandonedCalls.length} chamadas abandonadas`,
        recusadas: `${refusedCalls.length} chamadas recusadas`
      },
      saida: {
        atendidas: atendidas,
        abandonadas: abandonadas,
        recusadas: recusadas,
        total: total,
        formula: `total = atendidas + abandonadas = ${atendidas} + ${abandonadas} = ${total}`
      }
    }]);
    
    // Tempo médio de espera (calcula a partir das chamadas atendidas)
    let avgWaitTime = 0;
    if (attendedCalls.length > 0) {
      const totalWaitTime = attendedCalls.reduce((sum, call) => {
        const waitTimeStr = call.call_time_total_duration || call.time_waiting || call.call_time_waiting || '00:00:00';
        const waitParts = waitTimeStr.split(':');
        if (waitParts.length === 3) {
          return sum + (parseFloat(waitParts[0]) * 3600 + parseFloat(waitParts[1]) * 60 + parseFloat(waitParts[2]));
        }
        return sum;
      }, 0);
      avgWaitTime = totalWaitTime / attendedCalls.length;
    }
    
    // Total = APENAS atendidas + abandonadas (usando report_02 filtrado)
    const resultado = {
      date: format(date, 'dd/MM/yyyy'),
      atendidas: atendidas,
      recusa: recusa,
      recusadas: recusadas,
      abandonadas: abandonadas,
      total: total,
      avgWaitTime: avgWaitTime,
    };
    
    // Atualiza resultado final
    await updateResult(requestId, resultado);
    
    return resultado;
    
  } catch (error) {
    if (error.response?.status === 417) {
      // Silencia erro 417 repetido para não poluir logs
      return null;
    }
    console.error(`   ❌ Erro ao buscar ${format(date, 'dd/MM')}: ${error.message}`);
    return null;
  }
}

/**
 * ⚠️ MÉTODO CORRETO E VALIDADO - NÃO ALTERAR SEM AVISO PRÉVIO
 * 
 * Busca dados agregados de ligações usando report_01 (método correto validado em 15/01/2026).
 * 
 * Valores validados:
 * - 12/01/2026: 215 ligações (214 atendidas + 1 abandonada) ✅
 * - 13/01/2026: 195 ligações (194 atendidas + 1 abandonada) ✅
 * - 14/01/2026: 151 ligações (150 atendidas + 1 abandonada) ✅
 * 
 * @see METODO_CORRETO_BUSCA_DADOS.md para documentação completa
 * 
 * @param {Date} date - Data específica para buscar
 * @param {Date|null} endTime - Horário limite (opcional). Se fornecido, busca dados até esse horário. Se null, busca o dia inteiro.
 * @returns {Promise<Object|null>} KPIs do dia com valores corretos ou null em caso de erro
 */
export async function fetchDayDataAgregado(date, endTime = null) {
  if (!isConfigured()) {
    return null;
  }
  
  try {
    // ⚠️ CRÍTICO: Declara variável para comparação de datas
    const hoje = new Date();
    const dataFormatada = format(date, 'dd/MM/yyyy');
    const hojeFormatado = format(hoje, 'dd/MM/yyyy');
    const eHoje = dataFormatada === hojeFormatado;
    
    // ⚠️ REGRA SIMPLES: D0 (hoje) = API | D-1, D-2, etc = ARQUIVO DE REFERÊNCIA
    if (!eHoje) {
      // DIA ANTERIOR: Usa arquivo de referência
      console.log(`      📁 DIA ANTERIOR (${dataFormatada}): Buscando no arquivo de referência`);
      
      // Define período: se endTime fornecido, usa das 8h até endTime; senão, dia inteiro
      let dateStart, dateEnd;
      if (endTime) {
        dateStart = setSeconds(setMinutes(setHours(startOfDay(date), 8), 0), 0);
        dateEnd = endTime;
      } else {
        dateStart = startOfDay(date);
        dateEnd = endOfDay(date);
      }
      
      const referencia = getReferenceDataForPeriod(date, dateStart, dateEnd);
      
      if (referencia && referencia.total > 0) {
        console.log(`      ✅ Dados do arquivo de referência: Total=${referencia.total}, Atendidas=${referencia.atendidas}, Abandonadas=${referencia.abandonadas}`);
        return {
          date: dataFormatada,
          atendidas: referencia.atendidas,
          abandonadas: referencia.abandonadas,
          total: referencia.total,
          metodo: 'arquivo_referencia',
          avgWaitTime: 0,
        };
      } else {
        console.log(`      ⚠️ Arquivo de referência não tem dados para ${dataFormatada}`);
        return null;
      }
    }
    
    // D0 (HOJE): Sempre usa API
    console.log(`      🌐 🌐 🌐 D0 (HOJE - ${dataFormatada}): Buscando via API`);
    console.log(`      ⚠️ REGRA: D0 sempre usa API, nunca arquivo de referência`);
    
    // ⚠️ CORREÇÃO CRÍTICA: Para D0, SEMPRE busca DIA INTEIRO (00:00 até 23:59)
    // Não importa o endTime passado - sempre busca o dia completo para pegar TODAS as chamadas
    let dateStart, dateEnd;
    
    // SEMPRE dia inteiro para D0
    dateStart = startOfDay(date);
    dateEnd = endOfDay(date);
    
    console.log(`      ⚠️ D0: Buscando DIA INTEIRO (00:00 até 23:59) - ignorando endTime`);
    console.log(`      🔍 fetchDayDataAgregado (MÉTODO CORRETO): ${format(date, 'dd/MM/yyyy')} - Início: ${format(dateStart, 'HH:mm:ss')}, Fim: ${format(dateEnd, 'HH:mm:ss')}`);
    
    // ⚠️ MÉTODO CORRETO: Usa report_01 (agregado) - NÃO ALTERAR
    const urlPath = [
      formatDateForAPI(dateStart),
      formatDateForAPI(dateEnd),
      config.defaultFilters.queue,
      config.defaultFilters.number,
      config.defaultFilters.agent,
      'report_01',  // ⚠️ CORRETO: report_01 retorna valores agregados corretos
      config.defaultFilters.quiz_id,
      config.timezone,
    ].join('/');
    
    const fullUrl = `${config.apiUrl}/${urlPath}`;
    
    // 🔍 LOG DETALHADO: URL completa sendo chamada
    console.log(`      🔗 URL COMPLETA: ${fullUrl}`);
    console.log(`      📅 Período: ${format(dateStart, 'dd/MM/yyyy HH:mm:ss')} até ${format(dateEnd, 'dd/MM/yyyy HH:mm:ss')}`);
    
    const response = await api.get(`/${urlPath}`, {
      headers: {
        ...getAuthHeaders(),
        'Accept': 'application/json',
      },
      validateStatus: (status) => status < 500,
    });
    
    console.log(`      📊 Status HTTP: ${response.status}`);
    console.log(`      📊 Headers da resposta:`, JSON.stringify(response.headers, null, 2));
    console.log(`      🔍 Comparação de datas: dataFormatada="${dataFormatada}", hojeFormatado="${hojeFormatado}", éHoje=${eHoje}`);
    
    // Verifica status da resposta
    if (response.status !== 200) {
      console.log(`      ⚠️ Status HTTP diferente de 200: ${response.status}`);
      console.log(`      📄 Resposta completa:`, JSON.stringify(response.data, null, 2));
      
      // ⚠️ D0 (HOJE): Sempre retorna objeto (mesmo zerado), nunca null
      if (eHoje) {
        console.log(`      ⚠️ É HOJE e status é ${response.status} - retornando objeto zerado`);
        return {
          date: format(date, 'dd/MM/yyyy'),
          atendidas: 0,
          abandonadas: 0,
          total: 0,
          metodo: 'report_01_api',
          avgWaitTime: 0,
        };
      }
      
      return null;
    }
    
    let data = response.data;
    
    // 🔍 LOG DETALHADO: Estrutura completa da resposta
    console.log(`      📋 TIPO DA RESPOSTA: ${typeof data}`);
    console.log(`      📋 É ARRAY: ${Array.isArray(data)}`);
    if (data) {
      console.log(`      📋 RESPOSTA COMPLETA (JSON):`, JSON.stringify(data, null, 2));
      if (typeof data === 'object') {
        console.log(`      📋 Campos disponíveis no nível raiz:`, Object.keys(data));
      }
    }
    
    if (!data) {
      console.log(`      ⚠️ API retornou null para ${format(date, 'dd/MM/yyyy')}`);
      
      // ⚠️ D0 (HOJE): Sempre retorna objeto zerado, nunca null
      if (eHoje) {
        console.log(`      ⚠️ É HOJE e API retornou null - retornando objeto zerado`);
        return {
          date: format(date, 'dd/MM/yyyy'),
          atendidas: 0,
          abandonadas: 0,
          total: 0,
          metodo: 'report_01_api',
          avgWaitTime: 0,
        };
      }
      
      return null;
    }
    
    // 🔍 TRATAMENTO: Verifica se é array e pega o primeiro elemento
    if (Array.isArray(data)) {
      console.log(`      🔍 Resposta é ARRAY com ${data.length} elemento(s)`);
      if (data.length === 0) {
        console.log(`      ⚠️ API retornou array vazio para ${format(date, 'dd/MM/yyyy')}`);
        
        // ⚠️ D0 (HOJE): Sempre retorna objeto zerado, nunca null
        if (eHoje) {
          console.log(`      ⚠️ É HOJE e API retornou array vazio - retornando objeto zerado`);
          return {
            date: format(date, 'dd/MM/yyyy'),
            atendidas: 0,
            abandonadas: 0,
            total: 0,
            metodo: 'report_01_api',
            avgWaitTime: 0,
          };
        }
        
        return null;
      }
      console.log(`      🔍 Pegando primeiro elemento do array`);
      data = data[0];
      console.log(`      📋 Primeiro elemento (JSON):`, JSON.stringify(data, null, 2));
      if (data && typeof data === 'object') {
        console.log(`      📋 Campos disponíveis no primeiro elemento:`, Object.keys(data));
      }
    }
    
    // 🔍 TRATAMENTO: Verifica se há propriedades aninhadas (ex: data_report01)
    if (data && typeof data === 'object') {
      const possiveisPropriedades = ['data_report01', 'data', 'report01', 'report_01', 'result', 'results'];
      for (const prop of possiveisPropriedades) {
        if (data[prop] && typeof data[prop] === 'object') {
          console.log(`      🔍 Encontrada propriedade aninhada: ${prop}`);
          console.log(`      📋 Conteúdo de ${prop}:`, JSON.stringify(data[prop], null, 2));
          // Se for array, pega o primeiro elemento
          if (Array.isArray(data[prop]) && data[prop].length > 0) {
            console.log(`      🔍 ${prop} é array, pegando primeiro elemento`);
            data = data[prop][0];
          } else if (typeof data[prop] === 'object') {
            data = data[prop];
          }
          break;
        }
      }
    }
    
    // 🔍 LOG COMPLETO DA RESPOSTA DA API PARA DEBUG
    console.log(`      📋 RESPOSTA FINAL PROCESSADA DA API 55PBX (report_01) para ${format(date, 'dd/MM/yyyy')} até ${format(dateEnd, 'HH:mm:ss')}:`);
    if (data && typeof data === 'object') {
      console.log(`      📋 Campos disponíveis:`, Object.keys(data));
      console.log(`      📋 Valores brutos:`, {
        totalCallAttendedReceptive: data.totalCallAttendedReceptive,
        totalCallAbandonedQueue: data.totalCallAbandonedQueue,
        totalAbandonedCallsBranch: data.totalAbandonedCallsBranch,
        totalAbandonedCallsActive: data.totalAbandonedCallsActive,
        totalCallAbandonedURA: data.totalCallAbandonedURA,
        totalCallRefused: data.totalCallRefused,
        totalRefusedCalls: data.totalRefusedCalls,
        // Tentativas com nomes alternativos
        attended: data.attended,
        abandoned: data.abandoned,
        total: data.total,
        totalCalls: data.totalCalls
      });
    }
    
    // ⚠️ MÉTODO CORRETO: Extrai valores agregados diretamente da API
    // Segundo a documentação (API_DOCUMENTATION.md), report_01 retorna:
    // {
    //   "totalCallAttendedReceptive": 153,      // Ligações atendidas (receptivas)
    //   "totalCallAbandonedQueue": 0,          // Ligações abandonadas na fila
    //   "totalCallAbandonedURA": 27,           // Ligações retidas/abandonadas na URA
    //   "timeMediumWaitingAttendance": "00:00:06",
    //   "timeMediumDuration": "00:03:45",
    //   "sla_attendance": "85%",
    //   // ... outros campos
    // }
    
    let atendidas = 0;
    let abandonadas = 0;
    
    // ⚠️ EXTRAÇÃO CORRETA: Usa exatamente os campos documentados
    if (data && typeof data === 'object') {
      // Campo principal: totalCallAttendedReceptive
      atendidas = parseInt(data.totalCallAttendedReceptive || 0);
      
      // Campos de abandonadas: SOMA TODOS OS TIPOS DE ABANDONADAS
      // totalCallAbandonedQueue: abandonadas na fila
      // totalAbandonedCallsBranch: abandonadas em ramal
      // totalAbandonedCallsActive: abandonadas ativas (se existir)
      const abandonadasFila = parseInt(data.totalCallAbandonedQueue || 0);
      const abandonadasBranch = parseInt(data.totalAbandonedCallsBranch || 0);
      const abandonadasActive = parseInt(data.totalAbandonedCallsActive || 0);
      
      // Soma todas as abandonadas (exceto URA que não conta)
      abandonadas = abandonadasFila + abandonadasBranch + abandonadasActive;
      
      // Log detalhado dos valores encontrados
      console.log(`      🔍 Extração de dados (conforme documentação):`);
      console.log(`         totalCallAttendedReceptive: ${data.totalCallAttendedReceptive} → atendidas: ${atendidas}`);
      console.log(`         totalCallAbandonedQueue: ${abandonadasFila} → abandonadas na fila`);
      console.log(`         totalAbandonedCallsBranch: ${abandonadasBranch} → abandonadas em ramal`);
      console.log(`         totalAbandonedCallsActive: ${abandonadasActive} → abandonadas ativas`);
      console.log(`         TOTAL ABANDONADAS: ${abandonadas} (${abandonadasFila} + ${abandonadasBranch} + ${abandonadasActive})`);
      console.log(`         totalCallAbandonedURA: ${data.totalCallAbandonedURA} (não incluído no total)`);
      
      // Se os campos principais não existirem, tenta campos alternativos (fallback)
      if (atendidas === 0 && abandonadas === 0) {
        console.log(`      ⚠️ Campos principais zerados, tentando campos alternativos...`);
        atendidas = parseInt(data.attended || data.totalCallAttended || 0);
        abandonadas = parseInt(data.abandoned || data.totalCallAbandoned || 0);
        console.log(`         Campos alternativos: attended=${data.attended}, abandoned=${data.abandoned}`);
      }
    }
    
    // ⚠️ NÃO incluir totalCallAbandonedURA no total (conforme método validado)
    // Total = apenas atendidas + abandonadas (ligações que chegaram na fila humana)
    const total = atendidas + abandonadas;
    
    console.log(`      ✅ Valores CORRETOS obtidos (report_01): Total=${total}, Atendidas=${atendidas}, Abandonadas=${abandonadas}`);
    
    // Se ainda estiver zerado, loga aviso detalhado
    if (total === 0 && atendidas === 0 && abandonadas === 0) {
      console.log(`      ⚠️ AVISO CRÍTICO: Todos os valores estão zerados!`);
      console.log(`      📋 Verificando estrutura da resposta...`);
      console.log(`      📋 Tipo de dados: ${typeof data}`);
      console.log(`      📋 É array: ${Array.isArray(data)}`);
      console.log(`      📋 É objeto: ${typeof data === 'object' && data !== null}`);
      
      if (data && typeof data === 'object') {
        console.log(`      📋 Todas as chaves disponíveis:`, Object.keys(data));
        console.log(`      📋 Valores de todas as chaves:`, Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', '));
        
        // Tenta encontrar qualquer campo numérico que possa ser relevante
        const camposNumericos = Object.entries(data)
          .filter(([k, v]) => typeof v === 'number' && v > 0)
          .map(([k, v]) => `${k}=${v}`);
        
        if (camposNumericos.length > 0) {
          console.log(`      💡 Campos numéricos encontrados (mas não extraídos):`, camposNumericos.join(', '));
        } else {
          console.log(`      ⚠️ Nenhum campo numérico positivo encontrado na resposta`);
        }
      }
      
      // ⚠️ CRÍTICO: Para dados de HOJE, mesmo zerados, retorna o resultado (não null)
      // Isso permite que o sistema mostre "0" em vez de erro
      if (eHoje) {
        console.log(`      ⚠️ IMPORTANTE: É HOJE e valores estão zerados - pode ser que ainda não haja dados ou API não retornou`);
        console.log(`      ⚠️ Retornando resultado zerado (não null) para permitir exibição`);
      }
    }
    
    // ⚠️ D0 (HOJE): Retorna dados da API diretamente
    console.log(`      ✅ ✅ ✅ D0 (HOJE): Dados da API - Total=${total}, Atendidas=${atendidas}, Abandonadas=${abandonadas}`);
    
    // ⚠️ LOG CRÍTICO: Se estiver zerado, mostra aviso
    if (total === 0 && atendidas === 0 && abandonadas === 0) {
      console.error(`      ⚠️ ⚠️ ⚠️ ATENÇÃO: D0 está ZERADO após buscar na API!`);
      console.error(`      ⚠️ URL chamada: ${fullUrl}`);
      console.error(`      ⚠️ Status HTTP: ${response.status}`);
      console.error(`      ⚠️ Resposta da API:`, JSON.stringify(response.data, null, 2));
      console.error(`      ⚠️ Campos extraídos: atendidas=${atendidas}, abandonadas=${abandonadas}, total=${total}`);
    }
    
    const resultado = {
      date: format(date, 'dd/MM/yyyy'),
      atendidas: atendidas,
      abandonadas: abandonadas,
      total: total,
      metodo: 'report_01_api',  // Marca que foi usado API (D0)
      avgWaitTime: 0,  // report_01 não retorna tempo médio de espera
    };
    
    console.log(`      📤 Retornando resultado D0:`, JSON.stringify(resultado, null, 2));
    
    return resultado;
    
  } catch (error) {
    // 🔍 LOG DETALHADO DE ERROS
    console.error(`   ❌ ERRO ao buscar ${format(date, 'dd/MM/yyyy')} com método agregado:`);
    console.error(`      Mensagem: ${error.message}`);
    
    // ⚠️ D0 (HOJE): Sempre retorna objeto zerado, nunca null
    const hoje = new Date();
    const dataFormatada = format(date, 'dd/MM/yyyy');
    const hojeFormatado = format(hoje, 'dd/MM/yyyy');
    const eHoje = dataFormatada === hojeFormatado;
    
    if (eHoje) {
      console.error(`      ⚠️ É HOJE e houve erro - retornando objeto zerado`);
      return {
        date: dataFormatada,
        atendidas: 0,
        abandonadas: 0,
        total: 0,
        metodo: 'report_01_api',
        avgWaitTime: 0,
      };
    }
    
    if (error.response) {
      console.error(`      Status HTTP: ${error.response.status}`);
      console.error(`      Dados da resposta:`, JSON.stringify(error.response.data, null, 2));
      console.error(`      Headers da resposta:`, JSON.stringify(error.response.headers, null, 2));
      
      if (error.response.status === 417) {
        console.warn(`      ⚠️ Status 417 (Expectation Failed) - pode indicar falta de dados ou erro na requisição`);
        return null;
      }
      
      if (error.response.status === 404) {
        console.error(`      ⚠️ Status 404 (Not Found) - verifique a URL da API`);
      }
    } else if (error.request) {
      console.error(`      ⚠️ Sem resposta do servidor - verifique conexão de rede`);
      console.error(`      Request:`, error.request);
    } else {
      console.error(`      ⚠️ Erro ao configurar requisição:`, error.message);
    }
    
    return null;
  }
}

/**
 * ⚠️ MÉTODO CORRETO PARA CÁLCULO DE PORCENTAGEM - NÃO ALTERAR SEM AVISO PRÉVIO
 * 
 * Calcula porcentagem de diferença entre soma dos dias anteriores e dia atual.
 * Baseado no fluxograma validado em 15/01/2026.
 * 
 * Fórmula:
 * 1. SOMA = dia12 + dia13 + dia14
 * 2. DIFERENÇA = SOMA - diaHoje
 * 3. PORCENTAGEM = (DIFERENÇA / SOMA) * 100
 * 
 * @see METODO_CALCULO_PORCENTAGEM_MENSAGENS.md para documentação completa
 * 
 * @param {Array<number>} diasAnteriores - Array com valores dos dias anteriores [dia12, dia13, dia14]
 * @param {number} diaHoje - Valor do dia atual
 * @returns {Object} Resultado do cálculo com porcentagem e status
 */
export function calcularPorcentagemMensagens(diasAnteriores, diaHoje) {
  // Validação de entrada
  if (!Array.isArray(diasAnteriores) || diasAnteriores.length === 0) {
    return {
      soma: 0,
      diaHoje: diaHoje || 0,
      diferenca: 0,
      porcentagem: 0,
      status: 'SEM DADOS',
      interpretacao: 'Dados insuficientes para cálculo'
    };
  }
  
  // 1. SOMA dos dias anteriores
  const soma = diasAnteriores.reduce((acc, valor) => acc + (parseFloat(valor) || 0), 0);
  
  // 2. DIFERENÇA = SOMA - HOJE
  const diaHojeNum = parseFloat(diaHoje) || 0;
  const diferenca = soma - diaHojeNum;
  
  // 3. PORCENTAGEM = (DIFERENÇA / SOMA) * 100
  const porcentagem = soma > 0 ? (diferenca / soma) * 100 : 0;
  
  // 4. Interpretação
  let status = '';
  let interpretacao = '';
  
  if (Math.abs(porcentagem) < 0.01) {
    // Praticamente zero (diferença muito pequena)
    status = 'IGUAL À MÉDIA';
    interpretacao = 'Hoje está igual à soma dos dias anteriores';
  } else if (porcentagem < 0) {
    // Se negativo, hoje está ACIMA da soma
    status = 'ACIMA DA MÉDIA';
    interpretacao = `Hoje está ${Math.abs(porcentagem).toFixed(2)}% acima da soma dos dias anteriores`;
  } else {
    // Se positivo, hoje está ABAIXO da soma
    status = 'ABAIXO DA MÉDIA';
    interpretacao = `Hoje está ${porcentagem.toFixed(2)}% abaixo da soma dos dias anteriores`;
  }
  
  return {
    soma: soma,
    diaHoje: diaHojeNum,
    diferenca: diferenca,
    porcentagem: Math.round(porcentagem * 100) / 100, // Arredonda para 2 casas decimais
    porcentagemFormatada: `${porcentagem >= 0 ? '+' : ''}${porcentagem.toFixed(2)}%`,
    status: status,
    interpretacao: interpretacao,
    diasAnteriores: diasAnteriores.map((v, i) => ({
      dia: `dia${12 + i}`,
      valor: parseFloat(v) || 0
    }))
  };
}

/**
 * Encontra a segunda-feira anterior mais recente (pulando domingos e feriados)
 * @param {Date} date - Data de referência
 * @param {Date} dataMinima - Data mínima permitida
 * @returns {Date|null} Data da segunda anterior ou null se não encontrada
 */
function encontrarSegundaAnteriorMaisRecente(date, dataMinima) {
  let dataBusca = subDays(date, 1);
  let tentativas = 0;
  const limiteTentativas = 14; // Máximo 2 semanas para trás
  
  while (tentativas < limiteTentativas) {
    tentativas++;
    
    // Verifica se passou da data mínima
    if (startOfDay(dataBusca) < startOfDay(dataMinima)) {
      return null;
    }
    
    // Verifica se é segunda-feira e não é feriado
    if (getDay(dataBusca) === 1 && !isFeriado(dataBusca)) {
      return dataBusca;
    }
    
    // Vai para o dia anterior
    dataBusca = subDays(dataBusca, 1);
  }
  
  return null;
}

/**
 * Busca dados de mensagens comparando segunda com segunda na mesma faixa de horário
 * Se hoje for segunda-feira, compara com a segunda-feira anterior no mesmo horário
 * Usa o mesmo método correto (report_01) usado para ligações
 * 
 * @param {Date} dataHoje - Data de hoje (padrão: hoje)
 * @returns {Promise<Object|null>} Resultado com dados e porcentagem calculada
 */
export async function calcularPorcentagemMensagensDias(dataHoje = new Date()) {
  try {
    console.log('📊 Calculando porcentagem de mensagens...');
    
    const hoje = new Date(dataHoje);
    const diaSemana = getDay(hoje); // 0=domingo, 1=segunda, ..., 6=sábado
    const dataMinima = new Date(2026, 0, 12, 0, 0, 0, 0); // 12/01/2026
    
    // ⚠️ CRÍTICO: Calcula o horário de referência UMA VEZ para usar em ambas as buscas
    // Isso garante que compara na mesma faixa de horário
    const horaAtual = hoje.getHours();
    const minutoAtual = hoje.getMinutes();
    
    // Arredonda para o último intervalo completo de 30 minutos
    const minutosAjustados = Math.floor(minutoAtual / 30) * 30;
    const horarioReferencia = setSeconds(setMinutes(setHours(startOfDay(hoje), horaAtual), minutosAjustados), 0);
    
    console.log(`   ⏰ Horário de referência: ${format(hoje, 'HH:mm:ss')} → Ajustado para: ${format(horarioReferencia, 'HH:mm:ss')}`);
    
    // Se hoje for segunda-feira, compara com segunda anterior na mesma faixa de horário
    if (diaSemana === 1) {
      console.log(`   📅 Segunda-feira: Comparando com segunda anterior na mesma faixa de horário...`);
      
      const segundaAnterior = encontrarSegundaAnteriorMaisRecente(hoje, dataMinima);
      
      if (!segundaAnterior) {
        console.log(`   ⚠️ Segunda anterior não encontrada ou antes da data mínima`);
        return {
          soma: 0,
          diaHoje: 0,
          diferenca: 0,
          porcentagem: 0,
          status: 'SEM DADOS',
          interpretacao: 'Segunda anterior não encontrada para comparação',
          dados: {
            segundaAnterior: null,
            hoje: { data: format(hoje, 'dd/MM/yyyy'), valor: 0 }
          }
        };
      }
      
      console.log(`   📅 Segunda anterior encontrada: ${format(segundaAnterior, 'dd/MM/yyyy')}`);
      
      // Cria horário de fim para a segunda anterior (mesmo horário de referência)
      let horarioFimSegundaAnterior = setSeconds(
        setMinutes(
          setHours(
            startOfDay(segundaAnterior), 
            horarioReferencia.getHours()
          ), 
          horarioReferencia.getMinutes()
        ), 
        0
      );
      
      // Horário de início: 8h da manhã
      const horarioInicioSegundaAnterior = setSeconds(setMinutes(setHours(startOfDay(segundaAnterior), 8), 0), 0);
      
      // Se o horário de referência for antes das 8h, usa 8h como fim (período mínimo)
      if (horarioFimSegundaAnterior < horarioInicioSegundaAnterior) {
        console.log(`   ⚠️ Horário de referência (${format(horarioReferencia, 'HH:mm')}) é antes das 8h - usando período mínimo (8h às 8h)`);
        horarioFimSegundaAnterior = horarioInicioSegundaAnterior;
      }
      
      console.log(`   📊 Buscando dados da segunda anterior (${format(segundaAnterior, 'dd/MM/yyyy')}) no período: ${format(horarioInicioSegundaAnterior, 'HH:mm:ss')} até ${format(horarioFimSegundaAnterior, 'HH:mm:ss')}`);
      console.log(`   📊 Buscando dados de hoje (${format(hoje, 'dd/MM/yyyy')}) no período: 08:00:00 até ${format(horarioReferencia, 'HH:mm:ss')}`);
      
      // Busca dados usando o mesmo período de horário
      const [dadosSegundaAnterior, dadosHoje] = await Promise.all([
        fetchDayDataAgregado(segundaAnterior, horarioFimSegundaAnterior),
        fetchDayDataAgregado(hoje, horarioReferencia)
      ]);
      
      const mensagensSegundaAnterior = dadosSegundaAnterior?.total || 0;
      const mensagensHoje = dadosHoje?.total || 0;
      
      console.log(`   📊 Valores obtidos:`);
      console.log(`      Segunda anterior (${format(segundaAnterior, 'dd/MM/yyyy')}): ${mensagensSegundaAnterior}`);
      console.log(`      Hoje (${format(hoje, 'dd/MM/yyyy')}): ${mensagensHoje}`);
      
      // Calcula porcentagem comparando segunda com segunda
      const resultado = calcularPorcentagemMensagens(
        [mensagensSegundaAnterior],
        mensagensHoje
      );
      
      // ⚠️ CORREÇÃO: Quando compara segunda com segunda, a "média" é o próprio valor da segunda anterior
      // (não há múltiplos dias para fazer média, então usa o valor único como referência)
      const mediaSegundaAnterior = mensagensSegundaAnterior;
      
      console.log(`   ✅ Cálculo concluído:`);
      console.log(`      SOMA (segunda anterior): ${resultado.soma}`);
      console.log(`      MÉDIA (valor da segunda anterior): ${mediaSegundaAnterior}`);
      console.log(`      DIFERENÇA: ${resultado.diferenca}`);
      console.log(`      PORCENTAGEM: ${resultado.porcentagemFormatada}`);
      console.log(`      STATUS: ${resultado.status}`);
      
      return {
        ...resultado,
        media: mediaSegundaAnterior, // Adiciona campo média para uso no relatório
        dados: {
          segundaAnterior: { data: format(segundaAnterior, 'dd/MM/yyyy'), valor: mensagensSegundaAnterior },
          hoje: { data: format(hoje, 'dd/MM/yyyy'), valor: mensagensHoje }
        }
      };
    }
    
    // Para outros dias, mantém a lógica original (busca dias 12, 13, 14)
    console.log(`   📅 Dia ${diaSemana === 0 ? 'domingo' : diaSemana === 2 ? 'terça' : diaSemana === 3 ? 'quarta' : diaSemana === 4 ? 'quinta' : diaSemana === 5 ? 'sexta' : 'sábado'}: Usando lógica padrão (dias 12, 13, 14)...`);
    
    const dia12 = new Date(2026, 0, 12);
    const dia13 = new Date(2026, 0, 13);
    const dia14 = new Date(2026, 0, 14);
    
    console.log('   📅 Buscando dados dos dias 12, 13, 14 e hoje...');
    
    // Busca dados usando o método correto (report_01)
    const [dadosDia12, dadosDia13, dadosDia14, dadosHoje] = await Promise.all([
      fetchDayDataAgregado(dia12),
      fetchDayDataAgregado(dia13),
      fetchDayDataAgregado(dia14),
      fetchDayDataAgregado(hoje)
    ]);
    
    // Extrai quantidade de mensagens (ajustar campo conforme API retorna)
    const mensagensDia12 = dadosDia12?.total || 0;
    const mensagensDia13 = dadosDia13?.total || 0;
    const mensagensDia14 = dadosDia14?.total || 0;
    const mensagensHoje = dadosHoje?.total || 0;
    
    console.log(`   📊 Valores obtidos:`);
    console.log(`      Dia 12: ${mensagensDia12}`);
    console.log(`      Dia 13: ${mensagensDia13}`);
    console.log(`      Dia 14: ${mensagensDia14}`);
    console.log(`      Hoje: ${mensagensHoje}`);
    
    // Calcula porcentagem usando a função validada
    const resultado = calcularPorcentagemMensagens(
      [mensagensDia12, mensagensDia13, mensagensDia14],
      mensagensHoje
    );
    
    console.log(`   ✅ Cálculo concluído:`);
    console.log(`      SOMA: ${resultado.soma}`);
    console.log(`      DIFERENÇA: ${resultado.diferenca}`);
    console.log(`      PORCENTAGEM: ${resultado.porcentagemFormatada}`);
    console.log(`      STATUS: ${resultado.status}`);
    
    return {
      ...resultado,
      dados: {
        dia12: { data: format(dia12, 'dd/MM/yyyy'), valor: mensagensDia12 },
        dia13: { data: format(dia13, 'dd/MM/yyyy'), valor: mensagensDia13 },
        dia14: { data: format(dia14, 'dd/MM/yyyy'), valor: mensagensDia14 },
        hoje: { data: format(hoje, 'dd/MM/yyyy'), valor: mensagensHoje }
      }
    };
    
  } catch (error) {
    console.error('❌ Erro ao calcular porcentagem de mensagens:', error.message);
    return null;
  }
}

/**
 * Busca 15 dias corridos (excluindo APENAS domingos e feriados)
 * Média consolidada: inclui todos os dias válidos (dias úteis + sábados), independente de volume
 * @param {Date} currentTime - Horário atual de referência
 * @returns {Promise<Object|null>} Histórico e médias
 */
export async function fetchHistoricalData15DiasUteis(currentTime) {
  console.log('📊 API-55PBX: Buscando média consolidada (15 dias corridos, excluindo domingos e feriados)...');
  
  const hoje = new Date(currentTime);
  const isSabadoHoje = isSabado(hoje);
  const isDiaUtilHoje = isDiaUtil(hoje);
  
  if (!isSabadoHoje && !isDiaUtilHoje) {
    console.log('   ⚠️ Hoje é domingo ou feriado - não há histórico para comparar');
    await sendLog('⚠️ Hoje é domingo ou feriado - sem histórico', 'warning');
    return null;
  }
  
  const horaAtual = format(currentTime, 'HH:mm');
  console.log(`   ⏰ Horário de referência: ${horaAtual}`);
  await sendLog(`📊 Carregando média consolidada (15 dias válidos até ${horaAtual})...`, 'info');
  
  const historico = [];
  let diasBuscados = 0;
  let diasEncontrados = 0;
  
  // Ajusta o horário de fim considerando o horário de trabalho
  const horarioFimAjustado = ajustarHorarioFim(hoje, currentTime);
  if (!horarioFimAjustado) {
    return null;
  }
  
  // Busca dias anteriores até encontrar 15 dias válidos (excluindo apenas domingos e feriados)
  let dataBusca = subDays(hoje, 1); // Começa do dia anterior
  
  while (diasEncontrados < 15) {
    diasBuscados++;
    
    // Verifica tipo de dia
    const isDomingoBusca = isDomingo(dataBusca);
    const isFeriadoBusca = isFeriado(dataBusca);
    
    // CRÍTICO: Exclui APENAS domingos e feriados
    if (isDomingoBusca) {
      console.log(`   ⚠️ Dia ${format(dataBusca, 'dd/MM/yyyy')} é DOMINGO - EXCLUÍDO do histórico`);
      dataBusca = subDays(dataBusca, 1);
      continue; // Pula para o próximo dia
    }
    
    if (isFeriadoBusca) {
      console.log(`   ⚠️ Dia ${format(dataBusca, 'dd/MM/yyyy')} é FERIADO - EXCLUÍDO do histórico`);
      dataBusca = subDays(dataBusca, 1);
      continue; // Pula para o próximo dia
    }
    
    // INCLUI todos os demais dias (dias úteis E sábados, independente de volume)
    // Cria endTime com mesmo horário para este dia histórico
    const endTime = new Date(
      dataBusca.getFullYear(),
      dataBusca.getMonth(),
      dataBusca.getDate(),
      horarioFimAjustado.getHours(),
      horarioFimAjustado.getMinutes(),
      horarioFimAjustado.getSeconds()
    );
    
    console.log(`   📅 Dia ${diasEncontrados + 1}/15: ${format(dataBusca, 'dd/MM/yyyy')} até ${format(endTime, 'HH:mm')}`);
    
    // ⚠️ MÉTODO CORRETO: Usa report_01 (método correto validado)
    const dadosDia = await fetchDayDataAgregado(dataBusca, endTime);
    
    if (dadosDia) {
      historico.push(dadosDia);
      diasEncontrados++;
    }
    
    // Vai para o dia anterior
    dataBusca = subDays(dataBusca, 1);
    
    // Limite de segurança: não busca mais de 60 dias para trás
    if (diasBuscados > 60) {
      console.log('   ⚠️ Limite de busca atingido (60 dias)');
      break;
    }
    
    // Pequeno delay para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 300));
  }
  
  if (historico.length === 0) {
    console.log('   ⚠️ Nenhum dado histórico encontrado');
    await sendLog('⚠️ Sem dados históricos', 'warning');
    return null;
  }
  
  // Calcula médias (SEM ARREDONDAMENTO)
  const somaAtendidas = historico.reduce((sum, d) => sum + d.atendidas, 0);
  const somaAbandonadas = historico.reduce((sum, d) => sum + d.abandonadas, 0);
  const somaRetidasURA = historico.reduce((sum, d) => sum + d.retidasURA, 0);
  const somaTotal = historico.reduce((sum, d) => sum + d.total, 0);
  
  console.log(`   📊 Somas calculadas (${historico.length} dias):`);
  console.log(`      Atendidas: ${somaAtendidas}, Abandonadas: ${somaAbandonadas}, Retidas URA: ${somaRetidasURA}, Total: ${somaTotal}`);
  
  // MÉDIA ARITMÉTICA SIMPLES (SEM ARREDONDAMENTO)
  const mediaAtendidas = somaAtendidas / historico.length;
  const mediaAbandonadas = somaAbandonadas / historico.length;
  const mediaRetidasURA = somaRetidasURA / historico.length;
  const mediaTotal = somaTotal / historico.length;
  
  // ESPERA MÉDIA PONDERADA (CORRIGIDO)
  // Fórmula correta: soma(espera * totalChamadas) / soma(totalChamadas)
  const somaEsperaPonderada = historico.reduce((sum, d) => {
    const totalChamadasDia = d.total || 0;
    const esperaDia = d.avgWaitTime || 0;
    return sum + (esperaDia * totalChamadasDia);
  }, 0);
  const somaTotalChamadas = historico.reduce((sum, d) => sum + (d.total || 0), 0);
  const mediaEspera = somaTotalChamadas > 0 ? somaEsperaPonderada / somaTotalChamadas : 0;
  
  const horarioInfo = format(horarioFimAjustado, 'HH:mm');
  console.log(`   📈 Médias calculadas (${historico.length} dias até ${horarioInfo}):`);
  console.log(`      Atendidas: ${somaAtendidas} / ${historico.length} = ${mediaAtendidas}`);
  console.log(`      Abandonadas: ${somaAbandonadas} / ${historico.length} = ${mediaAbandonadas}`);
  console.log(`      Retidas URA: ${somaRetidasURA} / ${historico.length} = ${mediaRetidasURA}`);
  console.log(`      Total: ${somaTotal} / ${historico.length} = ${mediaTotal}`);
  console.log(`      Espera média (PONDERADA): ${somaEsperaPonderada} / ${somaTotalChamadas} = ${mediaEspera}s`);
  await sendLog(`✅ Média consolidada: ${historico.length} dias até ${horarioInfo} | Média: ${Math.round(mediaTotal)} recebidas/dia`, 'success');
  
  return {
    dias: historico.length,
    tipoDia: 'consolidado', // Média consolidada (não separa por tipo)
    historico: historico,
    medias: {
      atendidas: mediaAtendidas,
      abandonadas: mediaAbandonadas,
      retidasURA: mediaRetidasURA,
      total: mediaTotal,
      espera: mediaEspera,
    },
    lastUpdate: new Date().toISOString(),
  };
}

/**
 * Busca dados dos últimos N dias (função legada - mantida para compatibilidade)
 * @deprecated Use fetchHistoricalData15DiasUteis() para nova lógica
 * @param {number} days - Quantidade de dias (padrão: 15)
 * @param {Date|null} currentTime - Horário atual (opcional)
 * @returns {Promise<Object>} Histórico e análise
 */
export async function fetchHistoricalData(days = 15, currentTime = null) {
  // Se currentTime fornecido, usa a nova função
  if (currentTime) {
    return await fetchHistoricalData15DiasUteis(currentTime);
  }
  
  // Caso contrário, mantém comportamento antigo (sem filtro de dias úteis)
  console.log(`📊 API-55PBX: Buscando histórico dos últimos ${days} dias (modo legado)...`);
  await sendLog(`📊 Carregando histórico (${days} dias)...`, 'info');
  
  const historico = [];
  const hoje = new Date();
  
  for (let i = 1; i <= days; i++) {
    const data = subDays(hoje, i);
    console.log(`   📅 Dia ${i}/${days}: ${format(data, 'dd/MM/yyyy')}`);
    
    // ⚠️ MÉTODO CORRETO: Usa report_01 (método correto validado)
    const dadosDia = await fetchDayDataAgregado(data, null);
    
    if (dadosDia) {
      historico.push(dadosDia);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  if (historico.length === 0) {
    console.log('   ⚠️ Nenhum dado histórico encontrado');
    await sendLog('⚠️ Sem dados históricos', 'warning');
    return null;
  }
  
  const somaAtendidas = historico.reduce((sum, d) => sum + d.atendidas, 0);
  const somaAbandonadas = historico.reduce((sum, d) => sum + d.abandonadas, 0);
  const somaRetidasURA = historico.reduce((sum, d) => sum + d.retidasURA, 0);
  const somaTotal = historico.reduce((sum, d) => sum + d.total, 0);
  
  console.log(`   📊 Somas calculadas (${historico.length} dias):`);
  console.log(`      Atendidas: ${somaAtendidas}, Abandonadas: ${somaAbandonadas}, Retidas URA: ${somaRetidasURA}, Total: ${somaTotal}`);
  
  const mediaAtendidas = somaAtendidas / historico.length;
  const mediaAbandonadas = somaAbandonadas / historico.length;
  const mediaRetidasURA = somaRetidasURA / historico.length;
  const mediaTotal = somaTotal / historico.length;
  
  console.log(`   📈 Médias calculadas (${historico.length} dias):`);
  console.log(`      Atendidas: ${somaAtendidas} / ${historico.length} = ${mediaAtendidas}`);
  console.log(`      Abandonadas: ${somaAbandonadas} / ${historico.length} = ${mediaAbandonadas}`);
  console.log(`      Retidas URA: ${somaRetidasURA} / ${historico.length} = ${mediaRetidasURA}`);
  console.log(`      Total: ${somaTotal} / ${historico.length} = ${mediaTotal}`);
  await sendLog(`✅ Histórico: ${historico.length} dias | Média: ${mediaAtendidas} atendidas/dia`, 'success');
  
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
  
  const percentual = roundConsistent((valorAtual / media) * 100);
  
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
 * Busca dados escalonados de D-1 até D-N (excluindo domingos e feriados)
 * @param {Date} currentTime - Horário atual de referência
 * @param {number} quantidadeDias - Quantidade de dias para buscar (1 a 7)
 * @returns {Promise<Object|null>} Média dos KPIs dos últimos N dias ou null se não disponível
 */
export async function fetchDadosEscalonados(currentTime, quantidadeDias) {
  const hoje = new Date(currentTime);
  const horaAtualFormatada = format(currentTime, 'HH:mm');
  
  console.log(`📊 API-55PBX: Buscando dados escalonados (últimos ${quantidadeDias} dias úteis até ${horaAtualFormatada})...`);
  console.log(`   📅 Lógica SIMPLES: Buscar D-1, D-2, D-3... até D-${quantidadeDias} e fazer média aritmética`);
  
  // ⚠️ CRÍTICO: Calcula o horário de referência UMA VEZ e usa para TODOS os dias históricos
  // Isso garante que a média seja calculada usando o mesmo período (ex: 8h até 15h)
  const horaAtual = currentTime.getHours();
  const minutoAtual = currentTime.getMinutes();
  
  // Arredonda para o último intervalo completo de 30 minutos
  // Exemplo: 15:00 → 15:00, 15:15 → 15:00, 15:30 → 15:30, 15:45 → 15:30
  const minutosAjustados = Math.floor(minutoAtual / 30) * 30;
  const horarioReferencia = setSeconds(setMinutes(setHours(startOfDay(currentTime), horaAtual), minutosAjustados), 0);
  
  console.log(`   ⏰ Horário de referência: ${format(currentTime, 'HH:mm:ss')} → Ajustado para: ${format(horarioReferencia, 'HH:mm:ss')}`);
  console.log(`   📊 Todos os dias históricos usarão período das 8h até ${format(horarioReferencia, 'HH:mm')}`);
  
  // Ajusta o horário de fim considerando o horário de trabalho
  const horarioFimAjustado = ajustarHorarioFim(hoje, horarioReferencia);
  if (!horarioFimAjustado) {
    console.log('   ⚠️ Não foi possível ajustar horário');
    return null;
  }
  
  // Data mínima: 12/01/2026 00:00:00 (não busca dados antes dessa data)
  const dataMinima = new Date(2026, 0, 12, 0, 0, 0, 0); // 12/01/2026
  const dataMinimaFormatada = format(dataMinima, 'dd/MM/yyyy');
  const dataMinimaInicio = startOfDay(dataMinima);
  
  console.log(`   🚨 DATA MÍNIMA DEFINIDA: ${dataMinimaFormatada} - NÃO BUSCAR DADOS ANTES DESSA DATA`);
  
  const historico = [];
  const hojeFormatado = format(hoje, 'dd/MM/yyyy');
  let dataBusca = subDays(hoje, 1); // Começa do dia anterior (D-1)
  let diasEncontrados = 0;
  let diasBuscados = 0;
  const limiteBusca = 30;
  
  console.log(`   🚨 VALIDAÇÃO: Hoje é ${hojeFormatado} - NÃO incluir dados de hoje no histórico!`);
  
  // Busca os últimos N dias úteis (D-1, D-2, D-3...)
  while (diasEncontrados < quantidadeDias && diasBuscados < limiteBusca) {
    diasBuscados++;
    
    // Verifica se a data está antes da data mínima (12/01/2026)
    // Compara apenas a data (sem hora) para garantir que não busque antes de 12/01/2026
    const dataBuscaInicio = startOfDay(dataBusca);
    const hojeInicio = startOfDay(hoje);
    
    // VALIDAÇÃO CRÍTICA: NÃO incluir dados de HOJE
    if (dataBuscaInicio.getTime() === hojeInicio.getTime()) {
      console.log(`   🚨 ERRO CRÍTICO: Tentando buscar dados de HOJE (${hojeFormatado}) - PULANDO!`);
      dataBusca = subDays(dataBusca, 1);
      continue;
    }
    
    if (dataBuscaInicio < dataMinimaInicio) {
      console.log(`   🚨 PARANDO BUSCA: Dia ${format(dataBusca, 'dd/MM/yyyy')} está ANTES da data mínima (${dataMinimaFormatada})`);
      console.log(`   🚨 NÃO BUSCAR DADOS ANTES DE ${dataMinimaFormatada}`);
      break;
    }
    
    // Verifica se a data é exatamente 12/01/2026 ou depois
    if (dataBuscaInicio.getTime() === dataMinimaInicio.getTime()) {
      console.log(`   ✅ Data ${format(dataBusca, 'dd/MM/yyyy')} é a data mínima (${dataMinimaFormatada}) - OK para buscar`);
    }
    
    // Verifica se é domingo ou feriado
    if (isDomingo(dataBusca) || isFeriado(dataBusca)) {
      console.log(`   ⚠️ Dia ${format(dataBusca, 'dd/MM/yyyy')} é domingo ou feriado - pulando...`);
      dataBusca = subDays(dataBusca, 1);
      
      // Verifica novamente se não passou da data mínima após pular
      const dataBuscaInicioNovo = startOfDay(dataBusca);
      if (dataBuscaInicioNovo < dataMinimaInicio) {
        console.log(`   🚨 Após pular domingo/feriado, chegou antes de ${dataMinimaFormatada} - parando busca`);
        break;
      }
      continue;
    }
    
    // ⚠️ CRÍTICO: Usa o MESMO horário de referência para TODOS os dias históricos
    // Cria horário de início: 8h da manhã do dia histórico
    const horarioInicio = setSeconds(setMinutes(setHours(startOfDay(dataBusca), 8), 0), 0);
    
    // Aplica o mesmo horário de referência ao dia histórico
    // Exemplo: se são 15h00 agora, busca até 15h00 de cada dia histórico
    let horarioFimDiaHistorico = setSeconds(
      setMinutes(
        setHours(
          startOfDay(dataBusca), 
          horarioReferencia.getHours()
        ), 
        horarioReferencia.getMinutes()
      ), 
      0
    );
    
    // Se o horário de referência for antes das 8h, usa 8h como fim (período mínimo)
    if (horarioFimDiaHistorico < horarioInicio) {
      console.log(`   ⚠️ Horário de referência (${format(horarioReferencia, 'HH:mm')}) é antes das 8h - usando período mínimo (8h às 8h)`);
      horarioFimDiaHistorico = horarioInicio;
    }
    
    console.log(`   📅 Buscando D-${diasEncontrados + 1}: ${format(dataBusca, 'dd/MM/yyyy')} (PERÍODO: ${format(horarioInicio, 'HH:mm:ss')} até ${format(horarioFimDiaHistorico, 'HH:mm:ss')})`);
    console.log(`      ⚠️ Usando período das 8h até ${format(horarioReferencia, 'HH:mm')} para calcular média correta`);
    
    // ⚠️ MÉTODO CORRETO: Usa report_01 (método correto validado) - NÃO usar fetchDayData que usa report_02
    // Passa o horário de fim para buscar apenas o período das 8h até o horário de referência
    const dadosDia = await fetchDayDataAgregado(dataBusca, horarioFimDiaHistorico);
    
    if (dadosDia) {
      console.log(`      ✅ Dados obtidos da API: Total: ${dadosDia.total}, Atendidas: ${dadosDia.atendidas}, Abandonadas: ${dadosDia.abandonadas}`);
    } else {
      console.log(`      ⚠️ Nenhum dado retornado da API para ${format(dataBusca, 'dd/MM/yyyy')} até ${format(horarioFimDiaHistorico, 'HH:mm:ss')}`);
    }
    
    if (dadosDia) {
      const diaHistorico = {
        data: format(dataBusca, 'dd/MM/yyyy'),
        atendidas: dadosDia.atendidas || 0,
        abandonadas: dadosDia.abandonadas || 0,
        total: dadosDia.total || 0,
        avgWaitTime: dadosDia.avgWaitTime || 0,
      };
      historico.push(diaHistorico);
      console.log(`   ✅ D-${diasEncontrados + 1} obtido: ${format(dataBusca, 'dd/MM/yyyy')} - Total: ${diaHistorico.total} (Atendidas: ${diaHistorico.atendidas}, Abandonadas: ${diaHistorico.abandonadas})`);
      console.log(`      🔍 VALORES BRUTOS DA API: atendidas=${dadosDia.atendidas}, abandonadas=${dadosDia.abandonadas}, total=${dadosDia.total}`);
      diasEncontrados++;
    } else {
      console.log(`   ⚠️ D-${diasEncontrados + 1} (${format(dataBusca, 'dd/MM/yyyy')}) retornou null - NÃO ADICIONADO AO HISTÓRICO`);
    }
    
    // Vai para o dia anterior
    dataBusca = subDays(dataBusca, 1);
    
    // Verifica ANTES de continuar o loop se não passou da data mínima
    const dataBuscaInicioProximo = startOfDay(dataBusca);
    if (dataBuscaInicioProximo < dataMinimaInicio) {
      console.log(`   🚨 Próximo dia (${format(dataBusca, 'dd/MM/yyyy')}) está antes de ${dataMinimaFormatada} - parando busca`);
      break;
    }
    
    // Pequeno delay para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 300));
  }
  
  // VALIDAÇÃO FINAL: Garante que nenhum dia antes de 12/01/2026 foi incluído
  const historicoFiltrado = historico.filter(dia => {
    // Converte string "dd/MM/yyyy" para Date
    const partes = dia.data.split('/');
    const dataDia = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
    const dataDiaInicio = startOfDay(dataDia);
    if (dataDiaInicio < dataMinimaInicio) {
      console.log(`   🚨 REMOVENDO dia ${dia.data} do histórico - está antes de 12/01/2026`);
      return false;
    }
    return true;
  });
  
  if (historicoFiltrado.length === 0) {
    console.log(`   ⚠️ Nenhum dado encontrado para comparação escalonada (todos os dias estavam antes de 12/01/2026)`);
    return null;
  }
  
  // Substitui o histórico pelo filtrado
  historico.length = 0;
  historico.push(...historicoFiltrado);
  
  console.log(`   ✅ Histórico final validado: ${historico.length} dias (todos a partir de 12/01/2026)`);
  
  // Calcula médias ARITMÉTICAS SIMPLES
  console.log(`   📊 Dados no histórico (${historico.length} dias):`);
  historico.forEach((dia, index) => {
    console.log(`      D-${index + 1}: ${dia.data} - Total: ${dia.total} (Atendidas: ${dia.atendidas}, Abandonadas: ${dia.abandonadas})`);
  });
  
  // SOMA dos totais dos últimos dias (d-1 + d-2 + d-3 + d-4 = xx)
  console.log(`   🔢 CALCULANDO SOMA PASSO A PASSO:`);
  let somaAtendidas = 0;
  let somaAbandonadas = 0;
  let somaTotal = 0;
  
  historico.forEach((dia, index) => {
    const antesTotal = somaTotal;
    somaAtendidas += dia.atendidas || 0;
    somaAbandonadas += dia.abandonadas || 0;
    somaTotal += dia.total || 0;
    console.log(`      D-${index + 1} (${dia.data}): Total ${dia.total} → Soma acumulada: ${antesTotal} + ${dia.total} = ${somaTotal}`);
  });
  
  const somaEsperaPonderada = historico.reduce((sum, d) => sum + ((d.avgWaitTime || 0) * (d.total || 0)), 0);
  
  console.log(`   ✅ SOMA FINAL:`);
  console.log(`      Total: ${somaTotal} (soma de ${historico.length} dias: ${historico.map(d => d.total).join(' + ')} = ${somaTotal})`);
  console.log(`      Atendidas: ${somaAtendidas}, Abandonadas: ${somaAbandonadas}`);
  
  // MÉDIA ARITMÉTICA SIMPLES: soma / quantidade
  const mediaAtendidas = somaAtendidas / historico.length;
  const mediaAbandonadas = somaAbandonadas / historico.length;
  const mediaTotal = somaTotal / historico.length;
  const mediaEspera = somaTotal > 0 ? somaEsperaPonderada / somaTotal : 0;
  
  console.log(`   ✅ Média ARITMÉTICA SIMPLES calculada (${historico.length} dias):`);
  console.log(`      Total: ${somaTotal} / ${historico.length} = ${mediaTotal.toFixed(2)}`);
  console.log(`      Atendidas: ${mediaAtendidas.toFixed(2)}, Abandonadas: ${mediaAbandonadas.toFixed(2)}`);
  
  return {
    quantidadeDias: historico.length,
    historico: historico,
    medias: {
      atendidas: mediaAtendidas,
      abandonadas: mediaAbandonadas,
      total: mediaTotal,
      espera: mediaEspera,
    },
  };
}

/**
 * Busca dados para dias específicos (usado na nova lógica de comparação por dia da semana)
 * @param {Date} currentTime - Horário atual de referência
 * @param {Array<Date>} datasParaBuscar - Array de datas específicas para buscar
 * @returns {Promise<Object|null>} Histórico e médias ou null se não houver dados
 */
export async function fetchDadosPorDiasEspecificos(currentTime, datasParaBuscar) {
  if (!datasParaBuscar || datasParaBuscar.length === 0) {
    console.log(`   ⚠️ Nenhuma data especificada para busca`);
    return null;
  }
  
  const hoje = new Date(currentTime);
  const horaAtualFormatada = format(currentTime, 'HH:mm');
  
  console.log(`📊 API-55PBX: Buscando dados para ${datasParaBuscar.length} dia(s) específico(s) até ${horaAtualFormatada}...`);
  console.log(`   📋 Datas a buscar: ${datasParaBuscar.map(d => format(d, 'dd/MM/yyyy')).join(', ')}`);
  
  // ⚠️ CRÍTICO: Calcula o horário de referência UMA VEZ e usa para TODOS os dias históricos
  // Isso garante que a média seja calculada usando o mesmo período (ex: 8h até 15h)
  const horaAtual = currentTime.getHours();
  const minutoAtual = currentTime.getMinutes();
  
  // Arredonda para o último intervalo completo de 30 minutos
  // Exemplo: 15:00 → 15:00, 15:15 → 15:00, 15:30 → 15:30, 15:45 → 15:30
  const minutosAjustados = Math.floor(minutoAtual / 30) * 30;
  const horarioReferencia = setSeconds(setMinutes(setHours(startOfDay(currentTime), horaAtual), minutosAjustados), 0);
  
  console.log(`   ⏰ Horário de referência: ${format(currentTime, 'HH:mm:ss')} → Ajustado para: ${format(horarioReferencia, 'HH:mm:ss')}`);
  console.log(`   📊 Todos os dias históricos usarão período das 8h até ${format(horarioReferencia, 'HH:mm')}`);
  
  // Data mínima: 12/01/2026 00:00:00 (não busca dados antes dessa data)
  const dataMinima = new Date(2026, 0, 12, 0, 0, 0, 0); // 12/01/2026
  const dataMinimaFormatada = format(dataMinima, 'dd/MM/yyyy');
  const dataMinimaInicio = startOfDay(dataMinima);
  
  console.log(`   🚨 DATA MÍNIMA DEFINIDA: ${dataMinimaFormatada} - NÃO BUSCAR DADOS ANTES DESSA DATA`);
  
  const historico = [];
  const hojeFormatado = format(hoje, 'dd/MM/yyyy');
  
  console.log(`   🚨 VALIDAÇÃO: Hoje é ${hojeFormatado} - NÃO incluir dados de hoje no histórico!`);
  
  // Busca dados para cada data específica
  for (let i = 0; i < datasParaBuscar.length; i++) {
    const dataBusca = datasParaBuscar[i];
    const dataBuscaFormatada = format(dataBusca, 'dd/MM/yyyy');
    
    // VALIDAÇÃO CRÍTICA: NÃO incluir dados de HOJE
    const dataBuscaInicio = startOfDay(dataBusca);
    const hojeInicio = startOfDay(hoje);
    
    if (dataBuscaInicio.getTime() === hojeInicio.getTime()) {
      console.log(`   🚨 ERRO CRÍTICO: Tentando buscar dados de HOJE (${hojeFormatado}) - PULANDO!`);
      continue;
    }
    
    // Verifica se está antes da data mínima
    if (dataBuscaInicio < dataMinimaInicio) {
      console.log(`   🚨 PULANDO: Dia ${dataBuscaFormatada} está ANTES da data mínima (${dataMinimaFormatada})`);
      continue;
    }
    
    // Verifica se é domingo ou feriado
    if (isDomingo(dataBusca) || isFeriado(dataBusca)) {
      console.log(`   ⚠️ Dia ${dataBuscaFormatada} é domingo ou feriado - pulando...`);
      continue;
    }
    
    // ⚠️ CRÍTICO: Usa o MESMO horário de referência para TODOS os dias históricos
    // Cria horário de início: 8h da manhã do dia histórico
    const horarioInicio = setSeconds(setMinutes(setHours(startOfDay(dataBusca), 8), 0), 0);
    
    // Aplica o mesmo horário de referência ao dia histórico
    // Exemplo: se são 15h00 agora, busca até 15h00 de cada dia histórico
    let horarioFimDiaHistorico = setSeconds(
      setMinutes(
        setHours(
          startOfDay(dataBusca), 
          horarioReferencia.getHours()
        ), 
        horarioReferencia.getMinutes()
      ), 
      0
    );
    
    // Se o horário de referência for antes das 8h, usa 8h como fim (período mínimo)
    if (horarioFimDiaHistorico < horarioInicio) {
      console.log(`   ⚠️ Horário de referência (${format(horarioReferencia, 'HH:mm')}) é antes das 8h - usando período mínimo (8h às 8h)`);
      horarioFimDiaHistorico = horarioInicio;
    }
    
    console.log(`   📅 Buscando dia ${i + 1}/${datasParaBuscar.length}: ${dataBuscaFormatada} (PERÍODO: ${format(horarioInicio, 'HH:mm:ss')} até ${format(horarioFimDiaHistorico, 'HH:mm:ss')})`);
    console.log(`      ⚠️ Usando período das 8h até ${format(horarioReferencia, 'HH:mm')} para calcular média correta`);
    
    // ⚠️ MÉTODO CORRETO: Usa fetchDayDataAgregado que já usa arquivo de referência para dias anteriores
    // Passa o horário de fim para buscar apenas o período das 8h até o horário de referência
    const dadosDia = await fetchDayDataAgregado(dataBusca, horarioFimDiaHistorico);
    
    if (dadosDia) {
      console.log(`      ✅ Dados obtidos: Total: ${dadosDia.total}, Atendidas: ${dadosDia.atendidas}, Abandonadas: ${dadosDia.abandonadas}`);
      
      const diaHistorico = {
        data: dataBuscaFormatada,
        atendidas: dadosDia.atendidas || 0,
        abandonadas: dadosDia.abandonadas || 0,
        total: dadosDia.total || 0,
        avgWaitTime: dadosDia.avgWaitTime || 0,
      };
      historico.push(diaHistorico);
      console.log(`   ✅ Dia ${i + 1} obtido: ${dataBuscaFormatada} - Total: ${diaHistorico.total} (Atendidas: ${diaHistorico.atendidas}, Abandonadas: ${diaHistorico.abandonadas})`);
    } else {
      console.log(`   ⚠️ Dia ${i + 1} (${dataBuscaFormatada}) retornou null - NÃO ADICIONADO AO HISTÓRICO`);
    }
    
    // Pequeno delay para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 300));
  }
  
  if (historico.length === 0) {
    console.log(`   ⚠️ Nenhum dado encontrado para os dias especificados`);
    return null;
  }
  
  console.log(`   ✅ Histórico final: ${historico.length} dias`);
  
  // Calcula médias ARITMÉTICAS SIMPLES
  console.log(`   📊 Dados no histórico (${historico.length} dias):`);
  historico.forEach((dia, index) => {
    console.log(`      Dia ${index + 1}: ${dia.data} - Total: ${dia.total} (Atendidas: ${dia.atendidas}, Abandonadas: ${dia.abandonadas})`);
  });
  
  // SOMA dos totais dos dias encontrados
  console.log(`   🔢 CALCULANDO SOMA PASSO A PASSO:`);
  let somaAtendidas = 0;
  let somaAbandonadas = 0;
  let somaTotal = 0;
  
  historico.forEach((dia, index) => {
    const antesTotal = somaTotal;
    somaAtendidas += dia.atendidas || 0;
    somaAbandonadas += dia.abandonadas || 0;
    somaTotal += dia.total || 0;
    console.log(`      Dia ${index + 1} (${dia.data}): Total ${dia.total} → Soma acumulada: ${antesTotal} + ${dia.total} = ${somaTotal}`);
  });
  
  const somaEsperaPonderada = historico.reduce((sum, d) => sum + ((d.avgWaitTime || 0) * (d.total || 0)), 0);
  
  console.log(`   ✅ SOMA FINAL:`);
  console.log(`      Total: ${somaTotal} (soma de ${historico.length} dias: ${historico.map(d => d.total).join(' + ')} = ${somaTotal})`);
  console.log(`      Atendidas: ${somaAtendidas}, Abandonadas: ${somaAbandonadas}`);
  
  // MÉDIA ARITMÉTICA SIMPLES: soma / quantidade
  const mediaAtendidas = somaAtendidas / historico.length;
  const mediaAbandonadas = somaAbandonadas / historico.length;
  const mediaTotal = somaTotal / historico.length;
  const mediaEspera = somaTotal > 0 ? somaEsperaPonderada / somaTotal : 0;
  
  console.log(`   ✅ Média ARITMÉTICA SIMPLES calculada (${historico.length} dias):`);
  console.log(`      Total: ${somaTotal} / ${historico.length} = ${mediaTotal.toFixed(2)}`);
  console.log(`      Atendidas: ${mediaAtendidas.toFixed(2)}, Abandonadas: ${mediaAbandonadas.toFixed(2)}`);
  
  return {
    quantidadeDias: historico.length,
    historico: historico,
    medias: {
      atendidas: mediaAtendidas,
      abandonadas: mediaAbandonadas,
      total: mediaTotal,
      espera: mediaEspera,
    },
  };
}

/**
 * Busca KPIs do dia anterior (D-1) - mantido para compatibilidade
 * @param {Date} currentTime - Horário atual de referência
 * @returns {Promise<Object|null>} KPIs do dia anterior ou null se não disponível
 */
export async function fetchDiaAnterior(currentTime) {
  const hoje = new Date(currentTime);
  const ontem = subDays(hoje, 1);
  const dataOntem = format(ontem, 'dd/MM/yyyy');
  
  console.log(`📊 API-55PBX: Buscando dados de ontem (${dataOntem})...`);
  
  // Ajusta o horário de fim considerando o horário de trabalho do dia anterior
  const horarioFimAjustado = ajustarHorarioFim(ontem, currentTime);
  if (!horarioFimAjustado) {
    console.log('   ⚠️ Não foi possível ajustar horário para ontem');
    return null;
  }
  
  // Cria endTime com mesmo horário para o dia anterior
  const endTime = new Date(
    ontem.getFullYear(),
    ontem.getMonth(),
    ontem.getDate(),
    horarioFimAjustado.getHours(),
    horarioFimAjustado.getMinutes(),
    horarioFimAjustado.getSeconds()
  );
  
  console.log(`   📅 Buscando dados de ${dataOntem} até ${format(endTime, 'HH:mm')}`);
  
  // ⚠️ MÉTODO CORRETO: Usa report_01 (método correto validado)
  const dadosOntem = await fetchDayDataAgregado(ontem, endTime);
  
  if (!dadosOntem) {
    console.log('   ⚠️ Nenhum dado encontrado para ontem');
    return null;
  }
  
  console.log(`   ✅ Dados de ontem encontrados: ${dadosOntem.total} chamadas`);
  
  return {
    data: dataOntem,
    atendidas: dadosOntem.atendidas,
    abandonadas: dadosOntem.abandonadas,
    retidasURA: dadosOntem.retidasURA || 0,  // report_01 não retorna, mantém 0
    total: dadosOntem.total,
    avgWaitTime: dadosOntem.avgWaitTime || 0,
  };
}

/**
 * Verifica se existe dados de referência para uma data específica
 * @param {Date} data - Data a verificar
 * @returns {boolean} True se existir dados de referência
 */
function temDadosReferencia(data) {
  const refData = getReferenceDataForPeriod(data, startOfDay(data), endOfDay(data));
  return refData !== null && refData.total !== undefined;
}

/**
 * Encontra TODAS as segundas-feiras anteriores (pulando domingos e feriados)
 * @param {Date} date - Data de referência
 * @param {Date} dataMinima - Data mínima permitida
 * @returns {Array<Date>} Array de datas das segundas anteriores (do mais recente ao mais antigo)
 */
function encontrarTodasSegundasAnteriores(date, dataMinima) {
  const segundas = [];
  let dataBusca = subDays(date, 1);
  let tentativas = 0;
  const limiteTentativas = 60; // Máximo ~2 meses para trás (8-9 segundas)
  
  while (tentativas < limiteTentativas) {
    tentativas++;
    
    // Verifica se passou da data mínima
    if (startOfDay(dataBusca) < startOfDay(dataMinima)) {
      break;
    }
    
    // Verifica se é segunda-feira e não é feriado
    if (getDay(dataBusca) === 1 && !isFeriado(dataBusca)) {
      // Só adiciona se tiver dados de referência
      if (temDadosReferencia(dataBusca)) {
        segundas.push(new Date(dataBusca));
        console.log(`      ✅ Segunda encontrada: ${format(dataBusca, 'dd/MM/yyyy')}`);
      }
      // Pula 7 dias para a próxima segunda
      dataBusca = subDays(dataBusca, 7);
    } else {
      // Vai para o dia anterior
      dataBusca = subDays(dataBusca, 1);
    }
  }
  
  // Ordena do mais recente ao mais antigo
  segundas.sort((a, b) => b.getTime() - a.getTime());
  
  return segundas;
}

/**
 * Encontra TODOS os sábados anteriores (pulando domingos e feriados)
 * @param {Date} date - Data de referência
 * @param {Date} dataMinima - Data mínima permitida
 * @returns {Array<Date>} Array de datas dos sábados anteriores (do mais recente ao mais antigo)
 */
function encontrarTodosSabadosAnteriores(date, dataMinima) {
  const sabados = [];
  let dataBusca = subDays(date, 1);
  let tentativas = 0;
  const limiteTentativas = 60; // Máximo ~2 meses para trás (8-9 sábados)
  
  while (tentativas < limiteTentativas) {
    tentativas++;
    
    // Verifica se passou da data mínima
    if (startOfDay(dataBusca) < startOfDay(dataMinima)) {
      break;
    }
    
    // Verifica se é sábado e não é feriado
    if (getDay(dataBusca) === 6 && !isFeriado(dataBusca)) {
      // Só adiciona se tiver dados de referência
      if (temDadosReferencia(dataBusca)) {
        sabados.push(new Date(dataBusca));
        console.log(`      ✅ Sábado encontrado: ${format(dataBusca, 'dd/MM/yyyy')}`);
      }
      // Pula 7 dias para o próximo sábado
      dataBusca = subDays(dataBusca, 7);
    } else {
      // Vai para o dia anterior
      dataBusca = subDays(dataBusca, 1);
    }
  }
  
  // Ordena do mais recente ao mais antigo
  sabados.sort((a, b) => b.getTime() - a.getTime());
  
  return sabados;
}

/**
 * Encontra um dia específico da semana atual (segunda, terça, quarta, quinta, sexta)
 * @param {Date} date - Data de referência (hoje)
 * @param {number} diaSemanaDesejado - Dia da semana desejado (1=segunda, 2=terça, ..., 5=sexta)
 * @returns {Date|null} Data do dia encontrado ou null se não encontrado
 */
function encontrarDiaDaSemanaAtual(date, diaSemanaDesejado) {
  const hoje = new Date(date);
  const diaSemanaHoje = getDay(hoje); // 0=domingo, 1=segunda, ..., 6=sábado
  
  // Se o dia desejado ainda não passou nesta semana (ou é hoje), não encontramos
  // Exemplo: hoje é terça (2), queremos segunda (1) → 2 > 1 → encontra
  // Exemplo: hoje é segunda (1), queremos segunda (1) → 1 <= 1 → não encontra (é hoje)
  if (diaSemanaHoje <= diaSemanaDesejado) {
    return null;
  }
  
  // Calcula quantos dias voltar
  const diasParaVoltar = diaSemanaHoje - diaSemanaDesejado;
  const dataEncontrada = subDays(hoje, diasParaVoltar);
  
  // Verifica se não é feriado
  if (isFeriado(dataEncontrada)) {
    return null;
  }
  
  return dataEncontrada;
}

/**
 * Busca dias específicos para comparação baseado no dia da semana atual
 * Segunda: compara com TODAS as segundas anteriores (que têm dados de referência)
 * Terça: compara com segunda da semana atual
 * Quarta: compara com terça e segunda da semana atual
 * Quinta: compara com quarta, terça e segunda da semana atual
 * Sexta: compara com quinta, quarta, terça e segunda da semana atual
 * Sábado: compara com TODOS os sábados anteriores (que têm dados de referência)
 * Domingo: retorna array vazio
 * @param {Date} currentTime - Data/hora atual
 * @returns {Array<Date>} Array de datas para buscar (ordenadas do mais recente ao mais antigo)
 */
function buscarDiasEspecificosParaComparacao(currentTime) {
  const hoje = new Date(currentTime);
  const diaSemana = getDay(hoje); // 0=domingo, 1=segunda, ..., 6=sábado
  const dataMinima = new Date(2026, 0, 12, 0, 0, 0, 0); // 12/01/2026
  
  const datasParaBuscar = [];
  
  // Domingo: não processa
  if (diaSemana === 0 || isFeriado(hoje)) {
    console.log(`   ⚠️ Hoje (${format(hoje, 'dd/MM/yyyy')}) é domingo ou feriado - sem comparação`);
    return [];
  }
  
  // Segunda-feira: busca TODAS as segundas anteriores
  if (diaSemana === 1) {
    console.log(`   📅 Segunda-feira: Buscando TODAS as segundas anteriores...`);
    const segundasAnteriores = encontrarTodasSegundasAnteriores(hoje, dataMinima);
    if (segundasAnteriores.length > 0) {
      datasParaBuscar.push(...segundasAnteriores);
      console.log(`   ✅ ${segundasAnteriores.length} segunda(s) anterior(es) encontrada(s)`);
    } else {
      console.log(`   ⚠️ Nenhuma segunda anterior encontrada ou sem dados de referência`);
    }
  }
  
  // Terça-feira: busca segunda da semana atual, se não encontrar, busca segunda da semana passada
  else if (diaSemana === 2) {
    console.log(`   📅 Terça-feira: Buscando segunda da semana atual...`);
    let segunda = encontrarDiaDaSemanaAtual(hoje, 1);
    
    // Se não encontrou segunda da semana atual ou não tem dados, busca segunda da semana passada
    if (!segunda || !temDadosReferencia(segunda)) {
      console.log(`   ⚠️ Segunda da semana atual não encontrada ou sem dados, buscando segunda da semana passada...`);
      const segundaSemanaPassada = subDays(hoje, 7); // 7 dias atrás
      const diaSemanaSegundaPassada = getDay(segundaSemanaPassada);
      
      // Se 7 dias atrás não é segunda, ajusta para a segunda mais próxima
      if (diaSemanaSegundaPassada !== 1) {
        const diferenca = diaSemanaSegundaPassada === 0 ? 1 : (diaSemanaSegundaPassada === 1 ? 0 : 1 - diaSemanaSegundaPassada);
        segunda = subDays(segundaSemanaPassada, diferenca);
      } else {
        segunda = segundaSemanaPassada;
      }
      
      if (segunda && temDadosReferencia(segunda)) {
        datasParaBuscar.push(segunda);
        console.log(`   ✅ Segunda da semana passada encontrada: ${format(segunda, 'dd/MM/yyyy')}`);
      } else {
        console.log(`   ⚠️ Segunda não encontrada ou sem dados de referência`);
      }
    } else {
      datasParaBuscar.push(segunda);
      console.log(`   ✅ Segunda encontrada: ${format(segunda, 'dd/MM/yyyy')}`);
    }
  }
  
  // Quarta-feira: busca terça e segunda da semana atual
  else if (diaSemana === 3) {
    console.log(`   📅 Quarta-feira: Buscando terça e segunda da semana atual...`);
    const terca = encontrarDiaDaSemanaAtual(hoje, 2);
    const segunda = encontrarDiaDaSemanaAtual(hoje, 1);
    
    if (terca && temDadosReferencia(terca)) {
      datasParaBuscar.push(terca);
      console.log(`   ✅ Terça encontrada: ${format(terca, 'dd/MM/yyyy')}`);
    }
    if (segunda && temDadosReferencia(segunda)) {
      datasParaBuscar.push(segunda);
      console.log(`   ✅ Segunda encontrada: ${format(segunda, 'dd/MM/yyyy')}`);
    }
  }
  
  // Quinta-feira: busca quarta, terça e segunda da semana atual
  else if (diaSemana === 4) {
    console.log(`   📅 Quinta-feira: Buscando quarta, terça e segunda da semana atual...`);
    const quarta = encontrarDiaDaSemanaAtual(hoje, 3);
    const terca = encontrarDiaDaSemanaAtual(hoje, 2);
    const segunda = encontrarDiaDaSemanaAtual(hoje, 1);
    
    if (quarta && temDadosReferencia(quarta)) {
      datasParaBuscar.push(quarta);
      console.log(`   ✅ Quarta encontrada: ${format(quarta, 'dd/MM/yyyy')}`);
    }
    if (terca && temDadosReferencia(terca)) {
      datasParaBuscar.push(terca);
      console.log(`   ✅ Terça encontrada: ${format(terca, 'dd/MM/yyyy')}`);
    }
    if (segunda && temDadosReferencia(segunda)) {
      datasParaBuscar.push(segunda);
      console.log(`   ✅ Segunda encontrada: ${format(segunda, 'dd/MM/yyyy')}`);
    }
  }
  
  // Sexta-feira: busca quinta, quarta, terça e segunda da semana atual
  else if (diaSemana === 5) {
    console.log(`   📅 Sexta-feira: Buscando quinta, quarta, terça e segunda da semana atual...`);
    const quinta = encontrarDiaDaSemanaAtual(hoje, 4);
    const quarta = encontrarDiaDaSemanaAtual(hoje, 3);
    const terca = encontrarDiaDaSemanaAtual(hoje, 2);
    const segunda = encontrarDiaDaSemanaAtual(hoje, 1);
    
    if (quinta && temDadosReferencia(quinta)) {
      datasParaBuscar.push(quinta);
      console.log(`   ✅ Quinta encontrada: ${format(quinta, 'dd/MM/yyyy')}`);
    }
    if (quarta && temDadosReferencia(quarta)) {
      datasParaBuscar.push(quarta);
      console.log(`   ✅ Quarta encontrada: ${format(quarta, 'dd/MM/yyyy')}`);
    }
    if (terca && temDadosReferencia(terca)) {
      datasParaBuscar.push(terca);
      console.log(`   ✅ Terça encontrada: ${format(terca, 'dd/MM/yyyy')}`);
    }
    if (segunda && temDadosReferencia(segunda)) {
      datasParaBuscar.push(segunda);
      console.log(`   ✅ Segunda encontrada: ${format(segunda, 'dd/MM/yyyy')}`);
    }
  }
  
  // Sábado: busca TODOS os sábados anteriores
  else if (diaSemana === 6) {
    console.log(`   📅 Sábado: Buscando TODOS os sábados anteriores...`);
    const sabadosAnteriores = encontrarTodosSabadosAnteriores(hoje, dataMinima);
    if (sabadosAnteriores.length > 0) {
      datasParaBuscar.push(...sabadosAnteriores);
      console.log(`   ✅ ${sabadosAnteriores.length} sábado(s) anterior(es) encontrado(s)`);
    } else {
      console.log(`   ⚠️ Nenhum sábado anterior encontrado ou sem dados de referência`);
    }
  }
  
  // Ordena do mais recente ao mais antigo
  datasParaBuscar.sort((a, b) => b.getTime() - a.getTime());
  
  console.log(`   📊 Total de dias encontrados para comparação: ${datasParaBuscar.length}`);
  if (datasParaBuscar.length > 0) {
    console.log(`   📋 Datas: ${datasParaBuscar.map(d => format(d, 'dd/MM/yyyy')).join(', ')}`);
  }
  
  return datasParaBuscar;
}

/**
 * Determina o número do dia útil da semana (1 a 6, excluindo domingos e feriados)
 * Retorna o número do dia da semana atual
 * @param {Date} date - Data de referência
 * @returns {number} Número do dia útil (1 a 6, onde 1=segunda, 2=terça, ..., 6=sábado, 0=domingo/feriado)
 */
function getDiaUtilSemana(date) {
  // Retorna o número do dia da semana diretamente
  // 1 = segunda
  // 2 = terça
  // 3 = quarta
  // 4 = quinta
  // 5 = sexta
  // 6 = sábado
  // 0 = domingo/feriado (não processa)
  
  const hoje = new Date(date);
  const diaSemana = getDay(hoje); // 0 = domingo, 1 = segunda, ..., 6 = sábado
  
  // Se for domingo ou feriado, retorna 0 (não deve processar)
  if (isDomingo(hoje) || isFeriado(hoje)) {
    console.log(`   ⚠️ getDiaUtilSemana: Hoje (${format(hoje, 'dd/MM/yyyy')}) é domingo ou feriado - retorna 0`);
    return 0;
  }
  
  // Retorna o número do dia da semana diretamente
  // Segunda = 1, Terça = 2, Quarta = 3, Quinta = 4, Sexta = 5, Sábado = 6
  const resultado = diaSemana === 0 ? 0 : diaSemana; // 0 = domingo, já tratado acima
  
  console.log(`   🔍 getDiaUtilSemana: Hoje é ${format(hoje, 'dd/MM/yyyy')} (dia da semana: ${diaSemana})`);
  console.log(`   🔍 getDiaUtilSemana: Retornando ${resultado} (será usado para calcular quantidade de dias anteriores da semana atual)`);
  
  return Math.min(resultado, 7); // Máximo 7 dias
}

/**
 * Analisa o dia atual com comparação por dia da semana específico
 * Segunda: compara com TODAS as segundas anteriores (que têm dados de referência)
 * Terça: compara com segunda da semana atual
 * Quarta: compara com terça e segunda da semana atual
 * Quinta: compara com quarta, terça e segunda da semana atual
 * Sexta: compara com quinta, quarta, terça e segunda da semana atual
 * Sábado: compara com TODOS os sábados anteriores (que têm dados de referência)
 * Domingo: retorna erro
 * @returns {Promise<Object>} Análise completa
 */
export async function analisarDiaAtual() {
  console.log('📊 API-55PBX: Analisando dia atual com comparação por dia da semana...');
  
  // Captura o horário atual UMA ÚNICA VEZ
  const agora = new Date();
  const horaAtual = format(agora, 'HH:mm');
  const dataAtual = format(agora, 'dd/MM/yyyy');
  const diaSemana = getDay(agora);
  console.log(`   ⏰ Horário de referência: ${horaAtual}`);
  console.log(`   📅 Data: ${dataAtual}`);
  console.log(`   📅 Dia da semana: ${diaSemana} (${diaSemana === 0 ? 'domingo' : diaSemana === 1 ? 'segunda' : diaSemana === 2 ? 'terça' : diaSemana === 3 ? 'quarta' : diaSemana === 4 ? 'quinta' : diaSemana === 5 ? 'sexta' : 'sábado'})`);
  
  // Verifica se é dia útil ou sábado
  if (!isDiaUtil(agora) && !isSabado(agora)) {
    return {
      hoje: null,
      escalonada: null,
      analise: null,
      erro: 'Hoje é domingo ou feriado - não há dados para processar',
    };
  }
  
  // Busca KPIs de hoje - SEMPRE busca dados frescos da API
  console.log(`   🔄 Buscando KPIs de HOJE (dados frescos da API)...`);
  const kpisHoje = await calculateDayKPIs(agora);
  console.log(`   ✅ KPIs de HOJE obtidos: Total=${kpisHoje?.totalCalls || 0}, Atendidas=${kpisHoje?.answered || 0}, Abandonadas=${kpisHoje?.abandoned || 0}`);
  
  // Busca dias específicos para comparação baseado no dia da semana
  console.log(`   🔍 Determinando dias específicos para comparação...`);
  const datasParaBuscar = buscarDiasEspecificosParaComparacao(agora);
  
  // Verifica se encontrou dias para comparar
  if (datasParaBuscar.length === 0) {
    const nomeDia = diaSemana === 1 ? 'segunda-feira' : 
                    diaSemana === 6 ? 'sábado' : 
                    'dia útil';
    const mensagemErro = diaSemana === 1 
      ? 'Segunda-feira - não há segunda anterior com dados de referência para comparação'
      : diaSemana === 6
      ? 'Sábado - não há sábado anterior com dados de referência para comparação'
      : `Não há dias anteriores com dados de referência para comparação`;
    
    return {
      hoje: kpisHoje,
      escalonada: null,
      analise: null,
      erro: mensagemErro,
    };
  }
  
  const nomeDia = diaSemana === 1 ? 'segunda' : 
                  diaSemana === 2 ? 'terça' :
                  diaSemana === 3 ? 'quarta' :
                  diaSemana === 4 ? 'quinta' :
                  diaSemana === 5 ? 'sexta' : 'sábado';
  
  console.log(`   📊 Dia da semana: ${nomeDia} → Buscando ${datasParaBuscar.length} dia(s) específico(s) para comparação`);
  console.log(`   📅 Lógica: Comparando com dias específicos baseado no dia da semana atual`);
  
  // Busca dados para os dias específicos
  const dadosEscalonados = await fetchDadosPorDiasEspecificos(agora, datasParaBuscar);
  
  if (!dadosEscalonados || dadosEscalonados.historico.length === 0) {
    return {
      hoje: kpisHoje,
      escalonada: null,
      analise: null,
      erro: `Sem dados dos dias específicos para comparação`,
    };
  }
  
  const quantidadeDias = dadosEscalonados.quantidadeDias;
  
  const medias = dadosEscalonados.medias;
  const historico = dadosEscalonados.historico;
  
  // Calcula SOMAS dos últimos dias (xx = d-1 + d-2 + d-3 + d-4)
  console.log(`   🔢 CALCULANDO SOMA EM analisarDiaAtual:`);
  console.log(`   📋 Histórico recebido (${historico.length} dias):`);
  historico.forEach((dia, index) => {
    console.log(`      D-${index + 1}: ${dia.data} - Total: ${dia.total}, Atendidas: ${dia.atendidas}, Abandonadas: ${dia.abandonadas}`);
  });
  
  // Registra início do cálculo de soma
  const calculoId = await logRequest({
    tipo: 'calculoSoma',
    url: 'analisarDiaAtual',
    metodo: 'CALCULO',
    parametros: {
      quantidadeDias: historico.length,
      dias: historico.map(d => ({ data: d.data, total: d.total, atendidas: d.atendidas, abandonadas: d.abandonadas }))
    }
  });
  
  let somaTotalDias = 0;
  let somaAtendidasDias = 0;
  let somaAbandonadasDias = 0;
  
  const calculosPassoAPasso = [];
  
  historico.forEach((dia, index) => {
    const antesTotal = somaTotalDias;
    somaTotalDias += dia.total || 0;
    somaAtendidasDias += dia.atendidas || 0;
    somaAbandonadasDias += dia.abandonadas || 0;
    console.log(`      Soma D-${index + 1} (${dia.data}): ${antesTotal} + ${dia.total} = ${somaTotalDias}`);
    
    calculosPassoAPasso.push({
      passo: `D-${index + 1}`,
      descricao: `Soma do dia ${dia.data}`,
      calculo: `${antesTotal} + ${dia.total} = ${somaTotalDias}`,
      valores: {
        antes: antesTotal,
        valorDia: dia.total,
        depois: somaTotalDias
      }
    });
  });
  
  await addCalculations(calculoId, calculosPassoAPasso);
  
  const resultadoSoma = {
    somaTotal: somaTotalDias,
    somaAtendidas: somaAtendidasDias,
    somaAbandonadas: somaAbandonadasDias,
    formula: historico.map(d => `${d.data}:${d.total}`).join(' + ') + ` = ${somaTotalDias}`,
    quantidadeDias: historico.length
  };
  
  await updateResult(calculoId, resultadoSoma);
  
  console.log(`   ✅ SOMA FINAL EM analisarDiaAtual: ${somaTotalDias} (${historico.map(d => `${d.data}:${d.total}`).join(' + ')})`);
  
  // ⚠️ CORREÇÃO CRÍTICA: Recalcula médias usando soma / quantidade de dias
  // Isso garante que quando há apenas 1 dia, a média seja igual ao valor desse dia
  const quantidadeDiasReais = historico.length;
  
  // Recalcula médias corretas
  const mediasCorrigidas = {
    total: quantidadeDiasReais > 0 ? somaTotalDias / quantidadeDiasReais : 0,
    atendidas: quantidadeDiasReais > 0 ? somaAtendidasDias / quantidadeDiasReais : 0,
    abandonadas: quantidadeDiasReais > 0 ? somaAbandonadasDias / quantidadeDiasReais : 0,
    espera: medias.espera || 0
  };
  
  console.log(`   ⚠️ CORREÇÃO: Recalculando médias corretas:`);
  console.log(`      Soma Total: ${somaTotalDias}, Quantidade Dias: ${quantidadeDiasReais}`);
  console.log(`      Média Total: ${somaTotalDias} / ${quantidadeDiasReais} = ${mediasCorrigidas.total.toFixed(2)}`);
  console.log(`      Média anterior (medias.total): ${medias.total.toFixed(2)}`);
  console.log(`      Média corrigida: ${mediasCorrigidas.total.toFixed(2)}`);
  
  // Usa médias corrigidas
  const mediasParaUsar = mediasCorrigidas;
  
  // Calcula diferença percentual usando o VOLUME REALIZADO como base
  // Fórmula CORRETA: faltante = média - hoje
  //                  Percentual = (faltante / hoje) * 100
  // Exemplo: média = 174, hoje = 94
  //          faltante = 174 - 94 = 80
  //          percentual = (80 / 94) * 100 = 85.11%
  const calcularDiferencaPercentual = (valorHoje, media) => {
    // Validações
    if (media === 0 || media === null || media === undefined) return null;
    if (valorHoje === null || valorHoje === undefined) return null;
    
    // Garante que são números
    const valorHojeNum = Number(valorHoje) || 0;
    const mediaNum = Number(media) || 0;
    
    // Se o realizado (hoje) for 0, retorna 0 para evitar divisão por zero
    if (valorHojeNum === 0) return 0;
    
    // faltante = meta (média) - realizado (hoje)
    const faltante = mediaNum - valorHojeNum;
    
    // Percentual faltante = (faltante / realizado) * 100
    const percentualFaltante = (faltante / valorHojeNum) * 100;
    
    // Arredonda para 2 casas decimais
    const percentualArredondado = Math.round(percentualFaltante * 100) / 100;
    
    console.log(`      🔢 Cálculo percentual: faltante = ${mediaNum.toFixed(2)} - ${valorHojeNum} = ${faltante.toFixed(2)}`);
    console.log(`      🔢 Percentual faltante = (${faltante.toFixed(2)} / ${valorHojeNum}) * 100 = ${percentualArredondado.toFixed(2)}%`);
    
    // Retorna negativo se faltante > 0 (está abaixo da média)
    // Retorna positivo se faltante < 0 (está acima da média)
    return faltante > 0 ? -percentualArredondado : Math.abs(percentualArredondado);
  };
  
  // Log detalhado
  console.log(`   📊 Valores para cálculo (até ${horaAtual}):`);
  console.log(`      Hoje - Atendidas: ${kpisHoje.answered}, Abandonadas: ${kpisHoje.abandoned}, Total: ${kpisHoje.totalCalls}`);
  console.log(`      Soma dos últimos ${quantidadeDias} dias - Total: ${somaTotalDias}, Atendidas: ${somaAtendidasDias}, Abandonadas: ${somaAbandonadasDias}`);
  console.log(`      Média (${quantidadeDias} dias) - Atendidas: ${mediasParaUsar.atendidas.toFixed(2)}, Abandonadas: ${mediasParaUsar.abandonadas.toFixed(2)}, Total: ${mediasParaUsar.total.toFixed(2)}`);
  console.log(`   📋 DETALHAMENTO POR DIA (até ${horaAtual}):`);
  historico.forEach((dia, index) => {
    console.log(`      D-${index + 1} (${dia.data}): Total: ${dia.total} (Atendidas: ${dia.atendidas}, Abandonadas: ${dia.abandonadas})`);
  });
  
  // ⚠️ CRÍTICO: Garante que usa os valores MAIS RECENTES de kpisHoje
  // Extrai valores diretamente do objeto retornado por calculateDayKPIs para garantir dados frescos
  const valorHojeTotal = Number(kpisHoje?.totalCalls) || 0;
  const valorHojeAtendidas = Number(kpisHoje?.answered) || 0;
  const valorHojeAbandonadas = Number(kpisHoje?.abandoned) || 0;
  
  console.log(`   🔄 VALORES ATUALIZADOS DE HOJE (garantindo dados frescos - SEM CACHE):`);
  console.log(`      Total: ${valorHojeTotal}, Atendidas: ${valorHojeAtendidas}, Abandonadas: ${valorHojeAbandonadas}`);
  console.log(`      ⚠️ Estes valores serão usados para calcular a porcentagem agora`);
  
  // Calcula porcentagens usando valores frescos - SEMPRE recalcula
  console.log(`   📊 INICIANDO CÁLCULO DE PORCENTAGENS COM VALORES ATUALIZADOS:`);
  console.log(`   ⚠️ VALORES ANTES DO CÁLCULO:`);
  console.log(`      Hoje Total: ${valorHojeTotal}, Média Total: ${mediasParaUsar.total.toFixed(2)}`);
  console.log(`      Hoje Atendidas: ${valorHojeAtendidas}, Média Atendidas: ${mediasParaUsar.atendidas.toFixed(2)}`);
  console.log(`      Hoje Abandonadas: ${valorHojeAbandonadas}, Média Abandonadas: ${mediasParaUsar.abandonadas.toFixed(2)}`);
  
  // ⚠️ CRÍTICO: Verifica se os valores estão corretos antes de calcular
  console.log(`   🔍 VERIFICAÇÃO ANTES DO CÁLCULO:`);
  console.log(`      valorHojeTotal: ${valorHojeTotal} (tipo: ${typeof valorHojeTotal})`);
  console.log(`      mediasParaUsar.total: ${mediasParaUsar.total} (tipo: ${typeof mediasParaUsar.total})`);
  console.log(`      Cálculo esperado: (${valorHojeTotal} - ${mediasParaUsar.total.toFixed(2)}) / ${mediasParaUsar.total.toFixed(2)} * 100`);
  console.log(`      Resultado esperado: ${((valorHojeTotal - mediasParaUsar.total) / mediasParaUsar.total * 100).toFixed(2)}%`);
  
  const percentualTotal = calcularDiferencaPercentual(valorHojeTotal, mediasParaUsar.total);
  const percentualAtendidas = calcularDiferencaPercentual(valorHojeAtendidas, mediasParaUsar.atendidas);
  const percentualAbandonadas = calcularDiferencaPercentual(valorHojeAbandonadas, mediasParaUsar.abandonadas);
  
  // ⚠️ CRÍTICO: Verifica se o resultado está correto
  console.log(`   🔍 VERIFICAÇÃO APÓS O CÁLCULO:`);
  console.log(`      percentualTotal retornado: ${percentualTotal} (tipo: ${typeof percentualTotal})`);
  console.log(`      Deveria ser negativo? ${valorHojeTotal < mediasParaUsar.total ? 'SIM' : 'NÃO'}`);
  if (percentualTotal !== null && valorHojeTotal < mediasParaUsar.total && percentualTotal > 0) {
    console.error(`   ⚠️ ⚠️ ⚠️ ERRO CRÍTICO: Percentual está POSITIVO quando deveria ser NEGATIVO!`);
    console.error(`   ⚠️ Valor hoje (${valorHojeTotal}) < Média (${mediasParaUsar.total.toFixed(2)}) → Deveria ser negativo!`);
  }
  
  console.log(`   ✅ RESULTADOS DOS CÁLCULOS:`);
  console.log(`      Percentual Total: ${percentualTotal !== null ? percentualTotal.toFixed(2) + '%' : 'null'}`);
  console.log(`      Percentual Atendidas: ${percentualAtendidas !== null ? percentualAtendidas.toFixed(2) + '%' : 'null'}`);
  console.log(`      Percentual Abandonadas: ${percentualAbandonadas !== null ? percentualAbandonadas.toFixed(2) + '%' : 'null'}`);
  
  const analise = {
    atendidas: {
      diferencaPercentual: percentualAtendidas,
      valorHoje: valorHojeAtendidas,
      mediaEscalonada: mediasParaUsar.atendidas,
      somaDias: somaAtendidasDias,
    },
    abandonadas: {
      diferencaPercentual: percentualAbandonadas,
      valorHoje: valorHojeAbandonadas,
      mediaEscalonada: mediasParaUsar.abandonadas,
      somaDias: somaAbandonadasDias,
    },
    total: {
      diferencaPercentual: percentualTotal,
      valorHoje: valorHojeTotal,
      mediaEscalonada: mediasParaUsar.total,
      somaDias: somaTotalDias,
    },
  };
  
  // Log detalhado das diferenças percentuais calculadas
  console.log(`   📈 Diferenças percentuais FINAIS calculadas (até ${horaAtual}):`);
  console.log(`      Total: ${percentualTotal !== null ? percentualTotal.toFixed(2) + '%' : 'sem base'}`);
  console.log(`      Atendidas: ${percentualAtendidas !== null ? percentualAtendidas.toFixed(2) + '%' : 'sem base'}`);
  console.log(`      Abandonadas: ${percentualAbandonadas !== null ? percentualAbandonadas.toFixed(2) + '%' : 'sem base'}`);
  
  // Salva os dados de hoje para uso futuro (acumulação)
  // IMPORTANTE: Salva os dados com o horário de referência atual
  // Isso garante que quando carregar, saiba qual horário foi usado
  try {
    const dbService = await import('../DB-Reports/service.js');
    const dadosParaSalvar = {
      atendidas: kpisHoje.answered || 0,
      abandonadas: kpisHoje.abandoned || 0,
      total: kpisHoje.totalCalls || 0,
      avgWaitTime: kpisHoje.avgWaitTime || 0,
      horaReferencia: horaAtual, // Horário de referência usado
      timestamp: agora.toISOString(),
    };
    
    await dbService.saveAccumulatedData(agora, dadosParaSalvar);
    console.log(`   💾 Dados de hoje salvos para acumulação futura: ${dataAtual} (até ${horaAtual})`);
    console.log(`      Total: ${dadosParaSalvar.total} (Atendidas: ${dadosParaSalvar.atendidas}, Abandonadas: ${dadosParaSalvar.abandonadas})`);
  } catch (error) {
    console.error(`   ⚠️ Erro ao salvar dados acumulados: ${error.message}`);
    // Não falha o processo se não conseguir salvar
  }
  
  return {
    hoje: kpisHoje,
    escalonada: {
      quantidadeDias: quantidadeDias,
      diaSemana: diaSemana,
      nomeDia: nomeDia,
      historico: dadosEscalonados.historico,
      medias: mediasParaUsar, // Usa médias corrigidas
    },
    analise: analise,
  };
}

/**
 * Formata o relatório com comparação ESCALONADA D-1 até D-7
 * @param {Object} kpis - KPIs do dia atual
 * @param {Object} analise - Análise com dados escalonados
 * @returns {string} Relatório formatado
 */
export function formatRelatorioFinal(kpis, analise) {
  if (!kpis || !analise) {
    return '⚠️ Dados insuficientes para gerar relatório';
  }
  
  const agora = new Date();
  const dataFormatada = format(agora, 'dd/MM/yyyy');
  const horaFormatada = format(agora, 'HH:mm');
  
  // Obtém dados escalonados da análise
  const escalonada = analise.escalonada;
  if (!escalonada || !analise.analise) {
    return '⚠️ Dados escalonados não disponíveis para comparação';
  }
  
  const quantidadeDias = escalonada.quantidadeDias;
  const medias = escalonada.medias;
  
  // Calcula percentuais de atendidas e abandonadas (valores reais, sem arredondamento)
  const pctAtendidas = kpis.totalCalls > 0 ? (kpis.answered / kpis.totalCalls) * 100 : 0;
  const pctAbandonadas = kpis.totalCalls > 0 ? (kpis.abandoned / kpis.totalCalls) * 100 : 0;
  
  // Obtém diferenças percentuais
  const diffPctTotal = analise.analise.total.diferencaPercentual;
  const diffPctAtendidas = analise.analise.atendidas.diferencaPercentual;
  const diffPctAbandonadas = analise.analise.abandonadas.diferencaPercentual;
  
  // Função auxiliar para formatar percentual comparativo
  // Nova fórmula: faltante = média - hoje
  //               percentualFaltante = (faltante / hoje) * 100
  // - Se negativo: está abaixo da média (faltam X% para atingir a média)
  // - Se positivo: está acima da média (excedeu a média em X%)
  const formatarPercentual = (diffPct) => {
    if (diffPct === null) {
      return 'sem base de comparação';
    }
    
    const diffPctArredondado = Math.round(diffPct);
    
    if (Math.abs(diffPctArredondado) <= 1) {
      return 'igual';
    } else if (diffPct < 0) {
      // Negativo = está abaixo da média (faltam X% para atingir)
      return `${Math.abs(diffPctArredondado)}% abaixo`;
    } else {
      // Positivo = está acima da média (excedeu em X%)
      return `${diffPctArredondado}% acima`;
    }
  };
  
  // Formata valores (truncando, não arredondando)
  const totalFormatado = formatarSemArredondar(kpis.totalCalls, 0);
  const atendidasFormatado = formatarSemArredondar(kpis.answered, 0);
  const abandonadasFormatado = formatarSemArredondar(kpis.abandoned, 0);
  const esperaFormatada = formatarSemArredondar(kpis.avgWaitTime, 0);
  
  // Obtém soma dos dias (não média) para exibição
  // LOG DETALHADO: Mostra cada dia e seu valor antes de somar
  console.log(`   📊 CALCULANDO SOMA PARA RELATÓRIO:`);
  console.log(`   📋 Histórico recebido (${escalonada.historico.length} dias):`);
  escalonada.historico.forEach((dia, index) => {
    console.log(`      D-${index + 1}: ${dia.data} - Total: ${dia.total}, Atendidas: ${dia.atendidas}, Abandonadas: ${dia.abandonadas}`);
  });
  
  // ⚠️ CALCULA SOMA CORRETA: Verifica cada valor antes de somar
  console.log(`   🔍 VERIFICANDO VALORES ANTES DE SOMAR:`);
  escalonada.historico.forEach((dia, index) => {
    console.log(`      D-${index + 1} (${dia.data}):`);
    console.log(`         - Total: ${dia.total} (tipo: ${typeof dia.total})`);
    console.log(`         - Atendidas: ${dia.atendidas} (tipo: ${typeof dia.atendidas})`);
    console.log(`         - Abandonadas: ${dia.abandonadas} (tipo: ${typeof dia.abandonadas})`);
    console.log(`         - Objeto completo:`, JSON.stringify(dia, null, 2));
  });
  
  const somaTotalDias = escalonada.historico.reduce((sum, d) => {
    const valorTotal = parseFloat(d.total) || 0;
    const somaAcumulada = sum + valorTotal;
    console.log(`      Somando ${d.data}: ${d.total} (convertido: ${valorTotal}) → Total acumulado: ${sum} + ${valorTotal} = ${somaAcumulada}`);
    return somaAcumulada;
  }, 0);
  const somaAtendidasDias = escalonada.historico.reduce((sum, d) => {
    const valorAtendidas = parseFloat(d.atendidas) || 0;
    return sum + valorAtendidas;
  }, 0);
  const somaAbandonadasDias = escalonada.historico.reduce((sum, d) => {
    const valorAbandonadas = parseFloat(d.abandonadas) || 0;
    return sum + valorAbandonadas;
  }, 0);
  
  console.log(`   ✅ SOMA FINAL CALCULADA:`);
  console.log(`      Total: ${somaTotalDias} (de ${escalonada.historico.length} dias)`);
  console.log(`      Atendidas: ${somaAtendidasDias}, Abandonadas: ${somaAbandonadasDias}`);
  console.log(`      🔍 VALIDAÇÃO: Se média deve ser 175, então soma deve ser ${175 * escalonada.historico.length}`);
  
  const totalSomaFormatado = formatarSemArredondar(somaTotalDias, 0);
  const atendidasSomaFormatado = formatarSemArredondar(somaAtendidasDias, 0);
  const abandonadasSomaFormatado = formatarSemArredondar(somaAbandonadasDias, 0);
  
  // ⚠️ CORREÇÃO: Recalcula médias usando a soma correta (somaTotalDias) dividida pela quantidade de dias
  // A média deve ser: soma dos dias / quantidade de dias
  // Quando há apenas 1 dia (segunda comparando com segunda), a média é igual ao valor desse dia
  const quantidadeDiasReais = escalonada.historico.length;
  
  // ⚠️ IMPORTANTE: Quando quantidadeDiasReais = 1, a média é igual ao valor único (não precisa dividir)
  // Exemplo: segunda anterior = 69 → média = 69 (não 69/1)
  const mediaTotalCorrigida = quantidadeDiasReais > 0 ? somaTotalDias / quantidadeDiasReais : 0;
  const mediaAtendidasCorrigida = quantidadeDiasReais > 0 ? somaAtendidasDias / quantidadeDiasReais : 0;
  const mediaAbandonadasCorrigida = quantidadeDiasReais > 0 ? somaAbandonadasDias / quantidadeDiasReais : 0;
  
  // ⚠️ VALIDAÇÃO: Se quantidadeDiasReais = 1, a média deve ser igual ao valor único
  if (quantidadeDiasReais === 1) {
    console.log(`   ⚠️ ATENÇÃO: Apenas 1 dia para comparação - média = valor único`);
    console.log(`      Valor único: Total=${somaTotalDias}, Atendidas=${somaAtendidasDias}, Abandonadas=${somaAbandonadasDias}`);
    console.log(`      Média calculada: Total=${mediaTotalCorrigida}, Atendidas=${mediaAtendidasCorrigida}, Abandonadas=${mediaAbandonadasCorrigida}`);
  }
  
  console.log(`   ✅ MÉDIA RECALCULADA (soma correta / quantidade):`);
  console.log(`      Total: ${somaTotalDias} / ${quantidadeDiasReais} = ${mediaTotalCorrigida.toFixed(2)}`);
  console.log(`      Atendidas: ${somaAtendidasDias} / ${quantidadeDiasReais} = ${mediaAtendidasCorrigida.toFixed(2)}`);
  console.log(`      Abandonadas: ${somaAbandonadasDias} / ${quantidadeDiasReais} = ${mediaAbandonadasCorrigida.toFixed(2)}`);
  
  const mediaTotalFormatada = formatarSemArredondar(mediaTotalCorrigida, 0);
  const mediaAtendidasFormatada = formatarSemArredondar(mediaAtendidasCorrigida, 0);
  const mediaAbandonadasFormatada = formatarSemArredondar(mediaAbandonadasCorrigida, 0);
  
  // Determina texto da comparação escalonada
  const textoComparacao = quantidadeDias === 1 
    ? `Comparativo (média do dia anterior da semana atual)`
    : `Comparativo escalonado (média dos ${quantidadeDias} dias úteis anteriores da semana atual)`;
  
  // Formata quantidade de dias (singular ou plural)
  const textoQuantidadeDias = quantidadeDiasReais === 1 ? '1 dias' : `${quantidadeDiasReais} dias`;
  
  // Monta o relatório no formato obrigatório (exatamente como combinado)
  const relatorio = `📊 Relatório D0 - ${dataFormatada} ${horaFormatada}

Total: ${totalFormatado} ligações
✅ Atendidas: ${atendidasFormatado} (${formatarSemArredondar(pctAtendidas, 0)}%)
📵 Abandonadas: ${abandonadasFormatado} (${formatarSemArredondar(pctAbandonadas, 0)}%)
⏱️ Espera média: ${esperaFormatada}s

📈 ${textoComparacao}

Total: ${totalFormatado} | Média: ${mediaTotalFormatada} (${textoQuantidadeDias}) | ${formatarPercentual(diffPctTotal)}
✅ Atendidas: ${atendidasFormatado} | Média: ${mediaAtendidasFormatada} (${textoQuantidadeDias}) | ${formatarPercentual(diffPctAtendidas)}
📵 Abandonadas: ${abandonadasFormatado} | Média: ${mediaAbandonadasFormatada} (${textoQuantidadeDias}) | ${formatarPercentual(diffPctAbandonadas)}`;

  return relatorio;
}

export default {
  fetchTodayCalls,
  fetchDayData,
  fetchDayDataAgregado,  // ⚠️ MÉTODO CORRETO VALIDADO - usar para contagem precisa
  calcularPorcentagemMensagens,  // ⚠️ MÉTODO CORRETO VALIDADO - cálculo de porcentagem
  calcularPorcentagemMensagensDias,  // ⚠️ Busca dados e calcula porcentagem automaticamente
  fetchDiaAnterior,
  fetchHistoricalData,
  fetchHistoricalData15DiasUteis,
  calculateDayKPIs,
  analisarDiaAtual,
  formatRelatorioFinal,
  classificarNivel,
  classifyCallStatus,
  testConnection,
  validateToken,
  processWebhook,
  isDiaUtil,
  isSabado,
  isDomingo,
  isFeriado,
  getHorarioInicio,
  getHorarioFim,
  ajustarHorarioFim,
};
