/**
 * API-55PBX - Dados de Referência
 * 
 * Módulo para carregar e validar dados de referência contra cálculos da API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { format } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminho do arquivo de referência
const REFERENCE_DATA_PATH = path.join(__dirname, '../REFERENCE_DATA/dados_referencia.json');

let referenceDataCache = null;
let lastLoadTime = null;

/**
 * Carrega dados de referência do arquivo JSON
 * @returns {Object|null} Dados de referência ou null se não encontrado
 */
export function loadReferenceData() {
  try {
    // Verifica se o arquivo existe
    if (!fs.existsSync(REFERENCE_DATA_PATH)) {
      console.warn(`⚠️ Arquivo de referência não encontrado: ${REFERENCE_DATA_PATH}`);
      return null;
    }

    // Carrega e faz parse do JSON
    const fileContent = fs.readFileSync(REFERENCE_DATA_PATH, 'utf-8');
    const data = JSON.parse(fileContent);
    
    referenceDataCache = data;
    lastLoadTime = new Date();
    
    console.log(`✅ Dados de referência carregados: ${Object.keys(data.dados || {}).length} dias`);
    return data;
    
  } catch (error) {
    console.error(`❌ Erro ao carregar dados de referência:`, error.message);
    return null;
  }
}

/**
 * Obtém dados de referência do cache ou carrega do arquivo
 * @returns {Object|null} Dados de referência
 */
function getReferenceData() {
  // Recarrega a cada 5 minutos para pegar atualizações
  if (!referenceDataCache || !lastLoadTime || (Date.now() - lastLoadTime.getTime()) > 300000) {
    return loadReferenceData();
  }
  return referenceDataCache;
}

/**
 * Converte hora para formato de intervalo (ex: 10:30 -> "10:30-11:00")
 * @param {Date} hora - Horário
 * @returns {string} Intervalo formatado
 */
function horaParaIntervalo(hora) {
  const horas = hora.getHours();
  const minutos = hora.getMinutes();
  
  // Arredonda para o último intervalo completo de 30 minutos
  const minutosAjustados = Math.floor(minutos / 30) * 30;
  
  // Formata início do intervalo
  const horaInicio = `${String(horas).padStart(2, '0')}:${String(minutosAjustados).padStart(2, '0')}`;
  
  // Calcula fim do intervalo (30 minutos depois)
  const minutosFim = minutosAjustados + 30;
  const horasFim = minutosFim >= 60 ? horas + 1 : horas;
  const minutosFimAjustados = minutosFim >= 60 ? minutosFim - 60 : minutosFim;
  const horaFim = `${String(horasFim).padStart(2, '0')}:${String(minutosFimAjustados).padStart(2, '0')}`;
  
  return `${horaInicio}-${horaFim}`;
}

/**
 * Obtém dados de referência para um período específico
 * @param {Date} data - Data do dia
 * @param {Date} horaInicio - Horário de início (ex: 08:00)
 * @param {Date} horaFim - Horário de fim (ex: 10:30)
 * @returns {Object|null} Dados agregados do período ou null se não encontrado
 */
export function getReferenceDataForPeriod(data, horaInicio, horaFim) {
  const refData = getReferenceData();
  if (!refData || !refData.dados) {
    return null;
  }

  const dataFormatada = format(data, 'dd/MM/yyyy');
  const diaData = refData.dados[dataFormatada];
  
  if (!diaData) {
    return null;
  }

  // Lista de intervalos a somar
  const intervalos = [];
  let horaAtual = new Date(horaInicio);
  
  // Gera lista de intervalos de 30 em 30 minutos até o horário de fim
  while (horaAtual <= horaFim) {
    const intervalo = horaParaIntervalo(horaAtual);
    intervalos.push(intervalo);
    
    // Próximo intervalo (30 minutos depois)
    horaAtual = new Date(horaAtual.getTime() + 30 * 60 * 1000);
  }

  // Soma os valores dos intervalos encontrados
  let totalAtendidas = 0;
  let totalAbandonadas = 0;
  let totalTotal = 0;
  let intervalosEncontrados = 0;

  intervalos.forEach(intervalo => {
    if (diaData[intervalo]) {
      totalAtendidas += diaData[intervalo].atendidas || 0;
      totalAbandonadas += diaData[intervalo].abandonadas || 0;
      totalTotal += diaData[intervalo].total || 0;
      intervalosEncontrados++;
    }
  });

  if (intervalosEncontrados === 0) {
    return null;
  }

  return {
    atendidas: totalAtendidas,
    abandonadas: totalAbandonadas,
    total: totalTotal,
    intervalosUsados: intervalosEncontrados,
    periodo: `${format(horaInicio, 'HH:mm')} até ${format(horaFim, 'HH:mm')}`,
  };
}

/**
 * Valida cálculo comparando com dados de referência
 * @param {Date} data - Data do dia
 * @param {Date} horaInicio - Horário de início
 * @param {Date} horaFim - Horário de fim
 * @param {Object} valoresCalculados - Valores calculados pela API {atendidas, abandonadas, total}
 * @returns {Object} Resultado da validação
 */
export function validateCalculation(data, horaInicio, horaFim, valoresCalculados) {
  const referencia = getReferenceDataForPeriod(data, horaInicio, horaFim);
  
  if (!referencia) {
    return {
      temReferencia: false,
      validado: false,
      mensagem: 'Sem dados de referência para este período',
    };
  }

  const diferencaAtendidas = Math.abs(valoresCalculados.atendidas - referencia.atendidas);
  const diferencaAbandonadas = Math.abs(valoresCalculados.abandonadas - referencia.abandonadas);
  const diferencaTotal = Math.abs(valoresCalculados.total - referencia.total);

  // Tolerância: considera correto se diferença for <= 1
  const tolerancia = 1;
  const atendidasOk = diferencaAtendidas <= tolerancia;
  const abandonadasOk = diferencaAbandonadas <= tolerancia;
  const totalOk = diferencaTotal <= tolerancia;

  const validado = atendidasOk && abandonadasOk && totalOk;

  return {
    temReferencia: true,
    validado,
    referencia,
    calculado: valoresCalculados,
    diferencas: {
      atendidas: diferencaAtendidas,
      abandonadas: diferencaAbandonadas,
      total: diferencaTotal,
    },
    mensagem: validado 
      ? 'Cálculo validado com sucesso' 
      : `Diferenças encontradas: Atendidas: ${diferencaAtendidas}, Abandonadas: ${diferencaAbandonadas}, Total: ${diferencaTotal}`,
  };
}

/**
 * Obtém valor corrigido da referência para um período
 * @param {Date} data - Data do dia
 * @param {Date} horaInicio - Horário de início
 * @param {Date} horaFim - Horário de fim
 * @returns {Object|null} Valores corrigidos ou null se não houver referência
 */
export function getCorrectedValue(data, horaInicio, horaFim) {
  return getReferenceDataForPeriod(data, horaInicio, horaFim);
}

export default {
  loadReferenceData,
  getReferenceDataForPeriod,
  validateCalculation,
  getCorrectedValue,
};

