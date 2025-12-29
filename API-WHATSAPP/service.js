/**
 * API-WHATSAPP - Serviço de Envio
 * 
 * Integração com a API Baileys hospedada no Render
 */

import axios from 'axios';
import { config, isConfigured } from './config.js';

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
  const targetNumber = numero || config.destination;
  
  if (!isConfigured()) {
    console.warn('⚠️  WhatsApp: API não configurada');
    return { success: false, error: 'API não configurada' };
  }
  
  try {
    console.log(`📱 WhatsApp: Enviando mensagem para ${targetNumber}...`);
    
    const response = await api.post(config.endpoints.enviar, {
      numero: targetNumber,
      mensagem: mensagem,
    });
    
    console.log('✅ WhatsApp: Mensagem enviada com sucesso!');
    
    return {
      success: true,
      data: response.data,
    };
    
  } catch (error) {
    console.error('❌ WhatsApp: Erro ao enviar:', error.message);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data));
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Envia o relatório formatado para o número configurado
 * Usa o endpoint /enviar-relatorio com o formato correto
 * 
 * @param {Object} kpis - KPIs calculados do dia
 * @param {Object} analise - Análise histórica (opcional)
 * @returns {Promise<Object>} Resultado do envio
 */
export async function sendRelatorio(kpis, analise = null) {
  if (!isConfigured()) {
    console.warn('⚠️  WhatsApp: API não configurada');
    return { success: false, error: 'API não configurada' };
  }
  
  const numero = config.destination;
  const jid = `${numero}@s.whatsapp.net`;
  
  // Determina o período (Manhã ou Tarde)
  const hora = new Date().getHours();
  const periodo = hora < 12 ? 'Manhã' : 'Tarde';
  
  // Formata a data
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR'); // DD/MM/AAAA
  
  // Monta o payload no formato esperado pela API
  const payload = {
    jid: jid,
    numero: numero,
    dadosRelatorio: {
      ligacoesRecebidas: kpis.totalCalls || 0,
      ligacoesAtendidas: kpis.answered || 0,
      ligacoesAbandonadas: kpis.abandoned || 0,
      periodo: periodo,
      data: data,
      filas: kpis.peakHour ? [
        {
          momento: kpis.peakHour.hour || '00:00',
          quantidadePessoas: kpis.peakHour.count || 0,
        }
      ] : [],
    },
  };
  
  try {
    console.log(`📊 WhatsApp: Enviando relatório para ${numero}...`);
    console.log('   Payload:', JSON.stringify(payload, null, 2));
    
    const response = await api.post(config.endpoints.enviarRelatorio, payload);
    
    console.log('✅ WhatsApp: Relatório enviado com sucesso!');
    
    // Se tiver análise histórica, envia mensagem complementar
    if (analise && analise.analise) {
      await sendAnaliseHistorica(analise);
    }
    
    return {
      success: true,
      data: response.data,
    };
    
  } catch (error) {
    console.error('❌ WhatsApp: Erro ao enviar relatório:', error.message);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data));
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Envia mensagem com análise histórica (comparativo 15 dias)
 * @param {Object} analise - Dados da análise
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendAnaliseHistorica(analise) {
  if (!analise || !analise.analise) {
    return { success: false, error: 'Sem dados de análise' };
  }
  
  const { hoje, historico, analise: niveis } = analise;
  
  // Monta a mensagem de análise
  const totalAnalise = niveis.total;
  const emoji = totalAnalise.emoji || '📊';
  const nivel = totalAnalise.nivel || 'Indefinido';
  const percentual = totalAnalise.percentual || 0;
  
  // Texto da mensagem
  const mensagem = `${emoji} *Média da operação: ${nivel}*
comparado com os últimos 15 dias

📊 *Análise Detalhada:*
━━━━━━━━━━━━━━━━━━━━━━━━

✅ Atendidas: ${hoje.answered} (média: ${historico.medias.atendidas})
   ${niveis.atendidas.emoji} ${niveis.atendidas.percentual}% do esperado

📵 Abandonadas: ${hoje.abandoned} (média: ${historico.medias.abandonadas})
   ${niveis.abandonadas.emoji} ${niveis.abandonadas.percentual}% do esperado

🔄 Retidas URA: ${hoje.retainedURA} (média: ${historico.medias.retidasURA})
   ${niveis.retidasURA.emoji} ${niveis.retidasURA.percentual}% do esperado

━━━━━━━━━━━━━━━━━━━━━━━━
📈 *Volume total: ${percentual}% da média*
_Baseado nos últimos ${historico.dias} dias úteis_`;

  try {
    console.log(`📈 WhatsApp: Enviando análise histórica...`);
    
    // Pequeno delay para não enviar junto
    await new Promise(r => setTimeout(r, 2000));
    
    const result = await sendMessage(mensagem);
    
    if (result.success) {
      console.log('✅ WhatsApp: Análise histórica enviada!');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ WhatsApp: Erro ao enviar análise:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Envia o relatório para todos os números configurados na API
 * Usa o endpoint /enviar-relatorio-todos
 * 
 * @param {Object} kpis - KPIs calculados
 * @returns {Promise<Object>} Resultado do envio
 */
export async function sendRelatorioTodos(kpis) {
  const hora = new Date().getHours();
  const periodo = hora < 12 ? 'Manhã' : 'Tarde';
  const data = new Date().toLocaleDateString('pt-BR');
  
  const payload = {
    dadosRelatorio: {
      ligacoesRecebidas: kpis.totalCalls || 0,
      ligacoesAtendidas: kpis.answered || 0,
      ligacoesAbandonadas: kpis.abandoned || 0,
      periodo: periodo,
      data: data,
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
  const dateStr = now.toLocaleDateString('pt-BR', { 
    weekday: 'long', 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const total = kpis.totalCalls || 0;
  const answeredPct = total > 0 ? Math.round((kpis.answered / total) * 100) : 0;
  const abandonedPct = total > 0 ? Math.round((kpis.abandoned / total) * 100) : 0;
  
  const rateEmoji = answeredPct >= 80 ? '🟢' : answeredPct >= 60 ? '🟡' : '🔴';
  
  return `📊 *RELATÓRIO D0 - 55SYSTEM*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 *${dateStr}*
🕐 Gerado às ${timeStr}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *RESUMO DO DIA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Total de Ligações: *${total}*

✅ Atendidas: *${kpis.answered || 0}* (${answeredPct}%)
📵 Abandonadas: *${kpis.abandoned || 0}* (${abandonedPct}%)

${rateEmoji} Taxa de Atendimento: *${answeredPct}%*

${kpis.peakHour ? `🕐 Horário de Pico: *${kpis.peakHour.hour}* (${kpis.peakHour.count} lig.)` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_55SYSTEM | ReportsDAY_`;
}

export default {
  sendMessage,
  sendRelatorio,
  sendRelatorioTodos,
  getStatus,
  getGrupos,
  formatD0Report,
  isConfigured,
};
