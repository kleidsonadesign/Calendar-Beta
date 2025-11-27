require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { db } = require('./services/firebase');
const { parseDateText } = require('./utils/dateHelper');
const { createEvent, checkAvailability } = require('./services/googleClient');

// Configuração do Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Salva o login para não pedir QR Code toda vez
    puppeteer: {
        headless: true, // Roda sem abrir a janela do Chrome
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Gera o QR Code no terminal
client.on('qr', (qr) => {
    console.log('📱 ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

// Quando o bot estiver pronto
client.on('ready', () => {
    console.log('✅ Bot Online e conectado ao WhatsApp!');
});

// Escuta mensagens recebidas
client.on('message', async msg => {
    // Ignora mensagens de grupos e atualizações de status
    if (msg.from.includes('@g.us') || msg.from.includes('status')) return;

    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const texto = msg.body.toLowerCase().trim();
        // ID do usuário no banco será apenas os números do telefone
        const userId = msg.from.replace(/\D/g, ''); 

        // --- 1. FIRESTORE: Busca ou Cria o usuário ---
        const userRef = db.collection('contacts').doc(userId);
        const userDoc = await userRef.get();

        let userData;

        if (!userDoc.exists) {
            // Cliente novo: cria registro
            userData = { 
                phoneNumber: msg.from, 
                conversationStage: 'IDLE', 
                name: contact.pushname || '',
                createdAt: new Date()
            };
            await userRef.set(userData);
        } else {
            // Cliente antigo: pega dados
            userData = userDoc.data();
        }

        // Simula "digitando..." para parecer humano
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 1000));

        // --- 2. LÓGICA DA CONVERSA ---

        // ESTADO 1: Início (IDLE)
        if (userData.conversationStage === 'IDLE') {
            if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde'].some(t => texto.includes(t)) || 
                ['agendar', 'marcar', 'horario'].some(t => texto.includes(t))) {
                
                await client.sendMessage(msg.from, `Olá *${contact.pushname || 'Cliente'}*! 👋\nSou o assistente virtual da Barbearia.\n\nPara qual dia você gostaria de agendar?\n(Responda: *Hoje*, *Amanhã* ou uma data ex: *28/11*)`);
                
                // Atualiza estado para esperar a DATA
                await userRef.update({ conversationStage: 'ASKING_DATE' });
            }
        }

        // ESTADO 2: Esperando a Data
        else if (userData.conversationStage === 'ASKING_DATE') {
            const dataFormatada = parseDateText(texto);

            if (dataFormatada) {
                await client.sendMessage(msg.from, `Certo, dia *${dataFormatada.split('-').reverse().join('/')}*. 🗓️\n\nQual horário você prefere?\n(Digite ex: *14:00* ou *15h30*)`);
                
                // Atualiza estado para esperar a HORA e salva a data temporária
                await userRef.update({ 
                    conversationStage: 'ASKING_TIME', 
                    tempDate: dataFormatada 
                });
            } else {
                await client.sendMessage(msg.from, `Não entendi a data. 😕\nTente responder: *Hoje*, *Amanhã* ou dia/mês (ex: 25/11).`);
            }
        }

        // ESTADO 3: Esperando a Hora e Agendando
        else if (userData.conversationStage === 'ASKING_TIME') {
            // Regex para capturar hora (ex: 14:00, 14h, 9:00)
            const timeMatch = texto.match(/(\d{1,2})[:h]?(\d{2})?/);

            if (timeMatch) {
                const hora = timeMatch[1].padStart(2, '0');
                const minuto = timeMatch[2] || '00';
                const tempDate = userData.tempDate; // Data salva no passo anterior
                
                // Monta datas ISO para o Google (Fuso -03:00)
                const startISO = `${tempDate}T${hora}:${minuto}:00-03:00`;
                // Calcula fim (assumindo 1 hora de duração)
                const endHora = (parseInt(hora) + 1).toString().padStart(2, '0');
                const endISO = `${tempDate}T${endHora}:${minuto}:00-03:00`;

                await client.sendMessage(msg.from, `Verificando agenda... ⏳`);

                // Checa disponibilidade no Google
                const isFree = await checkAvailability(startISO, endISO);

                if (isFree) {
                    const nomeCliente = contact.pushname || `Cliente ${contact.number}`;
                    const nomeLimpo = nomeCliente.replace(/[^a-zA-Z0-9À-ÿ ]/g, ""); // Remove emojis

                    // Cria o evento
                    const sucesso = await createEvent(nomeLimpo, startISO, endISO);

                    if (sucesso) {
                        await client.sendMessage(msg.from, `✅ *Agendado com Sucesso!*\n\n👤 ${nomeLimpo}\n📅 ${tempDate.split('-').reverse().join('/')}\n⏰ ${hora}:${minuto}\n\nTe aguardamos! 💈`);
                        
                        // Reseta a conversa
                        await userRef.update({ conversationStage: 'IDLE', tempDate: null });
                    } else {
                        await client.sendMessage(msg.from, `Erro técnico ao salvar na agenda. Tente novamente mais tarde.`);
                        await userRef.update({ conversationStage: 'IDLE' });
                    }
                } else {
                    await client.sendMessage(msg.from, `❌ Puxa, o horário das *${hora}:${minuto}* já está ocupado.\nPor favor, escolha outro horário.`);
                }

            } else {
                await client.sendMessage(msg.from, `Horário inválido. Tente digitar assim: *14:00* ou *15h*.`);
            }
        }

        // COMANDO DE RESET
        if (texto === 'cancelar' || texto === 'sair') {
            await userRef.update({ conversationStage: 'IDLE', tempDate: null });
            await client.sendMessage(msg.from, `Conversa reiniciada. Digite *agendar* quando quiser.`);
        }

    } catch (err) {
        console.error("Erro fatal no bot:", err);
    }
});

client.initialize();