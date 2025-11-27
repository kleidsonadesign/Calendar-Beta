const admin = require('firebase-admin');
const path = require('path');

// Caminho para a chave que você baixou do site do Firebase
// O arquivo deve estar na RAIZ do projeto, junto com o package.json
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');

// Inicializa o Firebase apenas se ainda não estiver ativo
if (!admin.apps.length) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("🔥 Firebase conectado com sucesso!");
  } catch (error) {
    console.error("❌ ERRO: Não encontrei o arquivo 'serviceAccountKey.json' na raiz do projeto.");
    console.error("1. Vá ao Console do Firebase > Configurações > Contas de Serviço.");
    console.error("2. Clique em 'Gerar nova chave privada'.");
    console.error("3. Renomeie o arquivo baixado para 'serviceAccountKey.json' e coloque na pasta do projeto.");
    process.exit(1);
  }
}

const db = admin.firestore();

module.exports = { db };