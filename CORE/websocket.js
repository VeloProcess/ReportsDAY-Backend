/**
 * CORE - WebSocket Manager
 * 
 * Gerencia conexões WebSocket para comunicação em tempo real
 * com o painel ReportsDAY
 */

import { WebSocketServer } from 'ws';

// Armazena todas as conexões ativas
const clients = new Set();

// Instância do servidor WebSocket
let wss = null;

/**
 * Inicializa o servidor WebSocket
 * @param {Object} server - Servidor HTTP do Express
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('🔗 WebSocket: Nova conexão estabelecida');
    clients.add(ws);
    
    // Envia status inicial
    sendToClient(ws, {
      type: 'log',
      payload: { message: 'Conectado ao servidor 55SYSTEM', level: 'success' },
    });
    
    // Handler de mensagens
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message);
      } catch (err) {
        console.error('WebSocket: Erro ao processar mensagem:', err);
      }
    });
    
    // Handler de desconexão
    ws.on('close', () => {
      console.log('🔌 WebSocket: Conexão fechada');
      clients.delete(ws);
    });
    
    // Handler de erro
    ws.on('error', (err) => {
      console.error('WebSocket: Erro:', err.message);
      clients.delete(ws);
    });
  });
  
  console.log('✅ WebSocket: Servidor inicializado em /ws');
}

/**
 * Processa mensagens recebidas dos clientes
 * @param {WebSocket} ws - Conexão do cliente
 * @param {Object} message - Mensagem recebida
 */
function handleMessage(ws, message) {
  switch (message.type) {
    case 'get_status':
      // O cliente solicita status - será tratado pelas rotas
      break;
      
    case 'reconnect_whatsapp':
      broadcast({
        type: 'log',
        payload: { message: 'Reconexão WhatsApp solicitada...', level: 'info' },
      });
      break;
      
    default:
      console.log('WebSocket: Mensagem desconhecida:', message.type);
  }
}

/**
 * Envia mensagem para um cliente específico
 * @param {WebSocket} ws - Conexão do cliente
 * @param {Object} data - Dados a enviar
 */
export function sendToClient(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Envia mensagem para todos os clientes conectados
 * @param {Object} data - Dados a enviar
 */
export function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Envia log para todos os clientes
 * @param {string} message - Mensagem do log
 * @param {string} level - Nível: info, success, error, warning, event
 */
export function broadcastLog(message, level = 'info') {
  broadcast({
    type: 'log',
    payload: { message, level },
  });
}

/**
 * Notifica nova chamada recebida
 * @param {Object} callData - Dados da chamada
 */
export function notifyNewCall(callData) {
  broadcast({
    type: 'new_call',
    payload: callData,
  });
}

/**
 * Envia atualização do D0
 * @param {Object} kpis - KPIs atualizados
 */
export function sendD0Update(kpis) {
  broadcast({
    type: 'd0_update',
    payload: kpis,
  });
}

/**
 * Retorna número de clientes conectados
 * @returns {number}
 */
export function getClientCount() {
  return clients.size;
}

export default {
  initWebSocket,
  broadcast,
  broadcastLog,
  notifyNewCall,
  sendD0Update,
  getClientCount,
};

