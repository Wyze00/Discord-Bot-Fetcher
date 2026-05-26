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
    return blacklistedFileNames.includes(fileName);
}

export function writeBlacklistFile(filename: string) {
    blacklistedChannelWriteSream.write(`${filename}\n`);
}