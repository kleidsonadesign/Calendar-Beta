require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { db, admin } = require('../services/firebase');
const { 
    parseDateText, 
    isBusinessDay, 
    isBusinessHours,
    createISODateTime,
    formatDisplayDate 
} = require('./utils/dateHelper');
const { 
    createEvent, 
    checkAvailability,
    cancelLastEvent 
} = require('../services/googleClient');

// ✅ Configurações do .env
const CONVERSATION_TIMEOUT = parseInt(process.env.CONVERSATION_TIMEOUT_MINUTES || '10') * 60 * 1000;
const APPOINTMENT_DURATION = parseInt(process.env.APPOINTMENT_DURATION_MINUTES || '60');

// Configuração do Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
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
    console.log(`⏰ Timeout de conversa: ${CONVERSATION_TIMEOUT / 60000} minutos`);
    console.log(`⏱️  Duração padrão: ${APPOINTMENT_DURATION} minutos`);
});

// Escuta mensagens recebidas
client.on('message', async msg => {
    // Ignora mensagens de grupos e atualizações de status
    if (msg.from.includes('@g.us') || msg.from.includes('status')) return;

    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const texto = msg.body.toLowerCase().trim();
        const userId = msg.from.replace(/\D/g, '');

        // --- 1. FIRESTORE: Busca ou Cria o usuário ---
        const userRef = db.collection('contacts').doc(userId);
        const userDoc = await userRef.get();

        let userData;

        if (!userDoc.exists) {
            userData = { 
                phoneNumber: msg.from, 
                conversationStage: 'IDLE', 
                name: contact.pushname || '',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await userRef.set(userData);
        } else {
            userData = userDoc.data();
            
            // ✅ CORREÇÃO: Verifica timeout de conversa
            if (userData.conversationStage !== 'IDLE' && userData.lastMessageAt) {
                const lastMessage = userData.lastMessageAt.toMillis();
                const timeSinceLastMessage = Date.now() - lastMessage;
                
                if (timeSinceLastMessage > CONVERSATION_TIMEOUT) {
                    await userRef.update({ 
                        conversationStage: 'IDLE',
                        tempDate: null,
                        lastMessageAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    return await client.sendMessage(msg.from, 
                        `⏱️ Sua conversa expirou por inatividade.\n\nDigite *agendar* para começar novamente.`);
                }
            }
            
            // Atualiza timestamp
            await userRef.update({ 
                lastMessageAt: admin.firestore.FieldValue.serverTimestamp() 
            });
        }

        // Simula "digitando..."
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 800));

        // --- COMANDOS GLOBAIS ---
        
        // ✅ NOVO: Comando de cancelamento
        if (texto.includes('cancelar agendamento') || texto.includes('desmarcar')) {
            const result = await cancelLastEvent(userId);
            
            if (result.success) {
                const eventDate = new Date(result.event.start.dateTime);
                await client.sendMessage(msg.from, 
                    `✅ *Agendamento Cancelado*\n\n` +
                    `📅 ${eventDate.toLocaleDateString('pt-BR')}\n` +
                    `⏰ ${eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n\n` +
                    `Para agendar novamente, digite *agendar*.`);
            } else {
                await client.sendMessage(msg.from, 
                    `❌ Não encontrei nenhum agendamento futuro para cancelar.`);
            }
            
            await userRef.update({ conversationStage: 'IDLE', tempDate: null });
            return;
        }

        if (texto === 'cancelar' || texto === 'sair' || texto === 'reiniciar') {
            await userRef.update({ conversationStage: 'IDLE', tempDate: null });
            return await client.sendMessage(msg.from, 
                `🔄 Conversa reiniciada.\n\nDigite *agendar* quando quiser marcar um horário.`);
        }

        // --- 2. MÁQUINA DE ESTADOS ---

        // ESTADO 1: Início (IDLE)
        if (userData.conversationStage === 'IDLE') {
            if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].some(t => texto.includes(t)) || 
                ['agendar', 'marcar', 'horario', 'horário'].some(t => texto.includes(t))) {
                
                await client.sendMessage(msg.from, 
                    `Olá *${contact.pushname || 'Cliente'}*! 👋\n\n` +
                    `Sou o assistente virtual da Barbearia.\n\n` +
                    `📅 Para qual dia você gostaria de agendar?\n\n` +
                    `Responda:\n` +
                    `• *Hoje*\n` +
                    `• *Amanhã*\n` +
                    `• Ou uma data (ex: *28/11*)`);
                
                await userRef.update({ conversationStage: 'ASKING_DATE' });
            } else {
                await client.sendMessage(msg.from, 
                    `Olá! Digite *agendar* para marcar um horário. ✂️`);
            }
        }

        // ESTADO 2: Esperando a Data
        else if (userData.conversationStage === 'ASKING_DATE') {
            const dataFormatada = parseDateText(texto);

            if (!dataFormatada) {
                return await client.sendMessage(msg.from, 
                    `❌ Não entendi a data.\n\n` +
                    `Tente responder:\n` +
                    `• *Hoje*\n` +
                    `• *Amanhã*\n` +
                    `• Ou dia/mês (ex: *25/12*)`);
            }

            // ✅ CORREÇÃO: Valida dia útil
            if (!isBusinessDay(dataFormatada)) {
                const diasFechados = (process.env.CLOSED_DAYS || '0').split(',');
                const nomesDias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
                const diasTexto = diasFechados.map(d => nomesDias[parseInt(d)]).join(', ');
                
                return await client.sendMessage(msg.from, 
                    `❌ Não abrimos neste dia.\n\n` +
                    `Dias fechados: ${diasTexto}\n\n` +
                    `Por favor, escolha outra data.`);
            }

            await client.sendMessage(msg.from, 
                `Perfeito! Dia *${formatDisplayDate(dataFormatada)}* 🗓️\n\n` +
                `⏰ Qual horário você prefere?\n\n` +
                `Digite no formato *HH:MM* (ex: *14:00* ou *09:30*)`);
            
            await userRef.update({ 
                conversationStage: 'ASKING_TIME', 
                tempDate: dataFormatada 
            });
        }

        // ESTADO 3: Esperando a Hora e Agendando
        else if (userData.conversationStage === 'ASKING_TIME') {
            // ✅ CORREÇÃO: Validação de hora melhorada
            const timeMatch = texto.match(/^(\d{1,2})[:h](\d{2})$/);

            if (!timeMatch) {
                return await client.sendMessage(msg.from, 
                    `❌ Formato de horário inválido.\n\n` +
                    `Use o formato *HH:MM*\n` +
                    `Exemplos: *14:00*, *09:30*, *16:45*`);
            }

            const hora = parseInt(timeMatch[1]);
            const minuto = parseInt(timeMatch[2]);

            // Valida range de horário
            if (hora > 23 || minuto > 59) {
                return await client.sendMessage(msg.from, 
                    `❌ Horário inválido.\n\n` +
                    `Use valores entre *00:00* e *23:59*`);
            }

            const horaStr = hora.toString().padStart(2, '0');
            const minutoStr = minuto.toString().padStart(2, '0');
            const timeFormatted = `${horaStr}:${minutoStr}`;

            // ✅ CORREÇÃO: Valida horário comercial
            if (!isBusinessHours(timeFormatted)) {
                const start = process.env.BUSINESS_HOURS_START || '09:00';
                const end = process.env.BUSINESS_HOURS_END || '18:00';
                
                return await client.sendMessage(msg.from, 
                    `❌ Horário fora do expediente.\n\n` +
                    `Atendemos das *${start}* às *${end}*\n\n` +
                    `Por favor, escolha outro horário.`);
            }

            const tempDate = userData.tempDate;
            
            // ✅ CORREÇÃO: Usa fuso horário correto
            const startISO = createISODateTime(tempDate, timeFormatted);
            
            // Calcula horário de fim
            const endDate = new Date(new Date(startISO).getTime() + APPOINTMENT_DURATION * 60000);
            const endISO = endDate.toISOString();

            await client.sendMessage(msg.from, `⏳ Verificando disponibilidade...`);

            // Checa disponibilidade no Google
            const isFree = await checkAvailability(startISO, endISO);

            if (isFree) {
                const nomeCliente = contact.pushname || `Cliente ${contact.number}`;
                const nomeLimpo = nomeCliente.replace(/[^a-zA-Z0-9À-ÿ ]/g, "");

                const result = await createEvent(nomeLimpo, startISO, endISO, userId);

                if (result.success) {
                    await client.sendMessage(msg.from, 
                        `✅ *Agendamento Confirmado!*\n\n` +
                        `👤 ${nomeLimpo}\n` +
                        `📅 ${formatDisplayDate(tempDate)}\n` +
                        `⏰ ${timeFormatted}\n` +
                        `⏱️  Duração: ${APPOINTMENT_DURATION} min\n\n` +
                        `💈 Te aguardamos!\n\n` +
                        `_Para cancelar, digite *CANCELAR AGENDAMENTO*_`);
                    
                    // Salva histórico
                    await db.collection('appointments').add({
                        userId,
                        customerName: nomeLimpo,
                        phoneNumber: msg.from,
                        date: tempDate,
                        time: timeFormatted,
                        startISO,
                        endISO,
                        eventId: result.eventId,
                        status: 'confirmed',
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    await userRef.update({ 
                        conversationStage: 'IDLE', 
                        tempDate: null,
                        lastAppointment: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    await client.sendMessage(msg.from, 
                        `❌ Erro técnico ao salvar na agenda.\n\n` +
                        `Por favor, tente novamente ou entre em contato.`);
                    await userRef.update({ conversationStage: 'IDLE' });
                }
            } else {
                await client.sendMessage(msg.from, 
                    `❌ O horário das *${timeFormatted}* já está ocupado.\n\n` +
                    `Por favor, escolha outro horário.`);
            }
        }

    } catch (err) {
        console.error("❌ Erro fatal no bot:", err);
        console.error("Stack:", err.stack);
        
        try {
            await client.sendMessage(msg.from, 
                `⚠️ Ocorreu um erro inesperado.\n\n` +
                `Por favor, tente novamente ou entre em contato conosco.`);
        } catch (sendError) {
            console.error("Erro ao enviar mensagem de erro:", sendError);
        }
    }
});

// ✅ Tratamento de erros globais
client.on('disconnected', (reason) => {
    console.error('❌ Bot desconectado:', reason);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada não tratada:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
    process.exit(1);
});

client.initialize();