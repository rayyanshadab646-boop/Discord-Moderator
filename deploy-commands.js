const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Issue a strike to a user (requires a reason)')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to strike')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for the strike (MANDATORY)')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('removestrike')
        .setDescription('Remove a strike from a user (requires higher role than issuer)')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to remove a strike from')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Time out a user for a specific duration in minutes')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to time out')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('duration')
                .setDescription('Duration in minutes (1 to 40320)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('untime')
        .setDescription('Remove a timeout from a user')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to untime')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Check the current strike count for a user')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to check')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('strikeinfo')
        .setDescription('View detailed strike history, issuers, reasons, and timestamps')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to inspect')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('timeoutinfo')
        .setDescription('View active timeout details, issuer, reason, and timestamp')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to inspect')
                .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands...');

        const clientId = Buffer.from(process.env.DISCORD_TOKEN.split('.')[0], 'base64').toString('ascii');

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands globally!');
    } catch (error) {
        console.error(error);
    }
})();
