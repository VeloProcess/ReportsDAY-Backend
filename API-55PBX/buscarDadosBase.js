/**
 * Script para buscar dados base dos dias 12, 13 e 14 de janeiro de 2026
 * Salva apenas a quantidade de ligações em CALCULOBASE.JSON
 */

import dotenv from 'dotenv';
import { resolve } from 'path';

// Carrega variáveis de ambiente do arquivo .env na raiz do backend
// process.cwd() = BACKEND/ReportsDAY-Backend-main/API-55PBX
// Precisamos subir 2 níveis para chegar em BACKEND/ReportsDAY-Backend-main
const envPath = resolve(process.cwd(), '..', '..', '.env');
console.log(`📁 Tentando carregar .env de: ${envPath}`);
dotenv.config({ path: envPath });

import { fetchDayDataAgregado } from './service.js';  // ⚠️ MÉTODO CORRETO - usar report_01
import { isConfigured } from './config.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { format } from 'date-fns';

// Caminho do arquivo na raiz do projeto
// process.cwd() = BACKEND/ReportsDAY-Backend-main/API-55PBX
// Precisamos subir 3 níveis para chegar na raiz: Reports day
const OUTPUT_FILE = join(process.cwd(), '..', '..', '..', 'CALCULOBASE.JSON');

async function buscarDadosBase() {
  console.log('📊 Buscando dados base dos dias 12, 13 e 14 de janeiro de 2026...');
  
  // Verifica se a API está configurada
  if (!isConfigured()) {
    console.error('❌ API 55PBX não está configurada!');
    console.error('   Verifique as variáveis de ambiente: API_55_TOKEN, API_55_URL');
    return;
  }
  
  console.log('✅ API 55PBX configurada');
  console.log('⏳ Aguardando 3 segundos para garantir que a API está pronta...');
  await new Promise(r => setTimeout(r, 3000));
  
  const dados = {
    dataGeracao: new Date().toISOString(),
    descricao: 'Quantidade de ligações (atendidas + abandonadas) dos dias 12, 13 e 14 de janeiro de 2026',
    dias: []
  };
  
  // Datas a buscar (criando objetos Date corretos)
  const datas = [
    new Date(2026, 0, 12, 0, 0, 0, 0), // 12/01/2026
    new Date(2026, 0, 13, 0, 0, 0, 0), // 13/01/2026
    new Date(2026, 0, 14, 0, 0, 0, 0)  // 14/01/2026
  ];
  
  for (const data of datas) {
    const dataFormatada = format(data, 'dd/MM/yyyy');
    console.log(`\n📅 Buscando dados de ${dataFormatada}...`);
    
    try {
      // ⚠️ MÉTODO CORRETO: Busca dados do dia inteiro usando report_01 (método correto validado)
      const dadosDia = await fetchDayDataAgregado(data, null);
      
      if (dadosDia && dadosDia.total !== undefined) {
        const diaInfo = {
          data: dataFormatada,
          quantidadeLigacoes: dadosDia.total || 0,
          atendidas: dadosDia.atendidas || 0,
          abandonadas: dadosDia.abandonadas || 0,
          detalhes: {
            total: dadosDia.total,
            atendidas: dadosDia.atendidas,
            abandonadas: dadosDia.abandonadas,
            recusadas: dadosDia.recusadas || 0
          }
        };
        
        dados.dias.push(diaInfo);
        
        console.log(`   ✅ ${diaInfo.data}: ${diaInfo.quantidadeLigacoes} ligações`);
        console.log(`      - Atendidas: ${diaInfo.atendidas}`);
        console.log(`      - Abandonadas: ${diaInfo.abandonadas}`);
      } else {
        console.log(`   ⚠️ Nenhum dado encontrado para ${dataFormatada}`);
        dados.dias.push({
          data: dataFormatada,
          quantidadeLigacoes: 0,
          atendidas: 0,
          abandonadas: 0,
          erro: 'Nenhum dado retornado pela API'
        });
      }
      
      // Delay entre requisições para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (error) {
      console.error(`   ❌ Erro ao buscar dados de ${dataFormatada}:`, error.message);
      dados.dias.push({
        data: dataFormatada,
        quantidadeLigacoes: 0,
        atendidas: 0,
        abandonadas: 0,
        erro: error.message
      });
    }
  }
  
  // Salva no arquivo JSON
  try {
    await writeFile(OUTPUT_FILE, JSON.stringify(dados, null, 2), 'utf-8');
    console.log(`\n✅ Dados salvos em: ${OUTPUT_FILE}`);
    console.log(`\n📊 Resumo:`);
    dados.dias.forEach(dia => {
      console.log(`   ${dia.data}: ${dia.quantidadeLigacoes} ligações`);
    });
  } catch (error) {
    console.error('❌ Erro ao salvar arquivo:', error.message);
  }
}

// Executa
buscarDadosBase().catch(console.error);

