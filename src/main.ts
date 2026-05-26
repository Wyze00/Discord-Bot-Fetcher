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
import type { CLIArguments } from './types/index.js';
import { ZodError } from 'zod';

let args: CLIArguments;

async function main() {
    try {
        printBanner();
        logger.info('Getting arguments')
        args = getArgs();
        /** Overwrite winston logger level */
        logger.level = args.log;

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

                /** Filter channels to just category channels */
                const categories = getAllCategories(allChannels);
                await writeFromCategory(allChannels, categories);

            } catch (error: unknown) {
                
                if (error instanceof DiscordjsError) {
                    logger.error(`${error.name}: ${error.message}`)
                } else if (error instanceof Error) {
                    logger.error(`${error.message}`);
                } else {
                    logger.error('Error');
                }

                process.exit(1);
            }
        })
        
        logger.info('Bot login')
        await bot.login(args.botToken);

    } catch (error: unknown) {

        if (error instanceof ZodError) {
            logger.error(error.issues.map(e => `Argument [${e.path}]: ${e.message}`).toString());
        }

        if (error instanceof DiscordjsError) {
            logger.error(`${error.name}: ${error.message}`)
        }

        process.exit(1);
    }
}

function printBanner() {
    CFonts.say('Discord|Bot|Fetcher', {
        font: 'block',       
        align: 'center',
        colors: ['system'],
        background: 'transparent',
        letterSpacing: 1,
        space: true,
        gradient: ['#FFB7B2', '#B2CEFE'],
    })
}

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

async function writeFromCategory(
        allChannels: Collection<string, NonThreadGuildBasedChannel | null>,
        categories: (CategoryChannel | null)[]
    ) {
    
    /** Loop every category */
    for (const category of categories) {
        const categoryName = category!.name.trim();

        /** Check if this category is blackisted */
        if (isBlacklisted(categoryName)) {
            continue;
        }

        logger.debug(`Fetching Category : "${categoryName}"`);
        
        /** Get all channels in that category */
        const channels = getAllChannelsFromCategory(allChannels, category!.id);
        await writeFromChannels(categoryName, channels);
    }
}

async function writeFromChannels(categoryName: string, channels: (NonThreadGuildBasedChannel | null)[]) {
    /** Loop every channel */
    for (const channel of channels) {
        const channelName = channel!.name.trim();
        const outputChannelDir = path.join(categoryName, channelName);

        /** Check if channel is Text so we can fetch every threads */
        if (channel!.type === ChannelType.GuildText) {

            /** Check if this chnnel is blacklisted */
            if (isBlacklisted(outputChannelDir)) {
                continue;
            }

            logger.debug(`Fetching Channel : "${outputChannelDir}"`);

            /** Fetch all threads */
            const threads = await getAllThreadsFromChannel(channel!);
            
            /** Loop all threads */
            for (const thread of threads) {
                await writeFromThread(thread, outputChannelDir);
            }

            await write(outputChannelDir, channel!);
            process.exit(0);
        }
    }
}

async function writeFromThread(thread: AnyThreadChannel, outputChannelDir: string) {
    const threadName = thread.name.trim();
    const outputThreadDir = path.join(outputChannelDir, threadName); 

    /** Check if this thread is blacklisted */
    if (isBlacklisted(outputThreadDir)) {
        return;
    }

    logger.debug(`Fetching Thread : "${outputThreadDir}"`);
    await write(outputThreadDir, thread);
}

async function write(outputDir: string, channel: TextChannel | AnyThreadChannel) {
    /** @example backup/category/channel/thread */
    const finalOutputDir = path.join(args.outputDirectory, outputDir);
    /** @example backup/category/channel/thread/img */
    const imgDir = path.join(finalOutputDir, args.imageDirectory);

    /** Create imgDir category if not exists */
    if (!fs.existsSync(imgDir)) {
        fs.mkdirSync(imgDir, { recursive: true });
    }

    /** Get all messages */
    const rawMessages: Message<true>[] = await getAllMessages(channel);
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

    /** Channel and waypoint flag active */
    if (channel instanceof TextChannel && args.waypoint) {
        markdownContent += `\n%% Waypoint %%\n`;
    }

    const fileName = args.fileName === 'parent' ? `${path.basename(outputDir)}.md` : `${args.fileName}.md`;
    console.log(fileName);
    fs.writeFileSync(path.join(finalOutputDir, fileName), markdownContent);
    logger.info(`Success write to : "${finalOutputDir}"`);
    writeBlacklistFile(outputDir);
}

main();