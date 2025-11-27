const { google } = require('googleapis');
const { db } = require('./firebase');

// Configurações vindas do arquivo .env
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL
);

// ID fixo da empresa no banco de dados
// Se você tiver vários clientes, isso viria dinamicamente
const COMPANY_ID = 'minha_barbearia';

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

  // 3. Se o Google atualizar o token automaticamente, salvamos o novo no Firebase
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await db.collection('companies').doc(COMPANY_ID).set({
        googleToken: tokens.access_token,
        ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token })
      }, { merge: true });
    }
  });

  return oauth2Client;
}

// Função para CRIAR o evento
async function createEvent(customerName, startISO, endISO) {
  try {
    const auth = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.insert({
      calendarId: 'primary',
      resource: {
        summary: `✂️ ${customerName}`,
        description: 'Agendado pelo Bot WhatsApp',
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        colorId: '2' // Cor verde na agenda (opcional)
      },
    });
    return true;
  } catch (error) {
    console.error('Erro ao criar evento no Google:', error);
    return false;
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

    // Se a lista de "busy" (ocupados) estiver vazia, retorna true (livre)
    const busySlots = response.data.calendars.primary.busy;
    return busySlots.length === 0; 
  } catch (error) {
    console.error('Erro ao checar agenda:', error);
    return false;
  }
}

module.exports = { createEvent, checkAvailability, COMPANY_ID };