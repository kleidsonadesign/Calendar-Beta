const { addDays, format, parse, isValid } = require('date-fns');

function parseDateText(text) {
    const hoje = new Date();
    const texto = text.toLowerCase().trim();

    // 1. Atalhos de texto simples
    if (texto.includes('hoje')) {
        return format(hoje, 'yyyy-MM-dd');
    }

    if (texto.includes('amanhã') || texto.includes('amanha')) {
        return format(addDays(hoje, 1), 'yyyy-MM-dd');
    }

    // 2. Tenta ler data no formato DD/MM (ex: 28/11)
    try {
        // Assume o ano atual
        const parsedDate = parse(texto, 'dd/MM', new Date());
        
        if (isValid(parsedDate)) {
            // Se a data já passou este ano (ex: pediu 01/01 em Dezembro), 
            // assume que é para o ano que vem.
            if (parsedDate < addDays(hoje, -1)) {
                parsedDate.setFullYear(hoje.getFullYear() + 1);
            }
            return format(parsedDate, 'yyyy-MM-dd');
        }
    } catch (e) {
        return null;
    }
    return null;
}

module.exports = { parseDateText };