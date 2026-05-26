export interface CLIArguments {
    botToken: string;
    guildId: string;
    outputDirectory: string;
    imageDirectory: string;
    fileName: string;
    log: 'info' | 'debug' | 'error';
    waypoint: boolean;
    [key: string]: any;
}