import { program } from 'commander';
import { z, ZodError } from 'zod';
import type { CLIArguments } from '@/types/index.js';
import { logger } from '@/util/winston.js';
import { getEnv } from './env.js';

export function getArgs(): CLIArguments {
    const args: CLIArguments = getRawArgs();
    overwriteArgs(args);
    const validatedArgs = validateArgs(args);
    return validatedArgs;
}

/**
 * Get all raw Command Line Arguments
 */
function getRawArgs(): CLIArguments {
    program
    .option('-b, --bot-token <token>', 'Discord bot token', '')
    .option('-g, --guild-id <guildId>', 'Discord guild id', '')
    .option('-o, --output-directory <dir>', 'Output directory', './out')
    .option('-i, --image-directory <dir>', 'Image output directory', './img')
    .option('-f, --file-name <name>', 'Markdown file name', 'parent')
    .option('-l, --log <level>', 'Log level', 'info')
    .option('-w, --waypoint', 'Add obsidian waypoint', 'false')
    .parse(process.argv);

    return program.opts() as CLIArguments;
}

/**
 * Overwrite all arguments with .env variable
 */
function overwriteArgs(args: CLIArguments) {
    for (const key in args) {
        let envVar: string;

        /**
         * Match two or more argument words
         * @example botToken
         */
        if (key.match(/[A-Z]/)) {
            const match = key.match(/[A-Z]/)!;

            /** @example botToken -> BOT_TOKEN */
            envVar = `${key.slice(0, match.index)}_${key.slice(match.index)}`.toUpperCase();
        } else {
            envVar = key.toUpperCase();
        }

        const env = getEnv(envVar);

        if (env !== undefined) {
            args[key] = env;
        }
    }
}

function validateArgs(args: CLIArguments): CLIArguments {
    logger.info('Validating arguments');

    const schema: z.ZodType<CLIArguments> = z.object({
        botToken: z.string().min(1, 'Minimum 1 character'),
        guildId: z.string().min(1, 'Minimum 1 character'),
        outputDirectory: z.string().min(1, 'Minimum 1 character'),
        imageDirectory: z.string().min(1, 'Minimum 1 character'),
        fileName: z.string().min(1, 'Minimum 1 character'),
        log: z.enum(['info', 'error', 'debug'], 'Invalid value [infor | error | debug]'),
        waypoint: z.coerce.boolean()
    })

    try {
        const result = schema.parse(args);
        return result;
    } catch (e: unknown) {

        if (e instanceof ZodError) {
            logger.error(e.issues.map(e => `Argument [${e.path}]: ${e.message}`).toString());
        }
        process.exit(0);
    }
}