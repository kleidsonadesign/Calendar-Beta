const { google } = require('googleapis');
const { db, admin } = require('./firebase');

// Configurações vindas do arquivo .env
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL
);

// ID da empresa vindo do .env
const COMPANY_ID = process.env.COMPANY_ID || 'minha_barbearia';

async function getAuthClient() {
  // 1. Busca o token salvo no Firestore
  const doc = await db.collection('companies').doc(COMPANY_ID).get();

  if (!doc.exists || !doc.data().googleRefreshToken) {
    throw new Error('ATENÇÃO: Conta Google não conectada. Rode "npm run auth" primeiro.');
  }

  const data = doc.data();

  // 2. Configura o cliente com os tokens do banco
  oauth2Client.setCredentials({
    refresh_token: data.googleRefreshToken,
    access_token: data.googleToken 
  });

  // ✅ CORREÇÃO: Usa transação para evitar race condition
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const docRef = db.collection('companies').doc(COMPANY_ID);
      try {
        await db.runTransaction(async (transaction) => {
          const doc = await transaction.get(docRef);
          if (!doc.exists) return;
          
          transaction.update(docRef, {
            googleToken: tokens.access_token,
            ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token }),
            lastTokenUpdate: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      } catch (error) {
        console.error('Erro ao atualizar token:', error);
      }
    }
  });

  return oauth2Client;
}

// Função para CRIAR o evento
async function createEvent(customerName, startISO, endISO, userId) {
  try {
    const auth = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const event = await calendar.events.insert({
      calendarId: 'primary',
      resource: {
        summary: `✂️ ${customerName}`,
        description: `Agendado pelo Bot WhatsApp\nID Cliente: ${userId}`,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        colorId: '2' // Cor verde na agenda
      },
    });
    
    return { success: true, eventId: event.data.id };
  } catch (error) {
    console.error('Erro ao criar evento no Google:', error);
    return { success: false, error: error.message };
  }
}

// Função para CHECAR DISPONIBILIDADE
async function checkAvailability(startISO, endISO) {
  try {
    const auth = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.freebusy.query({
      resource: {
        timeMin: startISO,
        timeMax: endISO,
        items: [{ id: 'primary' }],
      },
    });

    const busySlots = response.data.calendars.primary.busy;
    return busySlots.length === 0; 
  } catch (error) {
    console.error('Erro ao checar agenda:', error);
    return false;
  }
}

// ✅ NOVA FUNÇÃO: Cancelar último evento do cliente
async function cancelLastEvent(userId) {
  try {
    const auth = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // Busca eventos futuros deste cliente
    const now = new Date().toISOString();
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now,
      q: userId, // Busca pelo ID no description
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 1
    });

    if (response.data.items && response.data.items.length > 0) {
      const event = response.data.items[0];
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: event.id
      });
      return { success: true, event };
    }
    
    return { success: false, error: 'Nenhum agendamento encontrado' };
  } catch (error) {
    console.error('Erro ao cancelar evento:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { 
  createEvent, 
  checkAvailability, 
  cancelLastEvent,
  COMPANY_ID 
};