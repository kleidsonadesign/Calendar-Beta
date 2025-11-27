require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { db, admin } = require('./services/firebase');

// ✅ ID vindo do .env
const COMPANY_ID = process.env.COMPANY_ID || 'minha_barbearia';

const app = express();
const PORT = process.env.AUTH_SERVER_PORT || 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL
);

// Permissões necessárias
const SCOPES = [
    'https://www.googleapis.com/auth/calendar', 
    'https://www.googleapis.com/auth/calendar.events'
];

// Rota 1: Inicia o login
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

// Rota 2: Callback do Google
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('Erro: Nenhum código recebido.');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // ✅ Valida se recebeu o refresh token
    if (!tokens.refresh_token) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: orange;">⚠️ Atenção!</h1>
                <p>Não recebi o Refresh Token do Google.</p>
                <p>Isso acontece quando você já autorizou antes.</p>
                <h3>Solução:</h3>
                <ol style="text-align: left; max-width: 500px; margin: 20px auto;">
                    <li>Acesse: <a href="https://myaccount.google.com/permissions" target="_blank">https://myaccount.google.com/permissions</a></li>
                    <li>Remova a permissão do aplicativo</li>
                    <li>Tente novamente: <a href="/auth">Autenticar</a></li>
                </ol>
            </div>
        `);
    }
    
    await db.collection('companies').doc(COMPANY_ID).set({
        name: process.env.COMPANY_NAME || "Minha Barbearia",
        googleRefreshToken: tokens.refresh_token,
        googleToken: tokens.access_token,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: green;">✅ Sucesso!</h1>
            <p>A conta do Google foi conectada ao Firebase.</p>
            <p>Você já pode fechar esta janela e rodar:</p>
            <pre style="background: #f0f0f0; padding: 10px; border-radius: 5px;">npm start</pre>
        </div>
    `);
    
    console.log('✅ Tokens salvos com sucesso no Firebase!');
    
    setTimeout(() => {
        console.log('🔒 Encerrando servidor de autenticação...');
        process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('❌ Erro ao conectar:', error);
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: red;">❌ Erro</h1>
            <p>Falha ao autenticar. Verifique o terminal para detalhes.</p>
            <p><a href="/auth">Tentar Novamente</a></p>
        </div>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔐 SERVIDOR DE AUTENTICAÇÃO GOOGLE CALENDAR`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n📌 Para conectar sua conta Google, abra este link:\n`);
  console.log(`   👉 http://localhost:${PORT}/auth\n`);
  console.log(`${'='.repeat(60)}\n`);
});