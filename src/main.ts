import { getArgs } from '@/util/args.js';
import { logger } from '@/util/winston.js';

function main() {
    const args = getArgs();
    /** Overwrite winston logger level */
    logger.level = args.log;


}

main();