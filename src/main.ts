import { getArgs } from '@/util/args.js';
import { logger } from '@/util/winston.js';
import { bot } from './util/client.js';
import { CategoryChannel, ChannelType, Collection, DiscordjsError, Guild, Message, TextChannel, type AnyThreadChannel, type FetchMessageOptions, type FetchMessagesOptions, type NonThreadGuildBasedChannel } from 'discord.js';
import CFonts from 'cfonts';
import { isBlacklisted, writeBlacklistFile } from './util/blacklisted.js';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

async function main() {
    printBanner();
    logger.info('Getting arguments')
    const args = getArgs();
    /** Overwrite winston logger level */
    logger.level = args.log;

    try {
        
        bot.once('clientReady', async () => {
            logger.info('Login successful');
            try {
                /** Fetch guild */
                const guild: Guild = await bot.guilds.fetch(args.guildId);

                if (!guild) {
                    throw new Error('Guild Not Found');
                }

                /** Fetch all channels in that guild (category, voice, text) */
                const allChannels = await guild.channels.fetch();

                /** Filter channels to just category */
                const categories = getAllCategories(allChannels);

                /** Loop every category */
                for (const category of categories) {
                    const categoryName = category!.name.trim();

                    /** Check if this category is blackisted */
                    if (isBlacklisted(categoryName)) {
                        continue;
                    }

                    /** Get all channels in that category */
                    const channels = getAllChannelsFromCategory(allChannels, category!.id);

                    /** Loop every channel */
                    for (const channel of channels) {
                        const channelName = channel!.name.trim();
                        const outputChannelDir = path.join(categoryName, channelName);

                        /** Check if channel is Text so we can fetch every threads */
                        if (channel!.type === ChannelType.GuildText && channel!.name === 'npm') {

                            /** Check if this chnnel is blacklisted */
                            if (isBlacklisted(outputChannelDir)) {
                                continue;
                            }

                            /** Fetch all threads */
                            const threads = await getAllThreadsFromChannel(channel!);
                            
                            /** Loop all threads */
                            for (const thread of threads) {
                                const threadName = thread.name.trim();
                                const outputThreadDir = path.join(categoryName, channelName, threadName); 

                                /** Check if this thread is blacklisted */
                                if (isBlacklisted(outputThreadDir)) {
                                    logger.debug(`Blacklisted ${outputThreadDir}`)
                                    continue;
                                }

                                /** @example backup/category/channel/thread */
                                const finalOutputThreadDir = path.join(args.outputDirectory, outputThreadDir);
                                /** @example backup/category/channel/thread/img */
                                const imgDir = path.join(finalOutputThreadDir, args.imageDirectory);

                                /** Create imgDir category if not exists */
                                if (!fs.existsSync(imgDir)) {
                                    fs.mkdirSync(imgDir, { recursive: true });
                                }

                                /** Get all messages */
                                const rawMessages: Message<true>[] = await getAllMessages(thread);
                                let markdownContent = ``;
                                let imageCounter = 1;

                                for (const message of rawMessages) {
                                    
                                    /** If there is a content, append */
                                    if (message.content) {
                                        const sanitizedMessage = sanitizeMarkdown(message.content);
                                        markdownContent += `${sanitizedMessage}\n\n`;
                                    }

                                    /** If there is attachment */
                                    if (message.attachments.size > 0) {

                                        for (const [key, attachment] of message.attachments) {

                                            /** Filter just image attachment */
                                            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                                                const ext = path.extname(attachment.name) || '.png';
                                                const fileName = `${imageCounter}${ext}`;
                                                const finalOutputImagePath = path.join(imgDir, fileName);

                                                const response = await fetch(attachment.url);

                                                if (response.ok && response.body) {
                                                    await pipeline(
                                                        Readable.fromWeb(response.body as any),
                                                        fs.createWriteStream(finalOutputImagePath)
                                                    );
                                                    
                                                    markdownContent += `![Attachment ${imageCounter}](./img/${fileName})\n\n`;
                                                    imageCounter++;

                                                } else {
                                                    markdownContent += `> [File: ${attachment.name}](${attachment.url})\n\n`;
                                                }
                                            }
                                        }
                                    }
                                }

                                fs.writeFileSync(path.join(finalOutputThreadDir, 'readme.md'), markdownContent);
                                writeBlacklistFile(outputThreadDir);
                                process.exit(0);
                            }
                        }
                    }
                }

            } catch (error: unknown) {
                
                if (error instanceof DiscordjsError) {
                    logger.error(`${error.name}: ${error.message}`)
                } else if (error instanceof Error) {
                    logger.error(`${error.message}`);
                } else {
                    logger.error('Error');
                }
            }
        })
        
        logger.info('Bot login')
        await bot.login(args.botToken);

    } catch (error: unknown) {
        
        if (error instanceof DiscordjsError) {
            logger.error(`${error.name}: ${error.message}`)
        }
    }
}

// main();

function getAllCategories(allChannels: Collection<string, NonThreadGuildBasedChannel | null>) {
    return Array.from(allChannels.values())
        .filter(c => c!.type === ChannelType.GuildCategory)
        .sort((a, b) => a!.name.localeCompare(b!.name));
}

function getAllChannelsFromCategory(allChannels: Collection<string, NonThreadGuildBasedChannel | null>, categoryId: string) {
    return Array.from(allChannels.values())
        .filter(c => c!.parentId === categoryId)
        .sort((a, b) =>a!.name.localeCompare(b!.name))
}

async function getAllThreadsFromChannel(channel: TextChannel) {
    const activeThreads = await channel!.threads.fetchActive();
    const archivedThreads = await channel!.threads.fetchArchived();
    return [
        ...activeThreads.threads.values(),
        ...archivedThreads.threads.values()
    ];
}

async function getAllMessages(channel: TextChannel | AnyThreadChannel) {
    let allMessages = [];
    let lastId;

    while (true) {
        const options: FetchMessagesOptions = { 
            limit: 100 
        };

        if (lastId){
         options.before = lastId;
        }    

        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) { 
            break;
        }

        allMessages.push(...messages.values());
        lastId = messages.last()!.id;
    }

    return allMessages.reverse();
}

function sanitizeMarkdown(message: string): string {
    const messageLine = message.split('\n');
    let isInsideCodeBlock = false;

    return messageLine.map(line => {

        /**
         * Sanitize invisible unicode character
         * \u2066-\u2069 : Isolate formatting characters
         * \u200B-\u200F : Zero-width spaces & marks
         * \u202A-\u202E : Embedding & override formatting characters
         */
        line = line.replace(/[\u2066-\u2069\u200B-\u200F\u202A-\u202E]/g, '');

        if (line.trim().startsWith('```')) {
            isInsideCodeBlock = !isInsideCodeBlock;
            return line;
        }

        /**
         * Add backtick to html tags
         */
        if (!isInsideCodeBlock) {
            
            const parts = line.split('`');
            
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    parts[i] = parts[i]!.replace(/<([^>]+)>/g, '`<$1>`');
                }
            }
            
            line = parts.join('`');
        }

        return line;
    }).join('\n');
}

function printBanner() {
    // CFonts.say('Discord|Bot|Fetcher', {
    //     font: 'block',       
    //     align: 'center',
    //     colors: ['system'],
    //     background: 'transparent',
    //     letterSpacing: 1,
    //     space: true,
    //     gradient: ['#FFB7B2', '#B2CEFE'],
    // })
}

function writeFromCategory(categories: CategoryChannel[]) {
    

}

main();