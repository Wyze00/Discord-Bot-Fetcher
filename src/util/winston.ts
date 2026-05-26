import winston, { Logger } from 'winston';
import pc from 'picocolors';

export const logger: Logger = winston.createLogger({
    level: 'debug',
    transports: [
        new winston.transports.Console(),
    ],
    format: winston.format.printf((log: winston.Logform.TransformableInfo) => {
        return `[${getLevelColor(log.level)}] ${log.message}`;
    })
});

function getLevelColor(level: string) {
    level = level.toUpperCase();

    if (level === 'ERROR') {
        return pc.red(level);
    } else if (level === 'WARN') {
        return pc.yellow(level);
    } else if (level === 'INFO') {
        return pc.green(level);
    } else if (level === 'DEBUG') {
        return pc.cyan(level);
    } else {
        return pc.magenta(level);
    }
}