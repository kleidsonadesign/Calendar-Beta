require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { db } = require('./services/firebase');

// O ID deve ser o mesmo usado no bot.js e googleClient.js
const COMPANY_ID = 'minha_barbearia';

const app = express();
const PORT = 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL
);

// Permissões necessárias: Ler e Escrever na Agenda
const SCOPES = [
    'https://www.googleapis.com/auth/calendar', 
    'https://www.googleapis.com/auth/calendar.events'
];

// Rota 1: Inicia o login -> Redireciona para o Google
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // CRUCIAL: 'offline' garante que receberemos o Refresh Token (acesso eterno)
    scope: SCOPES,
    prompt: 'consent' // Força o Google a perguntar de novo para garantir que mande o Refresh Token
  });
  res.redirect(authUrl);
});

// Rota 2: O Google devolve o usuário aqui com um código
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('Erro: Nenhum código recebido.');

  try {
    // Troca o código temporário pelos tokens reais
    const { tokens } = await oauth2Client.getToken(code);
    
    // Salva os tokens no Firebase na coleção 'companies'
    // Isso permite que o bot acesse essa conta depois sem precisar logar de novo
    await db.collection('companies').doc(COMPANY_ID).set({
        name: "Minha Barbearia",
        googleRefreshToken: tokens.refresh_token,
        googleToken: tokens.access_token,
        updatedAt: new Date()
    }, { merge: true });

    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: green;">Sucesso! 🔥</h1>
            <p>A conta do Google foi conectada ao Firebase.</p>
            <p>Você já pode fechar esta janela e rodar o comando <code>npm start</code> no terminal.</p>
        </div>
    `);
    
    console.log('✅ Tokens salvos com sucesso no Firebase!');
    
    // Encerra o servidor automaticamente após o sucesso para liberar o terminal
    setTimeout(() => {
        console.log('Encerrando servidor de autenticação...');
        process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('Erro ao conectar:', error);
    res.send('Erro ao autenticar. Veja o terminal para mais detalhes.');
  }
});

app.listen(PORT, () => {
  console.log(`--------------------------------------------------`);
  console.log(`🔗 SERVIDOR DE LOGIN RODANDO`);
  console.log(`👉 Para conectar a conta Google, abra este link no navegador:`);
  console.log(`   http://localhost:${PORT}/auth`);
  console.log(`--------------------------------------------------`);
});