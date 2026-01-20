/**
 * CORE - Calculation Logger
 * 
 * Gera e salva arquivos JSON com todos os cálculos utilizados
 * para gerar as métricas do relatório
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Diretório onde serão salvos os JSONs
const LOGS_DIR = join(__dirname, '..', 'calculation-logs');

/**
 * Garante que o diretório de logs existe
 */
async function ensureLogsDirectory() {
  if (!existsSync(LOGS_DIR)) {
    await mkdir(LOGS_DIR, { recursive: true });
    console.log(`📁 Diretório de logs criado: ${LOGS_DIR}`);
  }
}

/**
 * Gera o JSON completo com todos os cálculos
 * @param {Object} params - Parâmetros do relatório
 * @param {string} params.tipo - Tipo de acionamento ('manual' ou 'automatico')
 * @param {Object} params.kpis - KPIs calculados do dia atual
 * @param {Object} params.analise - Análise histórica completa
 * @param {Object} params.result - Resultado do envio do WhatsApp
 * @param {number} params.duration - Duração da execução em ms
 * @returns {Object} JSON completo com cálculos
 */
export function generateCalculationJSON({ tipo, kpis, analise, result, duration }) {
  const agora = new Date();
  const dataFormatada = format(agora, 'dd/MM/yyyy');
  const horaFormatada = format(agora, 'HH:mm:ss');
  const timestampISO = agora.toISOString();
  
  // Determina tipo de dia
  const tipoDia = analise?.escalonada ? 'escalonado' : 'desconhecido';
  
  // Extrai informações escalonadas
  const escalonada = analise?.escalonada || null;
  const medias = escalonada?.medias || null;
  const analiseDetalhada = analise?.analise || null;
  
  // Monta o JSON completo
  const calculationData = {
    // ============================================
    // METADADOS
    // ============================================
    metadata: {
      timestamp: timestampISO,
      dataFormatada: dataFormatada,
      horaFormatada: horaFormatada,
      tipoAcionamento: tipo, // 'manual' ou 'automatico'
      tipoDia: tipoDia, // 'diaUtil', 'sabado', 'domingo', 'feriado'
      duracaoExecucao: `${duration}ms`,
      sucesso: result?.success || false,
      erro: result?.error || null,
    },
    
    // ============================================
    // KPIs DO DIA ATUAL
    // ============================================
    kpisDiaAtual: {
      totalCalls: kpis?.totalCalls || 0,
      answered: kpis?.answered || 0,
      abandoned: kpis?.abandoned || 0,
      avgWaitTime: kpis?.avgWaitTime || 0,
      lastUpdate: kpis?.lastUpdate || null,
      observacao: 'totalCalls = atendidas + abandonadas',
    },
    
    // ============================================
    // HISTÓRICO ESCALONADO (D-1 até D-7)
    // ============================================
    escalonada: escalonada ? {
      quantidadeDias: escalonada.quantidadeDias,
      diaUtilSemana: escalonada.diaUtilSemana,
      observacao: escalonada.quantidadeDias === 1
        ? 'Comparativo D-1: compara apenas com o último dia útil anterior.'
        : `Comparativo escalonado: média dos últimos ${escalonada.quantidadeDias} dias úteis (exclui domingos e feriados).`,
      dadosPorDia: escalonada.historico.map(dia => ({
        data: dia.data,
        atendidas: dia.atendidas,
        abandonadas: dia.abandonadas,
        total: dia.total,
        avgWaitTime: dia.avgWaitTime || 0,
        observacao: 'total = atendidas + abandonadas',
      })),
    } : null,
    
    // ============================================
    // MÉDIAS CALCULADAS (ESCALONADAS)
    // ============================================
    medias: medias ? {
      atendidas: {
        valor: medias.atendidas,
        formula: `somaAtendidas / quantidadeDiasReais`,
        calculo: escalonada ? (() => {
          const soma = escalonada.historico.reduce((sum, d) => sum + d.atendidas, 0);
          const qtd = escalonada.historico.length;
          return `${soma} / ${qtd} = ${medias.atendidas.toFixed(2)}`;
        })() : null,
      },
      abandonadas: {
        valor: medias.abandonadas,
        formula: `somaAbandonadas / quantidadeDiasReais`,
        calculo: escalonada ? (() => {
          const soma = escalonada.historico.reduce((sum, d) => sum + d.abandonadas, 0);
          const qtd = escalonada.historico.length;
          return `${soma} / ${qtd} = ${medias.abandonadas.toFixed(2)}`;
        })() : null,
      },
      total: {
        valor: medias.total,
        formula: `somaTotal / quantidadeDiasReais`,
        observacao: 'Total = atendidas + abandonadas. Representa chamadas que chegaram na fila humana.',
        calculo: escalonada ? (() => {
          const soma = escalonada.historico.reduce((sum, d) => sum + d.total, 0);
          const qtd = escalonada.historico.length;
          return `${soma} / ${qtd} = ${medias.total.toFixed(2)}`;
        })() : null,
      },
      espera: {
        valor: medias.espera || 0,
        formula: `soma(espera * totalChamadas) / soma(totalChamadas)`,
        observacao: 'Espera média é PONDERADA pelo volume de chamadas. Dias com mais chamadas têm peso maior.',
        calculo: escalonada ? (() => {
          const somaEsperaPonderada = escalonada.historico.reduce((sum, d) => sum + ((d.avgWaitTime || 0) * (d.total || 0)), 0);
          const somaTotalChamadas = escalonada.historico.reduce((sum, d) => sum + (d.total || 0), 0);
          return somaTotalChamadas > 0 
            ? `${somaEsperaPonderada} / ${somaTotalChamadas} = ${medias.espera || 0}s (ponderada)`
            : '0s (sem chamadas)';
        })() : null,
      },
    } : null,
    
    // ============================================
    // ANÁLISE COMPARATIVA ESCALONADA (DIFERENÇAS PERCENTUAIS)
    // ============================================
    analiseComparativa: analiseDetalhada ? {
      atendidas: {
        valorAtual: analiseDetalhada.atendidas.valorHoje,
        mediaEscalonada: analiseDetalhada.atendidas.mediaEscalonada,
        diferencaPercentual: analiseDetalhada.atendidas.diferencaPercentual,
        formula: `faltante = mediaEscalonada - valorHoje; percentualFaltante = (faltante / valorHoje) * 100`,
        calculo: analiseDetalhada.atendidas.mediaEscalonada && analiseDetalhada.atendidas.valorHoje > 0 ? (() => {
          const faltante = analiseDetalhada.atendidas.mediaEscalonada - analiseDetalhada.atendidas.valorHoje;
          const percentual = analiseDetalhada.atendidas.diferencaPercentual !== null ? analiseDetalhada.atendidas.diferencaPercentual.toFixed(2) + '%' : 'sem base';
          return `faltante = ${analiseDetalhada.atendidas.mediaEscalonada.toFixed(2)} - ${analiseDetalhada.atendidas.valorHoje} = ${faltante.toFixed(2)}; percentual = (${faltante.toFixed(2)} / ${analiseDetalhada.atendidas.valorHoje}) * 100 = ${percentual}`;
        })() : null,
        status: analiseDetalhada.atendidas.diferencaPercentual !== null && analiseDetalhada.atendidas.diferencaPercentual >= 0 ? 'acima' : 'abaixo',
      },
      abandonadas: {
        valorAtual: analiseDetalhada.abandonadas.valorHoje,
        mediaEscalonada: analiseDetalhada.abandonadas.mediaEscalonada,
        diferencaPercentual: analiseDetalhada.abandonadas.diferencaPercentual,
        formula: `faltante = mediaEscalonada - valorHoje; percentualFaltante = (faltante / valorHoje) * 100`,
        calculo: analiseDetalhada.abandonadas.mediaEscalonada && analiseDetalhada.abandonadas.valorHoje > 0 ? (() => {
          const faltante = analiseDetalhada.abandonadas.mediaEscalonada - analiseDetalhada.abandonadas.valorHoje;
          const percentual = analiseDetalhada.abandonadas.diferencaPercentual !== null ? analiseDetalhada.abandonadas.diferencaPercentual.toFixed(2) + '%' : 'sem base';
          return `faltante = ${analiseDetalhada.abandonadas.mediaEscalonada.toFixed(2)} - ${analiseDetalhada.abandonadas.valorHoje} = ${faltante.toFixed(2)}; percentual = (${faltante.toFixed(2)} / ${analiseDetalhada.abandonadas.valorHoje}) * 100 = ${percentual}`;
        })() : null,
        status: analiseDetalhada.abandonadas.diferencaPercentual !== null && analiseDetalhada.abandonadas.diferencaPercentual >= 0 ? 'acima' : 'abaixo',
      },
      total: {
        valorAtual: analiseDetalhada.total.valorHoje,
        mediaEscalonada: analiseDetalhada.total.mediaEscalonada,
        diferencaPercentual: analiseDetalhada.total.diferencaPercentual,
        formula: `faltante = mediaEscalonada - valorHoje; percentualFaltante = (faltante / valorHoje) * 100`,
        calculo: analiseDetalhada.total.mediaEscalonada && analiseDetalhada.total.valorHoje > 0 ? (() => {
          const faltante = analiseDetalhada.total.mediaEscalonada - analiseDetalhada.total.valorHoje;
          const percentual = analiseDetalhada.total.diferencaPercentual !== null ? analiseDetalhada.total.diferencaPercentual.toFixed(2) + '%' : 'sem base';
          return `faltante = ${analiseDetalhada.total.mediaEscalonada.toFixed(2)} - ${analiseDetalhada.total.valorHoje} = ${faltante.toFixed(2)}; percentual = (${faltante.toFixed(2)} / ${analiseDetalhada.total.valorHoje}) * 100 = ${percentual}`;
        })() : null,
        status: analiseDetalhada.total.diferencaPercentual !== null && analiseDetalhada.total.diferencaPercentual >= 0 ? 'acima' : 'abaixo',
      },
    } : null,
    
    // ============================================
    // PERCENTUAIS DO DIA ATUAL
    // ============================================
    percentuaisDiaAtual: kpis ? {
      atendidas: {
        valor: kpis.totalCalls > 0 ? (kpis.answered / kpis.totalCalls) * 100 : 0,
        formula: `(answered / totalCalls) * 100`,
        calculo: kpis.totalCalls > 0 ? `(${kpis.answered} / ${kpis.totalCalls}) * 100 = ${(kpis.answered / kpis.totalCalls) * 100}%` : '0% (sem ligações)',
      },
      abandonadas: {
        valor: kpis.totalCalls > 0 ? (kpis.abandoned / kpis.totalCalls) * 100 : 0,
        formula: `(abandoned / totalCalls) * 100`,
        calculo: kpis.totalCalls > 0 ? `(${kpis.abandoned} / ${kpis.totalCalls}) * 100 = ${(kpis.abandoned / kpis.totalCalls) * 100}%` : '0% (sem ligações)',
      },
    } : null,
    
    // ============================================
    // HORÁRIOS DE TRABALHO APLICADOS
    // ============================================
    horariosTrabalho: {
      tipoDia: tipoDia,
      horarioInicio: tipoDia === 'sabado' ? '09:00' : tipoDia === 'diaUtil' ? '08:00' : null,
      horarioFim: tipoDia === 'sabado' ? '15:00' : tipoDia === 'diaUtil' ? '19:00' : null,
      horarioReferencia: horaFormatada,
      observacao: tipoDia === 'domingo' || tipoDia === 'feriado' 
        ? 'Domingo ou feriado - não há processamento' 
        : `Dados coletados até ${horaFormatada}`,
    },
    
    // ============================================
    // RESULTADO DO ENVIO
    // ============================================
    resultadoEnvio: {
      sucesso: result?.success || false,
      mensagemEnviada: result?.success || false,
      erro: result?.error || null,
      messageId: result?.messageId || null,
    },
  };
  
  return calculationData;
}

/**
 * Salva o JSON de cálculo em arquivo
 * @param {Object} calculationData - Dados do cálculo gerados
 * @param {string} tipo - Tipo de acionamento ('manual' ou 'automatico')
 * @returns {Promise<string>} Caminho do arquivo salvo
 */
export async function saveCalculationJSON(calculationData, tipo) {
  try {
    await ensureLogsDirectory();
    
    const agora = new Date();
    const timestamp = format(agora, 'yyyy-MM-dd_HH-mm-ss');
    const tipoPrefix = tipo === 'manual' ? 'MANUAL' : 'AUTO';
    const filename = `calculo_${tipoPrefix}_${timestamp}.json`;
    const filepath = join(LOGS_DIR, filename);
    
    // Formata o JSON com indentação para facilitar leitura
    const jsonContent = JSON.stringify(calculationData, null, 2);
    
    await writeFile(filepath, jsonContent, 'utf-8');
    
    console.log(`📄 JSON de cálculo salvo: ${filepath}`);
    
    return filepath;
    
  } catch (error) {
    console.error('❌ Erro ao salvar JSON de cálculo:', error.message);
    throw error;
  }
}

/**
 * Salva cálculo completo (gera e salva)
 * @param {Object} params - Parâmetros
 * @param {string} params.tipo - Tipo de acionamento
 * @param {Object} params.kpis - KPIs calculados
 * @param {Object} params.analise - Análise histórica
 * @param {Object} params.result - Resultado do envio
 * @param {number} params.duration - Duração da execução
 * @returns {Promise<string>} Caminho do arquivo salvo
 */
export async function logCalculation({ tipo, kpis, analise, result, duration }) {
  try {
    const calculationData = generateCalculationJSON({ tipo, kpis, analise, result, duration });
    const filepath = await saveCalculationJSON(calculationData, tipo);
    return filepath;
  } catch (error) {
    console.error('❌ Erro ao gerar log de cálculo:', error.message);
    // Não lança erro para não interromper o fluxo principal
    return null;
  }
}

export default {
  generateCalculationJSON,
  saveCalculationJSON,
  logCalculation,
};

