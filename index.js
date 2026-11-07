const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const express = require('express');
require('dotenv').config();

// --- KEEP-ALIVE WEB SERVER FOR RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is online and running!');
});

app.listen(PORT, () => {
    console.log(`Keep-alive server listening on port ${PORT}`);
});
// ----------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// --- CONFIGURE YOUR ROLE IDS DIRECTLY HERE ---
const ROLES_REQUIRING_REASON = [
    '111111111111111111', // Replace with Junior Mod Role ID 1
    '222222222222222222'  // Replace with Junior Mod Role ID 2
];

const ROLES_OPTIONAL_REASON = [
    '333333333333333333', // Replace with Senior Mod Role ID 1
    '444444444444444444', // Replace with Admin Role ID 2
    '555555555555555555'  // Add as many as you want here
];
// ---------------------------------------------

const userStrikes = new Map();

function getModPermissionCategory(member) {
    const memberRoles = member.roles.cache;

    if (member.permissions.has(PermissionFlagsBits.Administrator) || 
        ROLES_OPTIONAL_REASON.some(roleId => memberRoles.has(roleId))) {
        return 'OPTIONAL';
    }

    if (ROLES_REQUIRING_REASON.some(roleId => memberRoles.has(roleId))) {
        return 'REQUIRED';
    }

    return null;
}

client.once('ready', () => {
    console.log(`Bot operational as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, member, guild } = interaction;
    const permCategory = getModPermissionCategory(member);

    if (!permCategory) {
        return interaction.reply({ 
            content: 'You do not have permission to execute moderation commands.', 
            ephemeral: true 
        });
    }

    const targetUser = options.getUser('target');
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    const reasonInput = options.getString('reason');

    if (!targetMember) {
        return interaction.reply({ content: 'User not found in this server.', ephemeral: true });
    }

    if (permCategory === 'REQUIRED' && (!reasonInput || reasonInput.trim() === '')) {
        return interaction.reply({ 
            content: '❌ **Reason Required:** Your staff role requires you to specify a reason for moderation actions.', 
            ephemeral: true 
        });
    }

    const finalReason = reasonInput && reasonInput.trim() !== '' ? reasonInput : 'No reason provided by moderator.';

    if (commandName === 'strike') {
        const currentStrikes = (userStrikes.get(targetUser.id) || 0) + 1;
        userStrikes.set(targetUser.id, currentStrikes);

        let escalationText = '';

        if (currentStrikes === 2) {
            await targetMember.timeout(10 * 60 * 1000, 'Auto escalation: 2 strikes');
            escalationText = '\n⚠️ **Auto Escalation:** Applied 10-minute timeout for reaching 2 strikes.';
        } else if (currentStrikes === 3) {
            await targetMember.timeout(60 * 60 * 1000, 'Auto escalation: 3 strikes');
            escalationText = '\n🚨 **Auto Escalation:** Applied 1-hour timeout for reaching 3 strikes.';
        } else if (currentStrikes >= 4) {
            await targetMember.timeout(24 * 60 * 60 * 1000, 'Auto escalation: 4+ strikes');
            escalationText = '\n⛔ **Auto Escalation:** Applied 24-hour timeout for reaching 4+ strikes.';
        }

        await targetUser.send({
            content: `You received a strike in **${guild.name}**.\n**Reason:** ${finalReason}\n**Total Strikes:** ${currentStrikes}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('Strike Issued')
            .setColor(0xFF9900)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true },
                { name: 'Total Strikes', value: `${currentStrikes}`, inline: true },
                { name: 'Reason', value: finalReason }
            )
            .setTimestamp();

        return interaction.reply({ content: escalationText, embeds: [embed] });
    }

    if (commandName === 'timeout') {
        const durationMinutes = options.getInteger('duration');

        if (durationMinutes <= 0 || durationMinutes > 40320) {
            return interaction.reply({ content: 'Duration must be between 1 and 40,320 minutes (28 days).', ephemeral: true });
        }

        const durationMs = durationMinutes * 60 * 1000;
        await targetMember.timeout(durationMs, `${finalReason} (By ${member.user.tag})`);

        await targetUser.send({
            content: `You have been timed out in **${guild.name}** for **${durationMinutes} minute(s)**.\n**Reason:** ${finalReason}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('User Timed Out')
            .setColor(0xCC0000)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Duration', value: `${durationMinutes} min`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true },
                { name: 'Reason', value: finalReason }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'warnings') {
        const count = userStrikes.get(targetUser.id) || 0;
        return interaction.reply({
            content: `**${targetUser.tag}** currently has **${count}** strike(s).`,
            ephemeral: true
        });
    }
});

client.login(process.env.DISCORD_TOKEN);