/**
 * Importado antes de tudo em main.ts (import é içado: um comando solto no
 * main rodaria só depois de todos os módulos carregarem).
 *
 * Dias e meses são locais (`paraDia`, `diaDoProvedor`): se o processo subir
 * em UTC (serviço, container), compras da noite trocam de dia e de mês. O
 * usuário está no horário de Brasília. Quem definir TZ manda.
 */
process.env.TZ ||= 'America/Sao_Paulo';

export {};
