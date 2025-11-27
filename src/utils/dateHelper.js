const { addDays, format, parse, isValid, startOfDay, getDay } = require('date-fns');
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');

// Fuso horário da aplicação (vindo do .env)
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';

function parseDateText(text) {
    const hoje = new Date();
    const hojeInicio = startOfDay(hoje);
    const texto = text.toLowerCase().trim();

    let parsedDate = null;

    // 1. Atalhos de texto simples
    if (texto.includes('hoje')) {
        parsedDate = hojeInicio;
    } else if (texto.includes('amanhã') || texto.includes('amanha')) {
        parsedDate = addDays(hojeInicio, 1);
    } 
    // 2. Tenta ler data no formato DD/MM (ex: 28/11)
    else {
        try {
            // Assume o ano atual
            parsedDate = parse(texto, 'dd/MM', new Date());
            
            if (!isValid(parsedDate)) {
                return null;
            }

            // ✅ CORREÇÃO: Se a data já passou este ano, assume ano seguinte
            if (parsedDate < hojeInicio) {
                parsedDate.setFullYear(hoje.getFullYear() + 1);
            }
        } catch (e) {
            return null;
        }
    }

    if (!parsedDate) return null;

    // ✅ CORREÇÃO: Bloqueia datas no passado
    if (parsedDate < hojeInicio) {
        return null;
    }

    return format(parsedDate, 'yyyy-MM-dd');
}

// ✅ NOVA FUNÇÃO: Verifica se é dia útil
function isBusinessDay(dateString) {
    const date = new Date(dateString);
    const day = getDay(date);
    
    // Configuração: Dias fechados (0 = Domingo, 1 = Segunda...)
    const closedDays = (process.env.CLOSED_DAYS || '0').split(',').map(Number);
    
    if (closedDays.includes(day)) {
        return false;
    }
    
    // TODO: Adicionar verificação de feriados no Firebase
    // const holidays = await getHolidays();
    // if (holidays.includes(dateString)) return false;
    
    return true;
}

// ✅ NOVA FUNÇÃO: Valida horário comercial
function isBusinessHours(time) {
    const [hora, minuto] = time.split(':').map(Number);
    
    // Configuração do .env (formato HH:MM)
    const startTime = process.env.BUSINESS_HOURS_START || '09:00';
    const endTime = process.env.BUSINESS_HOURS_END || '18:00';
    
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    const timeMinutes = hora * 60 + minuto;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
}

// ✅ NOVA FUNÇÃO: Cria ISO com fuso correto
function createISODateTime(dateString, time) {
    const [hora, minuto] = time.split(':');
    const localDateTime = `${dateString}T${hora}:${minuto}:00`;
    
    // Converte para UTC considerando o fuso local
    const utcDate = zonedTimeToUtc(localDateTime, TIMEZONE);
    return utcDate.toISOString();
}

// ✅ NOVA FUNÇÃO: Formata data para exibição
function formatDisplayDate(dateString) {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
}

module.exports = { 
    parseDateText, 
    isBusinessDay,
    isBusinessHours,
    createISODateTime,
    formatDisplayDate,
    TIMEZONE
};