/**
 * API-WHATSAPP - Serviço de Envio
 * 
 * Integração com a API Baileys hospedada no Render
 */

import axios from 'axios';
import { config, isConfigured } from './config.js';
import { formatRelatorioFinal } from '../API-55PBX/service.js';
import websocket from '../CORE/websocket.js';

/**
 * Função auxiliar para arredondamento consistente
 * Sempre arredonda para o inteiro mais próximo (0.5 arredonda para cima)
 * @param {number} value - Valor a arredondar
 * @returns {number} Valor arredondado
 */
function roundConsistent(value) {
  return Math.round(value);
}

// Cria instância do axios
const api = axios.create({
  baseURL: config.apiUrl,
  timeout: config.timeout,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Envia uma mensagem simples via WhatsApp
 * 
 * @param {string} mensagem - Conteúdo da mensagem
 * @param {string} numero - Número de destino (opcional, usa .env)
 * @returns {Promise<Object>} Resultado do envio
 */
export async function sendMessage(mensagem, numero = null) {
  let targetNumber = numero || config.destination;
  
  // Remove espaços e vírgulas do número
  if (targetNumber) {
    targetNumber = targetNumber.toString().trim().replace(/,/g, '').replace(/\s/g, '');
  }
  
  if (!isConfigured()) {
    console.warn('⚠️  WhatsApp: API não configurada');
    websocket.broadcastLog('⚠️ WhatsApp: API não configurada', 'error');
    return { success: false, error: 'API não configurada' };
  }
  
  if (!targetNumber) {
    console.error('❌ WhatsApp: Número de destino não fornecido');
    websocket.broadcastLog('❌ Número de destino não fornecido', 'error');
    return { success: false, error: 'Número de destino não fornecido' };
  }
  
  // Valida formato do número (deve ter pelo menos 10 dígitos)
  if (targetNumber.length < 10) {
    console.error(`❌ WhatsApp: Número inválido: ${targetNumber}`);
    websocket.broadcastLog(`❌ Número inválido: ${targetNumber}`, 'error');
    return { success: false, error: `Número inválido: ${targetNumber}` };
  }
  
  const payload = {
    numero: targetNumber,
    mensagem: mensagem,
  };
  
  try {
    console.log(`📱 WhatsApp: Enviando mensagem para ${targetNumber}...`);
    console.log(`📱 Endpoint: ${config.apiUrl}${config.endpoints.enviar}`);
    console.log(`📱 Timeout configurado: ${config.timeout}ms`);
    console.log(`📱 Payload:`, JSON.stringify(payload, null, 2));
    websocket.broadcastLog(`📱 Enviando para ${targetNumber}...`, 'info');
    
    const requestStartTime = Date.now();
    const response = await api.post(config.endpoints.enviar, payload);
    const requestElapsed = Date.now() - requestStartTime;
    
    console.log(`✅ WhatsApp: Resposta recebida (${requestElapsed}ms)`);
    console.log(`✅ Response status: ${response.status}`);
    console.log(`✅ Response data:`, JSON.stringify(response.data, null, 2));
    websocket.broadcastLog(`✅ Resposta recebida (${requestElapsed}ms)`, 'success');
    
    // Valida a resposta da API
    if (response.data) {
      // Verifica se a API retornou sucesso real
      // A API pode retornar {sucesso: true} ou {success: true}
      const apiSuccess = response.data.sucesso === true || response.data.success === true;
      const apiError = response.data.error || response.data.erro || response.data.message;
      
      if (!apiSuccess || apiError) {
        const errorMsg = apiError || 'API retornou erro';
        console.error('⚠️ API retornou erro na resposta:', errorMsg);
        websocket.broadcastLog(`⚠️ API retornou erro: ${errorMsg}`, 'error');
        return {
          success: false,
          error: errorMsg,
          data: response.data,
        };
      }
    }
    
    console.log('✅ WhatsApp: Mensagem enviada com sucesso!');
    websocket.broadcastLog('✅ Mensagem enviada com sucesso!', 'success');
    
    return {
      success: true,
      data: response.data,
    };
    
  } catch (error) {
    const errorType = error.code || 'UNKNOWN';
    console.error(`❌ WhatsApp: Erro ao enviar (${errorType}):`, error.message);
    websocket.broadcastLog(`❌ Erro (${errorType}): ${error.message}`, 'error');
    
    if (error.code === 'ECONNABORTED') {
      console.error('   ⏱️ Timeout: A requisição excedeu o tempo limite');
      websocket.broadcastLog('⏱️ Timeout: Requisição excedeu o tempo limite', 'error');
    }
    
    let errorMessage = error.message;
    let errorDetails = null;
    
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText || '';
      const responseData = error.response.data || {};
      
      console.error(`   Status: ${status} ${statusText}`);
      console.error(`   Data da resposta:`, JSON.stringify(responseData, null, 2));
      websocket.broadcastLog(`   Status: ${status} ${statusText}`, 'error');
      
      // Tenta extrair mensagem de erro mais específica da resposta
      if (responseData.error || responseData.erro || responseData.message) {
        errorMessage = responseData.error || responseData.erro || responseData.message;
        console.error(`   Mensagem de erro da API: ${errorMessage}`);
        websocket.broadcastLog(`   Erro da API: ${errorMessage}`, 'error');
      }
      
      errorDetails = {
        status,
        statusText,
        data: responseData,
      };
    } else if (error.request) {
      console.error('   ⚠️ Sem resposta do servidor');
      websocket.broadcastLog('⚠️ Sem resposta do servidor', 'error');
    }
    
    return {
      success: false,
      error: errorMessage,
      details: errorDetails,
    };
  }
}

/**
 * Envia o relatório formatado para TODOS os números configurados no .env
 * Usa o endpoint /enviar-relatorio com o formato correto
 * 
 * ⚠️ IMPORTANTE: Esta função envia para TODOS os números configurados em WHATSAPP_DESTINATION
 * Para configurar múltiplos números, separe-os por vírgula no .env:
 * WHATSAPP_DESTINATION=5511922048764,5511999999999,5511888888888
 * 
 * @param {Object} kpis - KPIs calculados do dia
 * @param {Object} analise - Análise histórica (opcional)
 * @returns {Promise<Object>} Resultado do envio com contagem de sucessos e falhas
 */
export async function sendRelatorio(kpis, analise = null) {
  if (!isConfigured()) {
    console.warn('⚠️  WhatsApp: API não configurada');
    return { success: false, error: 'API não configurada' };
  }
  
  // ⚠️ IMPORTANTE: Sempre usa o array destinations para enviar para todos os números configurados
  // Isso garante que múltiplos números no .env sejam processados corretamente
  if (config.destinations.length === 0) {
    console.error('❌ WhatsApp: Nenhum número de destino configurado');
    websocket.broadcastLog('❌ Nenhum número de destino configurado', 'error');
    return { success: false, error: 'Nenhum número de destino configurado' };
  }
  
  // Sempre usa a função de múltiplos (funciona para 1 ou mais números)
  // Isso garante consistência e suporte a múltiplos números do .env
  // ⚠️ CRÍTICO: Esta função envia para TODOS os números configurados no WHATSAPP_DESTINATION
  console.log(`📱 sendRelatorio: Enviando para ${config.destinations.length} número(s) configurado(s)`);
  return await sendRelatorioMultiplos(kpis, analise);
}

/**
 * Envia relatório para múltiplos números configurados no .env
 * ⚠️ Esta função itera sobre TODOS os números em config.destinations
 * 
 * @param {Object} kpis - KPIs calculados
 * @param {Object} analise - Análise histórica (opcional)
 * @returns {Promise<Object>} Resultado do envio com detalhes de cada número
 */
async function sendRelatorioMultiplos(kpis, analise = null) {
  const resultados = [];
  let sucessos = 0;
  let falhas = 0;
  
  const quantidadeNumeros = config.destinations.length;
  console.log(`\n📊 ═══════════════════════════════════════════════════════`);
  console.log(`📊 WhatsApp: Enviando relatório para ${quantidadeNumeros} número(s)...`);
  console.log(`📋 Números configurados no .env: ${config.destinations.join(', ')}`);
  console.log(`📊 ═══════════════════════════════════════════════════════\n`);
  websocket.broadcastLog(`📊 Enviando para ${quantidadeNumeros} número(s)...`, 'info');
  
  // Formata a mensagem combinada uma vez para todos
  let mensagemFormatada;
  try {
    mensagemFormatada = formatRelatorioCompleto(kpis, analise);
    console.log(`📝 Mensagem formatada (${mensagemFormatada.length} caracteres)`);
    websocket.broadcastLog(`📝 Mensagem formatada (${mensagemFormatada.length} caracteres)`, 'info');
  } catch (formatError) {
    console.error('❌ Erro ao formatar mensagem:', formatError.message);
    websocket.broadcastLog(`❌ Erro ao formatar mensagem: ${formatError.message}`, 'error');
    return {
      success: false,
      error: `Erro ao formatar mensagem: ${formatError.message}`,
    };
  }
  
  for (const numero of config.destinations) {
    try {
      console.log(`   📱 Enviando para ${numero}...`);
      websocket.broadcastLog(`📱 Enviando para ${numero}...`, 'info');
      
      // Envia mensagem já formatada usando o endpoint /enviar
      const result = await sendMessage(mensagemFormatada, numero);
      
      if (result.success) {
        console.log(`   ✅ Enviado com sucesso para ${numero}`);
        websocket.broadcastLog(`✅ Enviado para ${numero}`, 'success');
        sucessos++;
        resultados.push({ numero, success: true });
      } else {
        throw new Error(result.error || 'Erro ao enviar');
      }
      
      // Pequeno delay entre envios para não sobrecarregar a API
      if (config.destinations.length > 1) {
      await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error) {
      console.error(`   ❌ Erro ao enviar para ${numero}:`, error.message);
      websocket.broadcastLog(`❌ Erro ao enviar para ${numero}: ${error.message}`, 'error');
      falhas++;
      resultados.push({ numero, success: false, error: error.message });
    }
  }
  
  console.log(`\n📊 ═══════════════════════════════════════════════════════`);
  console.log(`📊 RESUMO DO ENVIO:`);
  console.log(`📊   ✅ Sucessos: ${sucessos} de ${quantidadeNumeros}`);
  console.log(`📊   ❌ Falhas: ${falhas} de ${quantidadeNumeros}`);
  if (sucessos > 0) {
    console.log(`📊   📱 Números que receberam: ${resultados.filter(r => r.success).map(r => r.numero).join(', ')}`);
  }
  if (falhas > 0) {
    console.log(`📊   ⚠️ Números com erro: ${resultados.filter(r => !r.success).map(r => `${r.numero} (${r.error})`).join(', ')}`);
  }
  console.log(`📊 ═══════════════════════════════════════════════════════\n`);
  websocket.broadcastLog(`📊 Resumo: ${sucessos} sucesso(s), ${falhas} falha(s)`, falhas === 0 ? 'success' : 'warning');
  
  return {
    success: falhas === 0,
    enviados: sucessos,
    falhas: falhas,
    total: quantidadeNumeros,
    resultados: resultados,
  };
}

/**
 * Envia mensagem com análise histórica (comparativo 15 dias)
 * @param {Object} analise - Dados da análise
 * @param {string} numero - Número de destino (opcional, usa config.destination se não fornecido)
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendAnaliseHistorica(analise, numero = null) {
  if (!analise || !analise.analise) {
    return { success: false, error: 'Sem dados de análise' };
  }
  
  // A análise já está no formato correto, não precisa mais enviar separadamente
  // O relatório completo já inclui a análise
  // Esta função é mantida para compatibilidade mas não é mais usada
  return { success: true, message: 'Análise incluída no relatório principal' };
}

/**
 * Envia o relatório para todos os números configurados na API
 * Usa o endpoint /enviar-relatorio-todos
 * 
 * @param {Object} kpis - KPIs calculados
 * @returns {Promise<Object>} Resultado do envio
 */
export async function sendRelatorioTodos(kpis) {
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR');
  const horario = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const payload = {
    dadosRelatorio: {
      ligacoesRecebidas: kpis.totalCalls || 0,
      ligacoesAtendidas: kpis.answered || 0,
      ligacoesAbandonadas: kpis.abandoned || 0,
      data: data,
      horario: horario,
      filas: kpis.peakHour ? [
        {
          momento: kpis.peakHour.hour || '00:00',
          quantidadePessoas: kpis.peakHour.count || 0,
        }
      ] : [],
    },
  };
  
  try {
    console.log('📊 WhatsApp: Enviando relatório para TODOS os números...');
    
    const response = await api.post(config.endpoints.enviarRelatorioTodos, payload);
    
    console.log('✅ WhatsApp: Relatório enviado para todos!');
    
    return {
      success: true,
      data: response.data,
    };
    
  } catch (error) {
    console.error('❌ WhatsApp: Erro ao enviar para todos:', error.message);
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Verifica o status da conexão WhatsApp
 * @returns {Promise<Object>} Status da conexão
 */
export async function getStatus() {
  if (!config.apiUrl) {
    return {
      status: 'not_configured',
      configured: false,
      connected: false,
    };
  }
  
  try {
    const response = await api.get(config.endpoints.status);
    
    return {
      status: response.data?.status || 'connected',
      configured: true,
      connected: true,
      data: response.data,
    };
    
  } catch (error) {
    return {
      status: 'error',
      configured: true,
      connected: false,
      error: error.message,
    };
  }
}

/**
 * Lista os grupos disponíveis
 * @returns {Promise<Array>} Lista de grupos
 */
export async function getGrupos() {
  try {
    const response = await api.get(config.endpoints.grupos);
    return response.data || [];
  } catch (error) {
    console.error('❌ WhatsApp: Erro ao listar grupos:', error.message);
    return [];
  }
}

/**
 * Formata o relatório D0 para mensagem WhatsApp (texto simples)
 * Usado pelo endpoint /enviar
 * @param {Object} kpis - KPIs calculados
 * @returns {string} Mensagem formatada
 */
export function formatD0Report(kpis) {
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR'); // DD/MM/AAAA
  const horario = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); // HH:MM
  
  const total = kpis.totalCalls || 0;
  const answeredPct = total > 0 ? roundConsistent((kpis.answered / total) * 100) : 0;
  const abandonedPct = total > 0 ? roundConsistent((kpis.abandoned / total) * 100) : 0;
  
  return `📊 *Relatório D0 - ${data} ${horario}*

Total: *${total}* ligações
✅ Atendidas: *${kpis.answered || 0}* (${answeredPct}%)
📵 Abandonadas: *${kpis.abandoned || 0}* (${abandonedPct}%)
${kpis.avgWaitTime ? `⏱️ Espera média: *${kpis.avgWaitTime}s*` : ''}
${kpis.peakHour ? `🕐 Pico: *${kpis.peakHour.hour}* (${kpis.peakHour.count})` : ''}`;
}

/**
 * Formata relatório completo combinando D0 + análise histórica
 * Usa a nova função formatRelatorioFinal do service.js
 * @param {Object} kpis - KPIs calculados
 * @param {Object} analise - Análise histórica (opcional)
 * @returns {string} Mensagem formatada completa
 */
export function formatRelatorioCompleto(kpis, analise = null) {
  // Log para debug
  console.log(`   🔍 formatRelatorioCompleto: Verificando análise...`);
  console.log(`      analise existe: ${!!analise}`);
  console.log(`      analise.analise existe: ${!!(analise && analise.analise)}`);
  console.log(`      analise.escalonada existe: ${!!(analise && analise.escalonada)}`);
  
  if (analise) {
    console.log(`      Estrutura da análise:`, {
      temAnalise: !!analise.analise,
      temEscalonada: !!analise.escalonada,
      escalonadaKeys: analise.escalonada ? Object.keys(analise.escalonada) : null
    });
  }
  
  // Se tiver análise escalonada, usa a nova função formatRelatorioFinal
  // Passa o objeto analise completo para ter acesso a escalonada
  if (analise && analise.analise && analise.escalonada) {
    console.log(`   ✅ Usando formatRelatorioFinal (formato completo com comparativo)`);
    try {
      const relatorio = formatRelatorioFinal(kpis, analise);
      console.log(`   ✅ Relatório formatado com sucesso (${relatorio.length} caracteres)`);
      return relatorio;
    } catch (error) {
      console.error(`   ❌ Erro ao formatar relatório completo:`, error.message);
      console.error(`   ⚠️ Usando formato básico como fallback`);
    }
  } else {
    console.log(`   ⚠️ Análise escalonada não disponível, usando formato básico`);
    if (analise && !analise.escalonada) {
      console.log(`   ⚠️ Motivo: analise.escalonada está null/undefined`);
    }
    if (analise && !analise.analise) {
      console.log(`   ⚠️ Motivo: analise.analise está null/undefined`);
    }
    if (!analise) {
      console.log(`   ⚠️ Motivo: analise não foi fornecida`);
    }
  }
  
  // Caso contrário, formata apenas o D0 (compatibilidade)
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR');
  const horario = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const total = kpis.totalCalls || 0;
  const answeredPct = total > 0 ? roundConsistent((kpis.answered / total) * 100) : 0;
  const abandonedPct = total > 0 ? roundConsistent((kpis.abandoned / total) * 100) : 0;
  
  // Sempre mostra avgWaitTime (mesmo que seja 0)
  const avgWaitTime = kpis.avgWaitTime !== undefined && kpis.avgWaitTime !== null ? kpis.avgWaitTime : 0;
  
  return `📊 *Relatório D0 - ${data} ${horario}*

Total: *${total}* ligações
✅ Atendidas: *${kpis.answered || 0}* (${answeredPct}%)
📵 Abandonadas: *${kpis.abandoned || 0}* (${abandonedPct}%)
⏱️ Espera média: *${avgWaitTime}s*
${kpis.peakHour ? `🕐 Pico: *${kpis.peakHour.hour}* (${kpis.peakHour.count})` : ''}`;
}

export default {
  sendMessage,
  sendRelatorio,
  sendRelatorioTodos,
  getStatus,
  getGrupos,
  formatD0Report,
  formatRelatorioCompleto,
  isConfigured,
};
