import fs from 'fs';
import { logger } from './winston.js';

let blacklistedFileNames: string[];
const blacklistedChannelWriteSream = fs.createWriteStream('blacklistedChannels.txt', {
                    flags: 'a',
                });


try {
    blacklistedFileNames = fs.readFileSync('blacklistedChannels.txt',{
        encoding: 'utf-8',
        flag: 'as+',
    }).split('\n');

    blacklistedChannelWriteSream.write(`-- Blacklist ${new Date().toISOString()} --\n`);
} catch (error) {
    logger.error(`Error while reading blacklisted channels`);    
}

export function isBlacklisted(fileName: string) {
    const blacklisted = blacklistedFileNames.includes(fileName);

    if (blacklisted) {
        logger.debug(`Skip blacklisted channel : "${fileName}"`);
    }

    return blacklisted;
}

export function writeBlacklistFile(filename: string) {
    logger.debug(`Blacklisting: "${filename}"`);
    blacklistedChannelWriteSream.write(`${filename}\n`);
}